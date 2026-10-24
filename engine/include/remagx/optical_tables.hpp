#ifndef REMAGX_OPTICAL_TABLES_HPP
#define REMAGX_OPTICAL_TABLES_HPP
#include "project_document.hpp"
#include <string>
#include <string_view>
#include <vector>
namespace remagx {
struct OpticalTable {
    std::string name;
    std::string kind;
    size_t width = 0;
    std::vector<double> energies;
    std::vector<double> values; // row-major, for the shared C API
    size_t skipped_rows = 0;
    size_t extra_rows = 0;
};
OpticalTable parse_optical_table(std::string_view text, std::string name, std::string kind);
// Resolve exact material/element names plus .db/.m/.e or .ff/.ffm/.F in the working
// directory, as the original terminal does. No directory scans or case folding.
std::vector<OpticalTable> load_project_tables(const ProjectDocument& project,
                                              std::vector<std::string>& warnings, bool require_energy_tables = false);
}
#endif
