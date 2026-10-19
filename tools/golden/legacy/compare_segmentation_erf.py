#!/usr/bin/env python3
"""Measure error-function replacement compatibility; never exports private source/tables."""
import argparse
import ctypes
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile

REPOSITORY = Path(__file__).resolve().parents[3]
# Full hash kept separate from extraction delimiters to reject any source drift.
SOURCE_HASH = '5d7b1c3d0a5a784584f17fa49c92c1612569e362c2858d57b039da867e922e48'


def summarize(rows, reference_column, candidate_column):
    maximum_absolute = maximum_relative = maximum_scaled = 0.0
    worst_position = None
    failures = 0
    for row in rows:
        reference, candidate = row[reference_column], row[candidate_column]
        error = abs(candidate - reference)
        threshold = 1e-15 + 1e-10 * abs(reference)
        failures += error > threshold
        if error > maximum_absolute:
            maximum_absolute, worst_position = error, row[0]
        maximum_relative = max(maximum_relative, error / abs(reference) if reference else 0.0)
        maximum_scaled = max(maximum_scaled, error / threshold)
    return dict(count=len(rows), failures_at_D23=failures, maximum_absolute=maximum_absolute,
                maximum_relative_nonzero_reference=maximum_relative,
                maximum_tolerance_ratio=maximum_scaled, worst_absolute_position=worst_position)



def double_gamma_erf(position):
    """Independent double-only diagnostic from DLMF 8.7.1 and 8.9.2, a=1/2.

    The continued fraction is evaluated backwards at successive finite depths.
    This is not an NR port and is not used by the production engine.
    """
    squared = position * position
    if squared == 0:
        return 0.0
    scale = math.exp(.5 * math.log(squared) - squared - math.lgamma(.5))
    if squared < 1.5:
        term = total = 2.0
        for order in range(1, 201):
            term *= squared / (order + .5)
            total += term
            if abs(term) < abs(total) * 3e-7:
                return math.copysign(total * scale, position)
    else:
        # Even contraction of DLMF 8.9.2: b_n=z+2n+1/2,
        # a_n=-n(n-1/2), with the leading reciprocal.
        previous = 1 / (squared + .5)
        for depth in range(1, 201):
            denominator = squared + .5 + 2 * depth
            for level in range(depth, 0, -1):
                denominator = squared + .5 + 2 * (level - 1) - level * (level - .5) / denominator
            fraction = 1 / denominator
            if abs(fraction - previous) < abs(fraction) * 3e-7:
                return math.copysign(1 - scale * fraction, position)
            previous = fraction
    raise ValueError('Independent gamma diagnostic did not converge.')


def reflectivity_diagnostics(rows, native_core):
    class Layer(ctypes.Structure):
        _fields_ = [(name, ctypes.c_double) for name in ['thickness', 'roughness', 'delta', 'beta',
                    'delta_magnetic', 'beta_magnetic', 'gamma', 'phi']]
    class Point(ctypes.Structure):
        _fields_ = [(name, ctypes.c_double) for name in ['angle', 'wave', 'magnetic']]
    library = ctypes.CDLL(str(Path(native_core).resolve()))
    library.remagx_parratt.argtypes = [ctypes.POINTER(Layer), ctypes.c_size_t, ctypes.POINTER(Point),
        ctypes.c_size_t, ctypes.POINTER(ctypes.c_double), ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_double)]
    wave = 2 * math.pi / (12398.326 / 640)
    coordinates = [.002 + index * .001 for index in range(200)]
    points = (Point * len(coordinates))(*(Point(math.asin(qz / (2 * wave)), wave, 0) for qz in coordinates))
    beam = (ctypes.c_double * 4)(1, 0, 0, 0)
    # Fixed slices isolate the erf choice from adaptive step selection. This is
    # a synthetic rough interface, not the unfinished LayerSegmentation2 port.
    sampled = rows[::40][::-1]
    thickness = math.sqrt(2) * 3 * .02  # sigma=3 A, x spacing=.02
    curves = []
    for column in [1, 2, 3]:
        layers = [Layer(0, 0, .01, .002)]
        for row in sampled:
            fraction = .5 * (1 + row[column])
            layers.append(Layer(thickness, 0, .01 * fraction, .002 * fraction))
        layers.append(Layer())
        packed, values = (Layer * len(layers))(*layers), (ctypes.c_double * len(coordinates))()
        status = library.remagx_parratt(packed, len(layers), points, len(points), beam, 0, 0, values)
        if status or not all(map(math.isfinite, values)):
            raise ValueError('Synthetic native reflectivity diagnostic failed.')
        curves.append(list(values))
    compared = [[qz, *values] for qz, values in zip(coordinates, zip(*curves))]
    return dict(same_grid_std_erf=summarize(compared, 1, 2), direct_std_erf=summarize(compared, 1, 3),
                slice_count=len(sampled), energy_ev=640, roughness_angstrom=3,
                scope='Fixed synthetic slices only; does not measure adaptive segmentation or corpus accuracy.')


def compare(legacy_root, native_core, compiler='g++'):
    source = (Path(legacy_root) / 'shared/LayerSegmentation.cpp').read_bytes()
    if hashlib.sha256(source).hexdigest() != SOURCE_HASH:
        raise ValueError('Segmentation source differs from the reviewed snapshot; build refused.')
    text = source.decode('latin1').replace('\r\n', '\n')
    # These bodies remain private, in a temporary directory for compilation only.
    # No translation of NR algorithms or generated legacy table enters the repo.
    start = text.index('double gammln(')
    end = text.index('/*\nvoid LayerSegmentation3', start)
    methods = text[start:end]
    scaffold = '''#include <cmath>
#include <vector>
#include <iostream>
#include <iomanip>
using namespace std;
template<class T> using CVector = std::vector<T>;
void nrerror(const char*) {}
'''
    wrapper = '''int main() {
    erffinit();
    const auto original = table;
    vector<double> replacement(1001);
    for(int index=0;index<1001;++index) {
        const double position=LinInterpolation(0,index,999,-5,5);
        replacement[index]=std::erf(position);
    }
    cout<<setprecision(17);
    // Same grid and interpolation isolate table-generation error from gridding.
    for(int index=0;index<=20000;++index) {
        const double position=-5.0+index/2000.0;
        table=original; const double reference=erfftable(position);
        table=replacement; const double interpolated=erfftable(position);
        cout<<position<<' '<<reference<<' '<<interpolated<<' '<<std::erf(position)<<' '<<erff(position)<<'\\n';
    }
}
'''
    with tempfile.TemporaryDirectory(prefix='remagx-erf-study-') as temporary:
        cpp, executable = Path(temporary) / 'reference.cpp', Path(temporary) / 'reference'
        cpp.write_text(scaffold + methods + wrapper)
        subprocess.run([compiler, '-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off',
                        str(cpp), '-o', str(executable)], capture_output=True, check=True)
        output = subprocess.run([str(executable)], capture_output=True, text=True, check=True).stdout
    rows = [list(map(float, line.split())) for line in output.splitlines()]
    if len(rows) != 20001 or any(len(row) != 5 or not all(map(math.isfinite, row)) for row in rows):
        raise ValueError('Unexpected or nonfinite diagnostic output.')
    # Local optical profile for a single rough interface: delta=.01 in substrate,
    # delta=0 in ambient. This is GetOpticalConstant3's scalar two-medium formula,
    # evaluated at z=-sqrt(2)*sigma*x. No reflectivity accuracy claim follows.
    optical = [[row[0], *[.5 * .01 * (1 + value) for value in row[1:4]]] for row in rows]
    independent = [[row[0], row[4], double_gamma_erf(row[0])] for row in rows]
    return dict(independent_double_gamma=summarize(independent, 1, 2),
                reflectivity=reflectivity_diagnostics(rows, native_core), samples=len(rows), source_sha256=SOURCE_HASH,
                same_grid_std_erf=summarize(rows, 1, 2), direct_std_erf=summarize(rows, 1, 3),
                local_interface_delta_same_grid=summarize(optical, 1, 2),
                local_interface_delta_direct=summarize(optical, 1, 3),
                scope='Synthetic erf, single-interface delta and fixed-slice reflectivity diagnostics; no adaptive segmentation or corpus acceptance.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy-root', type=Path, default=REPOSITORY / 'old/reMagX3')
    parser.add_argument('--native-core', type=Path, default=REPOSITORY / 'build/engine/libremagx_core.so')
    parser.add_argument('--compiler', default='g++')
    args = parser.parse_args()
    try:
        result = compare(args.legacy_root, args.native_core, args.compiler)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        # Compiler errors may quote private source; never print captured diagnostics.
        print(str(error) if isinstance(error, ValueError) else 'Private erf comparison failed; verify source access and compiler locally.', file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
