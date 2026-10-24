#pragma once
#include <optional>
#include <string>
#include <string_view>
#include <vector>
namespace remagx {
struct LegacyAssignment {
    std::string key, value, text;
    bool had_comment = false;
    size_t line = 0;
};
struct LegacyAssignments {
    std::vector<LegacyAssignment> assignments;
    bool final_assignment_unterminated = false;
};
// Byte-input boundary: web TextDecoder UTF-8 replacement/BOM behavior, followed
// by legacy assignment syntax. Does not map fields or validate a project.
LegacyAssignments parse_legacy_assignments(std::string_view bytes);
// Decimal prefixes used by the web importer. Missing prefixes return nullopt;
// overflow returns infinity for subsequent schema rejection, never saturation.
// All numeric storage and conversion use double, including integer prefixes.
std::string trim_legacy_text(std::string_view value);
std::optional<double> legacy_number_prefix(std::string_view value, bool integer = false);
}
