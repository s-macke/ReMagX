#pragma once
#include "project_document.hpp"
#include <optional>
#include <vector>
namespace remagx {
struct LegacyImportMessage {
    std::string level, text;
    std::optional<size_t> line;
};
struct LegacyIgnoredKey {
    std::string key;
    size_t count, first_line;
};
struct LegacyImportResult {
    ProjectDocument project;
    std::vector<LegacyImportMessage> messages;
    std::vector<LegacyIgnoredKey> ignored_keys;
};
LegacyImportResult import_legacy_project(std::string_view bytes, std::string name = "project.all");
}
