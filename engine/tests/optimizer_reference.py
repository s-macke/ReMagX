"""Synthetic native optimizer outputs for the Node/Chromium ABI comparison."""
import ctypes
import json
import sys

class Options(ctypes.Structure):
    _fields_ = [('max_evaluations', ctypes.c_size_t), ('max_iterations', ctypes.c_size_t),
                ('parameter_tolerance', ctypes.c_double), ('objective_tolerance', ctypes.c_double)]
class AnnealingOptions(ctypes.Structure):
    _fields_ = [('simplex', Options), ('temperature', ctypes.c_double),
                ('temperature_step', ctypes.c_double), ('seed', ctypes.c_uint32)]
class Summary(ctypes.Structure):
    _fields_ = [('termination', ctypes.c_int), ('has_best', ctypes.c_int),
                ('iterations', ctypes.c_size_t), ('evaluations', ctypes.c_size_t), ('value', ctypes.c_double)]
Pointer = ctypes.POINTER(ctypes.c_double)
Objective = ctypes.CFUNCTYPE(ctypes.c_int, Pointer, ctypes.c_size_t, ctypes.c_void_p, Pointer)
library = ctypes.CDLL(sys.argv[1])
function = library.remagx_nelder_mead
function.argtypes = [Pointer, ctypes.c_size_t, ctypes.POINTER(Options), Objective,
                     ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, Pointer, ctypes.POINTER(Summary)]
function.restype = ctypes.c_int
annealing = library.remagx_simplex_annealing
annealing.argtypes = [Pointer, ctypes.c_size_t, ctypes.POINTER(AnnealingOptions), Objective,
                     ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, Pointer, ctypes.POINTER(Summary)]
annealing.restype = ctypes.c_int
cases = []
for dimension in [1, 2, 5]:
    simplex = [[-2.0] * dimension for _ in range(dimension + 1)]
    for row in range(1, dimension + 1): simplex[row][row - 1] += .5
    cases.append(dict(kind='quadratic', simplex=simplex))
cases.extend([dict(kind='rosenbrock', simplex=[[-1.2, 1], [-1.1, 1], [-1.2, 1.1]]),
              dict(kind='flat', simplex=[[0, 0], [2, 0], [0, 2]]),
              dict(kind='quadratic', simplex=[[0], [2]], maxEvaluations=3)])
cases.extend(dict(kind='double-well', simplex=[[2], [2.2]], annealing=True,
                  temperature=10, temperatureStep=-.01, seed=seed) for seed in range(12))
cases.extend(dict(kind='quadratic', simplex=[[0, 0], [1, 0], [0, 1]], annealing=True,
                  temperature=temperature, temperatureStep=step, seed=4294967295,
                  maxIterations=500 if step >= 0 else 5000)
             for temperature, step in [(0, 0), (2, -.02), (1, 0), (1, .01)])
for case in cases:
    dimension = len(case['simplex'][0])
    @Objective
    def objective(parameters, count, context, output):
        if case['kind'] == 'flat': value = 1.0
        elif case['kind'] == 'double-well':
            squared = parameters[0] * parameters[0] - 4
            value = squared * squared + .3 * parameters[0]
        elif case['kind'] == 'rosenbrock':
            curved = parameters[1] - parameters[0] * parameters[0]
            value = 100.0 * curved * curved + (1.0 - parameters[0]) * (1.0 - parameters[0])
        else:
            value = 0.0
            for index in range(count):
                offset = parameters[index] - (index + 1)
                value += (index + 1) * offset * offset
        output[0] = value
        return 0
    initial = (ctypes.c_double * (dimension * (dimension + 1)))(*[value for row in case['simplex'] for value in row])
    output = (ctypes.c_double * dimension)()
    summary = Summary()
    options = Options(case.get('maxEvaluations', 10000), case.get('maxIterations', 5000), 1e-9, 1e-14)
    invoke = function
    if case.get('annealing'):
        options = AnnealingOptions(options, case['temperature'], case['temperatureStep'], case['seed'])
        invoke = annealing
    status = invoke(initial, dimension, ctypes.byref(options), objective, None, None, None, output, ctypes.byref(summary))
    assert status == 0 and summary.has_best
    case['expected'] = dict(parameters=list(output), value=summary.value,
        iterations=summary.iterations, evaluations=summary.evaluations,
        termination=['converged', 'evaluation-limit', 'iteration-limit', 'stopped'][summary.termination])
print(json.dumps(cases))
