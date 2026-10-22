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

    def run_fixture(self, path, *options):
        result = subprocess.run([self.executable, path, *options], capture_output=True, text=True,
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

    def test_depth_profile_smooth_values_and_slice_boundaries(self):
        result = self.run_fixture(REPOSITORY / 'app/test/fixtures/default.all', '--profile')
        self.assertEqual(set(result), {'smooth', 'segments'})
        self.assertEqual(len(result['smooth']), len(result['segments']) + 1)
        self.assertGreater(len(result['segments']), 1)
        self.assertTrue(all(len(row) == 5 and all(map(math.isfinite, row)) for row in result['smooth']))
        self.assertTrue(all(len(row) == 6 and all(map(math.isfinite, row)) for row in result['segments']))
        for index, row in enumerate(result['segments']):
            self.assertEqual(row[0], result['smooth'][index][0])
            self.assertEqual(row[1], result['smooth'][index + 1][0])
            self.assertGreater(row[1], row[0])
            if index + 1 < len(result['segments']):
                for column in range(4):
                    self.assertEqual(result['smooth'][index + 1][column + 1],
                                     (row[column + 2] + result['segments'][index + 1][column + 2]) / 2)
        rejected = subprocess.run([self.executable, REPOSITORY / 'app/test/fixtures/default.all', '--profile', '--energy'],
                                  capture_output=True, text=True, timeout=30)
        self.assertEqual(rejected.returncode, 2)
        self.assertEqual(rejected.stdout, '')

    def test_density_grid_boundaries_and_scripted_values(self):
        base = (REPOSITORY / 'app/test/fixtures/default.all').read_text()
        settings = ['mode = 1', 'elementlayerversion = 2', 'ocautomatic = 0', 'disablescript = 1', 'minlayerthickness = 10']
        for element, roughness in [('Fe', 5), ('Co', 50)]:
            settings += ['element = ' + element, 'el_f1 = 1', 'el_f2 = 0',
                'el_layer = 0', 'el_density = 0.1', 'el_sigma = 100',
                'el_layer = 1', 'el_d = 10', 'el_density = 0.1', 'el_sigma = ' + str(roughness),
                'el_layer = 2', 'el_density = 0.1', 'el_sigma = 0']
        path = Path(self.directory.name) / 'density.all'
        source = base + '\n' + '\n'.join(settings) + '\n'
        path.write_text(source)
        result = self.run_fixture(path, '--density')
        self.assertEqual([row[0] for row in result['smooth']], list(range(-30, 50, 10)))
        self.assertEqual([[row[0] for row in element] for element in result['boundaries']], [[0, 10], [0, 10]])
        self.assertTrue(all(math.isclose(value, .1, rel_tol=1e-10, abs_tol=1e-15)
            for row in result['smooth'] for value in row[1:]))
        path.write_text(source + 'disablescript = 0\nscriptline = Fe:setthickness(1,20); for i=0,2 do Fe:setdensity(i,0.25) end\n')
        scripted = self.run_fixture(path, '--density')
        self.assertEqual(scripted['smooth'][-1][0], 50)
        self.assertTrue(all(math.isclose(row[1], .25, rel_tol=1e-10, abs_tol=1e-15) for row in scripted['smooth']))
        self.assertEqual([row[0] for row in scripted['boundaries'][0]], [0, 20])
        path.write_text(source.replace('el_d = 10', 'el_d = 0'))
        for options, code in [(('--density',), 12), (('--density', '--profile'), 2), (('--density', '--density'), 2)]:
            failed = subprocess.run([self.executable, path, *options], capture_output=True, text=True, cwd=self.directory.name, timeout=30)
            self.assertEqual(failed.returncode, code)
            self.assertEqual(failed.stdout, '')

    def test_profile_default_segmentation_is_local_when_key_is_absent(self):
        source = (REPOSITORY / 'app/test/fixtures/default.all').read_text()
        source = re.sub(r'^segmentationmodel\s*=.*$', '', source, flags=re.MULTILINE)
        path = Path(self.directory.name) / 'profile-default.all'
        path.write_text(source + '\n')
        omitted = self.run_fixture(path, '--profile')
        path.write_text(source + '\nsegmentationmodel = 2\n')
        local = self.run_fixture(path, '--profile')
        for section in ['smooth', 'segments']:
            self.assertEqual(len(omitted[section]), len(local[section]))
            for left, right in zip(omitted[section], local[section]):
                self.assertTrue(all(math.isclose(a, b, rel_tol=1e-10, abs_tol=1e-15) for a, b in zip(left, right)))
        path.write_text(source + '\nsegmentationmodel = 1\n')
        global_profile = self.run_fixture(path, '--profile')
        self.assertNotEqual(global_profile, local)

    def test_two_beams_and_both_asymmetry_definitions(self):
        fixture = (REPOSITORY / 'app/test/fixtures/default.all').read_text()
        for definition in [0, 1]:
            path = Path(self.directory.name) / 'asymmetry.all'
            path.write_text(fixture + f'\nmagnetizationmode = 1\nasymmetrydef = {definition}\n')
            points = self.run_fixture(path, '--asymmetry')
            self.assertEqual(len(points), 300)
            self.assertTrue(all(len(point) == 4 for point in points))
            self.assertTrue(any(abs(plus - minus) > 1e-12 for _, plus, minus, _ in points))
            for coordinate, plus, minus, actual in points:
                self.assertTrue(all(math.isfinite(value) for value in [coordinate, plus, minus, actual]))
                expected = (plus - minus) / (plus + minus) if definition == 0 and plus + minus else plus - minus
                self.assertLessEqual(abs(actual - expected), 1e-15 + 1e-10 * abs(expected))

    def test_fourier_gui_flags_and_corrected_transform_order(self):
        fixture = (REPOSITORY / 'app/test/fixtures/default.all').read_text()
        path = Path(self.directory.name) / 'fourier.all'
        path.write_text(fixture + '\nnumberofpoints = 17\naveraging = 1\nray1sigmare = 0\nray1sigmaim = 0\nray1pire = 1\nray1piim = 0\n')
        baseline = self.run_fixture(path, '--multiply-qz4', '--divide-pi')
        actual = self.run_fixture(path, '--fourier', '--multiply-qz4', '--divide-pi')
        self.assertEqual(len(actual), len(baseline) // 2)
        signal = [value * ((qz * qz) * (qz * qz)) *
                  .5 * (1 - math.cos(2 * 3.141592 * index / (len(baseline) + 1)))
                  for index, (qz, value) in enumerate(baseline)]
        for frequency, (depth, magnitude) in enumerate(actual):
            expected = abs(sum(value * cmath.exp(-2j * math.pi * frequency * index / len(signal))
                               for index, value in enumerate(signal))) if frequency else 0
            self.assertLessEqual(abs(magnitude - expected), 1e-15 + 1e-10 * abs(expected))
            self.assertEqual(depth, 2 * 3.141592 * frequency / baseline[-1][0])
        for options in [('--fourier', '--energy'), ('--fourier', '--asymmetry'), ('--fourier', '--fourier')]:
            result = subprocess.run([self.executable, path, *options], capture_output=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout, b'')

    def test_fourier_column_layout_diagnostic_does_not_publish_curves(self):
        self.write_energy_tables()
        fixture = (REPOSITORY / 'app/test/fixtures/default.all').read_text()
        path = Path(self.directory.name) / 'fourier-layout.all'
        for algorithm in [0, 1, 2]:
            path.write_text(fixture + f'\nalgorithm = {algorithm}\nnumberofpoints = 8\n'
                            'engscanmin = 700\nengscanmax = 900\nmagnetizationmode = 1\n')
            for options in [('--asymmetry',), ('--energy',), ('--energy', '--asymmetry')]:
                with self.subTest(algorithm=algorithm, options=options):
                    baseline = self.run_fixture(path, *options, '--column-layout')
                    transformed = self.run_fixture(path, *options, '--fourier', '--column-layout')
                    self.assertEqual(set(transformed), {'acceptancePassed', 'qz', 'energy',
                                                       'reflectivity', 'plus', 'minus', 'asymmetry'})
                    self.assertFalse(transformed['acceptancePassed'])
                    self.assertEqual(transformed['qz'], baseline['qz'] // 2)
                    self.assertEqual(transformed['reflectivity'], baseline['reflectivity'] // 2)
                    for column in ['energy', 'plus', 'minus', 'asymmetry']:
                        self.assertEqual(transformed[column], baseline[column])
                    if '--asymmetry' in options:
                        self.assertGreater(transformed['plus'], transformed['qz'])
                    if '--energy' in options:
                        self.assertGreater(transformed['energy'], transformed['reflectivity'])
                    rejected = subprocess.run([self.executable, path, *options, '--fourier'],
                                              capture_output=True, timeout=30)
                    self.assertEqual(rejected.returncode, 2)
                    self.assertEqual(rejected.stdout, b'')

    def write_energy_tables(self):
        for name, minimum, maximum, delta, beta in [
                ('Cu', 710, 890, .0016, .0002), ('Co', 720, 880, .003, .001),
                ('vacuum', 700, 900, 0, 0)]:
            Path(self.directory.name, name + '.db').write_text(
                f'{minimum} {delta * .9:.17g} {beta * .9:.17g}\n'
                f'{maximum} {delta * 1.1:.17g} {beta * 1.1:.17g}\n')
            magnetic = .0001 if name == 'Co' else 0
            Path(self.directory.name, name + '.m').write_text(
                f'{minimum} {magnetic:.17g} {magnetic / 2:.17g}\n'
                f'{maximum} {magnetic * 2:.17g} {magnetic:.17g}\n')

    def test_energy_grid_table_intersection_and_two_beams(self):
        self.write_energy_tables()
        fixture = (REPOSITORY / 'app/test/fixtures/default.all').read_text()
        path = Path(self.directory.name) / 'energy.all'
        path.write_text(fixture + '\nnumberofpoints = 8\nengscanmin = 700\nengscanmax = 900\nmagnetizationmode = 1\n')
        for options in [('--energy',), ('--energy', '--angle'), ('--energy', '--asymmetry')]:
            rows = self.run_fixture(path, *options)
            self.assertEqual([row[0] for row in rows], list(range(720, 881, 20)))
            self.assertTrue(all(len(row) == (4 if '--asymmetry' in options else 2) for row in rows))
            self.assertTrue(all(math.isfinite(value) for row in rows for value in row))
            self.assertGreater(max(row[1] for row in rows), min(row[1] for row in rows))

    def test_element_energy_grid_is_not_clipped_to_scattering_tables(self):
        fixture = (REPOSITORY / 'app/test/fixtures/default.all').read_text()
        # Fresh element loading does not populate MATERIAL entries used by
        # GetMaximumEnergyRange, even if matching compound files exist nearby.
        self.write_energy_tables()
        Path(self.directory.name, 'Fe.ff').write_text('750 26 0.1\n850 26 0.1\n')
        Path(self.directory.name, 'Fe.ffm').write_text('775 0 0\n825 0 0\n')
        settings = '\n'.join([
            'mode = 1', 'elementlayerversion = 2', 'element = Fe',
            'el_f1 = 26', 'el_f2 = 0.1', 'el_f1m = 0', 'el_f2m = 0',
            'el_layer = 0', 'el_density = 0.1', 'el_sigma = 3',
            'el_layer = 1', 'el_d = 20', 'el_density = 0.05', 'el_sigma = 3',
            'el_layer = 2', 'el_density = 0', 'el_sigma = 3',
            'energy = 800', 'engscanmin = 700', 'engscanmax = 900',
            'numberofpoints = 8', 'magnetizationmode = 1', '',
        ])
        path = Path(self.directory.name) / 'element-energy.all'
        path.write_text(fixture + '\n' + settings)
        for options in [('--energy',), ('--energy', '--angle'), ('--energy', '--asymmetry')]:
            rows = self.run_fixture(path, *options)
            self.assertEqual([row[0] for row in rows], list(range(700, 901, 25)))
            self.assertTrue(all(math.isfinite(value) for row in rows for value in row))

    def test_energy_dataset_shifts_and_invalid_grid(self):
        self.write_energy_tables()
        fixture = (REPOSITORY / 'app/test/fixtures/default.all').read_text()
        path = Path(self.directory.name) / 'energy-data.all'
        path.write_text(fixture + '\nusemeasurementqz = 1\ndatasetnumber = 1\n'
            'datasetqztranslation = 0.007\ndatasetenergyshift = 2\n'
            'dataset_qz = 0.1\ndataset_eng = 800\n'
            'dataset_qz = 0.08\ndataset_eng = 760\nactivedatasetindex = 1\n')
        rows = self.run_fixture(path, '--energy')
        self.assertEqual([row[0] for row in rows], [802, 762])
        for settings in ['engscanmin = 800\nengscanmax = 800', 'numberofpoints = 0']:
            path.write_text(fixture + '\n' + settings + '\n')
            result = subprocess.run([self.executable, path, '--energy'], capture_output=True, text=True, timeout=10,
                                    cwd=self.directory.name)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, '')
            self.assertEqual(result.stderr, '')

    def test_script_failures_do_not_publish_reference_curves(self):
        fixture = (REPOSITORY / 'app/test/fixtures/default.all').read_text()
        path = Path(self.directory.name) / 'script.all'
        for script in ['local missing = par[0]', 'error("private-script-marker")', 'local =']:
            with self.subTest(script=script):
                path.write_text(fixture + '\ndisablescript = 0\nscriptline = ' + script + '\n')
                result = subprocess.run([self.executable, path], capture_output=True, text=True,
                                        cwd=self.directory.name, timeout=30)
                self.assertEqual(result.returncode, 10)
                self.assertEqual(result.stdout, '')
                self.assertEqual(result.stderr, '')
        # A Lua error handled inside the script is not a failed host call.
        path.write_text(fixture + '\ndisablescript = 0\nscriptline = local ok = pcall(function() error("handled") end); local fn, message = loadstring("local =")\n')
        self.assertEqual(len(self.run_fixture(path)), 300)
        path.write_text(fixture + '\ndisablescript = 1\nscriptline = error("disabled")\n')
        self.assertEqual(len(self.run_fixture(path)), 300)

    def test_lookup_initialization_for_segmentation_and_elements(self):
        fixture = (REPOSITORY / 'app/test/fixtures/default.all').read_text()
        element = '\n'.join([
            'mode = 1', 'elementlayerversion = 2', 'element = Fe',
            'el_f1 = 26', 'el_f2 = 0.1', 'el_f1m = 0', 'el_f2m = 0',
            'el_layer = 0', 'el_density = 0.1', 'el_sigma = 3',
            'el_layer = 1', 'el_d = 20', 'el_density = 0.05', 'el_sigma = 3',
            'el_layer = 2', 'el_density = 0', 'el_sigma = 3', '',
        ])
        for settings in ['layersegmentationmode = 1', element]:
            path = Path(self.directory.name) / 'lookup.all'
            path.write_text(fixture + '\nnumberofpoints = 12\n' + settings + '\n')
            points = self.run_fixture(path)
            self.assertEqual(len(points), 12)
            self.assertTrue(all(math.isfinite(value) for row in points for value in row))
            self.assertGreater(max(row[1] for row in points), min(row[1] for row in points))

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
