import unittest

from export_sheet import skip_frames


class FrameSkippingTests(unittest.TestCase):
    def setUp(self):
        boundaries = [round(i * 62.5) for i in range(45)]
        self.loop = {"indices": list(range(44)), "end_exclusive": 44,
            "durations_ms": [b - a for a, b in zip(boundaries, boundaries[1:])]}

    def test_half_and_quarter_rate_preserve_cycle_and_source_indices(self):
        for stride, count, hold in ((2, 22, 125), (4, 11, 250)):
            result = skip_frames(self.loop, stride)
            self.assertEqual(result["indices"], list(range(0, 44, stride)))
            self.assertEqual(result["durations_ms"], [hold] * count)
            self.assertEqual(sum(result["durations_ms"]), 2750)
            self.assertNotIn(44, result["indices"])

    def test_partial_final_group_keeps_all_remaining_time(self):
        result = skip_frames(self.loop, 3)
        self.assertEqual(result["indices"][-1], 42)
        self.assertEqual(result["durations_ms"][-1], 125)
        self.assertEqual(sum(result["durations_ms"]), 2750)
        self.assertEqual(len(self.loop["indices"]), 44)

    def test_preserves_custom_holds_and_rejects_static_result(self):
        loop = {"indices": [3, 7, 8, 12, 15], "durations_ms": [40, 160, 75, 25, 300]}
        result = skip_frames(loop, 2)
        self.assertEqual(result["indices"], [3, 8, 15])
        self.assertEqual(result["durations_ms"], [200, 100, 300])
        for stride in (0, -1, 5):
            with self.assertRaises(ValueError):
                skip_frames(loop, stride)


if __name__ == "__main__":
    unittest.main()
