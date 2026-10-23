#!/usr/bin/env python3
"""Regenerate qz energy-broadening goldens from the committed public default only."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

from build_simulation_reference import build, HERE, REPOSITORY
from capture_corpus import validate_curve


def capture(legacy_root):
    fixture = REPOSITORY / 'app/test/fixtures/default.all'
    raw = fixture.read_bytes()
    cases = []
    with tempfile.TemporaryDirectory(prefix='remagx-public-qz-energy-') as temporary:
        directory = Path(temporary)
        executable = build(legacy_root, directory / 'reference')
        for algorithm in [0, 1, 2]:
            settings = (f'\nalgorithm = {algorithm}\nmagnetizationmode = 1\nnumberofpoints = 8\n'
                        'energyresolution = 30\nresolution = 0\nfastresolution = 0\n')
            project = directory / 'public-default.all'
            project.write_text(raw.decode() + settings)
            result = subprocess.run([executable, project], cwd=directory, capture_output=True, timeout=30, check=True)
            curve = validate_curve(result.stdout)
            if len(curve) != 8:
                raise ValueError('Unexpected public curve length.')
            cases.append({'algorithm': algorithm, 'settings': settings, 'curve': curve})
    return {'schemaVersion': 1, 'source': 'app/test/fixtures/default.all',
            'sourceSha256': hashlib.sha256(raw).hexdigest(),
            'adapterSha256': hashlib.sha256((HERE / 'simulation_reference.cpp').read_bytes()).hexdigest(),
            'legacyManifestSha256': hashlib.sha256((HERE / 'simulation_sources.json').read_bytes()).hexdigest(),
            'cases': cases}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy-root', type=Path, default=REPOSITORY / 'old/reMagX3')
    parser.add_argument('--output', type=Path, default=REPOSITORY / 'app/test/fixtures/qz-energy-reference.json')
    args = parser.parse_args()
    try:
        result = capture(args.legacy_root)
        args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    except (ValueError, OSError, subprocess.SubprocessError):
        print('Public reference generation failed; original diagnostics withheld.')
        return 1
    print('Generated three public qz energy-broadening reference curves.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
