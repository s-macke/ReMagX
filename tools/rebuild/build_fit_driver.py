#!/usr/bin/env python3
"""Build a PRIVATE original-objective/clean-optimizer integration executable.

The legacy physics dependencies are not a reviewed distributable engine. This
builder excludes original optimizer implementations, verifies the private source
closure and leaves the original tree untouched.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parents[1]
sys.path.insert(0, str(REPOSITORY / 'tools/golden/legacy'))
from build_simulation_reference import inputs
from build_state_reference import dependencies


def sources(root):
    cpp_flags, c_flags, cpp_sources, c_sources = inputs(root)
    cpp_flags += ['-include', 'unistd.h', '-I' + str(REPOSITORY / 'engine/include')]
    cpp_sources[0] = HERE / 'fit_driver.cpp'
    cpp_sources += [HERE / 'legacy_optimizer_state.cpp',
                    REPOSITORY / 'engine/src/optim/nelder_mead.cpp',
                    *(root / 'shared' / name for name in ['CFit.cpp', 'CError.cpp', 'random/mtrand.cpp'])]
    return cpp_flags, c_flags, cpp_sources, c_sources


def private_dependencies(root):
    cpp_flags, c_flags, cpp_sources, c_sources = sources(root)
    closure = dependencies('g++', cpp_flags, cpp_sources) + dependencies('gcc', c_flags, c_sources)
    local = {HERE / 'fit_driver.cpp', HERE / 'legacy_optimizer_state.cpp',
             REPOSITORY / 'engine/src/optim/nelder_mead.cpp',
             REPOSITORY / 'engine/include/remagx/optimizer.h',
             REPOSITORY / 'engine/include/remagx/core.h'}
    result = {}
    for entry in closure:
        path = Path(entry).resolve()
        if path in local:
            continue
        name = path.relative_to(root).as_posix()
        if name.endswith('/CChiSquareFit.cpp'):
            raise ValueError('Original optimizer implementation is prohibited in this build.')
        result[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def build(root, output):
    root, output = Path(root).resolve(), Path(output).resolve()
    # Generated files must never be placed inside the unchanged original tree.
    if output.is_relative_to(root):
        raise ValueError('Output must be outside the legacy source tree.')
    expected = json.loads((HERE / 'fit_driver_sources.json').read_text())['sha256']
    if private_dependencies(root) != expected:
        raise ValueError('Private source closure changed; review required.')
    cpp_flags, c_flags, cpp_sources, c_sources = sources(root)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='remagx-fit-driver-') as directory:
        objects = []
        for source in c_sources:
            target = Path(directory) / (source.stem + '.o')
            subprocess.run(['gcc', *c_flags, '-c', str(source), '-o', str(target)],
                           check=True, capture_output=True, text=True)
            objects.append(target)
        temporary = Path(directory) / 'fit-driver'
        subprocess.run(['g++', *cpp_flags, '-Wl,--gc-sections', '-Wl,--wrap=lua_pcall',
                        '-Wl,--wrap=luaL_loadbuffer', *map(str, cpp_sources), *map(str, objects),
                        '-lfftw3', '-ldl', '-lm', '-o', str(temporary)],
                       check=True, capture_output=True, text=True)
        symbols = subprocess.check_output(['nm', '-C', str(temporary)], text=True)
        if any('CChiSquareFit::' + name in symbols for name in
               ['Simplex(', 'Simplex2(', 'amotry(', 'amotsa(', 'LM(', 'LineSearch(', 'Iterate(']):
            raise ValueError('Original optimizer unexpectedly linked.')
        if private_dependencies(root) != expected:
            raise ValueError('Original sources changed during the build.')
        # Publish only after compilation, symbol and source-integrity checks.
        import shutil
        shutil.copy2(temporary, output)
    print('Private fit integration driver built with clean optimizers; not a distributable terminal.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy-root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    try:
        build(args.legacy_root, args.output)
    except (OSError, ValueError, subprocess.SubprocessError):
        raise SystemExit('Private fit integration build failed; diagnostics withheld.')
