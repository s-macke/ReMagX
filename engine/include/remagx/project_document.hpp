#ifndef REMAGX_PROJECT_DOCUMENT_HPP
#define REMAGX_PROJECT_DOCUMENT_HPP
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>

namespace remagx {
class ProjectDocumentError : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

// Native JSON document boundary. Validates the version-1 envelope and JSON
// representation, NOT every domain constraint or engine capability. Unknown
// members are retained. Scientific numbers use IEEE-754 double, like the web app.
class ProjectDocument {
public:
    static ProjectDocument parse(std::string_view text);
    std::string serialize() const;
    double number(std::string_view json_pointer) const;
    // Immutable numeric edit: target must already exist and be numeric; no
    // missing fields/array slots are created and a failed edit changes nothing.
    ProjectDocument with_number(std::string_view json_pointer, double value) const;
private:
    struct Storage;
    explicit ProjectDocument(std::shared_ptr<const Storage> storage);
    std::shared_ptr<const Storage> storage_;
};
}
#endif
