#include "remagx/optical_tables.hpp"
#include <cmath>
#include <iostream>
#include <stdexcept>
static void require(bool condition) { if (!condition) throw std::runtime_error("Native optical table parser failed"); }
int main() {
    try {
        const auto table = remagx::parse_optical_table(
            " # comment\n900 +.004 4e-4\n700 .002 2e-4 extra\n700 .003 3e-4\n"
            "broken\n800 NaN .1\n800 1e400 .1\n800 .1x .2\n", "public", "db");
        require(table.width == 2 && table.energies == std::vector<double>({700,700,900}));
        require(table.values == std::vector<double>({.002,2e-4,.003,3e-4,.004,4e-4}));
        require(table.skipped_rows == 4 && table.extra_rows == 1);
        const auto tiny = remagx::parse_optical_table("700 -0 4.9406564584124654e-324\n900 1e-400 1e-300", "tiny", "m");
        require(tiny.energies.size() == 2 && std::signbit(tiny.values[0]));
        require(tiny.values[1] > 0 && tiny.values[2] == 0 && tiny.values[3] == 1e-300);
        const auto empty = remagx::parse_optical_table("# empty\n", "empty", "e");
        require(empty.width == 18 && empty.energies.empty());
        bool rejected = false;
        try { remagx::parse_optical_table("", "invalid", "F"); }
        catch (const remagx::ProjectDocumentError&) { rejected = true; }
        require(rejected);
        std::cout << "Native optical table decimals, sorting, row diagnostics and double range passed.\n";
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
