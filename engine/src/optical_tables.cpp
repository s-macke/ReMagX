#include "remagx/optical_tables.hpp"
#include "chantler_tables.hpp"
#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <locale>
#include <set>
#include <sstream>
#include <utility>

namespace remagx {
OpticalTable parse_optical_table(std::string_view text, std::string name, std::string kind) {
    OpticalTable result;
    result.name = std::move(name); result.kind = std::move(kind);
    if (result.kind == "db" || result.kind == "m" || result.kind == "ff" || result.kind == "ffm") result.width = 2;
    else if (result.kind == "e" || result.kind == "f") result.width = 18;
    else throw ProjectDocumentError("Unsupported native optical table kind.");
    std::vector<std::vector<double>> rows;
    std::istringstream input{std::string(text)};
    input.imbue(std::locale::classic());
    std::string line;
    while (std::getline(input, line)) {
        const auto start = line.find_first_not_of(" \t\r\f\v");
        if (start == std::string::npos || line[start] == '#') continue;
        std::istringstream fields(line);
        fields.imbue(std::locale::classic());
        std::vector<double> row;
        bool valid = true;
        for (size_t column = 0; column <= result.width; ++column) {
            std::string token;
            if (!(fields >> token)) { valid = false; break; }
            std::istringstream number(token);
            number.imbue(std::locale::classic());
            double value = 0;
            if (!(number >> value) || number.peek() != std::char_traits<char>::eof() || !std::isfinite(value)) {
                valid = false; break;
            }
            row.push_back(value);
        }
        if (!valid) { ++result.skipped_rows; continue; }
        std::string extra;
        if (fields >> extra) ++result.extra_rows;
        rows.push_back(std::move(row));
    }
    std::stable_sort(rows.begin(), rows.end(), [](const auto& left, const auto& right) { return left[0] < right[0]; });
    result.energies.reserve(rows.size()); result.values.reserve(rows.size() * result.width);
    for (const auto& row : rows) {
        result.energies.push_back(row[0]);
        result.values.insert(result.values.end(), row.begin() + 1, row.end());
    }
    return result;
}

std::vector<OpticalTable> load_project_tables(const ProjectDocument& project, std::vector<std::string>& warnings) {
    std::vector<OpticalTable> result;
    if (!project.boolean("/calculation/automaticOpticalConstants")) return result;
    std::set<std::string> visited;
    const bool elements = project.string("/sample/mode") == "element";
    const std::string rows = elements ? "/sample/elementProfiles" : "/sample/layers";
    const size_t count = project.array_size(rows);
    for (size_t index = 0; index < count; ++index) {
        const auto name = project.string(rows + "/" + std::to_string(index) + (elements ? "/element" : "/opticalTable"));
        if (name.empty() || !visited.insert(name).second) continue;
        if (name.find('\0') != std::string::npos) throw ProjectDocumentError("Optical table name contains NUL.");
        for (const auto* kind : elements ? std::initializer_list<const char*>{"ff", "ffm", "F"}
                                         : std::initializer_list<const char*>{"db", "m", "e"}) {
            const std::filesystem::path path(name + '.' + kind);
            std::error_code error;
            const bool exists = std::filesystem::exists(path, error);
            if (error) throw ProjectDocumentError("Cannot inspect optical table input.");
            if (!exists) continue;
            if (!std::filesystem::is_regular_file(path, error) || error)
                throw ProjectDocumentError("Optical table input is not a regular file.");
            std::ifstream file(path, std::ios::binary);
            if (!file) throw ProjectDocumentError("Cannot open optical table input.");
            const std::string text{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
            if (file.bad()) throw ProjectDocumentError("Cannot read complete optical table input.");
            auto table = parse_optical_table(text, name, std::string(kind) == "F" ? "f" : kind);
            const std::string label = std::string(elements ? "Element " : "Layer ") + std::to_string(index) + " ." + kind + " table: ";
            if (table.skipped_rows) warnings.push_back(label + std::to_string(table.skipped_rows) + " malformed rows skipped.");
            if (table.extra_rows) warnings.push_back(label + std::to_string(table.extra_rows) + " rows have ignored extra columns.");
            result.push_back(std::move(table));
        }
    }
    resolve_chantler_tables(project, result);
    return result;
}
}
