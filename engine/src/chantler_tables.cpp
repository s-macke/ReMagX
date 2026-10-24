#include "chantler_tables.hpp"
#include "chantler_data.hpp"
#include "json.hpp"
#include <algorithm>
#include <iterator>

namespace remagx {
void resolve_chantler_tables(const ProjectDocument& project, std::vector<OpticalTable>& tables) {
    if (!project.boolean("/calculation/useChantlerDatabase") || project.string("/sample/mode") != "element") return;
    // Same reviewed data and exact-case/first-match symbol mapping as the web.
    // D-37 redistribution permission and D-38's 277 stored uranium rows apply.
    static const auto data = [] {
        std::string text;
        for (const auto* chunk : chantler_chunks) text += chunk;
        return nlohmann::json::parse(text);
    }();
    const size_t count = project.array_size("/sample/elementProfiles");
    for (size_t index = 0; index < count; ++index) {
        const auto name = project.string("/sample/elementProfiles/" + std::to_string(index) + "/element");
        const auto existing = std::find_if(tables.begin(), tables.end(), [&](const auto& table) {
            return table.name == name && table.kind == "ff";
        });
        if (existing != tables.end() && !existing->energies.empty()) continue;
        const auto symbol = std::find(std::begin(chantler_symbols), std::end(chantler_symbols), name);
        if (symbol == std::end(chantler_symbols)) continue;
        const auto position = static_cast<size_t>(symbol - std::begin(chantler_symbols));
        if (position >= data.at("elements").size()) continue;
        OpticalTable table;
        table.name = name; table.kind = "ff"; table.width = 2;
        for (const auto& row : data.at("elements").at(position).at("rows")) {
            table.energies.push_back(row.at(0).get<double>());
            table.values.push_back(row.at(1).get<double>());
            table.values.push_back(row.at(2).get<double>());
        }
        if (existing == tables.end()) tables.push_back(std::move(table));
        else *existing = std::move(table);
    }
}
}
