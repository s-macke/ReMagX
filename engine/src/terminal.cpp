#include "remagx/project_calculation.hpp"
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
        std::cout << "Usage: remagx-terminal -refl|-dicrefl project.json\n"
                     "       remagx-terminal -v\n"
                     "Manual compound constants, Nevot-Croce, Parratt/Matrix/Zak.\n"
                     "Output: qz R, or qz Rp Rm; 17 significant digits.\n"
                     "Generated qz grid: 0..qzMax inclusive (original terminal behavior).\n"
                     "Legacy .all, -fit and -convert integration remains pending.\n";
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
        const auto project = remagx::ProjectDocument::parse(text);
        const bool dichroic = std::string(argv[1]) == "-dicrefl";
        const auto curve = remagx::calculate_terminal_qz(project, dichroic);
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
