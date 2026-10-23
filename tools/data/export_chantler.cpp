// Boundary adapter only: read the unchanged original built-in tables.
#include "periodic_table.cpp"
#include <cmath>
#include <iomanip>
#include <iostream>
#include <sstream>

int main() {
    std::ostringstream output;
    output << std::setprecision(17) << std::showpoint << '[';
    for (int atomicNumber = 1; atomicNumber <= 92; ++atomicNumber) {
        const auto storedRowCount = sizeof(data_chantler) / sizeof(data_chantler[0]) / 3;
        CTable table;
        if (data_chantler_index[atomicNumber] > static_cast<int>(storedRowCount)) {
            // D-38: the final Uranium endpoint is one past the stored array.
            // Export only its 277 defined rows; never call the out-of-bounds path.
            if (atomicNumber != 92 || storedRowCount != 20255 ||
                data_chantler_index[91] != 19978 || data_chantler_index[92] != 20256) return 3;
            table.ncolumns = 2;
            for (size_t row = 19978; row < storedRowCount; ++row) {
                CTableEntry entry;
                entry.x = data_chantler[row * 3];
                entry.y[0] = data_chantler[row * 3 + 1];
                entry.y[1] = data_chantler[row * 3 + 2];
                table.entry.push_back(entry);
            }
        } else if (!GetChantlerTable(atomicNumber - 1, table)) return 1;
        if (table.ncolumns != 2 || !table.entry.size()) return 1;
        if (atomicNumber > 1) output << ',';
        output << "{\"atomicNumber\":" << atomicNumber << ",\"rows\":[";
        for (int row = 0; row < table.entry.size(); ++row) {
            const auto& entry = table.entry[row];
            if (!std::isfinite(entry.x) || entry.x <= 0 || !std::isfinite(entry.y[0]) ||
                !std::isfinite(entry.y[1]) || (row && entry.x < table.entry[row - 1].x)) {
                std::cerr << "Invalid table row: atomic number " << atomicNumber << ", row " << row
                          << ", descending " << (row && entry.x < table.entry[row - 1].x) << "\n";
                return 2;
            }
            if (row) output << ',';
            output << '[' << entry.x << ',' << entry.y[0] << ',' << entry.y[1] << ']';
        }
        output << "]}";
    }
    std::cout << output.str() << "]\n";
}
