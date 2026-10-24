#include "remagx/project_lua.hpp"
#include "json.hpp"
#include <iostream>
using Json = nlohmann::json;
std::vector<remagx::ScriptDielectricTensor> tensors(const Json& input) {
    std::vector<remagx::ScriptDielectricTensor> result;
    for (const auto& tensor : input) result.push_back({tensor.at("values").get<std::array<double,18>>(), tensor.at("anisotropic").get<bool>()});
    return result;
}
remagx::ScriptSolution solution(const Json& input) {
    return {input.at("qz").get<std::vector<double>>(), input.at("reflectivity").get<std::vector<double>>(),
        input.at("reflectivityPlus").get<std::vector<double>>(), input.at("reflectivityMinus").get<std::vector<double>>(),
        input.at("energy").get<std::vector<double>>()};
}
int main() {
    std::string line;
    while (std::getline(std::cin, line)) {
        try {
            const auto input = Json::parse(line);
            const auto project = remagx::ProjectDocument::parse(input.at("project").get<std::string>());
            const auto before = project.serialize();
            std::vector<std::string> messages;
            remagx::ProjectLuaSession session;
            session.install_project_arrays(project);
            if (input.contains("tables")) {
                std::vector<remagx::OpticalTable> tables;
                for (const auto& table : input.at("tables"))
                    tables.push_back(remagx::parse_optical_table(table.at("text").get<std::string>(),
                        table.at("name").get<std::string>(), table.at("kind").get<std::string>()));
                session.install_tables(tables);
            }
            if (input.contains("tensors")) session.install_tensors(tensors(input.at("tensors")));
            if (input.contains("solution")) {
                session.install_solution(); session.replace_solution(solution(input.at("solution")));
            }
            if (input.contains("scattering")) session.replace_scattering_tensors(input.at("scattering").get<std::vector<std::array<double,18>>>());
            if (input.value("functions", false)) session.install_project_functions();
            if (input.value("output", false)) session.install_output([&](const std::string& message) {
                if (input.value("failOutput", false)) throw std::runtime_error("Public output failure");
                messages.push_back(message);
            });
            session.compile(input.at("source").get<std::string>(), true);
            const remagx::ScriptHookValues values{8000, 1e-12, .001, .03, 1};
            auto result = values;
            for (int index = 0; index < input.value("repeat", 1); ++index) {
                if (index && input.contains("replacement"))
                    session.replace_project(remagx::ProjectDocument::parse(input.at("replacement").get<std::string>()), 1);
                if (index && input.contains("replacementTensors")) session.replace_tensors(tensors(input.at("replacementTensors")));
                if (index && input.contains("replacementSolution")) session.replace_solution(solution(input.at("replacementSolution")));
                result = session.run_hook(input.value("workspace", false) ? session.begin_hook() : values);
                if (input.value("workspace", false)) session.apply_hook(result);
            }
            const auto output = session.project_snapshot();
            if (project.serialize() != before) throw std::runtime_error("Input project changed");
            Json response{{"ok", true}, {"project", Json::parse(output.serialize())},
                {"hook", {{"energy", result.energy}, {"epsilon", result.epsilon}, {"resolution", result.resolution},
                    {"energyScanQz", result.energy_scan_qz}, {"renewOpticalConstants", result.renew_optical_constants}}}};
            if (input.contains("tensors")) {
                response["tensors"] = Json::array();
                for (const auto& tensor : session.tensor_snapshot())
                    response["tensors"].push_back({{"values", tensor.values}, {"anisotropic", tensor.anisotropic}});
            }
            if (input.contains("solution")) {
                const auto current = session.solution_snapshot();
                response["solution"] = {{"qz",current.qz}, {"reflectivity",current.reflectivity},
                    {"reflectivityPlus",current.reflectivity_plus}, {"reflectivityMinus",current.reflectivity_minus}, {"energy",current.energy}};
            }
            if (input.contains("scattering")) response["scattering"] = session.scattering_snapshot();
            if (input.value("output", false)) response["messages"] = messages;
            std::cout << response.dump() << '\n';
        } catch (const std::exception&) { std::cout << "{\"ok\":false}\n"; }
    }
}
