#include "remagx/project_fit.hpp"
#include "json.hpp"
#include <cmath>
#include <iostream>
using Json = nlohmann::json;
// Explicit sentinels let the public protocol exercise signed zero/nonfinite
// callback inputs without confusing JSON encoding with numerical behavior.
static double value(const Json& item) {
    if (item == "-0") return -0.0;
    if (item == "Infinity") return std::numeric_limits<double>::infinity();
    if (item == "NaN") return std::numeric_limits<double>::quiet_NaN();
    return item.get<double>();
}
static std::vector<double> values(const Json& items) {
    std::vector<double> result;
    for (const auto& item : items) result.push_back(value(item));
    return result;
}
static Json encoded(const std::vector<double>& items) {
    Json result = Json::array();
    for (double item : items) result.push_back(item == 0 && std::signbit(item) ? Json("-0") : Json(item));
    return result;
}
int main() {
    std::string line;
    while (std::getline(std::cin, line)) {
        try {
            const auto input = Json::parse(line);
            if (input.contains("regularization")) {
                const auto& regularization = input["regularization"];
                const double result = remagx::fit_regularization(value(regularization[0]), value(regularization[1]),
                    values(regularization[2]), values(regularization[3]));
                std::cout << Json{{"ok", true}, {"value", encoded({result})[0]}}.dump() << '\n'; continue;
            }
            const auto project = remagx::ProjectDocument::parse(input.at("project").get<std::string>());
            const auto before = project.serialize();
            if (input.contains("candidates")) {
                auto current = project;
                Json trials = Json::array();
                for (const auto& candidate : input["candidates"]) {
                    try {
                        const auto applied = remagx::apply_project_fit_parameters(current, values(candidate));
                        current = applied.project;
                        Json trial{{"ok", true}, {"values", encoded(applied.values)}, {"probes", Json::array()}};
                        for (const auto& path : input["probes"]) trial["probes"].push_back(encoded({current.number(path.get<std::string>())})[0]);
                        try { trial["project"] = Json::parse(current.serialize()); trial["saveable"] = true; }
                        catch (const remagx::ProjectDocumentError&) { trial["saveable"] = false; }
                        trials.push_back(std::move(trial));
                    } catch (const remagx::ProjectDocumentError&) { trials.push_back({{"ok", false}}); }
                }
                if (project.serialize() != before) throw std::runtime_error("Fit application mutated its original project");
                std::cout << Json{{"ok", true}, {"trials", trials}}.dump() << '\n'; continue;
            }
            const remagx::ProjectFitSpace prepared(project);
            Json trials = Json::array(), vertices = Json::array();
            for (const auto& vertex : prepared.simplex()) vertices.push_back(encoded(prepared.decode(vertex)));
            for (const auto& coordinates : input["coordinates"]) {
                try {
                    const auto candidate = prepared.decode(values(coordinates));
                    trials.push_back({{"ok", true}, {"values", encoded(candidate)}, {"bounded", encoded(prepared.bound(candidate))}});
                } catch (const remagx::ProjectDocumentError&) { trials.push_back({{"ok", false}}); }
            }
            if (project.serialize() != before) throw std::runtime_error("Project changed during fit initialization");
            std::cout << Json{{"ok", true}, {"simplex", prepared.simplex()}, {"vertices", vertices}, {"trials", trials}}.dump() << '\n';
        } catch (const std::exception&) { std::cout << "{\"ok\":false}\n"; }
    }
}
