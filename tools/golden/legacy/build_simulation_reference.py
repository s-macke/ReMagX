#!/usr/bin/env python3
"""Build a private original qz/energy simulation reference, without optimizers."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from build_reference import verify_dependencies
from build_state_reference import dependencies, HERE, REPOSITORY

SOURCES = ['CStateHandler.cpp', 'MaterialConstantsHelper.cpp', 'Variablen.cpp',
           'CPolarization.cpp', 'CTable.cpp', 'MaterialConstants.cpp', 'RechenHilfe.cpp',
           'LayerSegmentation.cpp', 'script.cpp', 'scriptfunctions.cpp',
           'scriptmetaarray.cpp', 'scriptmetaobject.cpp', 'periodic_table.cpp', 'CReflDetails.cpp']
LUA_DIRECTORY = 'shared/lua/lib/lua-5.1.4.tar/lua-5.1.4/src'
LUA_SOURCES = ('lapi lcode ldebug ldo ldump lfunc lgc llex lmem lobject lopcodes lparser '
               'lstate lstring ltable ltm lundump lvm lzio lauxlib lbaselib ldblib liolib '
               'lmathlib loslib ltablib lstrlib loadlib linit').split()


def inputs(root):
    common = ['-O2', '-fno-fast-math', '-ffp-contract=off', '-ffunction-sections', '-fdata-sections']
    cpp_flags = ['-std=c++17', '-fpermissive', '-pthread', *common, '-I' + str(root / 'shared')]
    c_flags = ['-std=gnu99', '-DLUA_USE_LINUX', *common]
    cpp_sources = [HERE / 'simulation_reference.cpp', *(root / 'shared' / name for name in SOURCES)]
    c_sources = [root / LUA_DIRECTORY / (name + '.c') for name in LUA_SOURCES]
    return cpp_flags, c_flags, cpp_sources, c_sources


def build(legacy_root, output, compiler='g++', c_compiler='gcc'):
    root = Path(legacy_root).resolve()
    cpp_flags, c_flags, cpp_sources, c_sources = inputs(root)
    closure = dependencies(compiler, cpp_flags, cpp_sources) + dependencies(c_compiler, c_flags, c_sources)
    manifest = json.loads((HERE / 'simulation_sources.json').read_text())['sha256']
    verify_dependencies(closure, root, manifest, cpp_sources[0])
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as directory:
        objects = []
        for source in c_sources:
            target = Path(directory) / (source.stem + '.o')
            subprocess.run([c_compiler, *c_flags, '-c', str(source), '-o', str(target)],
                           check=True, capture_output=True, text=True)
            objects.append(target)
        subprocess.run([compiler, *cpp_flags, '-Wl,--gc-sections', '-Wl,--wrap=lua_pcall', '-Wl,--wrap=luaL_loadbuffer', *map(str, cpp_sources),
                        *map(str, objects), '-lfftw3', '-ldl', '-lm', '-o', str(output)],
                       check=True, capture_output=True, text=True)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy-root', type=Path, default=REPOSITORY / 'old/reMagX3')
    parser.add_argument('--output', type=Path, default=REPOSITORY / 'build/legacy-simulation-reference')
    parser.add_argument('--compiler', default='g++')
    parser.add_argument('--c-compiler', default='gcc')
    args = parser.parse_args()
    try:
        build(args.legacy_root, args.output, args.compiler, args.c_compiler)
    except (ValueError, OSError, subprocess.CalledProcessError):
        print('Private simulation reference build failed; diagnostics withheld.', file=sys.stderr)
        return 1
    print('Private simulation reference built; full-project acceptance remains open.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
