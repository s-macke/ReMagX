#include "remagx/compound_layers.hpp"
#include "remagx/project_document.hpp"
#include <utility>

namespace remagx {
namespace {
class PatternParser {
    size_t layer_count_;
    size_t limit_;
    std::string_view pattern_;
    char at(size_t position) const { return position < pattern_.size() ? pattern_[position] : '\0'; }
public:
    PatternParser(size_t layer_count, size_t limit, std::string_view pattern)
        : layer_count_(layer_count), limit_(limit), pattern_(pattern) {}
    std::pair<std::vector<size_t>, size_t> parse(size_t position, size_t depth) const {
        if (depth > 128) throw ProjectDocumentError("Multilayer nesting exceeds the supported limit.");
        std::vector<size_t> indices;
        double value = 0;
        bool digits = false;
        while (at(position) != '\0' && at(position) != ')') {
            const char character = at(position), next = at(position + 1);
            if (character >= '0' && character <= '9') {
                digits = true;
                value = value * 10 + (character - '0');
                if (value > 9007199254740991.0)
                    throw ProjectDocumentError("Multilayer integer exceeds the supported range.");
            }
            if (digits && (character == ',' || next == '\0' || next == ')' || character == '*')) {
                if (character == '*') {
                    if (next != '(') throw ProjectDocumentError("Multilayer repetition requires '(' immediately after '*'.");
                    auto group = parse(position + 2, depth + 1);
                    if (at(group.second) != ')') throw ProjectDocumentError("Multilayer repetition is missing its closing parenthesis.");
                    if (!group.first.empty()) {
                        if (value > static_cast<double>((limit_ - indices.size()) / group.first.size()))
                            throw ProjectDocumentError("Multilayer expansion exceeds the supported layer limit.");
                        const auto repetitions = static_cast<size_t>(value);
                        for (size_t repeat = 0; repeat < repetitions; ++repeat)
                            indices.insert(indices.end(), group.first.begin(), group.first.end());
                    }
                    position = group.second;
                } else {
                    if (value >= static_cast<double>(layer_count_))
                        throw ProjectDocumentError("Multilayer layer index is out of range.");
                    if (indices.size() >= limit_)
                        throw ProjectDocumentError("Multilayer expansion exceeds the supported layer limit.");
                    indices.push_back(static_cast<size_t>(value));
                }
                value = 0;
                digits = false;
            }
            ++position;
        }
        return {std::move(indices), position};
    }
};
}
std::vector<size_t> compound_layer_indices(size_t layer_count, std::string_view pattern, size_t maximum_layers) {
    if (layer_count < 2 || maximum_layers < 2 ||
        static_cast<double>(layer_count) > 9007199254740991.0 ||
        static_cast<double>(maximum_layers) > 9007199254740991.0)
        throw ProjectDocumentError("Invalid compound layer count or expansion limit.");
    auto result = PatternParser(layer_count, maximum_layers - 2, pattern).parse(0, 0).first;
    result.insert(result.begin(), 0);
    result.push_back(layer_count - 1);
    return result;
}
}
