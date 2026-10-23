import json
import math
import os
from pathlib import Path
import struct
import unittest

from chantler import generate, HERE, ROOT


class ChantlerAssetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.asset = json.loads((ROOT / 'app/src/data/chantler.json').read_text())

    def test_complete_ordered_finite_tables_preserve_stored_precision(self):
        tables = self.asset['elements']
        self.assertEqual([table['atomicNumber'] for table in tables], list(range(1, 93)))
        self.assertEqual(sum(len(table['rows']) for table in tables), 20255)
        for table in tables:
            self.assertTrue(table['rows'])
            energies = []
            for row in table['rows']:
                self.assertEqual(len(row), 3)
                self.assertTrue(all(isinstance(value, (int, float)) and not isinstance(value, bool)
                                    and math.isfinite(value) for value in row))
                self.assertGreater(row[0], 0)
                energies.append(row[0])
                # These are exact legacy stored values represented in double;
                # parsing the original decimal literals directly would differ.
                for value in row:
                    self.assertEqual(struct.pack('d', value),
                                     struct.pack('d', struct.unpack('f', struct.pack('f', value))[0]))
            self.assertEqual(energies, sorted(energies))

    def test_provenance_and_explicit_uranium_correction(self):
        self.assertEqual(self.asset['formatVersion'], 1)
        manifest = json.loads((HERE / 'chantler_sources.json').read_text())['sha256']
        self.assertEqual(self.asset['source']['legacySourceSha256'], manifest['shared/periodic_table.cpp'])
        self.assertIn('D-37', self.asset['source']['redistribution'])
        self.assertIn('U.S. Secretary of Commerce', self.asset['source']['copyrightNotice'])
        self.assertEqual(len(self.asset['elements'][-1]['rows']), 277)
        correction, = self.asset['corrections']
        self.assertEqual((correction['atomicNumber'], correction['decision'], correction['storedRows'],
                          correction['originalRequestedRows']), (92, 'D-38', 277, 278))


@unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private original source reproduction not requested')
class OriginalChantlerTest(unittest.TestCase):
    def test_all_asset_values_match_unchanged_original_storage(self):
        expected = json.loads((ROOT / 'app/src/data/chantler.json').read_text())
        self.assertEqual(generate(Path(os.environ['LEGACY_ROOT'])), expected)


if __name__ == '__main__':
    unittest.main()
