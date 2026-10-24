#!/usr/bin/env python3
"""Targeted native fit integration checks using a disposable public tutorial."""
import argparse
import json
import math
from pathlib import Path
import subprocess
import tempfile

REPOSITORY = Path(__file__).resolve().parents[2]


def check(executable):
    executable = Path(executable).resolve(strict=True)
    source = (REPOSITORY / 'app/test/fixtures/Tut2.all').read_text()
    with tempfile.TemporaryDirectory(prefix='remagx-fit-integration-check-') as directory:
        project = Path(directory) / 'project.all'

        def run(algorithm=0, weight=0, temperature=0, lower=50, upper=250, start=150,
                active=True, evaluations='400', iterations='200', script=None):
            text = source.replace('datasetactive = 0', 'datasetactive = 1' if active else 'datasetactive = 0')
            text += f'''\ndisablescript = 1\nocautomatic = 0\nfitalgorithm = {algorithm}
fittemp = {temperature}\nfitdtemp = -0.005\nfitvariableversion = 1\nfit_variable = 1
fit_id = 0\nfit_additional_id = 1\nfit_element_id = -1\nfit_value = {start}
fit_lower_boundary = {lower}\nfit_upper_boundary = {upper}\n'''
            if script is not None:
                text += f'\ndisablescript = 0\nscriptline = {script}\n'
            project.write_text(text)
            before = project.read_bytes()
            result = subprocess.run([str(executable), str(project), evaluations, iterations, str(weight)],
                                    cwd=directory, capture_output=True, text=True, timeout=20)
            assert project.read_bytes() == before, 'Input project changed'
            if result.returncode:
                assert result.stdout == '', 'Failure published partial fit output'
                return result.returncode
            value = json.loads(result.stdout)
            assert value['algorithm'] == algorithm and value['seed'] == 100
            assert value['termination'] in (0, 1, 2, 3)
            assert math.isfinite(value['error'])
            assert len(value['values']) == len(value['regularizationReference']) == 1
            assert lower <= value['values'][0] <= upper
            assert all(map(math.isfinite, value['regularizationReference']))
            assert value['evaluations'] <= int(evaluations) and value['iterations'] <= int(iterations)
            return value

        ordinary = run()
        assert isinstance(ordinary, dict) and ordinary == run(), 'Ordinary replay changed'
        assert ordinary['termination'] == 0 and ordinary['referenceRefreshes'] == 0
        assert abs(ordinary['values'][0] - 147.84833857789636) < 1e-9
        assert abs(ordinary['error'] - .24354908614176804) < 1e-12
        zero_temperature = run(algorithm=2)
        assert zero_temperature['values'] == ordinary['values'] and zero_temperature['error'] == ordinary['error']
        annealing = run(algorithm=2, temperature=.01, weight=.01)
        assert isinstance(annealing, dict) and annealing == run(algorithm=2, temperature=.01, weight=.01)
        assert annealing['regularizationReference'] == [150] and annealing['referenceRefreshes'] == 0
        regularized = run(weight=.01)
        assert isinstance(regularized, dict) and regularized == run(weight=.01)
        assert regularized['referenceRefreshes'] > 0
        fixed = run(weight=.01, lower=147, upper=147)
        assert fixed['values'] == [147] and fixed['regularizationReference'] == [150]
        assert fixed['iterations'] == 0 and fixed['evaluations'] == 1
        limited = run(evaluations='2', iterations='1')
        assert isinstance(limited, dict) and limited['termination'] == 1
        for arguments in [dict(active=False), dict(algorithm=1), dict(lower=250, upper=50),
                          dict(evaluations='0'), dict(iterations='-1'), dict(weight='nan'),
                          dict(algorithm=2, temperature=-1), dict(algorithm=2, temperature=-1, lower=147, upper=147),
                          dict(script='error("synthetic failure")')]:
            assert isinstance(run(**arguments), int), 'Invalid request succeeded'
        assert run() == ordinary, 'Recovery after failed requests changed'
    print('Native original-objective/clean-optimizer integration passed: both algorithms, Q, bounds, replay, limits and failures.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('executable', type=Path)
    check(parser.parse_args().executable)
