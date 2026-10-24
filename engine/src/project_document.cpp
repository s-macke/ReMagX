#include "remagx/project_document.hpp"
#include "json.hpp"
#include "project_schema_data.hpp"
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

// This is the deliberately restricted subset emitted by export-project-schema.mjs.
// Unknown project properties are retained; unknown schema instructions are errors.
static void check_schema(const Json& schema) {
    static const std::set<std::string> supported = {
        "$schema", "type", "const", "enum", "properties", "required", "items",
        "minItems", "maxItems", "minimum", "maximum", "exclusiveMinimum",
        "exclusiveMaximum", "anyOf", "x-remagx-equal-column-lengths"};
    for (const auto& entry : schema.items())
        if (!supported.count(entry.key())) throw std::logic_error("Unsupported native project schema keyword.");
    if (schema.contains("properties"))
        for (const auto& child : schema["properties"]) check_schema(child);
    if (schema.contains("items")) check_schema(schema["items"]);
    if (schema.contains("anyOf")) for (const auto& child : schema["anyOf"]) check_schema(child);
}

static bool has_type(const Json& value, const std::string& type) {
    if (type == "null") return value.is_null();
    if (type == "object") return value.is_object();
    if (type == "array") return value.is_array();
    if (type == "string") return value.is_string();
    if (type == "boolean") return value.is_boolean();
    if (type == "number") return value.is_number();
    if (type == "integer") return value.is_number() && std::trunc(value.get<double>()) == value.get<double>();
    throw std::logic_error("Unsupported native project schema type.");
}

static std::string child_path(const std::string& path, const std::string& key) {
    std::string result = path + '/';
    for (char character : key) {
        if (character == '~') result += "~0";
        else if (character == '/') result += "~1";
        else result += character;
    }
    return result;
}

static void validate_value(const Json& value, const Json& schema, const std::string& path) {
    const auto fail = [&](const char* reason) {
        // Paths contain schema-defined names and array indices, never input values.
        throw ProjectDocumentError("Invalid project field " + (path.empty() ? std::string("/") : path) + ": " + reason);
    };
    if (schema.contains("type")) {
        const auto& type = schema["type"];
        bool matches = false;
        if (type.is_array()) {
            for (const auto& choice : type) matches = matches || has_type(value, choice.get<std::string>());
        } else matches = has_type(value, type.get<std::string>());
        if (!matches) fail("unexpected type.");
    }
    if (schema.contains("const") && value != schema["const"]) fail("unexpected constant.");
    if (schema.contains("enum")) {
        bool found = false;
        for (const auto& choice : schema["enum"]) if (value == choice) found = true;
        if (!found) fail("unsupported choice.");
    }
    if (schema.contains("anyOf")) {
        bool found = false;
        for (const auto& choice : schema["anyOf"]) {
            try { validate_value(value, choice, path); found = true; break; }
            catch (const ProjectDocumentError&) {}
        }
        if (!found) fail("no allowed alternative matches.");
    }
    if (value.is_number()) {
        const double number = value.get<double>();
        if (!std::isfinite(number)) fail("number must be finite.");
        if (schema.contains("minimum") && number < schema["minimum"].get<double>()) fail("below minimum.");
        if (schema.contains("maximum") && number > schema["maximum"].get<double>()) fail("above maximum.");
        if (schema.contains("exclusiveMinimum") && number <= schema["exclusiveMinimum"].get<double>()) fail("must exceed minimum.");
        if (schema.contains("exclusiveMaximum") && number >= schema["exclusiveMaximum"].get<double>()) fail("must be below maximum.");
    }
    if (value.is_object()) {
        if (schema.contains("required")) for (const auto& key : schema["required"])
            if (!value.contains(key.get<std::string>()))
                throw ProjectDocumentError("Missing project field " + child_path(path, key.get<std::string>()) + '.');
        if (schema.contains("properties")) for (const auto& entry : schema["properties"].items())
            if (value.contains(entry.key())) validate_value(value[entry.key()], entry.value(), child_path(path, entry.key()));
        if (schema.contains("x-remagx-equal-column-lengths")) {
            const auto count = value.at(schema["x-remagx-equal-column-lengths"].get<std::string>()).size();
            for (const auto& entry : schema.at("properties").items())
                if (value.contains(entry.key()) && value[entry.key()].size() != count)
                    throw ProjectDocumentError("Invalid project field " + child_path(path, entry.key()) + ": column length differs from qz.");
        }
    }
    if (value.is_array()) {
        if (schema.contains("minItems") && value.size() < schema["minItems"].get<size_t>()) fail("too few items.");
        if (schema.contains("maxItems") && value.size() > schema["maxItems"].get<size_t>()) fail("too many items.");
        if (schema.contains("items")) for (size_t index = 0; index < value.size(); ++index)
            validate_value(value[index], schema["items"], child_path(path, std::to_string(index)));
    }
}

static void validate_project(const Json& document) {
    static const Json schema = [] {
        auto result = Json::parse(project_schema_json);
        check_schema(result);
        return result;
    }();
    validate_envelope(document);
    validate_value(document, schema, "");
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
        validate_project(document);
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
        validate_project(document);
        return ProjectDocument(std::make_shared<Storage>(std::move(document)));
    } catch (const Json::exception&) { throw ProjectDocumentError("Invalid or missing project path."); }
}
}
