"""Demonstrate original -convert behavior using only disposable synthetic tables.

Pass an already built, private original terminal. No legacy sources or research
projects are copied, changed or emitted. This records a bug, not acceptance.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile


def diagnose(executable):
    executable = Path(executable).resolve(strict=True)
    findings = []
    for existing_tensor in (False, True):
        with tempfile.TemporaryDirectory(prefix='remagx-convert-') as directory:
            root = Path(directory)
            (root / 'sample.db').write_text('100 0.01 0.002\n200 0.02 0.003\n')
            (root / 'sample.m').write_text('100 0.001 0.0002\n200 0.002 0.0003\n')
            # Existing .e values are deliberately unrelated to .db/.m.
            values = [value for component in range(9) for value in (component + 1, 0)]
            if existing_tensor:
                (root / 'sample.e').write_text('\n'.join(
                    ' '.join(map(str, [energy, *values])) for energy in (100, 200)) + '\n')
            result = subprocess.run([str(executable), '-convert', 'sample'], cwd=root,
                                    capture_output=True, text=True, timeout=10)
            if result.returncode:
                raise RuntimeError('Original terminal failed the synthetic conversion.')
            rows = [[float(value) for value in line.split()]
                    for line in (root / 'sample.e').read_text().splitlines()
                    if line.strip() and not line.startswith('#')]
            expected = values if existing_tensor else [0] * 18
            if rows != [[energy, *expected] for energy in (100, 200)]:
                raise RuntimeError('Original conversion behavior changed; review required.')
            findings.append({'existingTensor': existing_tensor,
                             'result': 'copiedExistingTensor' if existing_tensor else 'allZeroTensor',
                             'rows': len(rows)})
    return {'terminalSha256': hashlib.sha256(executable.read_bytes()).hexdigest(),
            'cases': findings, 'acceptancePassed': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('terminal', type=Path)
    print(json.dumps(diagnose(parser.parse_args().terminal), indent=2))
