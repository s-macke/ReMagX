import cmath
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from build_simulation_reference import build, HERE, REPOSITORY, SOURCES, LUA_DIRECTORY, LUA_SOURCES


class SimulationManifestTest(unittest.TestCase):
    def test_reviewed_translation_units(self):
        manifest = json.loads((HERE / 'simulation_sources.json').read_text())['sha256']
        self.assertEqual({name for name in manifest if name.endswith('.cpp')},
                         {'shared/' + name for name in SOURCES})
        self.assertEqual({name for name in manifest if name.endswith('.c')},
                         {LUA_DIRECTORY + '/' + name + '.c' for name in LUA_SOURCES})
        self.assertEqual(len(manifest), 99)
        self.assertNotIn('shared/CChiSquareFit.cpp', manifest)
        self.assertTrue(all(len(value) == 64 for value in manifest.values()))


@unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private legacy sources not requested')
class SimulationReferenceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.directory.cleanup)
        try:
            cls.executable = build(os.environ['LEGACY_ROOT'], Path(cls.directory.name) / 'reference')
        except (OSError, ValueError, subprocess.CalledProcessError):
            raise RuntimeError('Private simulation build failed; diagnostics withheld.') from None

    def run_fixture(self, path):
        result = subprocess.run([self.executable, path], capture_output=True, text=True,
                                cwd=self.directory.name, timeout=30)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, '')
        return json.loads(result.stdout)

    def test_public_default_curve_and_no_optimizer_linkage(self):
        points = self.run_fixture(REPOSITORY / 'app/test/fixtures/default.all')
        self.assertEqual(len(points), 300)
        self.assertAlmostEqual(points[0][0], .002)
        self.assertAlmostEqual(points[-1][0], .6)
        self.assertTrue(all(math.isfinite(value) for point in points for value in point))
        self.assertTrue(all(value >= 0 for _, value in points))
        self.assertGreater(max(value for _, value in points), min(value for _, value in points))
        symbols = subprocess.run(['nm', '-C', self.executable], check=True, capture_output=True, text=True).stdout
        for forbidden in ['CChiSquareFit::', 'CMultiFit::']:
            self.assertNotIn(forbidden, symbols)
        self.assertIn('lua_newstate', symbols)
        libraries = subprocess.run(['ldd', self.executable], check=True, capture_output=True, text=True).stdout
        self.assertNotIn('liblua', libraries)

    def test_zero_contrast_is_zero(self):
        content = (REPOSITORY / 'app/test/fixtures/default.all').read_text()
        content = re.sub(r'(?m)^(\s*layer_(?:delta|beta|ddelta|dbeta|sigma)\s*=).*$', r'\1 0', content)
        path = Path(self.directory.name) / 'zero.all'
        path.write_text(content)
        points = self.run_fixture(path)
        self.assertEqual(len(points), 300)
        self.assertTrue(all(abs(value) <= 1e-15 for _, value in points))

    def test_single_interface_matches_fresnel(self):
        content = (REPOSITORY / 'app/test/fixtures/default.all').read_text()
        content = re.sub(r'(?m)^(\s*layer_(?:delta|beta|ddelta|dbeta|sigma)\s*=).*$', r'\1 0', content)
        content = re.sub(r'(?m)^(\s*layer_delta\s*=).*$', r'\1 0.001', content, count=1)
        content = re.sub(r'(?m)^(\s*ray1sigmare\s*=).*$', r'\1 1', content)
        content = re.sub(r'(?m)^(\s*ray1piim\s*=).*$', r'\1 0', content)
        path = Path(self.directory.name) / 'interface.all'
        path.write_text(content)
        points = self.run_fixture(path)
        wave_number = 2 * math.pi * 777.198 / 12398.326
        for coordinate, actual in points:
            incident = coordinate / 2
            transmitted = cmath.sqrt(incident * incident + wave_number * wave_number * ((1 - .001) ** 2 - 1))
            expected = abs((incident - transmitted) / (incident + transmitted)) ** 2
            self.assertLessEqual(abs(actual - expected), 1e-15 + 1e-10 * abs(expected))

    def test_selected_dataset_order_and_shift_threshold(self):
        fixture = (REPOSITORY / 'app/test/fixtures/default.all').read_text()
        fixture = fixture.replace('usemeasurementqz = 0', 'usemeasurementqz = 1')
        selected = [.1, .03, .1, .07]
        for shift in [0, 1e-10, 1.1e-10, .007, -.007]:
            content = fixture + '\n' + '\n'.join([
                'datasetnumber = 1', 'dataset_qz = 0.4', 'dataset_R0 = 99',
                'datasetnumber = 2', f'datasetqztranslation = {shift}',
                'datasetmultiplicator = 9', 'datasettranslator = 2',
                *[line for value in selected for line in [f'dataset_qz = {value}', 'dataset_R0 = -7']],
                'activedatasetindex = 2', '',
            ])
            path = Path(self.directory.name) / 'dataset.all'
            path.write_text(content)
            points = self.run_fixture(path)
            expected = [value + (shift if abs(shift) > 1e-10 else 0) for value in selected]
            self.assertEqual([point[0] for point in points], expected)
            self.assertEqual(points[0][0], points[2][0])
            self.assertLessEqual(abs(points[0][1] - points[2][1]), 1e-15 + 1e-10 * abs(points[0][1]))
            self.assertTrue(all(math.isfinite(value) and value >= 0 for _, value in points))

    def test_dataset_selection_failure_publishes_no_curve(self):
        fixture = (REPOSITORY / 'app/test/fixtures/default.all').read_text()
        fixture = fixture.replace('usemeasurementqz = 0', 'usemeasurementqz = 1')
        for selected in [0, -1, 1000]:
            path = Path(self.directory.name) / 'invalid-selection.all'
            path.write_text(fixture + f'\nactivedatasetindex = {selected}\n')
            result = subprocess.run([self.executable, path], capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, '')
            self.assertEqual(result.stderr, '')

    def test_missing_input_has_no_diagnostics_or_partial_curve(self):
        result = subprocess.run([self.executable, Path(self.directory.name) / 'PRIVATE_MARKER.all'],
                                capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr, '')


if __name__ == '__main__':
    unittest.main()
