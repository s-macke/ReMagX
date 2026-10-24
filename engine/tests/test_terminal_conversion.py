"""Public CLI conversion checks for the approved tensor-construction correction."""
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

EXECUTABLE = str(Path(sys.argv.pop(1)).resolve())


class TerminalConversion(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='remagx-convert-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.base = self.directory / 'public material'

    def write(self, extension, text):
        path = Path(str(self.base) + '.' + extension)
        path.write_text(text)
        return path

    def run_conversion(self, success=True):
        result = subprocess.run([EXECUTABLE, '-convert', str(self.base)], cwd=self.directory,
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0 if success else 1, result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertEqual(list(self.directory.glob('.remagx-convert-*')), [])
        return result

    def rows(self):
        lines = Path(str(self.base) + '.e').read_text().splitlines()
        rows = [[float(part) for part in line.split()] for line in lines if line and not line.startswith('#')]
        self.assertTrue(all(len(row) == 19 and all(math.isfinite(value) for value in row) for row in rows))
        return rows

    def check_tensor(self, row, energy, delta, beta, delta_magnetic=0, beta_magnetic=0):
        self.assertEqual(row[0], energy)
        diagonal = complex(1-delta, beta)**2
        coupling = 2j * diagonal * complex(delta_magnetic, -beta_magnetic)
        # Analytic tensor at gamma=phi=90: diagonal n^2 and xz=-zx coupling.
        expected = [diagonal, 0j, coupling, 0j, diagonal, 0j, -coupling, 0j, diagonal]
        for index, value in enumerate(expected):
            for actual, reference in zip(row[1+index*2:3+index*2], (value.real, value.imag)):
                self.assertLessEqual(abs(actual-reference), 1e-15+1e-10*abs(reference))

    def test_magnetic_interpolation_replaces_existing_tensor_and_preserves_sources(self):
        optical = '1000 .003 .0003\n800 .00123456789012345 .0001\n900 .002 .0002\n'
        magnetic = '800 .00001 .000001\n1000 .00003 .000003\n'
        db = self.write('db', optical); mag = self.write('m', magnetic)
        self.write('e', '# previous tensor must not be used\n800 ' + ' '.join(['123']*18))
        result = self.run_conversion()
        self.assertIn('Converted 3 rows', result.stderr)
        rows = self.rows()
        self.assertEqual(len(rows), 3)
        self.check_tensor(rows[0],800,.00123456789012345,.0001,.00001,.000001)
        self.check_tensor(rows[1],900,.002,.0002,.00002,.000002)
        self.check_tensor(rows[2],1000,.003,.0003,.00003,.000003)
        self.assertEqual(db.read_text(), optical); self.assertEqual(mag.read_text(), magnetic)

    def test_absent_magnetic_table_and_parser_report(self):
        self.write('db', '# public\n800 .001 .0001 extra\nbroken row\n')
        result = self.run_conversion()
        self.assertIn('without magneto-optical', result.stderr)
        self.assertIn('1 malformed rows skipped', result.stderr)
        self.assertIn('1 rows have ignored extra columns', result.stderr)
        self.check_tensor(self.rows()[0],800,.001,.0001)

    def test_magnetic_range_exclusion(self):
        self.write('db', '700 .001 .0001\n800 .001 .0001\n900 .001 .0001')
        self.write('m', '800 .00001 .000001')
        self.assertIn('2 energies outside .m range', self.run_conversion().stderr)
        for index, row in enumerate(self.rows()):
            self.check_tensor(row,700+100*index,.001,.0001,.00001 if index == 1 else 0,.000001 if index == 1 else 0)

    def test_empty_magnetic_table(self):
        self.write('db', '800 .001 .0001'); self.write('m', '# empty')
        self.assertIn('without magneto-optical', self.run_conversion().stderr)
        self.check_tensor(self.rows()[0],800,.001,.0001)

    def test_failures_preserve_existing_output(self):
        output = self.write('e', 'previous output\n')
        for text in (None, '# empty', '800 1e308 1e308'):
            with self.subTest(text=text):
                if text is not None: self.write('db', text)
                self.run_conversion(False)
                self.assertEqual(output.read_text(), 'previous output\n')

    def test_unreadable_magnetic_and_output_failure(self):
        self.write('db', '800 .001 .0001')
        magnetic = Path(str(self.base)+'.m'); magnetic.mkdir()
        self.run_conversion(False)
        magnetic.rmdir()
        output = Path(str(self.base)+'.e'); output.mkdir()
        marker = output/'retained'; marker.write_text('keep')
        self.run_conversion(False)
        self.assertEqual(marker.read_text(),'keep')


if __name__ == '__main__':
    unittest.main()
