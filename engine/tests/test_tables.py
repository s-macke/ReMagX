import ctypes
import hashlib
import os
from pathlib import Path
import random
import subprocess
import tempfile
import math
import sys
import unittest

library = ctypes.CDLL(sys.argv.pop(1))
library.remagx_table_lookup.argtypes = [ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_double),
    ctypes.c_size_t, ctypes.c_size_t, ctypes.POINTER(ctypes.c_double), ctypes.c_size_t,
    ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(ctypes.c_double)]
library.remagx_table_lookup.restype = ctypes.c_int


def lookup(energies, rows, queries, cursor=0, columns=2):
    array = lambda values: (ctypes.c_double * len(values))(*values)
    energy_array, values, inputs = array(energies), array([value for row in rows for value in row]), array(queries)
    position = ctypes.c_size_t(cursor)
    output = array([-123.] * (len(queries) * columns))
    before = bytes(energy_array), bytes(values), bytes(inputs)
    status = library.remagx_table_lookup(energy_array, values, len(energies), columns, inputs, len(queries), ctypes.byref(position), output)
    if before != (bytes(energy_array), bytes(values), bytes(inputs)):
        raise AssertionError('Table lookup mutated input')
    return status, list(output), position.value


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
        generator = random.Random(26019)
        payload, expected = [], []
        for case in range(80):
            columns = [1, 2, 18, 20][case % 4]
            energies = sorted(generator.randint(1, 10) for _ in range(case % 21))
            rows = [[generator.uniform(-1e3, 1e3) for _ in range(columns)] for _ in energies]
            queries = [generator.uniform(0, 11) for _ in range(10)] + [2, 2, 2, 5, 5, 5, 1, 10]
            cursor = generator.choice([0, len(energies) + 20])
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
