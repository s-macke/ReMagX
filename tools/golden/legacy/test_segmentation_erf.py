import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from compare_segmentation_erf import compare


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

    @unittest.skipUnless(os.environ.get('LEGACY_ROOT') and os.environ.get('NATIVE_CORE'), 'private erf study not requested')
    def test_replacement_disagrees_with_legacy_at_existing_tolerance(self):
        result = compare(os.environ['LEGACY_ROOT'], os.environ['NATIVE_CORE'])
        self.assertEqual(result['samples'], 20001)
        self.assertGreater(result['same_grid_std_erf']['failures_at_D23'], 0)
        self.assertGreater(result['direct_std_erf']['maximum_absolute'], result['same_grid_std_erf']['maximum_absolute'])
        self.assertEqual(result['reflectivity']['same_grid_std_erf']['count'], 200)
        self.assertGreater(result['reflectivity']['same_grid_std_erf']['failures_at_D23'], 0)


if __name__ == '__main__':
    unittest.main()
