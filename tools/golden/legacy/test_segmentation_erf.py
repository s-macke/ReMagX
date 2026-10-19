import os
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from compare_segmentation_erf import compare, double_gamma_erf


class SegmentationErfGateTest(unittest.TestCase):
    def test_changed_source_never_reaches_compiler(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'shared').mkdir()
            (root / 'shared/LayerSegmentation.cpp').write_text('unreviewed source')
            with patch('compare_segmentation_erf.subprocess.run') as run:
                with self.assertRaisesRegex(ValueError, 'reviewed snapshot'):
                    compare(root, root / 'unused-library')
                run.assert_not_called()

    def test_independent_diagnostic_matches_its_mathematical_accuracy_bound(self):
        # This approximation deliberately stops at 3e-7. Its own mathematical
        # sanity bound is not a golden tolerance; compare() still applies D-23.
        self.assertEqual(double_gamma_erf(0), 0)
        for index in range(1, 501):
            position = index / 100
            value = double_gamma_erf(position)
            self.assertLessEqual(abs(value - math.erf(position)), 1e-7)
            self.assertEqual(double_gamma_erf(-position), -value)

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT') and os.environ.get('NATIVE_CORE'), 'private erf study not requested')
    def test_replacement_disagrees_with_legacy_at_existing_tolerance(self):
        result = compare(os.environ['LEGACY_ROOT'], os.environ['NATIVE_CORE'])
        self.assertEqual(result['samples'], 20001)
        self.assertGreater(result['independent_double_gamma']['failures_at_D23'], 0)
        self.assertGreater(result['same_grid_std_erf']['failures_at_D23'], 0)
        self.assertGreater(result['direct_std_erf']['maximum_absolute'], result['same_grid_std_erf']['maximum_absolute'])
        self.assertEqual(result['reflectivity']['same_grid_std_erf']['count'], 200)
        self.assertGreater(result['reflectivity']['same_grid_std_erf']['failures_at_D23'], 0)


if __name__ == '__main__':
    unittest.main()
