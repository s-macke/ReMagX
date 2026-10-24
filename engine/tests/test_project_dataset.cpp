#include "remagx/project_dataset.hpp"
#include "remagx/project_calculation.hpp"
#include "json.hpp"
#include "remagx/core.h"
#include "remagx/project_fit.hpp"
#include <cmath>
#include <iostream>
using Json = nlohmann::json;
static std::vector<double> column(const Json& input, const char* name) {
    if (!input.contains(name)) return {};
    std::vector<double> values;
    for (const auto& value : input.at(name))
        values.push_back(value == "NaN" ? std::numeric_limits<double>::quiet_NaN() : value.get<double>());
    return values;
}
int main() {
    std::string line;
    while (std::getline(std::cin, line)) {
        try {
            const auto input = Json::parse(line);
            if (input.value("lookup", false)) {
                std::vector<double> samples(1001);
                if (remagx_error_function_lookup(samples.data(), samples.size()) != REMAGX_SUCCESS)
                    throw std::runtime_error("Standard lookup generation failed");
                std::cout << Json(samples).dump() << '\n';
                continue;
            }
            const auto original = remagx::ProjectDocument::parse(input.at("project").get<std::string>());
            const auto before = original.serialize();
            auto current = original;
            if (input.contains("edits")) {
                std::vector<std::pair<std::string, double>> edits;
                for (const auto& edit : input.at("edits")) edits.emplace_back(edit.at(0).get<std::string>(), edit.at(1).get<double>());
                current = current.with_calculation_numbers(edits);
            }
            if (input.contains("candidates")) {
                std::vector<remagx::OpticalTable> tables;
                if (input.contains("tables")) for (const auto& table : input.at("tables"))
                    tables.push_back(remagx::parse_optical_table(table.at("text").get<std::string>(), table.at("name").get<std::string>(), table.at("kind").get<std::string>()));
                remagx::ProjectFitObjective objective(current, std::move(tables));
                if (input.value("prepareFit", false)) objective.prepare_standalone();
                Json results = Json::array();
                for (const auto& step : input.at("candidates")) {
                    try {
                        const auto result = objective.evaluate(step.at("values").get<std::vector<double>>(),
                            step.at("reference").get<std::vector<double>>(), step.value("refresh", false));
                        results.push_back({{"ok", true}, {"project", Json::parse(result.project.serialize())},
                            {"values", result.values}, {"reference", result.reference}, {"error", result.error}});
                    } catch (const remagx::ProjectDocumentError&) { results.push_back({{"ok", false}}); }
                }
                if (original.serialize() != before) throw std::runtime_error("Candidate evaluation changed its input");
                std::cout << Json{{"results", results}}.dump() << '\n';
                continue;
            }
            if (input.value("serial", false)) {
                std::vector<remagx::OpticalTable> tables;
                if (input.contains("tables")) for (const auto& table : input.at("tables"))
                    tables.push_back(remagx::parse_optical_table(table.at("text").get<std::string>(), table.at("name").get<std::string>(), table.at("kind").get<std::string>()));
                const auto evaluation = remagx::evaluate_project_datasets(current, tables);
                Json curves = Json::array();
                for (const auto& curve : evaluation.curves) curves.push_back({{"qz", curve.qz}, {"energy", curve.energy},
                    {"plus", curve.plus}, {"minus", curve.minus}, {"asymmetry", curve.asymmetry}});
                if (original.serialize() != before) throw std::runtime_error("Serial evaluation changed its input");
                std::cout << Json{{"ok", true}, {"error", evaluation.error}, {"project", Json::parse(evaluation.project.serialize())},
                    {"indices", evaluation.indices}, {"curves", curves}}.dump() << '\n';
                continue;
            }
            const double selected = input.at("index").get<double>();
            if (selected < 0 || std::floor(selected) != selected || selected >= static_cast<double>(current.array_size("/datasets")))
                throw remagx::ProjectDocumentError("Invalid test dataset index");
            const auto prepared = remagx::prepare_fit_dataset(current, static_cast<size_t>(selected));
            Json context{{"energy", prepared.project.number("/experiment/energy")},
                {"angularFwhm", prepared.project.number("/experiment/resolution/angularFwhm")},
                {"activeDatasetIndex", prepared.project.number("/activeDatasetIndex")},
                {"useDatasetPoints", prepared.project.boolean("/experiment/qzScan/useDatasetPoints")}};
            Json output{{"ok", true}, {"measurement", prepared.measurement}, {"errorMode", prepared.error_mode},
                {"scan", prepared.energy_scan ? "energy" : "qz"}, {"beams", prepared.dichroic ? "dichroic" : "monochromatic"},
                {"weight", prepared.weight}, {"context", context}};
            try { output["project"] = Json::parse(prepared.project.serialize()); output["saveable"] = true; }
            catch (const remagx::ProjectDocumentError&) { output["saveable"] = false; }
            if (input.value("calculate", false)) {
                try {
                    std::vector<remagx::OpticalTable> tables;
                    if (input.contains("tables")) for (const auto& table : input.at("tables"))
                        tables.push_back(remagx::parse_optical_table(table.at("text").get<std::string>(), table.at("name").get<std::string>(), table.at("kind").get<std::string>()));
                    const auto curve = input.value("energyCalculation", false) ? remagx::calculate_fit_dataset(prepared, tables)
                        : remagx::calculate_fit_dataset_qz(prepared, tables);
                    const auto error = remagx::evaluate_fit_dataset(prepared, {curve.qz, curve.energy, curve.plus, curve.minus, curve.asymmetry});
                    output["calculation"] = {{"ok", true}, {"qz", curve.qz}, {"plus", curve.plus}, {"minus", curve.minus},
                        {"asymmetry", curve.asymmetry}, {"mean", error.mean}, {"weighted", error.weighted}, {"accepted", error.accepted}};
                    if (input.value("energyCalculation", false)) output["calculation"]["energy"] = curve.energy;
                } catch (const remagx::ProjectDocumentError&) { output["calculation"] = {{"ok", false}}; }
            }
            if (input.contains("curve")) {
                try {
                    const auto& curve = input.at("curve");
                    const auto error = remagx::evaluate_fit_dataset(prepared, {column(curve, "qz"), column(curve, "energy"),
                        column(curve, "plus"), column(curve, "minus"), column(curve, "asymmetry")});
                    output["error"] = {{"ok", true}, {"mean", error.mean}, {"weighted", error.weighted}, {"accepted", error.accepted}};
                } catch (const remagx::ProjectDocumentError&) { output["error"] = {{"ok", false}}; }
            }
            if (original.serialize() != before) throw std::runtime_error("Dataset preparation changed its input");
            std::cout << output.dump() << '\n';
        } catch (const std::exception&) { std::cout << "{\"ok\":false}\n"; }
    }
}
