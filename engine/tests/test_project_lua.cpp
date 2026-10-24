#include "remagx/project_lua.hpp"
#include "json.hpp"
#include <iostream>
using Json = nlohmann::json;
int main() {
    std::string line;
    while (std::getline(std::cin, line)) {
        try {
            const auto input = Json::parse(line);
            const auto project = remagx::ProjectDocument::parse(input.at("project").get<std::string>());
            const auto before = project.serialize();
            remagx::ProjectLuaSession session;
            session.install_project_arrays(project);
            if (input.contains("tables")) {
                std::vector<remagx::OpticalTable> tables;
                for (const auto& table : input.at("tables"))
                    tables.push_back(remagx::parse_optical_table(table.at("text").get<std::string>(),
                        table.at("name").get<std::string>(), table.at("kind").get<std::string>()));
                session.install_tables(tables);
            }
            session.compile(input.at("source").get<std::string>(), true);
            const remagx::ScriptHookValues values{8000, 1e-12, .001, .03, 1};
            auto result = values;
            for (int index = 0; index < input.value("repeat", 1); ++index) {
                if (index && input.contains("replacement"))
                    session.replace_project(remagx::ProjectDocument::parse(input.at("replacement").get<std::string>()), 1);
                result = session.run_hook(input.value("workspace", false) ? session.begin_hook() : values);
                if (input.value("workspace", false)) session.apply_hook(result);
            }
            const auto output = session.project_snapshot();
            if (project.serialize() != before) throw std::runtime_error("Input project changed");
            std::cout << Json{{"ok", true}, {"project", Json::parse(output.serialize())},
                {"hook", {{"energy", result.energy}, {"epsilon", result.epsilon}, {"resolution", result.resolution},
                    {"energyScanQz", result.energy_scan_qz}, {"renewOpticalConstants", result.renew_optical_constants}}}}.dump() << '\n';
        } catch (const std::exception&) { std::cout << "{\"ok\":false}\n"; }
    }
}
