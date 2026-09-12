"""Conversion contract tests; real tensor cases require torch and safetensors."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import prepare_macos as mac


class PlanTests(unittest.TestCase):
    def test_conversion_bakes_scales_and_removes_fp8_markers(self):
        header = {"scaled_fp8": {"dtype": "F32", "shape": [2], "data_offsets": [0, 8]},
                  "layer.weight": {"dtype": "F8_E4M3", "shape": [2, 3], "data_offsets": [8, 14]},
                  "layer.scale_weight": {"dtype": "F32", "shape": [], "data_offsets": [14, 18]},
                  "layer.scale_input": {"dtype": "F32", "shape": [], "data_offsets": [18, 22]},
                  "layer.bias": {"dtype": "BF16", "shape": [2], "data_offsets": [22, 26]}}
        plan, size = mac.conversion_plan(header)
        self.assertEqual(size, 16)
        result = {key: (scale, convert, spec) for key, scale, convert, spec in plan}
        self.assertEqual(set(result), {"layer.weight", "layer.bias"})
        self.assertEqual(result["layer.weight"][:2], ("layer.scale_weight", True))
        self.assertEqual(result["layer.weight"][2]["dtype"], "F16")
        self.assertEqual(result["layer.bias"][2]["dtype"], "BF16")

    def test_unknown_or_incomplete_quantization_fails(self):
        with self.assertRaisesRegex(ValueError, "pinned ComfyUI"):
            mac.conversion_plan({})
        with self.assertRaisesRegex(ValueError, "Missing scale"):
            mac.conversion_plan({"scaled_fp8": {}, "layer.weight": {"dtype": "F8_E4M3"}})
        with self.assertRaisesRegex(ValueError, "Orphan"):
            mac.conversion_plan({"scaled_fp8": {}, "missing.scale_weight": {}})

    def test_macos_weights_have_distinct_names(self):
        self.assertEqual(mac.model_name("high"), "wan2.2_i2v_high_noise_14B_mps_fp16.safetensors")
        with self.assertRaises(ValueError):
            mac.model_name("unknown")


@unittest.skipUnless(importlib.util.find_spec("torch") and importlib.util.find_spec("safetensors"),
                     "requires the sprite runtime (torch and safetensors)")
class TensorTests(unittest.TestCase):
    def test_checkpoint_roundtrip_scales_weights_preserves_bias_and_original(self):
        import torch
        from safetensors.torch import save_file, load_file
        with tempfile.TemporaryDirectory() as temp:
            source, target = Path(temp) / "source.safetensors", Path(temp) / "mac.safetensors"
            weights = torch.tensor([[-3., 0., .25], [1.5, 2., 4.]]).to(torch.float8_e4m3fn)
            scale = torch.tensor(.375)
            bias = torch.tensor([1., -2.], dtype=torch.bfloat16)
            save_file({"scaled_fp8": torch.zeros(2), "layer.weight": weights,
                       "layer.scale_weight": scale, "layer.scale_input": torch.tensor(5.), "layer.bias": bias}, source)
            original_hash = mac.sha256(source)
            record = mac.convert(source, target, original_hash)
            converted = load_file(target)
            self.assertEqual(set(converted), {"layer.weight", "layer.bias"})
            torch.testing.assert_close(converted["layer.weight"], (weights.float() * scale).half(), rtol=0, atol=0)
            torch.testing.assert_close(converted["layer.bias"], bias, rtol=0, atol=0)
            self.assertEqual(mac.sha256(source), original_hash)
            self.assertEqual(mac.convert(source, target, original_hash), record)
            with target.open("ab") as output:
                output.write(b"corruption")
            with self.assertRaisesRegex(RuntimeError, "provenance"):
                mac.verify(source, target, original_hash)

    def test_fp16_overflow_is_rejected(self):
        import torch
        with self.assertRaisesRegex(ValueError, "non-finite"):
            mac.dequantize(torch.tensor([448.]).to(torch.float8_e4m3fn), torch.tensor(1000.))


if __name__ == "__main__":
    unittest.main()
