#!/usr/bin/env python3
"""Build the private original project loader, with no optimizer or Lua implementation."""
import argparse
import json
from pathlib import Path
import shlex
import subprocess
import sys
from build_reference import verify_dependencies

HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parents[2]
SOURCES = ['CStateHandler.cpp', 'MaterialConstantsHelper.cpp', 'Variablen.cpp', 'CPolarization.cpp', 'CTable.cpp']


def dependencies(compiler, flags, sources):
    result = subprocess.run([compiler, *flags, '-MM', *map(str, sources)], check=True, capture_output=True, text=True)
    return [item for rule in result.stdout.replace('\\\n', ' ').splitlines()
            for item in shlex.split(rule.split(':', 1)[1])]


def build(legacy_root, output, compiler='g++'):
    root = Path(legacy_root).resolve()
    adapter = HERE / 'state_reference.cpp'
    sources = [adapter, *(root / 'shared' / name for name in SOURCES)]
    flags = ['-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', '-pthread',
             '-ffunction-sections', '-fdata-sections', '-I' + str(root / 'shared')]
    manifest = json.loads((HERE / 'state_sources.json').read_text())['sha256']
    verify_dependencies(dependencies(compiler, flags, sources), root, manifest, adapter)
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    # Drop unused legacy methods rather than linking optimizer, scripting,
    # FFT or built-in-table implementations merely to load a project.
    subprocess.run([compiler, *flags, '-Wl,--gc-sections', *map(str, sources), '-o', str(output)],
                   check=True, capture_output=True, text=True)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy-root', type=Path, default=REPOSITORY / 'old/reMagX3')
    parser.add_argument('--output', type=Path, default=REPOSITORY / 'build/legacy-state-reference')
    parser.add_argument('--compiler', default='g++')
    args = parser.parse_args()
    try:
        build(args.legacy_root, args.output, args.compiler)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(str(error) if isinstance(error, ValueError) else 'Private project-loader build failed.', file=sys.stderr)
        return 1
    print('Private original project-loader reference built; numeric state only, no simulation goldens.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
