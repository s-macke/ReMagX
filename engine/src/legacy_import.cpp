#include "remagx/legacy_import.hpp"
#include "remagx/legacy_assignments.hpp"
#include "legacy_import_data.hpp"
#include "json.hpp"
#include <algorithm>
#include <cmath>
#include <map>

namespace remagx {
namespace {
using Json = nlohmann::json;
using Paths = std::map<std::string, std::string>;
const Paths numeric_fields{
    {"resolution", "/experiment/resolution/angularFwhm"}, {"energyresolution", "/experiment/resolution/energyFwhm"},
    {"qzmin", "/experiment/qzScan/qzMin"}, {"qzmax", "/experiment/qzScan/qzMax"},
    {"engscanqz", "/experiment/energyScan/qz"}, {"engscanangle", "/experiment/energyScan/angle"},
    {"engscanmin", "/experiment/energyScan/energyMin"}, {"engscanmax", "/experiment/energyScan/energyMax"},
    {"maggamma", "/calculation/magnetization/direction/gamma"}, {"magphi", "/calculation/magnetization/direction/phi"},
    {"minlayerthickness", "/calculation/segmentation/minThickness"}, {"maxlayerthickness", "/calculation/segmentation/maxThickness"},
    {"gradientscale", "/calculation/segmentation/gradientScale"}, {"segmentationerror", "/calculation/segmentation/tolerance"},
    {"fittemp", "/fit/annealing/temperature"}, {"fitdtemp", "/fit/annealing/temperatureStep"},
    {"fitqzmin", "/fit/window/qzMin"}, {"fitqzmax", "/fit/window/qzMax"},
    {"fitenergymin", "/fit/window/energyMin"}, {"fitenergymax", "/fit/window/energyMax"},
    {"evo_elite", "/fit/evolution/elitePercent"}, {"evo_parents", "/fit/evolution/parentsPercent"},
    {"evo_range", "/fit/evolution/mutationRangePercent"}, {"evo_mixing", "/fit/evolution/mixingProbability"},
    {"evo_probability", "/fit/evolution/mutationProbability"},
};
const Paths flags{
    {"fastresolution", "/experiment/resolution/fastConvolution"}, {"usemeasurementqz", "/experiment/qzScan/useDatasetPoints"},
    {"showangle", "/experiment/qzScan/showAngle"}, {"ocautomatic", "/calculation/automaticOpticalConstants"},
    {"usechantlerdatabase", "/calculation/useChantlerDatabase"}, {"fitresolution", "/fit/fitAngularResolution"},
    {"fitmeasmult", "/fit/fitIntensityScale"}, {"fitdeltaqz", "/fit/fitQzShift"}, {"fitenergyshift", "/fit/fitEnergyShift"},
    {"evo_takeeliteasparents", "/fit/evolution/eliteAsParents"}, {"evo_evorestrictfitparameters", "/fit/evolution/restrictToBounds"},
    {"enablemultilayer", "/sample/multilayer/enabled"},
};
const Paths layer_fields{
    {"layer_d", "/thickness"}, {"layer_density", "/density"}, {"layer_delta", "/delta"}, {"layer_beta", "/beta"},
    {"layer_ddelta", "/deltaMag"}, {"layer_dbeta", "/betaMag"}, {"layer_maggamma", "/magnetization/gamma"},
    {"layer_magphi", "/magnetization/phi"}, {"layer_sigma", "/roughness"}, {"layer_electron_escape_depth", "/electronEscapeDepth"},
};
const Paths profile_fields{{"gauss_delta", "/deltaAmplitude"}, {"gauss_beta", "/betaAmplitude"},
    {"gauss_variance", "/width"}, {"gauss_z", "/center"}};
const Paths element_fields{{"el_f1", "/f1"}, {"el_f2", "/f2"}, {"el_f1m", "/f1Mag"}, {"el_f2m", "/f2Mag"}};
const Paths slab_fields{{"el_d", "/thickness"}, {"el_sigma", "/roughness"}, {"el_density", "/density"}};
const Paths fit_fields{{"fit_value", "/value"}, {"fit_lower_boundary", "/lowerBound"}, {"fit_upper_boundary", "/upperBound"}};
const Paths dataset_fields{{"datasetenergy", "/energy"}, {"datasetresolution", "/angularResolution"},
    {"datasetmultiplicator", "/intensityScale"}, {"datasettranslator", "/intensityOffset"}, {"dataseterrorweight", "/errorWeight"},
    {"datasetqztranslation", "/qzShift"}, {"datasetenergyshift", "/energyShift"}};
const Paths columns{{"dataset_qz", "qz"}, {"dataset_R0", "reflectivity"}, {"dataset_Rp", "reflectivityPlus"},
    {"dataset_Rm", "reflectivityMinus"}, {"dataset_A", "asymmetry"}, {"dataset_eng", "energy"}, {"dataset_TEY", "electronYield"}};
std::string polarization_path(const std::string& key) {
    for (const auto* beam : {"ray1", "ray2"}) for (const auto* component : {"sigma", "pi"}) for (const auto* part : {"re", "im"})
        if (key == std::string(beam) + component + part)
            return std::string("/polarization/") + (std::string(beam) == "ray1" ? "beam1/" : "beam2/") + component + "/" + part;
    return {};
}
void finite_numbers(const Json& value) {
    if (value.is_number() && !std::isfinite(value.get<double>())) throw ProjectDocumentError("Imported project contains a nonfinite number.");
    if (value.is_structured()) for (const auto& child : value) finite_numbers(child);
}
}
LegacyImportResult import_legacy_project(std::string_view bytes, std::string name) {
    static const auto defaults = Json::parse(legacy_import_defaults);
    Json project = defaults.at("project");
    if (name.size() >= 4) {
        auto suffix = name.substr(name.size() - 4);
        for (auto& character : suffix) if (character >= 'A' && character <= 'Z') character += 'a' - 'A';
        if (suffix == ".all") name.resize(name.size() - 4);
    }
    project["name"] = name;
    std::vector<LegacyImportMessage> messages;
    std::vector<LegacyIgnoredKey> ignored, by_design;
    const auto message = [&](const std::string& level, const std::string& text, std::optional<size_t> line = std::nullopt) {
        messages.push_back({level, text, line});
    };
    const auto record = [](std::vector<LegacyIgnoredKey>& entries, const LegacyAssignment& assignment) {
        auto entry = std::find_if(entries.begin(), entries.end(), [&](const auto& value) { return value.key == assignment.key; });
        if (entry == entries.end()) entries.push_back({assignment.key, 1, assignment.line});
        else ++entry->count;
    };
    Json layers = nullptr, elements = Json::array(), profiles = Json::array(), current_profile = nullptr;
    Json datasets = nullptr, current_dataset = nullptr, parameters = Json::array();
    std::vector<double> depths, spline_x, spline_y;
    std::vector<std::string> scripts, default_scripts;
    Json script_parameters = Json::array();
    bool thickness_defined = false, precision_seen = false;
    double active = 0, scale = 1, shift = 0, energy = 0;
    const auto finish_profile = [&] {
        if (current_profile.is_null()) return;
        if (spline_x.size() != spline_y.size()) message("warning", "Depth-profile spline x/y counts differ; extra values dropped.");
        for (size_t index = 0; index < std::min(spline_x.size(), spline_y.size()); ++index)
            current_profile["spline"]["points"].push_back({{"z", spline_x[index]}, {"value", spline_y[index]}});
        profiles.push_back(current_profile); current_profile = nullptr; spline_x.clear(); spline_y.clear();
    };
    const auto finish_dataset = [&] {
        if (current_dataset.is_null()) return;
        if (!current_dataset["columns"]["qz"].empty()) datasets.push_back(current_dataset);
        else message("warning", "Dataset without qz points skipped, as in legacy ReMagX.");
        current_dataset = nullptr;
    };
    const auto parsed = parse_legacy_assignments(bytes);
    if (parsed.final_assignment_unterminated)
        message("warning", "Final assignment has no terminating newline; processed here, but ignored by original ReMagX 2.6.", parsed.assignments.back().line);
    for (const auto& assignment : parsed.assignments) {
        const auto& key = assignment.key;
        const auto number = [&](double fallback, bool integer = false) {
            const auto value = legacy_number_prefix(assignment.value, integer);
            if (!value) message("warning", key + ": invalid numeric prefix; previous/default value retained.", assignment.line);
            return value.value_or(fallback);
        };
        const auto flag = [&](bool fallback = false) { return number(fallback ? 1 : 0, true) != 0; };
        const auto missing = [&](const std::string& section) {
            message("warning", key + " appears before " + section + " and was ignored.", assignment.line);
        };
        const auto assign_numeric = [&](Json& owner, const Paths& paths) {
            const auto found = paths.find(key);
            if (found == paths.end()) return false;
            if (owner.is_null()) missing("its section entry");
            else { auto& target = owner.at(Json::json_pointer(found->second)); target = number(target.get<double>()); }
            return true;
        };
        if (defaults["ignoredByDesign"].contains(key)) { record(by_design, assignment); continue; }
        if (assign_numeric(project, numeric_fields)) continue;
        if (const auto found = flags.find(key); found != flags.end()) {
            auto& target = project.at(Json::json_pointer(found->second)); target = flag(key == "fastresolution"); continue;
        }
        if (key == "fileversion" || key == "layerversion" || key == "magneticversion" || key == "measurementdataversion") {
            const std::string expected = key == "fileversion" ? "1" : key == "layerversion" ? "3" : key == "magneticversion" ? "4" : "2";
            if (assignment.value != expected) throw ProjectDocumentError("Unsupported legacy " + key + " at line " + std::to_string(assignment.line) + '.');
            if (key == "layerversion") layers = Json::array();
            if (key == "magneticversion") { profiles = Json::array(); current_profile = nullptr; }
            if (key == "measurementdataversion") datasets = Json::array();
            continue;
        }
        if (key == "elementlayerversion") { elements = Json::array(); continue; }
        if (key == "fitvariableversion") { parameters = Json::array(); continue; }
        if (key == "layer") {
            if (layers.is_null()) layers = Json::array();
            layers.push_back(defaults["layer"]); depths.push_back(0); continue;
        }
        if (key == "layer_z") {
            if (!layers.is_null() && !layers.empty()) depths[layers.size() - 1] = number(0);
            continue;
        }
        Json absent;
        auto& layer = layers.is_array() && !layers.empty() ? layers.back() : absent;
        if (layer_fields.count(key)) {
            assign_numeric(layer, layer_fields);
            if (key == "layer_d") thickness_defined = true;
            continue;
        }
        if (key == "layer_db" || key == "layer_material") {
            if (layer.is_null()) missing("layer");
            else layer[key == "layer_db" ? "opticalTable" : "material"] = assignment.value;
            continue;
        }
        if (key == "element") {
            elements.push_back({{"element", assignment.value}, {"f1", 0.0}, {"f2", 0.0}, {"f1Mag", 0.0}, {"f2Mag", 0.0}, {"slabs", Json::array()}});
            continue;
        }
        auto& element = elements.empty() ? absent : elements.back();
        if (key == "el_layer") {
            if (element.is_null()) missing("element");
            else element["slabs"].push_back({{"thickness", 0.0}, {"roughness", 0.0}, {"density", 0.0}});
            continue;
        }
        if (assign_numeric(element, element_fields)) continue;
        if (slab_fields.count(key)) {
            if (element.is_null()) { missing("element"); missing("element"); }
            else { auto& slabs = element["slabs"]; auto& slab = slabs.empty() ? absent : slabs.back(); assign_numeric(slab, slab_fields); }
            continue;
        }
        if (key == "gauss_function") { finish_profile(); current_profile = defaults["profile"]; continue; }
        if (assign_numeric(current_profile, profile_fields)) continue;
        if (key == "gauss_usespline" || key == "gauss_acoupling" || key == "gauss_varcoupling" || key == "gauss_bindtolayer" || key == "gauss_splinex" || key == "gauss_spliney") {
            if (current_profile.is_null()) { missing("gauss_function"); continue; }
            if (key == "gauss_usespline") current_profile["spline"]["enabled"] = flag();
            else if (key == "gauss_splinex") spline_x.push_back(number(0));
            else if (key == "gauss_spliney") spline_y.push_back(number(0));
            else {
                const double value = number(-1, true);
                current_profile[key == "gauss_acoupling" ? "amplitudeCoupledTo" : key == "gauss_varcoupling" ? "widthCoupledTo" : "boundToLayer"] = value < 0 ? Json(nullptr) : Json(value);
            }
            continue;
        }
        if (key == "fit_variable") {
            parameters.push_back({{"legacyId", -1.0}, {"line", assignment.line}, {"target", "thickness"}, {"index", nullptr},
                {"elementIndex", nullptr}, {"value", 0.0}, {"step", 0.0}, {"lowerBound", -1e10}, {"upperBound", 1e10}}); continue;
        }
        auto& parameter = parameters.empty() ? absent : parameters.back();
        if (assign_numeric(parameter, fit_fields)) continue;
        if (key == "fit_id" || key == "fit_additional_id" || key == "fit_element_id") {
            if (parameter.is_null()) missing("fit_variable");
            else {
                const double value = number(-1, true);
                if (key == "fit_id") parameter["legacyId"] = value;
                else parameter[key == "fit_additional_id" ? "index" : "elementIndex"] = value < 0 ? Json(nullptr) : Json(value);
            }
            continue;
        }
        if (key == "activedatasetindex") { active = number(0, true); continue; }
        if (key == "measuremult") { scale = number(scale); continue; }
        if (key == "deltaqz") { shift = number(shift); continue; }
        if (key == "datasetnumber") {
            if (datasets.is_null()) datasets = Json::array();
            finish_dataset(); current_dataset = defaults["dataset"];
            current_dataset["intensityScale"] = scale; current_dataset["qzShift"] = shift; continue;
        }
        if (assign_numeric(current_dataset, dataset_fields)) continue;
        if (key == "datasettitle" || key == "datasetcomment" || key == "datasetfile" || key == "datasetlambda" || key == "datasetactive" || columns.count(key)) {
            if (current_dataset.is_null()) { missing("datasetnumber"); continue; }
            if (columns.count(key)) {
                auto& values = current_dataset["columns"][columns.at(key)];
                if (values.is_null()) values = Json::array();
                values.push_back(number(0));
            } else if (key == "datasetlambda") current_dataset["energy"] = 12398.326 / number(12398.326 / current_dataset["energy"].get<double>());
            else if (key == "datasetactive") current_dataset["active"] = flag();
            else current_dataset[key == "datasettitle" ? "title" : key == "datasetcomment" ? "comment" : "sourceFile"] = trim_legacy_text(assignment.text);
            continue;
        }
        const bool dataset_beam = key.compare(0, 7, "dataset") == 0;
        const auto beam_path = polarization_path(dataset_beam ? key.substr(7) : key);
        if (!beam_path.empty()) {
            auto& owner = dataset_beam ? current_dataset : project["experiment"];
            if (owner.is_null()) missing("datasetnumber");
            else { auto& target = owner.at(Json::json_pointer(beam_path)); target = number(target.get<double>()); }
            continue;
        }
        if (key == "energy") { energy = number(energy); if (energy == 0) energy = 1; continue; }
        if (key == "lambda") { double wavelength = number(0); if (wavelength == 0) wavelength = 1; energy = 12398.326 / wavelength; continue; }
        if (key == "numberofpoints") {
            const double points = number(project["experiment"]["qzScan"]["points"].get<double>(), true);
            if (points < 2) message("warning", "Too few qz points; using 2.", assignment.line);
            project["experiment"]["qzScan"]["points"] = std::max(2.0, points); continue;
        }
        if (key == "pipolratio") {
            const double ratio = number(0), magnitude = std::hypot(1 - ratio, ratio);
            const double norm = magnitude == 0 ? 1 : magnitude;
            for (const auto* beam : {"beam1", "beam2"}) {
                project["experiment"]["polarization"][beam] = {
                    {"sigma", {{"re", (1 - ratio) / norm}, {"im", 0.0}}},
                    {"pi", {{"re", 0.0}, {"im", (std::string(beam) == "beam1" ? ratio : -ratio) / norm}}}};
            }
            continue;
        }
        if (key == "precision") {
            precision_seen = true; message("info", "Stored precision ignored: calculations always use double precision.", assignment.line); continue;
        }
        if (key == "mode" || key == "scattering" || key == "polanalyzer" || key == "algorithm" || key == "magnetizationmode" || key == "fiterrorfunction" || key == "fitalgorithm") {
            const double value = number(0, true);
            const auto choice = [&](const std::vector<std::string>& options, const std::string& path) {
                const bool valid = std::isfinite(value) && value >= 0 && value < static_cast<double>(options.size());
                if (!valid) message("warning", "Unknown " + key + "; default selection retained.", assignment.line);
                project.at(Json::json_pointer(path)) = options[valid ? static_cast<size_t>(value) : 0];
            };
            if (key == "mode") choice({"compound", "element"}, "/sample/mode");
            else if (key == "scattering") choice({"reflection", "transmission"}, "/experiment/scattering");
            else if (key == "polanalyzer") choice({"none", "sigma", "pi"}, "/experiment/polarization/analyzer");
            else if (key == "algorithm") choice({"parratt", "matrix", "zak", "parratt-single-scattering", "electron-yield"}, "/calculation/algorithm");
            else if (key == "magnetizationmode") choice({"none", "add", "profile"}, "/calculation/magnetization/mode");
            else if (key == "fiterrorfunction") choice({"log-chi2", "lin-chi2"}, "/fit/errorFunction");
            else {
                project["fit"]["algorithm"] = value == 2 ? "simplex-annealing" : "simplex";
                if (value == 1) message("warning", "Levenberg-Marquardt is unavailable; switched to Simplex.", assignment.line);
                else if (value == 3) message("warning", "Evolutionary fit is unavailable; switched to Simplex.", assignment.line);
                else if (value != 0 && value != 2) message("warning", "Unknown fit algorithm; switched to Simplex.", assignment.line);
            }
            continue;
        }
        if (key == "layersegmentationmode") { project["calculation"]["roughnessModel"] = number(0, true) == 1 ? "segmentation" : "nevot-croce"; continue; }
        if (key == "calcmode") {
            const double value = number(0, true);
            project["calculation"]["roughnessModel"] = value >= 1 ? "segmentation" : "nevot-croce";
            if (value == 2) project["calculation"]["magnetization"]["mode"] = "profile";
            message("info", "Obsolete calcmode converted.", assignment.line); continue;
        }
        if (key == "fitmz") {
            project["calculation"]["magnetization"]["mode"] = flag() ? "profile" : "none";
            message("info", "Obsolete fitmz converted.", assignment.line); continue;
        }
        if (key == "segmentationmodel") {
            const double model = number(2, true);
            project["calculation"]["segmentation"]["scope"] = model == 0 || model == 1 ? "global" : "local";
            if (model == 0) message("warning", "Legacy interface-product segmentation is not represented; using global segmentation.", assignment.line);
            else if (model != 1 && model != 2) message("warning", "Unknown segmentation model; using local fallback.", assignment.line);
            continue;
        }
        if (key == "gausscoupling") { project["calculation"]["profileCombination"] = flag() ? "product" : "sum"; continue; }
        if (key == "averaging") { project["calculation"]["averaging"] = std::max(0.0, number(0, true)); continue; }
        if (key == "asymmetrydef") { project["calculation"]["asymmetryDefinition"] = number(0, true) == 1 ? "difference" : "normalized"; continue; }
        if (key == "evo_random") { auto& target = project["fit"]["evolution"]["randomSeed"]; target = number(target.get<double>(), true); continue; }
        if (key == "evo_population") { auto& target = project["fit"]["evolution"]["population"]; target = std::max(1.0, number(target.get<double>(), true)); continue; }
        if (key == "disablescript") { project["scripts"]["enabled"] = !flag(); continue; }
        if (key == "scriptparameters") { script_parameters.push_back(number(0)); continue; }
        if (key == "scriptline" || key == "defaultscriptline") {
            if (assignment.had_comment) message("warning", "Script text after # dropped, as in legacy ReMagX.", assignment.line);
            (key == "scriptline" ? scripts : default_scripts).push_back(assignment.text); continue;
        }
        if (key == "multilayerscript") { project["sample"]["multilayer"]["pattern"] = assignment.text; continue; }
        record(ignored, assignment);
    }
    finish_profile(); finish_dataset();
    if (!layers.is_null()) {
        if (!thickness_defined && layers.size() > 2) {
            for (size_t index = 1; index + 1 < layers.size(); ++index) layers[index]["thickness"] = depths[index] - depths[index - 1];
            message("info", "Layer thicknesses derived from stored z positions.");
        }
        if (layers.size() < 2) {
            message("warning", "Missing substrate/ambient layers added.");
            while (layers.size() < 2) layers.push_back(defaults["layer"]);
        }
        project["sample"]["layers"] = layers;
    }
    project["sample"]["elementProfiles"] = elements;
    project["sample"]["depthProfileFunctions"] = profiles;
    if (datasets.is_null()) datasets = Json::array();
    for (auto& dataset : datasets) {
        auto& values = dataset["columns"];
        for (auto item = values.begin(); item != values.end();) {
            if (item.key() != "qz" && item.value().size() != values["qz"].size()) {
                message("warning", "Dataset column " + item.key() + " has a different length from qz and was dropped."); item = values.erase(item);
            } else ++item;
        }
    }
    project["datasets"] = datasets;
    project["activeDatasetIndex"] = active >= 1 && active <= static_cast<double>(datasets.size()) ? Json(active - 1) : Json(nullptr);
    if (energy > 0) project["experiment"]["energy"] = energy;
    else message("warning", "No positive energy supplied; using the legacy default of 1000 eV.");
    for (auto parameter : parameters) {
        const double id = parameter["legacyId"].get<double>();
        const size_t line = parameter["line"].get<size_t>();
        if (!std::isfinite(id) || id < 0 || id >= static_cast<double>(defaults["fitTargets"].size())) {
            message("warning", "Fit variable with unknown id skipped.", line); continue;
        }
        parameter["target"] = defaults["fitTargets"][static_cast<size_t>(id)];
        double step = std::abs(0.05 * parameter["value"].get<double>());
        if (step <= 1e-7) step = std::abs(0.05 * parameter["upperBound"].get<double>());
        if (step <= 1e-7) step = 1e-8;
        parameter["step"] = step; parameter.erase("legacyId"); parameter.erase("line");
        project["fit"]["parameters"].push_back(parameter);
    }
    const auto join = [](const std::vector<std::string>& lines) {
        std::string result;
        for (size_t index = 0; index < lines.size(); ++index) { if (index) result += '\n'; result += lines[index]; }
        return result;
    };
    project["scripts"]["beforeCalculation"] = join(scripts);
    project["scripts"]["default"] = join(default_scripts);
    project["scripts"]["parameters"] = script_parameters;
    for (const auto& entry : by_design)
        message("info", entry.key + " ignored (" + std::to_string(entry.count) + " occurrences): " + defaults["ignoredByDesign"][entry.key].get<std::string>() + '.');
    if (!precision_seen) message("info", "Computed in double precision.");
    if (!ignored.empty()) message("info", "Unknown legacy keys were ignored; see the ordered ignored-key report.");
    finite_numbers(project);
    return {ProjectDocument::parse(project.dump()), std::move(messages), std::move(ignored)};
}
}
