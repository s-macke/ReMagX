#include "remagx/compound_layers.hpp"
#include "remagx/project_document.hpp"
#include <iostream>
#include <stdexcept>
#include <string>

using remagx::compound_layer_indices;
static void equal(const std::vector<size_t>& actual, const std::vector<size_t>& expected) {
    if (actual != expected) throw std::runtime_error("Multilayer expansion differs");
}
template<class Action> static void rejects(Action action) {
    try { action(); } catch (const remagx::ProjectDocumentError&) { return; }
    throw std::runtime_error("Invalid multilayer accepted");
}
int main() {
    try {
        equal(compound_layer_indices(5, "2*(1, 2*(2,3))"), {0,1,2,3,2,3,1,2,3,2,3,4});
        equal(compound_layer_indices(5, "0,3*(1,2),4"), {0,0,1,2,1,2,1,2,4,4});
        equal(compound_layer_indices(5, ""), {0,4});
        equal(compound_layer_indices(5, "0*(1,2),3"), {0,3,4});
        equal(compound_layer_indices(5, "9007199254740991*()"), {0,4});
        equal(compound_layer_indices(15, "1a2"), {0,12,14});
        equal(compound_layer_indices(5, "1)2"), {0,1,4});
        equal(compound_layer_indices(5, std::string("1\0,2", 4)), {0,1,4});
        equal(compound_layer_indices(5, "2*(1,2)", 6), {0,1,2,1,2,4});
        equal(compound_layer_indices(2, "", 2), {0,1});
        for (const auto* pattern : {"5", "2* (1)", "2*(1", "9007199254740992*(1)",
                 "9007199254740992*()", "100000*(1)", "0*(9)", "1,99998*(1)"})
            rejects([&] { compound_layer_indices(5, pattern); });
        rejects([] { compound_layer_indices(5, "2*(1,2)", 5); });
        rejects([] { compound_layer_indices(1, ""); });
        rejects([] { compound_layer_indices(5, "", 1); });
        std::string nested;
        for (size_t index = 0; index < 129; ++index) nested += "1*(";
        nested += "1" + std::string(129, ')');
        rejects([&] { compound_layer_indices(5, nested); });
        auto independent = compound_layer_indices(5, "2*(1)");
        independent[1] = 3;
        equal(compound_layer_indices(5, "2*(1)"), {0,1,1,4});
        std::cout << "Native multilayer sequences, boundaries, limits and recovery passed.\n";
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n'; return 1;
    }
}
