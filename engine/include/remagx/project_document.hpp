#ifndef REMAGX_PROJECT_DOCUMENT_HPP
#define REMAGX_PROJECT_DOCUMENT_HPP
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace remagx {
class ProjectDocumentError : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

// Native JSON document boundary. Validates the exported version-1 web schema
// and JSON representation, not calculation capability/runtime constraints. Unknown
// members are retained. Scientific numbers use IEEE-754 double, like the web app.
class ProjectDocument {
public:
    static ProjectDocument parse(std::string_view text);
    // Serialization always enforces the persisted project schema.
    std::string serialize() const;
    double number(std::string_view json_pointer) const;
    std::string string(std::string_view json_pointer) const;
    bool boolean(std::string_view json_pointer) const;
    bool contains(std::string_view json_pointer) const;
    bool is_null(std::string_view json_pointer) const;
    size_t array_size(std::string_view json_pointer) const;
    // Immutable numeric edit: target must already exist and be numeric; no
    // missing fields/array slots are created and a failed edit changes nothing.
    ProjectDocument with_number(std::string_view json_pointer, double value) const;
    // Immutable calculation-only batch: finite values, existing numeric targets,
    // list-order writes. Transient fit values may exceed persisted field domains;
    // solver preparation validates them, and serialize() rejects invalid projects.
    ProjectDocument with_calculation_numbers(const std::vector<std::pair<std::string, double>>& edits) const;
    // Select a validated dataset for calculation without adapting its raw columns.
    ProjectDocument for_fit_dataset(size_t index) const;
private:
    struct Storage;
    explicit ProjectDocument(std::shared_ptr<const Storage> storage, bool schema_validated = true);
    std::shared_ptr<const Storage> storage_;
    bool schema_validated_;
};
}
#endif
