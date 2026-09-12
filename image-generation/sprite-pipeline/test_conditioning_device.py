"""Long-prompt CLIP tensors follow the encoder rather than a hardcoded GPU."""
import importlib.util
from types import SimpleNamespace
import unittest

from sprite_references import conditioning


@unittest.skipUnless(importlib.util.find_spec("torch"), "requires the sprite runtime")
class ConditioningDeviceTests(unittest.TestCase):
    def test_cpu_encoders_process_every_prompt_chunk_without_cuda(self):
        import torch

        class Tokenizer:
            model_max_length = 6
            bos_token_id, eos_token_id, pad_token_id = 100, 101, 0

            def __call__(self, text, **kwargs):
                return {"input_ids": list(range(len(text.split())))}

        class Encoder:
            device = torch.device("cpu")

            def __call__(self, ids, **kwargs):
                self_device = self.device
                if ids.device != self_device:
                    raise AssertionError("Prompt tensor was allocated on the wrong device")
                hidden = ids.float().unsqueeze(-1)
                return SimpleNamespace(hidden_states=[hidden, hidden, hidden],
                                       text_embeds=ids.float().sum(dim=1, keepdim=True))

        pipe = SimpleNamespace(tokenizer=Tokenizer(), tokenizer_2=Tokenizer(),
                               text_encoder=Encoder(), text_encoder_2=Encoder())
        embeddings, record = conditioning(pipe, "one two three four five six seven eight nine", "avoid")
        self.assertEqual(record["chunks"], 3)
        self.assertEqual(record["truncated_tokens"], 0)
        self.assertEqual(tuple(embeddings["prompt_embeds"].shape), (1, 18, 2))
        self.assertEqual(embeddings["prompt_embeds"].device.type, "cpu")
        self.assertEqual(embeddings["negative_prompt_embeds"].shape, embeddings["prompt_embeds"].shape)


if __name__ == "__main__":
    unittest.main()
