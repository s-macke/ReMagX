#pragma once
#include <string>
#include <vector>
namespace remagx {
// Rebuild basename.e from basename.db and optional basename.m (D-42).
// Existing .e data is not a calculation input. Publish only complete output.
void convert_terminal_tables(const std::string& basename, std::vector<std::string>& messages);
}
