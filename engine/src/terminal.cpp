#include "remagx/project_calculation.hpp"
#include "remagx/legacy_import.hpp"
#include "remagx/project_fit.hpp"
#include <csignal>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <locale>
#include <sstream>
#include <string>

namespace {
volatile std::sig_atomic_t fit_stop_requested = 0;
void stop_fit(int) { fit_stop_requested = 1; }
}

int main(int argc, char** argv) {
    std::cout.imbue(std::locale::classic());
    if (argc == 2 && std::string(argv[1]) == "-v") {
        std::cout << "ReMagX native terminal, JSON project version 1, double precision (partial command integration)\n";
        return 0;
    }
    if (argc == 2 && (std::string(argv[1]) == "--help" || std::string(argv[1]) == "-h")) {
        std::cout << "Usage: remagx-terminal -refl|-dicrefl|-fit project.json|project.all\n"
                     "       remagx-terminal -v\n"
                     "Manual/automatic compound or element constants, Parratt/Matrix/Zak.\n"
                     "Output: qz R, or qz Rp Rm; 17 significant digits.\n"
                     "Generated qz grid: 0..qzMax inclusive (original terminal behavior).\n"
                     "-fit writes the fitted JSON project to stdout; diagnostics go to stderr.\n"
                     "Ctrl+C stops fitting and returns the best evaluated project, if available.\n"
                     "Native Lua and -convert integration remain pending.\n";
        return 0;
    }
    if (argc != 3 || (std::string(argv[1]) != "-refl" && std::string(argv[1]) != "-dicrefl" && std::string(argv[1]) != "-fit")) {
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
        const bool fitting = std::string(argv[1]) == "-fit";
        bool energy_tables = false;
        if (fitting) for (size_t index = 0; index < project.array_size("/datasets"); ++index) {
            const auto path = "/datasets/" + std::to_string(index);
            energy_tables = energy_tables || (project.boolean(path + "/active") &&
                project.contains(path + "/columns/energy") && project.array_size(path + "/columns/energy") > 0);
        }
        const auto tables = remagx::load_project_tables(project, warnings, energy_tables);
        if (fitting) {
            for (const auto& warning : warnings) std::cerr << warning << '\n';
            std::signal(SIGINT, stop_fit);
            remagx::ProjectFitOptions options;
            options.should_stop = [] { return fit_stop_requested != 0; };
            const auto result = remagx::run_project_fit(project, tables, options);
            const auto output = result.best.project.serialize();
            std::cerr << std::setprecision(std::numeric_limits<double>::max_digits10)
                << "Fit error: " << result.best.error << "; iterations: " << result.iterations
                << "; evaluations: " << result.evaluations << "; termination: " << result.termination << '\n';
            std::cout << output << '\n';
            return std::cout ? 0 : 1;
        }
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
