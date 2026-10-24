#include "remagx/project_document.hpp"
#include "json.hpp"
#include <cmath>
#include <set>
#include <type_traits>
#include <utility>
#include <vector>

namespace remagx {
using Json = nlohmann::json;
static_assert(std::is_same<Json::number_float_t, double>::value, "Project values require double precision");

struct ProjectDocument::Storage {
    Json document;
    explicit Storage(Json value) : document(std::move(value)) {}
};

// JSON integer -0 would otherwise be parsed through an integer representation
// and lose its sign. Force only that token through the library's double parser;
// string contents and all nonzero/decimal/exponent tokens remain unchanged.
static std::string preserve_negative_zero(std::string_view text) {
    std::string result;
    result.reserve(text.size());
    bool quoted = false, escaped = false;
    for (size_t index = 0; index < text.size(); ++index) {
        const char character = text[index];
        if (quoted) {
            result += character;
            if (escaped) escaped = false;
            else if (character == '\\') escaped = true;
            else if (character == '"') quoted = false;
        } else if (character == '"') {
            quoted = true;
            result += character;
        } else if (character == '-' && index + 1 < text.size() && text[index + 1] == '0' &&
                   (index + 2 == text.size() ||
                    (text[index + 2] != '.' && text[index + 2] != 'e' && text[index + 2] != 'E' &&
                     (text[index + 2] < '0' || text[index + 2] > '9')))) {
            result += "-0.0";
            ++index;
        } else result += character;
    }
    return result;
}

static void validate_envelope(const Json& document) {
    if (!document.is_object()) throw ProjectDocumentError("Project JSON must be an object.");
    if (!document.contains("format") || document["format"] != "remagx-project")
        throw ProjectDocumentError("Unrecognized project format.");
    if (!document.contains("version") || !document["version"].is_number() || document["version"] != 1)
        throw ProjectDocumentError("Unsupported project version; expected version 1.");
    if (!document.contains("name") || !document["name"].is_string())
        throw ProjectDocumentError("Project name must be a string.");
    for (const auto* field : {"sample", "experiment", "calculation", "fit", "scripts"})
        if (!document.contains(field) || !document[field].is_object())
            throw ProjectDocumentError(std::string("Project field must be an object: ") + field);
    if (!document.contains("datasets") || !document["datasets"].is_array())
        throw ProjectDocumentError("Project datasets must be an array.");
    if (!document.contains("activeDatasetIndex")) throw ProjectDocumentError("Missing activeDatasetIndex.");
    const auto& active = document["activeDatasetIndex"];
    if (!active.is_null()) {
        if (!active.is_number()) throw ProjectDocumentError("Invalid activeDatasetIndex.");
        const double index = active.get<double>();
        if (!std::isfinite(index) || index < 0 || std::trunc(index) != index || index > 9007199254740991.0)
            throw ProjectDocumentError("Invalid activeDatasetIndex.");
    }
}

ProjectDocument::ProjectDocument(std::shared_ptr<const Storage> storage) : storage_(std::move(storage)) {}

ProjectDocument ProjectDocument::parse(std::string_view text) {
    if (text.find('\0') != std::string_view::npos) throw ProjectDocumentError("Unescaped NUL in project JSON.");
    std::vector<std::set<std::string>> object_keys;
    const auto callback = [&](int depth, Json::parse_event_t event, Json& value) {
        if (depth > 256) throw ProjectDocumentError("Project JSON exceeds 256 nesting levels.");
        if (event == Json::parse_event_t::object_start) object_keys.emplace_back();
        else if (event == Json::parse_event_t::object_end) object_keys.pop_back();
        else if (event == Json::parse_event_t::key) {
            if (!object_keys.back().insert(value.get<std::string>()).second)
                throw ProjectDocumentError("Duplicate object key in project JSON.");
        } else if (event == Json::parse_event_t::value && value.is_number()) {
            const double number = value.get<double>();
            if (!std::isfinite(number)) throw ProjectDocumentError("Nonfinite project number.");
            value = number; // Match browser Number storage also for integer tokens.
        }
        return true;
    };
    try {
        auto document = Json::parse(preserve_negative_zero(text), callback);
        validate_envelope(document);
        return ProjectDocument(std::make_shared<Storage>(std::move(document)));
    } catch (const Json::exception&) {
        // Library parse errors may quote input strings; keep research text out
        // of diagnostics. No partial document escapes a failed parse.
        throw ProjectDocumentError("Invalid project JSON syntax or numeric range.");
    }
}

std::string ProjectDocument::serialize() const {
    return storage_->document.dump(2) + '\n'; // Shortest round-trip double representation.
}

double ProjectDocument::number(std::string_view json_pointer) const {
    try {
        const auto& value = storage_->document.at(Json::json_pointer(std::string(json_pointer)));
        if (!value.is_number()) throw ProjectDocumentError("Project path does not contain a number.");
        return value.get<double>();
    } catch (const Json::exception&) { throw ProjectDocumentError("Invalid or missing project path."); }
}

ProjectDocument ProjectDocument::with_number(std::string_view json_pointer, double value) const {
    if (!std::isfinite(value)) throw ProjectDocumentError("Project number must be finite.");
    try {
        auto document = storage_->document;
        auto& target = document.at(Json::json_pointer(std::string(json_pointer)));
        if (!target.is_number()) throw ProjectDocumentError("Project path does not contain a number.");
        target = value;
        validate_envelope(document);
        return ProjectDocument(std::make_shared<Storage>(std::move(document)));
    } catch (const Json::exception&) { throw ProjectDocumentError("Invalid or missing project path."); }
}
}
