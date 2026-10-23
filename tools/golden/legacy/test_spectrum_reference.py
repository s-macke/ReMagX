import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from build_simulation_reference import build, REPOSITORY


@unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private legacy sources not requested')
class SpectrumReferenceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.directory.cleanup)
        cls.root = Path(cls.directory.name)
        try:
            cls.executable = build(os.environ['LEGACY_ROOT'], cls.root / 'reference', spectrum=True)
        except (OSError, ValueError, subprocess.CalledProcessError):
            raise RuntimeError('Private spectrum build failed; diagnostics withheld.') from None
        cls.fixture = (REPOSITORY / 'app/test/fixtures/default.all').read_text()

    def run_case(self, extra='', kind='optical', layer=1, element=0):
        (self.root / 'Co.db').write_text('700 .01 .001\n800 .02 .002\n')
        (self.root / 'Co.m').write_text('700 .0001 .00001\n800 .0002 .00002\n')
        project = self.root / 'public.all'
        project.write_text(self.fixture + '\nusechantlerdatabase = 0\nocautomatic = 0\ndisablescript = 1\n' + extra)
        inputs = [path for path in self.root.iterdir() if path.suffix in ['.all', '.db', '.m', '.ff']]
        before = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs}
        result = subprocess.run([self.executable, project, kind, str(layer), str(element)],
                                cwd=self.root, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.stderr, '')
        self.assertEqual(before, {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs})
        return result

    def test_compound_table_outputs_and_no_optimizer_linkage(self):
        for kind, expected in [('optical', [[700, .01, .001], [800, .02, .002]]),
                               ('magnetic', [[700, .0001, .00001], [800, .0002, .00002]])]:
            result = self.run_case(kind=kind)
            self.assertEqual(result.returncode, 0)
            for row, reference in zip(json.loads(result.stdout), expected, strict=True):
                for actual, value in zip(row, reference, strict=True):
                    self.assertLessEqual(abs(actual - value), 1e-15 + 1e-10 * abs(value))
        symbols = subprocess.run(['nm', '-C', self.executable], capture_output=True, text=True, check=True).stdout
        for forbidden in ['CChiSquareFit::', 'CMultiFit::']:
            self.assertNotIn(forbidden, symbols)
        self.assertIn('lua_newstate', symbols)

    def test_script_errors_and_invalid_selection_publish_no_partial_curve(self):
        result = self.run_case('disablescript = 0\nscriptline = error("public test")\n')
        self.assertEqual(result.returncode, 7)
        self.assertEqual(result.stdout, '')
        result = self.run_case(layer=1000000)
        self.assertEqual(result.returncode, 5)
        self.assertEqual(result.stdout, '')

    def test_zero_energy_is_skipped_only_for_scattering_factors(self):
        (self.root / 'Fe.ff').write_text('0 99 99\n700 20 1\n800 22 2\n')
        source = ('mode = 1\nelementlayerversion = 1\nelement = Fe\nel_f1 = 1\nel_f2 = 0\n' +
                  ''.join(f'el_layer = {index}\nel_d = 10\nel_density = .1\nel_sigma = 0\n' for index in range(3)))
        factors = self.run_case(source, kind='factors', layer=0)
        self.assertEqual(factors.returncode, 0)
        self.assertEqual(json.loads(factors.stdout), [[700, 20, 1], [800, 22, 2]])
        optical = self.run_case(source, kind='optical', layer=0)
        self.assertEqual(optical.returncode, 8)
        self.assertEqual(optical.stdout, '')
