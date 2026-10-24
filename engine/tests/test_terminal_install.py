"""Check that a staged native installation runs after relocation (Linux)."""
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile

build = Path(sys.argv[1]).resolve()
bin_directory, library_directory, data_directory, cmake = sys.argv[2:6]
for destination in (bin_directory, library_directory, data_directory):
    if Path(destination).is_absolute() or ".." in Path(destination).parts:
        raise SystemExit("Relocation smoke test requires prefix-relative install directories")
root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='remagx-install-') as directory:
    temporary = Path(directory)
    prefix = temporary / 'original'
    subprocess.run([cmake, '--install', str(build), '--prefix', str(prefix)], check=True,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    installed = temporary / 'relocated'
    prefix.rename(installed)
    executable = installed / bin_directory / 'remagx-terminal'
    environment = dict(os.environ)
    environment.pop('LD_LIBRARY_PATH', None)
    environment.pop('LD_PRELOAD', None)
    def run(arguments):
        return subprocess.run([str(executable), *arguments], cwd=temporary, env=environment,
                              check=True, capture_output=True, text=True, timeout=20)
    assert 'double precision' in run(['-v']).stdout
    dependencies = subprocess.run(['ldd', str(executable)], env=environment,
                                  check=True, capture_output=True, text=True).stdout
    assert str(build) not in dependencies, 'Installed executable still loads build-tree libraries'
    assert 'not found' not in dependencies, 'Installed executable has unresolved dependencies'
    for line in dependencies.splitlines():
        if 'libremagx_core.' in line:
            assert str(installed) in line, 'Core was loaded from outside the installation'
    project = json.loads((root / 'tests/fixtures/project-v1.json').read_text())
    project['scripts']['enabled'] = False
    project['calculation']['automaticOpticalConstants'] = False
    project['calculation']['roughnessModel'] = 'nevot-croce'
    project['experiment']['qzScan'].update(points=3, qzMax=0.1, useDatasetPoints=False)
    filename = temporary / 'public.json'
    filename.write_text(json.dumps(project))
    rows = run(['-refl', str(filename)]).stdout.splitlines()
    assert len(rows) == 3
    assert all(len(row.split()) == 2 and all(math.isfinite(float(value)) for value in row.split()) for row in rows)
    notices = installed / data_directory / 'doc/remagx'
    for name in ['LICENSE', 'licenses/math-NOTICE.txt', 'licenses/COPYING.LIB', 'licenses/LICENSE.MIT']:
        assert (notices / name).is_file(), f'Missing installed notice: {name}'
print('Relocated native terminal: version, calculation, dependency resolution and notices passed.')
