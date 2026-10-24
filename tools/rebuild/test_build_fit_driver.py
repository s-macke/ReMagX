import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import build_fit_driver as builder


class BuildBoundaryTests(unittest.TestCase):
    def test_output_cannot_enter_original_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, 'outside the legacy'):
                builder.build(root, root / 'new' / 'driver')
            self.assertEqual(list(root.iterdir()), [])

    def test_changed_source_closure_cannot_start_compilation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(builder, 'private_dependencies', return_value={}), \
                 patch.object(builder.subprocess, 'run') as compile_process:
                with self.assertRaisesRegex(ValueError, 'closure changed'):
                    builder.build(root / 'legacy', root / 'output' / 'driver')
                compile_process.assert_not_called()
            self.assertFalse((root / 'output').exists())

    def test_original_optimizer_source_is_rejected_before_reading(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            prohibited = root / 'shared/CChiSquareFit.cpp'
            with patch.object(builder, 'dependencies', return_value=[str(prohibited)]):
                with self.assertRaisesRegex(ValueError, 'optimizer implementation is prohibited'):
                    builder.private_dependencies(root)


if __name__ == '__main__':
    unittest.main()
