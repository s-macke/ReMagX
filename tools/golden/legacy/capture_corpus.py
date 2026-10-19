#!/usr/bin/env python3
"""Capture private qz reference attempts; successful execution is not parity acceptance."""
import argparse
from collections import Counter
import hashlib
import json
import math
import os
from pathlib import Path
import resource
import shutil
import subprocess
import tempfile

from build_simulation_reference import build, REPOSITORY, HERE


def discover(root):
    root = Path(root)
    if not root.is_dir() or root.is_symlink():
        raise ValueError('Invalid private corpus root.')
    files = []
    for directory, folders, names in os.walk(root, onerror=lambda error: (_ for _ in ()).throw(error)):
        for name in folders + names:
            if (Path(directory) / name).is_symlink():
                raise ValueError('Private corpus symbolic links are unsupported.')
        files.extend((Path(directory) / name).relative_to(root) for name in names if name.lower().endswith('.all'))
    if not files:
        raise ValueError('Private corpus contains no projects.')
    return sorted(files)


def validate_curve(payload):
    rows = json.loads(payload)
    if not isinstance(rows, list) or not rows:
        raise ValueError('Invalid reference curve.')
    for row in rows:
        if not isinstance(row, list) or len(row) != 2 or any(
                isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) for value in row):
            raise ValueError('Invalid reference curve.')
    return rows


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def capture(root, output, timeout, builder=build):
    projects = discover(root)
    root, output = Path(root).resolve(), Path(output).absolute()
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError('Invalid reference timeout.')
    # Never overwrite an earlier capture, or place generated files in its inputs.
    if output.exists() or output.is_symlink() or output.resolve().is_relative_to(root):
        raise ValueError('Capture destination must be new and outside the corpus.')
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    with tempfile.TemporaryDirectory(prefix='remagx-corpus-capture-') as temporary:
        temporary = Path(temporary)
        executable = builder(root, temporary / 'reference')
        copied = temporary / 'corpus'
        shutil.copytree(root, copied)
        # A whole-input fingerprint includes local tables and script resources.
        inputs = hashlib.sha256()
        for path in sorted(p for p in copied.rglob('*') if p.is_file()):
            inputs.update(json.dumps([str(path.relative_to(copied)), digest(path)]).encode())
        manifest = {'formatVersion': 1, 'scope': 'qz-reflectivity-execution-only',
                    'acceptancePassed': False, 'allReferencesCaptured': False,
                    'referenceSha256': digest(executable), 'inputTreeSha256': inputs.hexdigest(),
                    'sourceManifestSha256': digest(HERE / 'simulation_sources.json'),
                    'timeoutSeconds': timeout, 'projects': []}
        output.mkdir(parents=True)
        for index, relative in enumerate(projects, 1):
            path = copied / relative
            item = {'id': index, 'project': str(relative), 'projectSha256': digest(path)}
            try:
                process = subprocess.run([str(executable), str(path)], cwd=path.parent,
                                         capture_output=True, timeout=timeout)
                if process.returncode:
                    item.update(status='reference-error', exitCode=process.returncode)
                else:
                    rows = validate_curve(process.stdout)
                    curve = output / f'{index:04d}.json'
                    curve.write_text(json.dumps(rows, allow_nan=False) + '\n')
                    item.update(status='captured', points=len(rows), curve=curve.name, curveSha256=digest(curve))
            except subprocess.TimeoutExpired:
                item['status'] = 'timeout'
            except (ValueError, OverflowError):
                item['status'] = 'invalid-output'
            manifest['projects'].append(item)
        counts = dict(Counter(item['status'] for item in manifest['projects']))
        manifest['allReferencesCaptured'] = counts.get('captured', 0) == len(projects)
        (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        return {'projects': len(projects), 'counts': counts,
                'allReferencesCaptured': manifest['allReferencesCaptured'], 'acceptancePassed': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy-root', type=Path, default=REPOSITORY / 'old/reMagX3')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--timeout', type=float, default=120)
    args = parser.parse_args()
    try:
        # CLI artifacts must stay in this repository's ignored build directory.
        output = args.output.absolute()
        private_build = REPOSITORY / 'build'
        if not output.resolve().is_relative_to(private_build.resolve()) or output.resolve() == private_build.resolve():
            raise ValueError('Private captures must be below build/.')
        if any(parent.is_symlink() for parent in [output, *output.parents] if parent != REPOSITORY.parent):
            raise ValueError('Capture destination links are unsupported.')
        ignored = subprocess.run(['git', '-c', f'safe.directory={REPOSITORY}', 'check-ignore', '--quiet', str(output)],
                                 cwd=REPOSITORY, capture_output=True)
        if ignored.returncode != 0:
            raise ValueError('Capture destination must be git-ignored.')
        # Check the supplied root before resolve() can conceal a symbolic link.
        discover(args.legacy_root)
        result = capture(args.legacy_root, output, args.timeout)
        print(json.dumps(result))
        return 0 if result['allReferencesCaptured'] else 1
    except (OSError, ValueError, OverflowError, subprocess.SubprocessError):
        print('Private reference capture failed; paths and diagnostics withheld.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
