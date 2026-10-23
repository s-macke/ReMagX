import ctypes
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import math
import sys
import unittest

library = ctypes.CDLL(sys.argv.pop(1))
from table_binding import NativeTable
from table_cases import synthetic_table_cases
lookup = NativeTable(library).lookup

class TableLookupTest(unittest.TestCase):
    def test_linear_columns_endpoints_and_zero_outside(self):
        self.assertEqual(lookup([100, 200, 300], [[1, 10], [3, 20], [7, 30]], [50, 100, 150, 250, 300, 350]),
            (0, [0, 0, 1, 10, 2, 15, 5, 25, 7, 30, 0, 0], 2))
        self.assertEqual(lookup([], [], [1, 2], cursor=10), (0, [0, 0, 0, 0], 10))
        self.assertEqual(lookup([100], [[1, 2]], [99, 100, 101], cursor=10), (0, [0, 0, 1, 2, 0, 0], 10))

    def test_duplicate_energy_history_is_explicit_and_preserved(self):
        energies, rows = [1, 2, 2, 3], [[10], [20], [30], [40]]
        self.assertEqual(lookup(energies, rows, [2, 2, 2, 2], columns=1), (0, [20, 20, 30, 30], 3))
        self.assertEqual(lookup(energies, rows, [2], cursor=3, columns=1), (0, [30], 3))
        self.assertEqual(lookup(energies, rows, [2], cursor=999, columns=1), (0, [20], 1))
        self.assertEqual(lookup([2, 2], [[10], [20]], [2], cursor=99, columns=1), (0, [10], 99))

    def test_validation_and_late_failure_are_atomic(self):
        for energies, rows, queries in [([2, 1], [[1, 2], [3, 4]], [1.5]),
            ([1, 2], [[1, math.nan], [3, 4]], [1.5]), ([1, 2], [[1, 2], [3, 4]], [math.inf])]:
            self.assertEqual(lookup(energies, rows, queries, cursor=19), (1, [-123, -123], 19))
        self.assertEqual(lookup([1, 2, 3], [[1], [1e308], [-1e308]], [1, 2.5], cursor=19, columns=1),
            (2, [-123, -123], 19))
        self.assertEqual(library.remagx_table_lookup(None, None, 1, 2, None, 1, None, None), 1)


class PreparedTableTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        pointer = ctypes.POINTER(ctypes.c_double)
        library.remagx_table_prepare.argtypes = [pointer, pointer, ctypes.c_size_t, ctypes.c_size_t, ctypes.POINTER(ctypes.c_void_p)]
        library.remagx_table_prepare.restype = ctypes.c_int
        library.remagx_table_lookup_prepared.argtypes = [ctypes.c_void_p, pointer, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t), pointer]
        library.remagx_table_lookup_prepared.restype = ctypes.c_int
        library.remagx_table_destroy.argtypes = [ctypes.c_void_p]
        library.remagx_table_destroy.restype = None

    def prepare(self, energies, columns):
        energy = (ctypes.c_double * len(energies))(*energies)
        values = [columns[column][row] for row in range(len(energies)) for column in range(len(columns))]
        data = (ctypes.c_double * len(values))(*values)
        handle = ctypes.c_void_p()
        self.assertEqual(library.remagx_table_prepare(energy, data, len(energies), len(columns), ctypes.byref(handle)), 0)
        self.addCleanup(library.remagx_table_destroy, handle)
        return handle, energy, data

    def sample(self, handle, queries, cursor, columns):
        inputs = (ctypes.c_double * len(queries))(*queries)
        output = (ctypes.c_double * (len(queries) * columns))(*([-123] * (len(queries) * columns)))
        position = ctypes.c_size_t(cursor)
        status = library.remagx_table_lookup_prepared(handle, inputs, len(queries), ctypes.byref(position), output)
        return status, list(output), position.value

    def test_all_lookup_sequences_match_one_shot_exactly(self):
        for case in synthetic_table_cases():
            handle, _, _ = self.prepare(case['energy'], case['columns'])
            width = len(case['columns'])
            expected = lookup(case['energy'], list(zip(*case['columns'])), case['queries'], case['cursor'], width)
            self.assertEqual(self.sample(handle, case['queries'], case['cursor'], width), expected)

    def test_snapshot_ownership_and_cursor_history(self):
        handle, energies, values = self.prepare([1, 2, 2, 3], [[10, 20, 30, 40]])
        energies[0] = 999
        values[0] = 999
        self.assertEqual(self.sample(handle, [1, 2, 2, 2, 2], 0, 1), (0, [10, 20, 20, 30, 30], 3))
        self.assertEqual(self.sample(handle, [2], 3, 1), (0, [30], 3))

    def test_validation_and_failure_leave_handles_outputs_and_cursors_unchanged(self):
        energies = (ctypes.c_double * 2)(2, 1)
        values = (ctypes.c_double * 2)(1, 2)
        handle = ctypes.c_void_p(123)
        self.assertEqual(library.remagx_table_prepare(energies, values, 2, 1, ctypes.byref(handle)), 1)
        self.assertEqual(handle.value, 123)
        prepared, _, _ = self.prepare([1, 2, 3], [[1, 1e308, -1e308]])
        self.assertEqual(self.sample(prepared, [1, 2.5], 19, 1), (2, [-123, -123], 19))
        self.assertEqual(self.sample(prepared, [math.nan], 19, 1), (1, [-123], 19))
        self.assertEqual(self.sample(None, [1], 19, 1), (1, [-123], 19))
        empty, _, _ = self.prepare([], [[], []])
        self.assertEqual(self.sample(empty, [1, 2], 19, 2), (0, [0, 0, 0, 0], 19))
        library.remagx_table_destroy(None)


@unittest.skipUnless(os.environ.get('LEGACY_ROOT'), 'private table comparison not requested')
class OriginalTableTest(unittest.TestCase):
    def test_original_lookup_sequences(self):
        source = (Path(os.environ['LEGACY_ROOT']) / 'shared/CTable.cpp').read_text(encoding='latin1')
        method = source[source.index('CTableEntry CTable::Get('):source.index('int choose_pivot')]
        self.assertEqual(hashlib.sha256(method.encode()).hexdigest(),
            'b0a801387df064057510a57121805c99d4b779ed5c672c4ba372dd64cc7649ba', 'Reviewed legacy lookup changed')
        # Only the hash-gated method is compiled; the rest of CTable.cpp is excluded.
        scaffold = r"""
#include <vector>
#include <iostream>
#include <iomanip>
#include <utility>
struct CTableEntry { double x; double y[20]; };
struct Entries : std::vector<CTableEntry> { CTableEntry& last() { return back(); } };
struct Mutex { void Lock() {} void Unlock() {} };
struct CTable { Entries entry; int ncolumns=0,index=0; Mutex mutex; CTableEntry Get(double x); };
"""
        main = r"""
int main() { int rows,columns,queries,cursor; while(std::cin>>rows>>columns>>queries>>cursor) {
 CTable table; table.ncolumns=columns; table.index=cursor;
 for(int row=0;row<rows;++row){ CTableEntry entry;std::cin>>entry.x;for(int col=0;col<columns;++col)std::cin>>entry.y[col];table.entry.push_back(entry); }
 std::vector<double> values;for(int query=0;query<queries;++query){double x;std::cin>>x;auto entry=table.Get(x);for(int col=0;col<columns;++col)values.push_back(entry.y[col]);}
 std::cout<<table.index<<std::setprecision(17);for(double value:values)std::cout<<' '<<value;std::cout<<'\n';
}}
"""
        payload, expected = [], []
        for case in synthetic_table_cases():
            energies, columns, rows, queries, cursor = case['energy'], len(case['columns']), list(zip(*case['columns'])), case['queries'], case['cursor']
            status, values, end = lookup(energies, rows, queries, cursor, columns)
            self.assertEqual(status, 0)
            expected.append((end, values))
            payload.append(f'{len(rows)} {columns} {len(queries)} {cursor}')
            payload.extend(' '.join(map(str, [energy, *row])) for energy, row in zip(energies, rows))
            payload.append(' '.join(map(str, queries)))
        with tempfile.TemporaryDirectory() as directory:
            source_path, binary = Path(directory) / 'reference.cpp', Path(directory) / 'reference'
            source_path.write_text(scaffold + method + main)
            subprocess.run(['g++', '-std=c++17', '-O2', '-ffp-contract=off', str(source_path), '-o', str(binary)], capture_output=True, check=True)
            original = subprocess.run([str(binary)], input='\n'.join(payload) + '\n', text=True, capture_output=True, check=True).stdout.splitlines()
        self.assertEqual(len(original), len(expected))
        comparisons = 0
        for line, (cursor, values) in zip(original, expected):
            fields = line.split()
            self.assertEqual(int(fields[0]), cursor)
            self.assertEqual(len(fields) - 1, len(values))
            for target, value in zip(map(float, fields[1:]), values):
                self.assertLessEqual(abs(value-target), 1e-15 + 1e-10 * abs(target))
                comparisons += 1
        print(f'Original table lookup: {comparisons} values and 80 cursor sequences matched.', flush=True)


if __name__ == '__main__':
    unittest.main()
