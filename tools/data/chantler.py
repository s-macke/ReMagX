#!/usr/bin/env python3
"""Export the authorized built-in Chantler asset from unchanged original sources."""
import argparse
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / 'tools/golden/legacy'))
from build_reference import verify_dependencies
from build_state_reference import dependencies


def generate(legacy_root, compiler='g++'):
    root = Path(legacy_root).resolve()
    adapter = HERE / 'export_chantler.cpp'
    sources = [adapter, root / 'shared/CTable.cpp']
    manifest = json.loads((HERE / 'chantler_sources.json').read_text())['sha256']
    flags = ['-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', '-pthread',
             '-ffunction-sections', '-fdata-sections', '-I' + str(root / 'shared')]
    verify_dependencies(dependencies(compiler, flags, sources), root, manifest, adapter)
    with tempfile.TemporaryDirectory() as directory:
        executable = Path(directory) / 'export'
        subprocess.run([compiler, *flags, '-Wl,--gc-sections', *map(str, sources), '-o', str(executable)],
                       check=True, capture_output=True, timeout=120)
        result = subprocess.run([str(executable)], check=True, capture_output=True, text=True, timeout=30)
        elements = json.loads(result.stdout)
    if [item['atomicNumber'] for item in elements] != list(range(1, 93)):
        raise ValueError('Invalid element coverage')
    rows = sum(len(item['rows']) for item in elements)
    if rows != 20255:
        raise ValueError('Unexpected table dimensions')
    for item in elements:
        previous = 0
        for row in item['rows']:
            if len(row) != 3 or not all(math.isfinite(value) for value in row) or row[0] <= 0 or row[0] < previous:
                raise ValueError('Invalid table contents')
            previous = row[0]
    # Recheck every source after compilation/export; never modify the source tree.
    verify_dependencies(dependencies(compiler, flags, sources), root, manifest, adapter)
    return {
        'formatVersion': 1,
        'source': {
            'name': 'Chantler tables embedded in ReMagX 2.6.1',
            'referenceUrl': 'https://www.nist.gov/pml/x-ray-form-factor-attenuation-and-scattering-tables',
            'copyrightNotice': 'Copyright 1995, 1996, 2001 U.S. Secretary of Commerce on behalf of the United States of America. All rights reserved.',
            'redistribution': 'Redistribution permission confirmed by the user on 2026-10-23; decision D-37.',
            'legacySourceSha256': manifest['shared/periodic_table.cpp'],
            'representation': 'Original stored values exported as double-precision numbers; no interpolation or replacement data.',
        },
        'corrections': [{'atomicNumber': 92, 'decision': 'D-38', 'storedRows': 277, 'originalRequestedRows': 278,
                         'description': 'Use only stored Uranium rows; omit the original out-of-bounds read.'}],
        'elements': elements,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy-root', type=Path, default=ROOT / 'old/reMagX3')
    parser.add_argument('--output', type=Path, default=ROOT / 'app/src/data/chantler.json')
    parser.add_argument('--compiler', default='g++')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        if args.output.resolve().is_relative_to(args.legacy_root.resolve()):
            raise ValueError('Output must remain outside original sources')
        result = generate(args.legacy_root, args.compiler)
        serialized = json.dumps(result, separators=(',', ':'), allow_nan=False) + '\n'
        if args.check:
            if args.output.read_text() != serialized:
                raise ValueError('Asset differs from original output')
        else:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(serialized)
        print('Chantler asset: 92 elements, 20,255 rows, 60,765 stored values (Uranium endpoint corrected under D-38); source hashes unchanged.')
    except (OSError, ValueError, subprocess.SubprocessError):
        print('Chantler export/check failed; private build diagnostics withheld.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
