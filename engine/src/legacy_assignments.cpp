#include "remagx/legacy_assignments.hpp"
#include <algorithm>
#include <cmath>
#include <limits>
#include <locale>
#include <sstream>

namespace remagx {
namespace {
// WHATWG UTF-8 decoder: a bad continuation is consumed again as a new lead;
// incomplete valid prefixes produce one replacement character, not one per byte.
std::string decode(std::string_view bytes) {
    std::string result;
    size_t index = bytes.substr(0, 3) == "\xef\xbb\xbf" ? 3 : 0;
    while (index < bytes.size()) {
        const auto lead = static_cast<unsigned char>(bytes[index]);
        if (lead < 0x80) { result += bytes[index++]; continue; }
        size_t count = 0;
        unsigned char lower = 0x80, upper = 0xbf;
        if (lead >= 0xc2 && lead <= 0xdf) count = 2;
        else if (lead >= 0xe0 && lead <= 0xef) {
            count = 3;
            if (lead == 0xe0) lower = 0xa0;
            if (lead == 0xed) upper = 0x9f;
        } else if (lead >= 0xf0 && lead <= 0xf4) {
            count = 4;
            if (lead == 0xf0) lower = 0x90;
            if (lead == 0xf4) upper = 0x8f;
        }
        if (!count) { result += "\xef\xbf\xbd"; ++index; continue; }
        size_t consumed = 1;
        while (consumed < count && index + consumed < bytes.size()) {
            const auto next = static_cast<unsigned char>(bytes[index + consumed]);
            if (next < lower || next > upper) break;
            ++consumed; lower = 0x80; upper = 0xbf;
        }
        if (consumed == count) result.append(bytes.substr(index, count));
        else result += "\xef\xbf\xbd";
        index += consumed;
    }
    return result;
}
std::string without_spaces(std::string value) {
    value.erase(std::remove(value.begin(), value.end(), ' '), value.end());
    return value;
}
size_t whitespace(std::string_view text) {
    if (text.empty()) return 0;
    const auto first = static_cast<unsigned char>(text.front());
    if (first == 0x20 || (first >= 9 && first <= 13)) return 1;
    for (const auto* value : {"\xc2\xa0", "\xe1\x9a\x80", "\xe2\x80\x80", "\xe2\x80\x81", "\xe2\x80\x82",
         "\xe2\x80\x83", "\xe2\x80\x84", "\xe2\x80\x85", "\xe2\x80\x86", "\xe2\x80\x87", "\xe2\x80\x88",
         "\xe2\x80\x89", "\xe2\x80\x8a", "\xe2\x80\xa8", "\xe2\x80\xa9", "\xe2\x80\xaf", "\xe2\x81\x9f",
         "\xe3\x80\x80", "\xef\xbb\xbf"}) {
        const std::string_view prefix(value);
        if (text.substr(0, prefix.size()) == prefix) return prefix.size();
    }
    return 0;
}
bool digit(char value) { return value >= '0' && value <= '9'; }
}
LegacyAssignments parse_legacy_assignments(std::string_view bytes) {
    const auto content = decode(bytes);
    LegacyAssignments result;
    size_t start = 0, line_number = 1;
    while (start <= content.size()) {
        const size_t newline = content.find('\n', start);
        auto line = content.substr(start, newline == std::string::npos ? newline : newline - start);
        line.erase(std::remove(line.begin(), line.end(), '\r'), line.end());
        const size_t stop = line.find_first_of("#=");
        if (stop != std::string::npos && line[stop] == '=') {
            const auto rest = line.substr(stop + 1);
            const auto hash = rest.find('#');
            const auto raw = rest.substr(0, hash);
            result.assignments.push_back({without_spaces(line.substr(0, stop)), without_spaces(raw),
                !raw.empty() && raw.front() == ' ' ? raw.substr(1) : raw, hash != std::string::npos, line_number});
            if (newline == std::string::npos) result.final_assignment_unterminated = true;
        }
        if (newline == std::string::npos) break;
        start = newline + 1; ++line_number;
    }
    return result;
}
std::optional<double> legacy_number_prefix(std::string_view value, bool integer) {
    size_t start = 0;
    while (const size_t count = whitespace(value.substr(start))) start += count;
    size_t end = start;
    if (end < value.size() && (value[end] == '+' || value[end] == '-')) ++end;
    size_t digits = 0;
    while (end < value.size() && digit(value[end])) { ++end; ++digits; }
    if (!integer && end < value.size() && value[end] == '.') {
        ++end;
        while (end < value.size() && digit(value[end])) { ++end; ++digits; }
    }
    if (!digits) return std::nullopt;
    if (!integer && end < value.size() && (value[end] == 'e' || value[end] == 'E')) {
        size_t exponent = end + 1;
        if (exponent < value.size() && (value[exponent] == '+' || value[exponent] == '-')) ++exponent;
        const size_t first_digit = exponent;
        while (exponent < value.size() && digit(value[exponent])) ++exponent;
        if (exponent > first_digit) end = exponent;
    }
    std::istringstream input(std::string{value.substr(start, end - start)});
    input.imbue(std::locale::classic());
    double number = 0;
    input >> number;
    if (input.fail() && std::abs(number) == std::numeric_limits<double>::max())
        number = std::copysign(std::numeric_limits<double>::infinity(), number);
    return number;
}
}
