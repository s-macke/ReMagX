"""Script-prepared energy settings versus independent native point/convolution calls."""
import ctypes as c
import json
import math
import sys
import unittest

library = c.CDLL(sys.argv.pop(1))
class Layer(c.Structure):
    _fields_ = [('values', c.c_double * 8)]
class MatrixLayer(c.Structure):
    _fields_ = [('values', c.c_double * 22), ('anisotropic', c.c_int)]
class Beam(c.Structure):
    _fields_ = [('values', c.c_double * 4)]
class Result(c.Structure):
    _fields_ = [('plus', c.c_double), ('minus', c.c_double)]
class Settings(c.Structure):
    _fields_ = [('energy', c.c_double), ('width', c.c_double), ('epsilon', c.c_double)]
P, D, I, N = c.POINTER, c.c_double, c.c_int, c.c_size_t
convolve = library.remagx_energy_resolution
convolve.argtypes = [P(D), P(Result), N, D, P(Result)]
tensor = library.remagx_dielectric_tensor
tensor.argtypes = [P(Layer), I, I, P(D), P(I)]


def run(algorithm, mode, analyzer, angular, invalid=None, variable=False, invalid_counts=None, late_error=False):
    matrix = algorithm == 'visnovsky'
    layer_type = MatrixLayer if matrix else Layer
    scan = getattr(library, f'remagx_{algorithm}_energy_scan_' + ('stacks' if variable else 'points'))
    point = getattr(library, f'remagx_{algorithm}_qz_resolution')
    common = [P(layer_type), N, P(D), P(D), P(I), N]
    tail = [D, P(Beam), P(Beam), I, I] if matrix else [I, P(Beam), P(Beam), I, I] if algorithm == 'zak' else [P(Beam), P(Beam), I, I, I, I]
    scan.argtypes = (common[:2] + [P(N)] + common[2:] if variable else common) + tail + [D, D, P(Settings), P(Result)]
    point.argtypes = [P(layer_type), N, P(D), N, D] + tail + [D, I, P(Result)]
    energies, coordinates = [640., 643., 641., 648.], [.02, .03, .04, .06]
    mask = [1, analyzer % 2, 1, 1]
    settings = [[620., angular, 1e-8], [850., angular * 2, .1], [640., 0., 1e-4], [710., .002, 1e-8]]
    stacks, packed_stacks = [], []
    for index in range(4):
        scalar = [[0, 1, .01, .002, .001, .0001, 30, 60],
                  [35, 1, .006 + index * .0001, .001, .0004, .00004, 45, 70],
                  [0, 0, 0, 0, 0, 0, 90, 90]]
        if variable: scalar = [scalar[0], *([scalar[1]] * index), scalar[-1]]
        stack, packed = [], []
        for row in scalar:
            if matrix:
                values, kind = (D * 18)(), I()
                assert tensor(c.byref(Layer((D * 8)(*row))), 0, 1, values, c.byref(kind)) == 0
                values = [row[0], row[1], 1-row[2], row[3], *values]
                stack.append(MatrixLayer((D * 22)(*values), kind.value))
                packed.append(dict(values=values, anisotropic=kind.value))
            else:
                stack.append(Layer((D * 8)(*row)))
                packed.append(row)
        stacks.append(stack)
        packed_stacks.append(packed)
    counts = [len(stack) for stack in stacks]
    total = sum(counts)
    source = (layer_type * total)(*(item for stack in stacks for item in stack))
    energy, qz, enabled = (D * 4)(*energies), (D * 4)(*coordinates), (I * 4)(*mask)
    first, second = Beam((D * 4)(1, .2, .3, -.1)), Beam((D * 4)(.2, -.3, .4, .1))
    raw, expected = (Result * 4)(*(Result(1, mode) for _ in range(4))), (Result * 4)()
    for index in range(4):
        if not mask[index]: continue
        extra = [settings[index][2], c.byref(first), c.byref(second), analyzer, mode] if matrix else [1, c.byref(first), c.byref(second), analyzer, mode] if algorithm == 'zak' else [c.byref(first), c.byref(second), 0, analyzer, 1, mode]
        assert point((layer_type * counts[index])(*stacks[index]), counts[index], c.byref(D(qz[index])), 1, settings[index][0],
                     *extra, settings[index][1], 0, c.byref(raw[index])) == 0
    assert convolve(energy, raw, 4, .5, expected) == 0
    configured = (Settings * 4)(*(Settings(*row) for row in settings))
    if invalid:
        setattr(configured[3], invalid[0], invalid[1])
    extra = [1e-8, c.byref(first), c.byref(second), analyzer, mode] if matrix else [1, c.byref(first), c.byref(second), analyzer, mode] if algorithm == 'zak' else [c.byref(first), c.byref(second), 0, analyzer, 1, mode]
    actual = (Result * 4)(*(Result(-123, -456) for _ in range(4)))
    before = bytes(actual)
    descriptor = (N * 4)(*counts)
    if invalid_counts is not None and invalid_counts != 'null': descriptor[3] = invalid_counts
    if late_error: qz[3] = 1e4
    inputs = [bytes(item) for item in (source, energy, qz, enabled, configured)]
    status = scan(source, *([total, None if invalid_counts == 'null' else descriptor] if variable else [3]), energy, qz, enabled, 4, *extra, 0, .5, configured, actual)
    assert inputs == [bytes(item) for item in (source, energy, qz, enabled, configured)]
    if invalid or invalid_counts is not None:
        assert status == 1 and bytes(actual) == before
        return
    if late_error:
        assert status != 0 and bytes(actual) == before
        return
    assert status == 0 and bytes(actual) == bytes(expected)
    return dict(kind='energy', stacks=packed_stacks, energy=energies, qz=coordinates, enabled=mask,
                beam1=list(first.values), beam2=list(second.values), tensor=0, magnetic=1, epsilon=1e-8,
                analyzer=analyzer, mode=mode, angularWidth=0, energyWidth=.5, pointSettings=settings,
                expected=[value for row in expected for value in (row.plus, row.minus)])


def payload():
    return {key: [run(algorithm, mode, analyzer, width, variable=variable) for variable in [False, True] for mode in [0, 1]
                  for analyzer in [0, 1, 2] for width in [0, .001, .01]]
            for key, algorithm in [('scans', 'parratt'), ('matrices', 'visnovsky'), ('zak', 'zak')]}


class EnergyPointSettingsTest(unittest.TestCase):
    def test_independent_points_and_measured_grid_convolution(self):
        cases = payload()
        self.assertEqual(sum(len(items) for items in cases.values()), 108)

    def test_variable_count_validation_and_late_numerical_errors(self):
        for algorithm in ['parratt', 'visnovsky', 'zak']:
            for count in [0, 1, 4, 6, 100, N(-1).value, 'null']:
                run(algorithm, 1, 0, .001, variable=True, invalid_counts=count)
            run(algorithm, 1, 0, .001, variable=True, late_error=True)

    def test_invalid_late_settings_leave_output_untouched(self):
        for algorithm in ['parratt', 'visnovsky', 'zak']:
            for invalid in [('energy', 0), ('energy', math.inf), ('width', -1), ('width', math.nan), ('epsilon', math.inf)]:
                run(algorithm, 1, 0, .001, invalid)
                run(algorithm, 1, 0, .001, invalid, variable=True)


if __name__ == '__main__':
    if '--wasm-payload' in sys.argv:
        print(json.dumps(payload()))
    else:
        unittest.main()
