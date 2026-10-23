#!/usr/bin/env python3
"""Compare original native qz references with the shipped Wine terminal (AC-6)."""
import argparse
import hashlib
from collections import Counter
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from build_simulation_reference import build, REPOSITORY
from capture_corpus import discover, digest, validate_curve


def expected_version(payload):
    return any(line.split()[:3] == [b'ReMagX', b'version', b'2.3.1'] for line in payload.splitlines())


def parse_wine_curve(payload):
    text = payload.decode('ascii')
    rows = []
    for line in text.splitlines():
        if not line.strip():
            continue
        fields = line.split()
        if len(fields) != 2:
            raise ValueError('Invalid terminal output.')
        values = [float(field) for field in fields]
        if not all(map(math.isfinite, values)):
            raise ValueError('Nonfinite terminal output.')
        rows.append(values)
    if not rows:
        raise ValueError('Empty terminal output.')
    return rows


def wine_failure_status(status, stdout):
    if status == 'timeout':
        return 'wine-timeout'
    if b'#error' in stdout.lower():
        return 'wine-error'
    if status != 0:
        return 'wine-failure'
    return None


def compare_curves(native, wine):
    # Wine is the AC-6 reference. There is no absolute tolerance or resampling.
    mismatches = [0, 0]
    maximum = [0., 0.]
    for actual, expected in zip(native, wine):
        for column in range(2):
            difference = abs(actual[column] - expected[column])
            if difference > 1e-6 * abs(expected[column]):
                mismatches[column] += 1
            if expected[column] != 0:
                relative = difference / abs(expected[column])
                if not math.isfinite(relative):
                    maximum[column] = None
                elif maximum[column] is not None:
                    maximum[column] = max(maximum[column], relative)
    length_match = len(native) == len(wine)
    return {'nativePoints': len(native), 'winePoints': len(wine), 'lengthMatch': length_match,
            'mismatches': mismatches, 'maxRelativeErrorForNonzeroReference': maximum,
            'passed': bool(native and wine) and length_match and not any(mismatches)}



def summarize_comparisons(corpus_count, cases):
    counts = dict(Counter(row['status'] for row in cases))
    complete = corpus_count > 0 and len(cases) == corpus_count and {row['id'] for row in cases} == set(range(1, corpus_count + 1))
    passed = complete and counts.get('matched', 0) > 0 and all(
        row['status'] in ['matched', 'wine-error'] for row in cases)
    return {'projects': len(cases), 'completeCorpus': complete, 'counts': counts, 'acceptancePassed': passed}


def tree_fingerprint(root):
    fingerprint = hashlib.sha256()
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError('Input links are unsupported.')
        if path.is_file():
            fingerprint.update(json.dumps([str(path.relative_to(root)), digest(path)]).encode())
    return fingerprint.hexdigest()


def invoke(command, cwd, environment, timeout):
    # Wine services may inherit output handles after the terminal has exited.
    # Wait for the requested process, not EOF on every descendant's pipe.
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
        try:
            result = subprocess.run(command, cwd=cwd, env=environment,
                                    stdout=output, stderr=errors, timeout=timeout)
            status = result.returncode
        except subprocess.TimeoutExpired:
            status = 'timeout'
        output.seek(0)
        errors.seek(0)
        return status, output.read(), errors.read()


def crosscheck(root, output, timeout, native_path=None, case_ids=None):
    projects = discover(root)
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError('Invalid timeout.')
    selected = list(range(1, len(projects) + 1)) if case_ids is None else case_ids
    if not selected or len(set(selected)) != len(selected) or any(index < 1 or index > len(projects) for index in selected):
        raise ValueError('Invalid case selection.')
    root = Path(root).resolve()
    output = Path(output).absolute()
    private_build = (REPOSITORY / 'build').resolve()
    if output.exists() or not output.resolve().is_relative_to(private_build) or output.resolve() == private_build:
        raise ValueError('Output must be a new ignored directory below build/.')
    if any(path.is_symlink() for path in [output, *output.parents]):
        raise ValueError('Output links are unsupported.')
    subprocess.run(['git', '-c', f'safe.directory={REPOSITORY}', 'check-ignore', '--quiet', str(output)], check=True,
                   capture_output=True, cwd=REPOSITORY)
    wine = shutil.which('wine')
    server = shutil.which('wineserver')
    if not wine or not server:
        raise ValueError('Wine is unavailable.')
    with tempfile.TemporaryDirectory(prefix='remagx-wine-crosscheck-') as temporary:
        temporary = Path(temporary)
        native = Path(native_path).resolve() if native_path else build(root, temporary / 'native')
        copied = temporary / 'corpus'
        shutil.copytree(root, copied)
        input_fingerprint = tree_fingerprint(copied)
        binary = temporary / 'terminal'
        binary.mkdir()
        for directory in [root / 'bin', root / 'remagx-terminal']:
            for path in directory.iterdir():
                if path.suffix.lower() == '.dll' and not (binary / path.name).exists():
                    shutil.copy2(path, binary / path.name)
        terminal = binary / 'ReMagX_Terminal.exe'
        shutil.copy2(root / 'bin/ReMagX_Terminal.exe', terminal)
        environment = {**os.environ, 'WINEDEBUG': '-all', 'WINEPREFIX': str(temporary / 'prefix'),
                       'WINEDLLOVERRIDES': 'winemenubuilder.exe=d;mscoree,mshtml='}
        output.mkdir(parents=True)
        Path(environment['WINEPREFIX']).mkdir(mode=0o700)
        manifest = {'schemaVersion': 1, 'scope': 'qz-reflectivity-native-vs-wine-2.3.1',
                    'nativeSha256': digest(native), 'terminalSha256': digest(terminal),
                    'inputTreeSha256': input_fingerprint,
                    'dllHashes': {path.name: digest(path) for path in binary.glob('*.dll')},
                    'timeoutSeconds': timeout, 'corpusCount': len(projects), 'selectedIds': selected,
                    'completeCorpus': False, 'acceptancePassed': False, 'cases': []}
        server_process = None
        try:
            server_process = subprocess.Popen([server, '-f', '-p'], env=environment,
                                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            _, version, version_error = invoke([wine, str(terminal), '-v'], binary, environment, max(120, timeout))
            (output / 'version.stdout').write_bytes(version)
            (output / 'version.stderr').write_bytes(version_error)
            # This shipped version exits 1 for -v despite printing valid version information.
            if not expected_version(version):
                raise ValueError('Unexpected terminal version.')
            for index in selected:
                relative = projects[index - 1]
                path = copied / relative
                original_hash = digest(path)
                row = {'id': index, 'project': str(relative), 'inputSha256': original_hash}
                status, stdout, stderr = invoke([wine, str(terminal), '-refl', path.name], path.parent, environment, timeout)
                (output / f'{index:04d}.wine.stdout').write_bytes(stdout)
                (output / f'{index:04d}.wine.stderr').write_bytes(stderr)
                row['wineExitCode'] = status
                failure = wine_failure_status(status, stdout)
                if failure:
                    row['status'] = failure
                else:
                    try:
                        wine_rows = parse_wine_curve(stdout)
                        status, stdout, stderr = invoke([str(native), str(path)], path.parent, os.environ, timeout)
                        (output / f'{index:04d}.native.stdout').write_bytes(stdout)
                        (output / f'{index:04d}.native.stderr').write_bytes(stderr)
                        row['nativeExitCode'] = status
                        if status == 'timeout':
                            row['status'] = 'native-timeout'
                        elif status != 0:
                            row['status'] = 'native-error'
                        else:
                            row.update(compare_curves(validate_curve(stdout), wine_rows))
                            row['status'] = 'matched' if row['passed'] else 'mismatch'
                    except (ValueError, OverflowError, UnicodeError):
                        row['status'] = 'invalid-output'
                if digest(path) != original_hash or tree_fingerprint(copied) != input_fingerprint:
                    row['status'] = 'input-changed'
                manifest['cases'].append(row)
                (output / 'manifest.json').write_text(json.dumps(manifest, indent=2, allow_nan=False) + '\n')
                print(json.dumps({'id': index, 'status': row['status']}), flush=True)
                if row['status'] == 'input-changed':
                    break
            summary = summarize_comparisons(len(projects), manifest['cases'])
            manifest.update(summary)
            (output / 'manifest.json').write_text(json.dumps(manifest, indent=2, allow_nan=False) + '\n')
            return summary

        finally:
            if server_process is not None:
                try:
                    subprocess.run([server, '-k'], env=environment, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=10)
                    server_process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server_process.kill()
                    server_process.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy-root', type=Path, default=REPOSITORY / 'old/reMagX3')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--native', type=Path)
    parser.add_argument('--timeout', type=float, default=120)
    parser.add_argument('--case-ids', help='Optional diagnostic subset; cannot pass full-corpus acceptance.')
    args = parser.parse_args()
    try:
        selected = None if args.case_ids is None else [int(value) for value in args.case_ids.split(',')]
        summary = crosscheck(args.legacy_root, args.output, args.timeout, args.native, selected)
    except (ValueError, OSError, subprocess.SubprocessError):
        print('Wine crosscheck failed; private diagnostics withheld.')
        return 1
    print(json.dumps(summary))
    return 0 if summary['acceptancePassed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
