from pathlib import Path
import tempfile
import os
import signal
import sys
import unittest

from crosscheck_wine import compare_curves, crosscheck, expected_version, invoke, parse_wine_curve, summarize_comparisons, tree_fingerprint, wine_failure_status


class WineCrosscheckTest(unittest.TestCase):
    def test_version_query_accepts_only_the_required_terminal_version(self):
        self.assertTrue(expected_version(b'ReMagX version 2.3.1 (build 1)\r\n'))
        for text in [b'', b'ReMagX version 2.3.10', b'ReMagX version 2.6.0', b'error 2.3.1', b'ReMagX version 2.3.1-other']:
            self.assertFalse(expected_version(text))

    def test_only_explicit_errors_establish_terminal_unavailability(self):
        self.assertIsNone(wine_failure_status(0, b'1 2'))
        self.assertEqual(wine_failure_status(1, b''), 'wine-failure')
        self.assertEqual(wine_failure_status(-11, b'1 2'), 'wine-failure')
        self.assertEqual(wine_failure_status(1, b'#Error: calculation failed'), 'wine-error')
        self.assertEqual(wine_failure_status(0, b'#error: calculation failed'), 'wine-error')
        self.assertEqual(wine_failure_status('timeout', b'#error'), 'wine-timeout')

    def test_terminal_numbers_and_rejected_diagnostics(self):
        self.assertEqual(parse_wine_curve(b' 2.000000e-03 1.234567e-01\r\n\n.5 0\n'),
                         [[.002, .1234567], [.5, 0]])
        for payload in [b'', b'\n', b'#error\n', b'1 nan', b'1 inf', b'1 2 3', b'1', b'1 2\nwarning', b'\xff']:
            with self.subTest(payload=payload), self.assertRaises((ValueError, UnicodeError)):
                parse_wine_curve(payload)

    def test_relative_criterion_has_no_absolute_slack_or_resampling(self):
        self.assertTrue(compare_curves([[1, 2]], [[1, 2]])['passed'])
        self.assertTrue(compare_curves([[1, 2 + 1e-6]], [[1, 2]])['passed'])
        self.assertFalse(compare_curves([[1, 2 + 3e-6]], [[1, 2]])['passed'])
        self.assertFalse(compare_curves([[1, 1e-30]], [[1, 0]])['passed'])
        self.assertTrue(compare_curves([[0, 0]], [[0, 0]])['passed'])
        self.assertFalse(compare_curves([], [])['passed'])
        result = compare_curves([[1, 2]], [[1, 2], [2, 3]])
        self.assertFalse(result['passed'])
        self.assertFalse(result['lengthMatch'])
        self.assertFalse(compare_curves([[2, 3], [1, 2]], [[1, 2], [2, 3]])['passed'])
        self.assertIsNone(compare_curves([[1, 1e308]], [[1, 1e-308]])['maxRelativeErrorForNonzeroReference'][1])

    def test_weight_sum_difference_remains_a_failed_comparison(self):
        # A representative seven-significant-digit output after the old .999999 sum.
        expected = float(format(1.0 * .999999, '.6e'))
        result = compare_curves([[.1, 1.0]], [[.1, expected]])
        self.assertGreater(abs(1.0 - expected), 1e-6 * abs(expected))
        self.assertEqual(result['mismatches'], [0, 1])
        self.assertFalse(result['passed'])

    def test_acceptance_requires_complete_nonvacuous_results_without_unknown_failures(self):
        rows = [{'id': 1, 'status': 'matched'}, {'id': 2, 'status': 'wine-error'}]
        self.assertTrue(summarize_comparisons(2, rows)['acceptancePassed'])
        self.assertFalse(summarize_comparisons(3, rows)['acceptancePassed'])
        self.assertFalse(summarize_comparisons(0, [])['acceptancePassed'])
        self.assertFalse(summarize_comparisons(2, [rows[0], rows[0]])['acceptancePassed'])
        for status in ['wine-error', 'wine-failure', 'wine-timeout', 'native-error', 'native-timeout', 'mismatch', 'invalid-output', 'input-changed']:
            changed = [{'id': 1, 'status': status}, rows[1]]
            with self.subTest(status=status):
                self.assertFalse(summarize_comparisons(2, changed)['acceptancePassed'])

    def test_background_output_handles_do_not_create_a_false_timeout(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pid_file = root / 'child.pid'
            program = ("import subprocess,sys; from pathlib import Path; "
                       "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); "
                       "Path(sys.argv[1]).write_text(str(child.pid)); print('1 2')")
            try:
                status, output, _ = invoke([sys.executable, '-c', program, str(pid_file)], root, os.environ, 2)
                self.assertEqual(status, 0)
                self.assertEqual(parse_wine_curve(output), [[1, 2]])
            finally:
                if pid_file.exists():
                    try:
                        os.kill(int(pid_file.read_text()), signal.SIGTERM)
                    except ProcessLookupError:
                        pass

    def test_invalid_configuration_fails_before_launching_reference_processes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'project.all').write_text('public synthetic project')
            for selection in [[], [0], [2], [1, 1]]:
                with self.subTest(selection=selection), self.assertRaises(ValueError):
                    crosscheck(root, root / 'output', 1, case_ids=selection)
            for timeout in [0, -1, float('nan'), float('inf')]:
                with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                    crosscheck(root, root / 'output', timeout)
            with self.assertRaises(ValueError):
                crosscheck(root, root / 'outside-ignored-build', 1)
            self.assertFalse((root / 'outside-ignored-build').exists())

    def test_fingerprint_detects_companion_changes_and_rejects_links(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'project.all').write_text('public synthetic project')
            companion = root / 'table.db'
            companion.write_text('first')
            before = tree_fingerprint(root)
            companion.write_text('second')
            self.assertNotEqual(before, tree_fingerprint(root))
            companion.unlink()
            companion.symlink_to('project.all')
            with self.assertRaises(ValueError):
                tree_fingerprint(root)


if __name__ == '__main__':
    unittest.main()
