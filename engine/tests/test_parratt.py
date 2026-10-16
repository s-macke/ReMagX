import cmath
import ctypes
import math
import os
from pathlib import Path
import json
from table_binding import NativeTable
from table_cases import synthetic_table_cases
from parratt_cases import synthetic_cases, synthetic_qz_cases, synthetic_resolution_cases
import subprocess
import sys
import tempfile
import unittest

library_path = sys.argv.pop(1)


class Layer(ctypes.Structure):
    _fields_ = [(name, ctypes.c_double) for name in ('thickness', 'roughness', 'delta', 'beta', 'delta_magnetic', 'beta_magnetic', 'gamma_degrees', 'phi_degrees')]


class Beam(ctypes.Structure):
    _fields_ = [(name, ctypes.c_double) for name in ('sigma_real', 'sigma_imaginary', 'pi_real', 'pi_imaginary')]


class Point(ctypes.Structure):
    _fields_ = [(name, ctypes.c_double) for name in ('angle_radians', 'vacuum_wave_number', 'magnetization')]


library = ctypes.CDLL(library_path)
library.remagx_parratt.argtypes = [ctypes.POINTER(Layer), ctypes.c_size_t, ctypes.POINTER(Point), ctypes.c_size_t, ctypes.POINTER(Beam), ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_double)]
library.remagx_parratt.restype = ctypes.c_int


def calculate(layers, points, beam=(1, 0, 0, 0), tensor=0, analyzer=0):
    layer_array = (Layer * len(layers))(*(Layer(*layer) for layer in layers))
    point_array = (Point * len(points))(*(Point(*point) for point in points))
    polarization = Beam(*beam)
    output = (ctypes.c_double * len(points))(*([-123.0] * len(points)))
    before = bytes(layer_array), bytes(point_array), bytes(polarization)
    status = library.remagx_parratt(layer_array, len(layers), point_array, len(points), ctypes.byref(polarization), tensor, analyzer, output)
    if before != (bytes(layer_array), bytes(point_array), bytes(polarization)):
        raise AssertionError('API mutated its input')
    return status, list(output)


class Reflectivity(ctypes.Structure):
    _fields_ = [('beam1', ctypes.c_double), ('beam2', ctypes.c_double)]


library.remagx_parratt_qz.argtypes = [ctypes.POINTER(Layer), ctypes.c_size_t, ctypes.POINTER(ctypes.c_double),
    ctypes.c_size_t, ctypes.c_double, ctypes.POINTER(Beam), ctypes.POINTER(Beam), ctypes.c_int,
    ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.POINTER(Reflectivity)]
library.remagx_parratt_qz.restype = ctypes.c_int
library.remagx_parratt_qz_resolution.argtypes = library.remagx_parratt_qz.argtypes[:-1] + [ctypes.c_double, ctypes.c_int, ctypes.POINTER(Reflectivity)]
library.remagx_parratt_qz_resolution.restype = ctypes.c_int


def calculate_qz(layers, qz, energy=640, beam1=(1, 0, 0, 0), beam2=(0, 0, 1, 0), tensor=0,
                 analyzer=0, magnetic=1, mode=1, resolution=None):
    layer_array = (Layer * len(layers))(*(Layer(*layer) for layer in layers))
    coordinates = (ctypes.c_double * len(qz))(*qz)
    first, second = Beam(*beam1), Beam(*beam2) if beam2 is not None else None
    output = (Reflectivity * len(qz))(*(Reflectivity(-123, -456) for _ in qz))
    before = bytes(layer_array), bytes(coordinates), bytes(first), bytes(second) if second else None
    arguments = [layer_array, len(layers), coordinates, len(qz), energy,
        ctypes.byref(first), ctypes.byref(second) if second else None, tensor, analyzer, magnetic, mode]
    status = (library.remagx_parratt_qz(*arguments, output) if resolution is None else
              library.remagx_parratt_qz_resolution(*arguments, *resolution, output))
    if before != (bytes(layer_array), bytes(coordinates), bytes(first), bytes(second) if second else None):
        raise AssertionError('qz API mutated its input')
    return status, [(value.beam1, value.beam2) for value in output]


class QzScanTest(unittest.TestCase):
    layers = [(0, 0, .01, .002, .0001, .00002, 90, 90), (0, 0, 0, 0, 0, 0, 90, 90)]

    def test_native_resolution_matches_reviewed_worker(self):
        offsets = [-2, -1.77777777777778, -1.55555555555556, -1.33333333333333,
            -1.11111111111111, -.888888888888889, -.666666666666667, -.444444444444444,
            -.222222222222222, 0, .222222222222222, .444444444444444, .666666666666667,
            .888888888888889, 1.11111111111111, 1.33333333333333, 1.55555555555556, 1.77777777777778, 2]
        inputs, actuals, coordinates = [], [], []
        for case, prepared in enumerate(synthetic_cases()):
            energy = [100, 640, 8000][case % 3]
            wave = 2 * math.pi / (12398.326 / energy)
            qz = [ratio * 2 * wave for ratio in [-.02, 0, .05, .2, .4]]
            options = dict(energy=energy, beam1=prepared['beam'], beam2=(.3, .4, .6, .8),
                tensor=prepared['tensor'], analyzer=prepared['analyzer'], magnetic=(case // 2) % 2, mode=(case // 4) % 2)
            for width in [0, 1e-11, wave * .01]:
                for fast in [0, 1]:
                    points = qz if fast else [q + offset * width for q in qz for offset in (offsets[:1] if width < 1e-10 else offsets)]
                    status, raw = calculate_qz(prepared['layers'], points, **options)
                    self.assertEqual(status, 0)
                    status, actual = calculate_qz(prepared['layers'], qz, **options, resolution=(width, fast))
                    self.assertEqual(status, 0)
                    inputs.append(dict(qz=qz, width=width, fast=bool(fast), dichroic=bool(options['mode']), raw=[value for pair in raw for value in pair]))
                    actuals.append([value for pair in actual for value in pair])
                    coordinates.append(points)
        comparison = subprocess.run(['node', '--experimental-strip-types', str(Path(__file__).with_name('compare_resolution.mjs'))],
            input=json.dumps(inputs), text=True, capture_output=True, check=True)
        expected = json.loads(comparison.stdout)
        self.assertEqual(len(expected), 720)
        for actual, target, points in zip(actuals, expected, coordinates):
            self.assertEqual(points, target['coordinates'])
            self.assertEqual(len(actual), len(target['values']))
            for value, reference in zip(actual, target['values']):
                self.assertLessEqual(abs(value-reference), 1e-15 + 1e-10 * abs(reference))
        print('Native angular resolution: 7,200 intensity comparisons with reviewed worker convolution passed.', flush=True)

    def test_native_resolution_original_references_and_failures(self):
        status, values = calculate_qz(self.layers, [0, .03], magnetic=0, mode=0, resolution=(.002, 0))
        self.assertEqual(status, 0)
        for pair, target in zip(values, [.56005877016968919, .87413289596007782]):
            self.assertLessEqual(abs(pair[0] - target), 1e-15 + 1e-10 * abs(target))
            self.assertEqual(pair[1], 0)
        self.assertEqual(calculate_qz(self.layers, [.01, .03], resolution=(0, 0)), calculate_qz(self.layers, [.01, .03]))
        self.assertEqual(calculate_qz(self.layers, [.01], resolution=(1e-11, 0)), calculate_qz(self.layers, [.01 - 2e-11]))
        maximum = 2 * (2 * math.pi / (12398.326 / 640))
        self.assertEqual(calculate_qz(self.layers, [maximum], resolution=(0, 1)), (4, [(-123, -456)]))
        self.assertEqual(calculate_qz(self.layers, [maximum], resolution=(0, 0))[0], 0)
        for resolution in [(-1, 0), (math.nan, 0), (0, 2)]:
            self.assertEqual(calculate_qz(self.layers, [.01], resolution=resolution), (1, [(-123, -456)]))
        self.assertEqual(calculate_qz(self.layers, [.01, maximum], mode=0, resolution=(.002, 0)), (4, [(-123, -456)] * 2))

    def test_legacy_qz_boundaries(self):
        maximum = 2 * (2 * math.pi / (12398.326 / 640))
        self.assertEqual(calculate_qz(self.layers, [maximum], mode=0), (4, [(-123, -456)]))
        self.assertEqual(calculate_qz(self.layers, [maximum], mode=1)[0], 0)
        self.assertEqual(calculate_qz(self.layers, [math.nextafter(maximum, math.inf)])[0], 4)
        self.assertEqual(calculate_qz(self.layers, [-maximum], mode=0)[0], 4)
        self.assertEqual(calculate_qz(self.layers, [-maximum], mode=1), (0, [(0, 0)]))
        self.assertEqual(calculate_qz(self.layers, [-.01], mode=0), (0, [(0, 0)]))
        self.assertEqual(calculate_qz(self.layers, [0], mode=0)[0], 0)

    def test_beam_selection_and_magnetic_sign(self):
        for magnetic in [0, 1]:
            for tensor in [0, 1]:
                for analyzer in [0, 1, 2]:
                    wave = 2 * math.pi / (12398.326 / 640)
                    qz = .05
                    angle = math.asin(qz / (2 * wave))
                    beams = [(.3, .4, .6, .8), (0, 0, .2, .7)]
                    expected = [calculate(self.layers, [(angle, wave, sign * magnetic)], beam, tensor, analyzer)[1][0]
                                for beam, sign in zip(beams, [1, -1])]
                    status, values = calculate_qz(self.layers, [qz], beam1=beams[0], beam2=beams[1],
                                                  tensor=tensor, analyzer=analyzer, magnetic=magnetic)
                    self.assertEqual(status, 0)
                    self.assertEqual(values, [tuple(expected)])
        self.assertEqual(calculate_qz(self.layers, [.05], mode=0, beam2=None)[0], 0)
        self.assertEqual(calculate_qz(self.layers, [.05], mode=0)[1][0][1], 0)

    def test_atomic_failure_and_invalid_inputs(self):
        for options in [dict(energy=0), dict(energy=math.nan), dict(beam2=None), dict(mode=2),
                        dict(magnetic=2), dict(tensor=2), dict(analyzer=3), dict(beam1=(math.inf, 0, 0, 0))]:
            self.assertEqual(calculate_qz(self.layers, [.01, .1], **options), (1, [(-123, -456)] * 2))
        self.assertEqual(calculate_qz(self.layers, [.01, 100]), (4, [(-123, -456)] * 2))
        self.assertEqual(calculate_qz(self.layers, [.01, math.nan]), (1, [(-123, -456)] * 2))
        explosive = [(0, 0, 1e308, 1e308, 0, 0, 90, 90), self.layers[1]]
        self.assertEqual(calculate_qz(explosive, [-.01, .1]), (2, [(-123, -456)] * 2))
        self.assertEqual(calculate_qz(explosive, [-.01]), (0, [(0, 0)]))
        self.assertEqual(library.remagx_parratt_qz(None, 2, None, 1, 640, None, None, 0, 0, 0, 0, None), 1)


class NativeParrattTest(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('WASM_MODULE'), 'WASM comparison not requested')
    def test_wasm_matches_native(self):
        cases = []
        for prepared in synthetic_cases():
            status, values = calculate(**prepared)
            self.assertEqual(status, 0)
            cases.append(dict(**prepared, expected=values))
        qz_cases = []
        for prepared in synthetic_qz_cases():
            status, values = calculate_qz(**prepared)
            self.assertEqual(status, 0)
            qz_cases.append(dict(**prepared, expected=[value for pair in values for value in pair]))
        for prepared in synthetic_resolution_cases():
            status, values = calculate_qz(**prepared)
            self.assertEqual(status, 0)
            width, fast = prepared['resolution']
            qz_cases.append(dict(prepared, resolution=dict(width=width, fast=bool(fast)), expected=[value for pair in values for value in pair]))
        table_cases = []
        table_lookup = NativeTable(library).lookup
        for table in synthetic_table_cases():
            status, values, cursor = table_lookup(table['energy'], list(zip(*table['columns'])), table['queries'], table['cursor'], len(table['columns']))
            self.assertEqual(status, 0)
            table_cases.append(dict(table, expected=values, expectedCursor=cursor))
        energy_cases = []
        convolve = library.remagx_energy_resolution
        convolve.argtypes = [ctypes.POINTER(ctypes.c_double), ctypes.POINTER(Reflectivity), ctypes.c_size_t, ctypes.c_double, ctypes.POINTER(Reflectivity)]
        for index in range(120):
            energies = [float((point * 7 + index) % 23 - 2) for point in range(7)]
            if index % 2: energies.sort()
            raw = [math.sin(index + point) for point in range(14)]
            width = [0, 1e-11, 1e-10, .5, 20][index % 5]
            source = (Reflectivity * 7)(*(Reflectivity(*raw[point:point+2]) for point in range(0, 14, 2)))
            output = (Reflectivity * 7)()
            self.assertEqual(convolve((ctypes.c_double * 7)(*energies), source, 7, width, output), 0)
            energy_cases.append(dict(energy=energies, raw=raw, width=width,
                expected=[value for row in output for value in (row.beam1, row.beam2)]))
        scan_cases = []
        batch = library.remagx_parratt_energy_scan
        batch.argtypes = [ctypes.POINTER(Layer), ctypes.c_size_t, ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_double),
            ctypes.POINTER(ctypes.c_int), ctypes.c_size_t, ctypes.POINTER(Beam), ctypes.POINTER(Beam),
            ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_double, ctypes.c_double, ctypes.POINTER(Reflectivity)]
        for index, prepared in enumerate(qz_cases[:240]):
            stacks = [prepared['layers']] * 3
            energies = [prepared['energy'] + offset for offset in [0, 1, 2]]
            coordinates = prepared['qz'][:3]
            enabled = [1, index % 2, 1]
            first, second = Beam(*prepared['beam1']), Beam(.3, .4, .6, .8)
            output = (Reflectivity * 3)()
            width = [0, .002][index % 2]
            energy_width = [0, .5, 2][index % 3]
            packed = (Layer * (len(stacks[0]) * 3))(*(Layer(*layer) for stack in stacks for layer in stack))
            self.assertEqual(batch(packed, len(stacks[0]), (ctypes.c_double * 3)(*energies), (ctypes.c_double * 3)(*coordinates),
                (ctypes.c_int * 3)(*enabled), 3, ctypes.byref(first), ctypes.byref(second), prepared['tensor'], prepared['analyzer'],
                prepared['magnetic'], prepared['mode'], width, energy_width, output), 0)
            scan_cases.append(dict(stacks=stacks, energy=energies, qz=coordinates, enabled=enabled,
                beam1=prepared['beam1'], beam2=[.3, .4, .6, .8], tensor=prepared['tensor'], analyzer=prepared['analyzer'],
                magnetic=prepared['magnetic'], mode=prepared['mode'], angularWidth=width, energyWidth=energy_width,
                expected=[value for row in output for value in (row.beam1, row.beam2)]))
        tensor_cases = []
        tensor_function = library.remagx_dielectric_tensor
        tensor_function.argtypes = [ctypes.POINTER(Layer), ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_int)]
        for case in cases:
            layer = Layer(*case['layers'][0])
            for tensor in [0, 1]:
                for magnetic in [0, 1]:
                    output = (ctypes.c_double * 18)()
                    kind = ctypes.c_int()
                    self.assertEqual(tensor_function(ctypes.byref(layer), tensor, magnetic, output, ctypes.byref(kind)), 0)
                    tensor_cases.append(dict(layer=case['layers'][0], tensor=tensor, magnetic=magnetic,
                        expected=list(output), anisotropic=bool(kind.value)))
        matrix_cases = json.loads(subprocess.run([sys.executable, str(Path(__file__).with_name('test_visnovsky.py')),
            library._name, '--wasm-payload'], capture_output=True, text=True, check=True).stdout)
        zak_cases = json.loads(subprocess.run([sys.executable, str(Path(__file__).with_name('test_zak.py')),
            library._name, '--wasm-payload'], capture_output=True, text=True, check=True).stdout)
        payload = json.dumps(dict(angular=cases, qz=qz_cases, tables=table_cases, energy=energy_cases, scans=scan_cases, tensors=tensor_cases, matrices=matrix_cases, zak=zak_cases))
        subprocess.run(['node', str(Path(__file__).with_name('test_wasm.mjs')),
                        str(Path(os.environ['WASM_MODULE']).resolve())],
                       input=payload, text=True, check=True)
        if os.environ.get('WASM_BROWSER') == '1':
            subprocess.run(['node', str(Path(__file__).resolve().parents[2] / 'app/scripts/test-wasm-browser.mjs'),
                            str(Path(os.environ['WASM_MODULE']).resolve())],
                           input=payload, text=True, check=True)


    def test_fresnel_and_complex_polarization(self):
        layers = [(0, 0, 0.01, 0.002, 0, 0, 90, 90), (0, 0, 0, 0, 0, 0, 90, 90)]
        angle = 0.2
        index = complex(0.99, 0.002)
        lower = cmath.sqrt(index * index - math.cos(angle)**2)
        upper = cmath.sqrt(1 - math.cos(angle)**2)
        sigma = abs((upper - lower) / (upper + lower))**2
        pi = abs((index*index*upper - lower) / (index*index*upper + lower))**2
        for analyzer, expected in [(0, .25*sigma + pi), (1, .25*sigma), (2, pi)]:
            status, values = calculate(layers, [(angle, 1, 0)], (.3, .4, .6, .8), analyzer=analyzer)
            self.assertEqual(status, 0)
            self.assertLessEqual(abs(values[0] - expected), 1e-15 + 1e-10*abs(expected))

    def test_failures_leave_output_untouched(self):
        layers = [(0, 0, 0.01, 0.002, 0, 0, 90, 90), (0, 0, 0, 0, 0, 0, 90, 90)]
        for points in [[(.1, 1, 0), (math.nan, 1, 0)], [(.1, 0, 0)]]:
            status, values = calculate(layers, points)
            self.assertEqual(status, 1)
            self.assertEqual(values, [-123.0] * len(points))
        for tensor, analyzer in [(2, 0), (0, -1), (0, 3)]:
            self.assertEqual(calculate(layers, [(.1, 1, 0)], tensor=tensor, analyzer=analyzer), (1, [-123.0]))
        explosive = [(0, 0, 1e308, 1e308, 0, 0, 90, 90), layers[1]]
        self.assertEqual(calculate(explosive, [(.1, 1, 0)]), (2, [-123.0]))
        magnetic_layers = [(0, 0, .01, .002, 1, 0, 90, 90), layers[1]]
        self.assertEqual(calculate(magnetic_layers, [(.1, 1, 0), (.1, 1, 1e308)]), (2, [-123.0, -123.0]))
        self.assertEqual(library.remagx_parratt(None, 2, None, 1, None, 0, 0, None), 1)

    def test_zero_contrast_and_partition_invariance(self):
        ambient = (0, 0, 0, 0, 0, 0, 90, 90)
        substrate = (0, 0, .01, .002, 0, 0, 90, 90)
        self.assertEqual(calculate([ambient, ambient], [(0, 1, 0), (.2, 1, 0)]), (0, [0.0, 0.0]))
        direct = calculate([substrate, ambient], [(.1, 1, 0)])[1][0]
        split = calculate([substrate, (50, *substrate[1:]), ambient], [(.1, 1, 0)])[1][0]
        self.assertLessEqual(abs(direct - split), 1e-15 + 1e-10*abs(direct))


@unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private legacy comparison not requested')
class LegacyComparisonTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/golden/legacy'))
        from build_reference import build
        cls.directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.directory.cleanup)
        cls.reference = build(os.environ['LEGACY_ROOT'], Path(cls.directory.name) / 'reference')

    def test_qz_scan_matches_original_beams(self):
        comparisons = 0
        max_log_error = 0.0
        for case, prepared in enumerate(synthetic_cases()):
            energy = [100, 640, 8000][case % 3]
            wave = 2 * math.pi / (12398.326 / energy)
            qz = [ratio * 2 * wave for ratio in [-.1, 0, 1e-8, .005, .1, .7, .999]]
            beams = [prepared['beam'], (.3, .4, .6, .8)]
            magnetic = (case // 2) % 2
            status, actual = calculate_qz(prepared['layers'], qz, energy, *beams,
                tensor=prepared['tensor'], analyzer=prepared['analyzer'], magnetic=magnetic)
            self.assertEqual(status, 0)
            self.assertEqual(actual[0], (0, 0))
            for beam_index, (beam, sign) in enumerate(zip(beams, [1, -1])):
                points = [(math.asin(value / (2 * wave)), wave, sign * magnetic) for value in qz[1:]]
                payload = f"{len(prepared['layers'])} {len(points)} {prepared['tensor']} {prepared['analyzer']}\n"
                payload += ' '.join(map(str, beam)) + '\n'
                payload += '\n'.join(' '.join(map(str, row)) for row in [*prepared['layers'], *points]) + '\n'
                reference = subprocess.run([self.reference], input=payload, text=True, capture_output=True, check=True)
                expected = list(map(float, reference.stdout.splitlines()))
                self.assertEqual(len(expected), len(points))
                for index, target in enumerate(expected, 1):
                    value = actual[index][beam_index]
                    self.assertTrue(math.isfinite(value))
                    self.assertLessEqual(abs(value - target), 1e-15 + 1e-10 * abs(target))
                    if value > 0 and target > 0:
                        relative = (value - target) / target
                        error = (abs(math.log1p(relative) / math.log(10)) if abs(relative) < .5
                                 else abs(math.log10(value) - math.log10(target)))
                        max_log_error = max(max_log_error, error)
                    comparisons += 1
        self.assertEqual(comparisons, 1440)
        print(f'Prepared qz scan: {comparisons} original-routine comparisons; maximum log10 error {max_log_error} decades', flush=True)

    def test_prepared_stacks_match_original_all_parratt_branches(self):
        comparisons = 0
        positive_pairs = 0
        zero_pairs = 0
        nonpositive_mismatches = 0
        below_absolute_floor = 0
        positive_range = [math.inf, 0.0]
        worst_log_error = (0.0, None)
        for case, prepared in enumerate(synthetic_cases()):
            layers, points, beam, tensor, analyzer = (prepared[key] for key in ('layers', 'points', 'beam', 'tensor', 'analyzer'))
            payload = f'{len(layers)} {len(points)} {tensor} {analyzer}\n'
            payload += ' '.join(map(str, beam)) + '\n'
            payload += '\n'.join(' '.join(map(str, row)) for row in [*layers, *points]) + '\n'
            reference = subprocess.run([self.reference], input=payload, text=True, capture_output=True, check=True)
            expected = list(map(float, reference.stdout.splitlines()))
            status, actual = calculate(layers, points, beam, tensor, analyzer)
            self.assertEqual(status, 0, f'synthetic case {case}')
            self.assertEqual(len(expected), len(actual))
            for index, (value, target) in enumerate(zip(actual, expected)):
                self.assertTrue(math.isfinite(value))
                self.assertLessEqual(abs(value-target), 1e-15 + 1e-10*abs(target), f'synthetic case {case}, point {index}')
                if target > 0:
                    positive_range[0] = min(positive_range[0], target)
                    positive_range[1] = max(positive_range[1], target)
                    below_absolute_floor += target < 1e-15
                if value > 0 and target > 0:
                    positive_pairs += 1
                    relative_difference = (value - target) / target
                    # log1p retains small discrepancies that subtracting two logs loses.
                    log_error = (abs(math.log1p(relative_difference) / math.log(10))
                                 if abs(relative_difference) < .5
                                 else abs(math.log10(value) - math.log10(target)))
                    if log_error > worst_log_error[0]:
                        worst_log_error = (log_error, (case, index, target, value))
                elif value == target == 0:
                    zero_pairs += 1
                else:
                    nonpositive_mismatches += 1
                comparisons += 1
        self.assertEqual(comparisons, 4320)
        print(f'Parratt log diagnostics (synthetic stacks only): {positive_pairs} positive pairs; '
              f'{zero_pairs} both zero; {nonpositive_mismatches} nonpositive mismatches; '
              f'{below_absolute_floor} positive references below 1e-15; '
              f'positive reference range {positive_range[0]:.17g} to {positive_range[1]:.17g}; '
              f'maximum log10 error {worst_log_error[0]:.17g} decades; '
              f'worst (case, point, reference, actual) = {worst_log_error[1]}', flush=True)


if __name__ == '__main__':
    unittest.main()
