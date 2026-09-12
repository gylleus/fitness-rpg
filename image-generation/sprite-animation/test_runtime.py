"""Platform policy checks that run without model weights or a GPU runtime."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import runtime

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


cli = module("sprite_cli_test", REPO / "tools/python/frpg_tools/cli.py")
setup = module("sprite_setup_test", ROOT / "setup.py")
with patch.dict(sys.modules, {"requests": Mock(), "resources": Mock()}):
    wan = module("wan_runtime_test", ROOT.parent / "pixel-animation-14b/run.py")
    pilot = module("pilot_runtime_test", ROOT / "comfy.py")


def fake_torch(cuda=False, mps=False):
    return SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: cuda),
                           backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: mps)))


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_auto_selects_available_gpu_and_cuda_keeps_priority(self):
        for cuda, mps, expected in ((True, False, "cuda"), (False, True, "mps"), (True, True, "cuda")):
            with self.subTest(expected=expected), patch.dict(sys.modules, {"torch": fake_torch(cuda, mps)}):
                self.assertEqual(runtime.device_name(), expected)
        with patch.dict(sys.modules, {"torch": fake_torch()}):
            with self.assertRaisesRegex(RuntimeError, "No CUDA or Apple MPS"):
                runtime.device_name()

    def test_explicit_device_never_silently_falls_back(self):
        with patch.dict(sys.modules, {"torch": fake_torch(mps=True)}):
            with patch.dict(os.environ, SPRITE_DEVICE="cuda"):
                with self.assertRaisesRegex(RuntimeError, "unavailable"):
                    runtime.device_name()
            with patch.dict(os.environ, SPRITE_DEVICE="cpu"):
                self.assertEqual(runtime.device_name(), "cpu")
            with patch.dict(os.environ, SPRITE_DEVICE="wrong"):
                with self.assertRaises(ValueError):
                    runtime.device_name()

    def test_linux_comfy_flags_and_timeout_are_preserved(self):
        with patch.object(runtime.platform, "system", return_value="Linux"):
            self.assertEqual(runtime.configured_device(), "cuda")
            self.assertEqual(runtime.comfy_flags(), ["--lowvram", "--reserve-vram", "1.5"])
            self.assertEqual(runtime.comfy_flags("1"), ["--lowvram", "--reserve-vram", "1"])
            self.assertEqual(runtime.inference_timeout(), 3600)

    def test_mac_uses_fp16_diffusion_cpu_vae_and_longer_timeout(self):
        with patch.object(runtime.platform, "system", return_value="Darwin"):
            self.assertEqual(runtime.configured_device(), "mps")
            self.assertIn("--fp16-unet", runtime.comfy_flags())
            self.assertIn("--cpu-vae", runtime.comfy_flags())
            self.assertNotIn("--cpu", runtime.comfy_flags())
            self.assertEqual(runtime.inference_timeout(), 14400)
        with patch.dict(os.environ, SPRITE_DEVICE="cpu"):
            self.assertEqual(runtime.comfy_flags(), ["--cpu"])
        for value in ("0", "-2", "bad"):
            with patch.dict(os.environ, SPRITE_INFERENCE_TIMEOUT=value):
                with self.assertRaises(ValueError):
                    runtime.inference_timeout()

    def test_cuda_tracking_autocast_is_not_used_on_mps_or_cpu(self):
        torch = Mock()
        with patch.dict(sys.modules, {"torch": torch}):
            with runtime.tracking_context("mps"), runtime.tracking_context("cpu"):
                torch.autocast.assert_not_called()
            runtime.tracking_context("cuda")
            torch.autocast.assert_called_once_with("cuda", dtype=torch.bfloat16)

    def test_wan_expert_graph_changes_only_the_mac_checkpoint(self):
        settings = dict(size=512, length=45, pixel_lora=1., distilled=True,
                        seed=72001, steps=4, split_step=2, cfg=1., sampler="ddim", shift=5., end_condition=True)
        preset = dict(prompt="knight breathing", negative="camera movement")
        for stage in ("high", "low"):
            with patch.dict(os.environ, SPRITE_DEVICE="cuda"):
                linux = wan.workflow("reference.png", preset, settings, stage)
            with patch.dict(os.environ, SPRITE_DEVICE="mps"), \
                    patch.object(sys, "path", [str(ROOT.parent / "pixel-animation-14b"), *sys.path]):
                mac = wan.workflow("reference.png", preset, settings, stage)
            self.assertEqual(linux["1"]["inputs"]["unet_name"], f"wan2.2_i2v_{stage}_noise_14B_fp8_scaled.safetensors")
            self.assertEqual(mac["1"]["inputs"]["unet_name"], f"wan2.2_i2v_{stage}_noise_14B_mps_fp16.safetensors")
            mac["1"] = linux["1"]
            self.assertEqual(mac, linux)

    def test_pilot_keeps_fp8_encoder_on_cpu_for_mac_only(self):
        settings = dict(size=512, length=45, shift=5., steps=4, cfg=1.)
        with patch.dict(os.environ, SPRITE_DEVICE="cuda"):
            linux = pilot.workflow("reference.png", "prompt", "negative", settings, 1)
        with patch.dict(os.environ, SPRITE_DEVICE="mps"):
            mac = pilot.workflow("reference.png", "prompt", "negative", settings, 1)
        self.assertEqual(linux["2"]["inputs"]["device"], "default")
        self.assertEqual(mac["2"]["inputs"]["device"], "cpu")
        mac["2"] = linux["2"]
        self.assertEqual(mac, linux)

    def test_cli_selects_distinct_interpreters_on_each_platform(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(cli, "ROOT", Path(temp)):
            base = Path(temp) / "image-generation/sprite-animation"
            for platform, env in (("darwin", ".venv-macos"), ("linux", ".venv")):
                python = base / env / "bin/python"
                python.parent.mkdir(parents=True)
                python.write_text("test interpreter placeholder")
                python.chmod(0o700)
                with patch.object(cli.sys, "platform", platform):
                    self.assertEqual(cli._sprite_python(), python)

    def test_mac_setup_bootstraps_without_study_environment(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(cli, "ROOT", Path(temp)), \
                patch.object(cli.sys, "platform", "darwin"), patch.object(cli, "_exec") as execute:
            cli.sprite_setup()
            execute.assert_called_once_with(Path(sys.executable), Path(temp) / "image-generation/sprite-animation/setup.py")

    def test_cli_preserves_explicit_fallback_setting(self):
        with patch.object(cli.sys, "platform", "darwin"), patch.object(cli.os, "execv"):
            cli._exec("python")
            self.assertEqual(os.environ["PYTORCH_ENABLE_MPS_FALLBACK"], "1")
            os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "0"
            cli._exec("python")
            self.assertEqual(os.environ["PYTORCH_ENABLE_MPS_FALLBACK"], "0")

    def test_mac_setup_does_not_install_into_linux_or_root_env(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(setup, "ROOT", Path(temp)), \
                patch.object(setup.platform, "machine", return_value="arm64"), patch.object(setup, "run") as run:
            setup.mac_environment()
            calls = run.call_args_list
            self.assertEqual(calls[0].args[-1], Path(temp) / ".venv-macos")
            self.assertEqual(calls[1].args[4], Path(temp) / ".venv-macos/bin/python")
            self.assertEqual(calls[1].args[-1], Path(temp) / "requirements-macos.lock.txt")
            self.assertEqual(calls[2].args[0], Path(temp) / ".venv-macos/bin/python")
        with patch.object(setup.platform, "machine", return_value="x86_64"), patch.object(setup, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "Rosetta"):
                setup.mac_environment()
            run.assert_not_called()

    def test_mac_pins_include_direct_requirements_and_exclude_cuda(self):
        def pins(path):
            return {line.split("==")[0].split("[")[0].lower().replace("_", "-"): line.split("==")[1]
                    for line in path.read_text().splitlines() if line and not line.startswith("#")}
        lock = pins(ROOT / "requirements-macos.lock.txt")
        for name, version in pins(ROOT / "requirements-macos.in").items():
            self.assertEqual(lock[name], version)
        self.assertEqual(lock["torch"], "2.8.0")
        self.assertEqual(lock["sympy"], "1.14.0")
        self.assertFalse(any(name.startswith("nvidia-") or name == "triton" for name in lock))


if __name__ == "__main__":
    unittest.main()
