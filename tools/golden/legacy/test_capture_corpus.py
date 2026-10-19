import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest

from capture_corpus import capture, discover, validate_curve


class CorpusCaptureTest(unittest.TestCase):
    def test_rejects_empty_missing_and_linked_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for path in [root, root / 'missing']:
                with self.assertRaises(ValueError):
                    discover(path)
            (root / 'one.all').write_text('public fixture')
            (root / 'link').symlink_to(root / 'one.all')
            with self.assertRaises(ValueError):
                discover(root)

    def test_numeric_output_validation(self):
        self.assertEqual(validate_curve('[[0.1, 0]]'), [[0.1, 0]])
        for payload in ['[]', '{}', '[[1, NaN]]', '[[1, Infinity]]', '[[true, 1]]', '[[1, "2"]]', '[[1]]', '[[1, 2, 3]]']:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                validate_curve(payload)

    def test_records_failures_without_curves_and_never_prints_private_details(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'corpus'
            root.mkdir()
            for name, value in [('1.ALL', 'ok'), ('2.all', 'script'), ('3.all', 'bad'), ('4.all', 'slow')]:
                (root / name).write_text(value)
            def builder(_root, executable):
                executable.write_text('''#!/usr/bin/env python3
import pathlib,sys,time
value=pathlib.Path(sys.argv[1]).read_text()
if value=='slow': time.sleep(2)
if value=='script':
 print('PRIVATE-MARKER', file=sys.stderr)
 sys.exit(10)
print('[[1, NaN]]' if value=='bad' else '[[0.1, 0.2]]')
''')
                executable.chmod(0o700)
                return executable
            output = Path(directory) / 'output'
            stream = io.StringIO()
            with contextlib.redirect_stdout(stream), contextlib.redirect_stderr(stream):
                result = capture(root, output, .5, builder)
            self.assertEqual(stream.getvalue(), '')
            self.assertEqual(result['counts'], {'captured': 1, 'reference-error': 1, 'invalid-output': 1, 'timeout': 1})
            self.assertFalse(result['allReferencesCaptured'])
            self.assertFalse(result['acceptancePassed'])
            self.assertEqual(sorted(p.name for p in output.iterdir()), ['0001.json', 'manifest.json'])
            manifest = json.loads((output / 'manifest.json').read_text())
            self.assertEqual(manifest['projects'][1]['exitCode'], 10)
            self.assertEqual(len(manifest['inputTreeSha256']), 64)
            self.assertNotIn('PRIVATE-MARKER', (output / 'manifest.json').read_text())
            self.assertEqual((root / '1.ALL').read_text(), 'ok')
            with self.assertRaises(ValueError):
                capture(root, output, .5, builder)
            with self.assertRaises(ValueError):
                capture(root, root / 'output', .5, builder)
