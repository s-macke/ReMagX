#!/usr/bin/env python3
"""Check the replacement state constructor against private legacy declarations."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent


def check(root):
    shared = Path(root).resolve() / 'shared'
    expected = json.loads((HERE / 'optimizer_state_sources.json').read_text())['sha256']
    for name, digest in expected.items():
        if hashlib.sha256((shared / name).read_bytes()).hexdigest() != digest:
            raise ValueError('Legacy metadata dependency changed; review required.')
    with tempfile.TemporaryDirectory(prefix='remagx-optimizer-state-') as directory:
        executable = Path(directory) / 'probe'
        command = ['g++', '-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off',
                   '-I' + str(shared), str(HERE / 'optimizer_state_probe.cpp'),
                   str(HERE / 'legacy_optimizer_state.cpp'), str(shared / 'random/mtrand.cpp'),
                   '-o', str(executable)]
        subprocess.run(command, check=True, capture_output=True, text=True)
        subprocess.run([str(executable)], check=True, capture_output=True, timeout=10)
        symbols = subprocess.check_output(['nm', '-C', str(executable)], text=True)
        forbidden = ['CChiSquareFit::Simplex', 'CChiSquareFit::amotry', 'CChiSquareFit::amotsa',
                     'CChiSquareFit::LM(', 'CChiSquareFit::LineSearch', 'CChiSquareFit::Iterate']
        if any(name in symbols for name in forbidden):
            raise ValueError('Original optimizer method unexpectedly linked.')
    print('Legacy optimizer metadata bridge passed; no original optimizer methods linked.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy-root', type=Path, required=True)
    try:
        check(parser.parse_args().legacy_root)
    except (OSError, ValueError, subprocess.SubprocessError):
        raise SystemExit('Metadata bridge check failed; private build diagnostics withheld.')
