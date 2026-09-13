"""Numerical failures must not become apparently successful black PNG files."""
import unittest
from unittest.mock import Mock

import numpy as np
from diffusers.image_processor import VaeImageProcessor

from sprite_references import checked_image


class ReferenceNumericsTests(unittest.TestCase):
    def test_nan_and_infinity_are_rejected_before_pixel_conversion(self):
        for value in (np.nan, np.inf, -np.inf):
            with self.subTest(value=value):
                pixels = np.zeros((2, 2, 3), dtype=np.float32)
                pixels[0, 0, 0] = value
                processor = Mock()
                with self.assertRaisesRegex(RuntimeError, "non-finite pixels"):
                    checked_image(processor, pixels)
                processor.numpy_to_pil.assert_not_called()

    def test_finite_output_keeps_diffusers_pixel_rounding(self):
        pixels = np.array([[[0., .5, 1.], [.1, .9, .25]]], dtype=np.float32)
        processor = VaeImageProcessor()
        image = checked_image(processor, pixels)
        self.assertEqual(image.mode, "RGB")
        self.assertEqual(image.size, (2, 1))
        self.assertEqual(image.tobytes(), processor.numpy_to_pil(pixels)[0].tobytes())
        self.assertEqual(image.getpixel((0, 0)), (0, 128, 255))


if __name__ == "__main__":
    unittest.main()
