"""Public synthetic probe of the coordinates passed by legacy Fourier fitting.

This is not a fit reference: it demonstrates preparation followed by a rejected
simulation, without linking an optimizer or accepting partial numerical output.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile

from build_simulation_reference import build, REPOSITORY


def diagnose(legacy_root):
    # CalcErrorOfDataset postprocesses the copied measurement before invoking the
    # DLL solver, and does not inspect its returned status. Keep that reviewed
    # private source pinned even though this probe does not link CError.
    source = (Path(legacy_root) / 'shared/CError.cpp').read_text(encoding='latin1')
    if hashlib.sha256(source.encode()).hexdigest() != '04fd3895a30b5aa7c4cdacad253566fee5c4ff19cc4a2d11ae174a4b1a7003bd':
        raise ValueError('Legacy error source changed; review required.')
    with tempfile.TemporaryDirectory(prefix='remagx-fourier-fit-') as temporary:
        directory = Path(temporary)
        executable = build(legacy_root, directory / 'reference')
        fixture = (REPOSITORY / 'app/test/fixtures/default.all').read_text()
        project = directory / 'project.all'

        def run(text, *options):
            project.write_text(text)
            return subprocess.run([executable, project, *options], cwd=directory,
                                  capture_output=True, text=True, timeout=30)

        # A synthetic measured curve: the original solver output supplies finite
        # nonconstant values, so no private project data is involved.
        base = fixture + '\nnumberofpoints = 17\nenergy = 640\nenergyresolution = 0\n'
        raw = run(base)
        if raw.returncode:
            raise ValueError('Synthetic baseline calculation failed.')
        raw_points = json.loads(raw.stdout)
        measured = base + '\nusemeasurementqz = 1\ndatasetnumber = 1\n' + ''.join(
            f'dataset_qz = {qz:.17g}\ndataset_R0 = {value:.17g}\n'
            for qz, value in raw_points) + 'activedatasetindex = 1\n'
        transformed = run(measured, '--fourier')
        if transformed.returncode:
            raise ValueError('Synthetic Fourier calculation failed.')
        depth_points = json.loads(transformed.stdout)
        maximum_qz = 4 * math.pi / (12398.326 / 640)
        if len(depth_points) != len(raw_points) // 2 or depth_points[1][0] <= maximum_qz:
            raise ValueError('Synthetic preparation did not expose the coordinate conflict.')
        # Reproduce the coordinate input produced by measurement PostModifications
        # in CalcErrorOfDataset. It then initializes R to one and calls the solver.
        # The first solver error occurs before its final Fourier stage.
        prepared = base + '\nusemeasurementqz = 1\ndatasetnumber = 1\n' + ''.join(
            f'dataset_qz = {depth:.17g}\ndataset_R0 = 1\n'
            for depth, _ in depth_points) + 'activedatasetindex = 1\n'
        rejected = run(prepared)
        if rejected.returncode != 7 or rejected.stdout:
            raise ValueError('Expected solver rejection was not reproduced.')
        return {
            'scope': 'synthetic Fourier-fit coordinate preparation, not fit acceptance',
            'originalPointCount': len(raw_points),
            'transformedPointCount': len(depth_points),
            'firstPositiveDepth': depth_points[1][0],
            'maximumPhysicalQz': maximum_qz,
            'simulationAdapterExitCode': rejected.returncode,
            'publishedRejectedCurve': bool(rejected.stdout),
            'acceptancePassed': False,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy-root', type=Path, default=REPOSITORY / 'old/reMagX3')
    arguments = parser.parse_args()
    try:
        print(json.dumps(diagnose(arguments.legacy_root), indent=2, allow_nan=False))
    except (OSError, ValueError, subprocess.SubprocessError):
        parser.exit(1, 'Fourier fit diagnostic failed; source/compiler diagnostics withheld.\n')


if __name__ == '__main__':
    main()
