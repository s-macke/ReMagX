#include "remagx/project_calculation.hpp"
#include "remagx/legacy_import.hpp"
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <locale>
#include <sstream>
#include <string>

int main(int argc, char** argv) {
    std::cout.imbue(std::locale::classic());
    if (argc == 2 && std::string(argv[1]) == "-v") {
        std::cout << "ReMagX native terminal, JSON project version 1, double precision (partial command integration)\n";
        return 0;
    }
    if (argc == 2 && (std::string(argv[1]) == "--help" || std::string(argv[1]) == "-h")) {
        std::cout << "Usage: remagx-terminal -refl|-dicrefl project.json|project.all\n"
                     "       remagx-terminal -v\n"
                     "Manual/automatic compound or element constants, Parratt/Matrix/Zak.\n"
                     "Output: qz R, or qz Rp Rm; 17 significant digits.\n"
                     "Generated qz grid: 0..qzMax inclusive (original terminal behavior).\n"
                     "Lua, -fit and -convert integration remains pending.\n";
        return 0;
    }
    if (argc != 3 || (std::string(argv[1]) != "-refl" && std::string(argv[1]) != "-dicrefl")) {
        std::cerr << "Unsupported invocation; use --help for currently integrated commands.\n";
        return 2;
    }
    try {
        std::ifstream input(argv[2], std::ios::binary);
        if (!input) throw remagx::ProjectDocumentError("Cannot open project input.");
        const std::string text{std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
        if (input.bad()) throw remagx::ProjectDocumentError("Cannot read complete project input.");
        auto extension = std::filesystem::path(argv[2]).extension().string();
        for (auto& character : extension) if (character >= 'A' && character <= 'Z') character += 'a' - 'A';
        const auto project = [&] {
            if (extension != ".all") return remagx::ProjectDocument::parse(text);
            const auto imported = remagx::import_legacy_project(text, std::filesystem::path(argv[2]).filename().string());
            for (const auto& message : imported.messages) {
                std::cerr << "Import " << message.level;
                if (message.line) std::cerr << " at line " << *message.line;
                std::cerr << ": " << message.text << '\n';
            }
            for (const auto& key : imported.ignored_keys)
                std::cerr << "Import ignored key " << key.key << ": " << key.count << " occurrences, first at line " << key.first_line << '\n';
            return imported.project;
        }();
        const bool dichroic = std::string(argv[1]) == "-dicrefl";
        std::vector<std::string> warnings;
        const auto tables = remagx::load_project_tables(project, warnings);
        const auto curve = remagx::calculate_terminal_qz(project, dichroic, tables);
        warnings.insert(warnings.end(), curve.warnings.begin(), curve.warnings.end());
        for (const auto& warning : warnings) std::cerr << warning << '\n';
        // Prepare all output before publishing any scientific rows.
        std::ostringstream output;
        output.imbue(std::locale::classic());
        output << std::setprecision(std::numeric_limits<double>::max_digits10);
        for (size_t index = 0; index < curve.qz.size(); ++index) {
            output << curve.qz[index] << ' ' << curve.plus[index];
            if (dichroic) output << ' ' << curve.minus[index];
            output << '\n';
        }
        std::cout << output.str();
        if (!std::cout) return 1;
        return 0;
    } catch (const remagx::ProjectDocumentError& error) {
        std::cerr << error.what() << '\n';
    } catch (const std::bad_alloc&) {
        std::cerr << "Insufficient memory for project calculation.\n";
    } catch (const std::exception&) {
        std::cerr << "Native terminal calculation failed.\n";
    }
    return 1;
}
