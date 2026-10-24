#include "remagx/legacy_assignments.hpp"
#include "json.hpp"
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>
using Json = nlohmann::json;
static Json number(std::optional<double> value) {
    if (!value) return nullptr;
    if (std::isinf(*value)) return *value < 0 ? Json("-Infinity") : Json("Infinity");
    if (*value == 0 && std::signbit(*value)) return "-0";
    return *value;
}
int main() {
    try {
        std::string line;
        while (std::getline(std::cin, line)) {
            const auto request = Json::parse(line);
            std::string bytes;
            for (const auto& byte : request.at("bytes")) bytes += static_cast<char>(byte.get<unsigned char>());
            const auto parsed = remagx::parse_legacy_assignments(bytes);
            Json assignments = Json::array();
            for (const auto& entry : parsed.assignments) assignments.push_back({
                {"key", entry.key}, {"value", entry.value}, {"text", entry.text}, {"hadComment", entry.had_comment},
                {"line", entry.line}, {"number", number(remagx::legacy_number_prefix(entry.value))},
                {"integer", number(remagx::legacy_number_prefix(entry.value, true))}});
            std::cout << Json{{"assignments", assignments}, {"unterminated", parsed.final_assignment_unterminated}}.dump() << '\n';
        }
    } catch (const std::exception&) { std::cerr << "Native assignment test input failed.\n"; return 1; }
    return 0;
}
