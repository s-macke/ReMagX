"""Verify the pinned container's toolchain and record its exact versions."""
import json
from pathlib import Path
import platform
import re
import subprocess

root = Path(__file__).resolve().parents[1]
expected_sdk = (root / 'engine/emscripten.version').read_text().strip()
versions = {
    'architecture': platform.machine(),
    'emscripten': subprocess.check_output(['emcc', '--version'], text=True).splitlines()[0],
    'node': subprocess.check_output(['node', '--version'], text=True).strip(),
    'npm': subprocess.check_output(['npm', '--version'], text=True).strip(),
    'g++': subprocess.check_output(['g++', '-dumpfullversion'], text=True).strip(),
    'cmake': subprocess.check_output(['cmake', '--version'], text=True).splitlines()[0],
    'python': platform.python_version(),
    'libc': platform.libc_ver(),
}
if versions['architecture'] != 'x86_64':
    raise SystemExit('This container build is currently validated only for linux/amd64.')
if not re.search(r'\b' + re.escape(expected_sdk) + r'\b', versions['emscripten']):
    raise SystemExit('Container SDK differs from engine/emscripten.version.')
if versions['node'] != 'v24.19.0':
    raise SystemExit('Container Node version differs from the reviewed image.')
(root / 'build').mkdir(exist_ok=True)
(root / 'build/toolchain.json').write_text(json.dumps(versions, indent=2) + '\n')
print(json.dumps(versions, indent=2))
