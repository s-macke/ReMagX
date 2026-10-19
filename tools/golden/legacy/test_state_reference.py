import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from build_state_reference import build, HERE, REPOSITORY, SOURCES


class StateReferenceManifestTest(unittest.TestCase):
    def test_translation_units_exclude_optimizer_and_script_implementations(self):
        manifest = json.loads((HERE / 'state_sources.json').read_text())['sha256']
        units = {name for name in manifest if name.endswith('.cpp')}
        self.assertEqual(units, {'shared/' + name for name in SOURCES})
        self.assertEqual(len(manifest), 28)
        self.assertTrue(all(len(value) == 64 for value in manifest.values()))
        self.assertNotIn('shared/CChiSquareFit.cpp', manifest)
        self.assertNotIn('shared/LayerSegmentation.cpp', manifest)
        self.assertNotIn('shared/script.cpp', manifest)


@unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private legacy sources not requested')
class StateReferenceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.directory.cleanup)
        try:
            cls.executable = build(os.environ['LEGACY_ROOT'], Path(cls.directory.name) / 'reference')
        except (OSError, ValueError, subprocess.CalledProcessError):
            raise RuntimeError('Private loader reference build failed; diagnostics withheld.') from None

    def test_public_fixture_and_no_implementation_linkage(self):
        result = subprocess.run([self.executable, REPOSITORY / 'app/test/fixtures/default.all'],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, '')
        state = json.loads(result.stdout)
        self.assertEqual(len(state['films']), 1)
        self.assertEqual(len(state['films'][0]), 14)
        self.assertEqual(state['films'][0][0], [0, 5, .00165, .00029911, 0, 0, 90, 90])
        self.assertAlmostEqual(state['energy'], 777.198)
        symbols = subprocess.run(['nm', '-C', self.executable], check=True, capture_output=True, text=True).stdout
        for forbidden in ['CChiSquareFit::', 'CMultiFit::', 'lua_close', 'fftw_execute', 'LayerSegmentation']:
            self.assertNotIn(forbidden, symbols)

    def test_missing_input_does_not_publish_private_diagnostics(self):
        result = subprocess.run([self.executable, Path(self.directory.name) / 'PRIVATE_MARKER.all'],
                                capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr, '')


if __name__ == '__main__':
    unittest.main()
