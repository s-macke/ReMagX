import hashlib
import json
from pathlib import Path
import unittest


class ReferenceMathSources(unittest.TestCase):
    def test_pinned_unmodified_upstream_and_distributed_license(self):
        root = Path(__file__).resolve().parents[1]
        directory = root / 'third_party/glibc_math'
        manifest = json.loads((directory / 'manifest.json').read_text())
        self.assertEqual(manifest['revision'], '04e750e75b73957cf1c791535a3f4319534a52fc')
        expected = {'e_atan2.c', 'e_asin.c', 's_sin.c', 'sincostab.c', 'branred.c',
                    'dla.h', 'mydefs.h', 'uatan.tbl', 'atnat2.h', 'usncs.h', 'branred.h',
                    'asincos.tbl', 'root.tbl', 'powtwo.tbl', 'uasncs.h', 'COPYING.LIB',
                    'e_hypot.c', 's_csqrt_template.c', 's_clog_template.c', 'x2y2m1.c', 'mul_split.h'}
        self.assertEqual(set(manifest['sha256']), expected)
        for name, digest in manifest['sha256'].items():
            self.assertEqual(hashlib.sha256((directory / name).read_bytes()).hexdigest(), digest, name)
        self.assertEqual((directory / 'COPYING.LIB').read_bytes(),
                         (root.parent / 'app/public/licenses/glibc-LGPL-2.1.txt').read_bytes())


if __name__ == '__main__':
    unittest.main()
