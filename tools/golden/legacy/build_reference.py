#!/usr/bin/env python3
"""Build the narrow private-source Parratt oracle after checking its include closure."""
import argparse
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parents[2]


def verify_dependencies(dependencies, legacy_root, manifest, adapter):
    root = Path(legacy_root).resolve()
    found = set()
    for dependency in dependencies:
        path = Path(dependency).resolve()
        if path == Path(adapter).resolve():
            continue
        try:
            relative = path.relative_to(root).as_posix()
        except ValueError:
            raise ValueError('Unreviewed dependency outside the legacy source root.') from None
        expected = manifest.get(relative)
        if expected is None:
            raise ValueError('Unreviewed legacy dependency; build refused.')
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('Legacy source differs from the reviewed snapshot; build refused.')
        found.add(relative)
    if found != set(manifest):
        raise ValueError('Dependency closure differs from the reviewed snapshot; build refused.')


def build(legacy_root, output, compiler='g++'):
    root = Path(legacy_root).resolve()
    adapter = HERE / 'parratt_reference.cpp'
    manifest = json.loads((HERE / 'parratt_sources.json').read_text())['sha256']
    flags = [compiler, '-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', '-pthread', '-I' + str(root / 'shared')]
    dependency_output = subprocess.run([*flags, '-MM', str(adapter)], check=True, capture_output=True, text=True).stdout
    dependencies = shlex.split(dependency_output.split(':', 1)[1].replace('\\\n', ' '))
    verify_dependencies(dependencies, root, manifest, adapter)
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([*flags, str(adapter), '-o', str(output)], check=True, capture_output=True, text=True)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy-root', type=Path, default=REPOSITORY / 'old/reMagX3')
    parser.add_argument('--output', type=Path, default=REPOSITORY / 'build/legacy-parratt-reference')
    parser.add_argument('--compiler', default='g++')
    args = parser.parse_args()
    try:
        build(args.legacy_root, args.output, args.compiler)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        # Compiler diagnostics can echo private paths and source text.
        print(str(error) if isinstance(error, ValueError) else 'Reference build failed; verify the private sources and C++17 compiler locally.', file=sys.stderr)
        return 1
    print('Private-source Parratt reference built; eight reviewed headers, double instantiation, 17-digit output.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
