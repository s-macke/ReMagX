#ifndef REMAGX_COMPOUND_LAYERS_HPP
#define REMAGX_COMPOUND_LAYERS_HPP
#include <cstddef>
#include <string_view>
#include <vector>
namespace remagx {
// Defined legacy pattern semantics, with the web parser's nesting/integer/size
// guards. Substrate and ambient are always added as the outer two rows.
std::vector<size_t> compound_layer_indices(size_t layer_count, std::string_view pattern,
                                          size_t maximum_layers = 100000);
}
#endif
