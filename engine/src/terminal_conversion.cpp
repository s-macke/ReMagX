#include "terminal_conversion.hpp"
#include "remagx/core.h"
#include "remagx/optical_tables.hpp"
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <locale>
#include <sstream>

namespace remagx {
namespace {
OpticalTable read_conversion_table(const std::string& basename, const std::string& kind,
    bool required, std::vector<std::string>& messages) {
    const std::filesystem::path path(basename + "." + kind);
    std::error_code error;
    const bool exists = std::filesystem::exists(path, error);
    if (error) throw ProjectDocumentError("Cannot inspect ." + kind + " conversion input.");
    if (!exists && !required) return parse_optical_table("", basename, kind);
    if (!exists || !std::filesystem::is_regular_file(path, error) || error)
        throw ProjectDocumentError("Conversion requires a readable ." + kind + " file.");
    std::ifstream input(path, std::ios::binary);
    if (!input) throw ProjectDocumentError("Cannot open ." + kind + " conversion input.");
    const std::string text{std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
    if (input.bad()) throw ProjectDocumentError("Cannot read complete ." + kind + " conversion input.");
    auto table = parse_optical_table(text, basename, kind);
    if (table.skipped_rows) messages.push_back("." + kind + ": " + std::to_string(table.skipped_rows) + " malformed rows skipped.");
    if (table.extra_rows) messages.push_back("." + kind + ": " + std::to_string(table.extra_rows) + " rows have ignored extra columns.");
    if (required && table.energies.empty()) throw ProjectDocumentError("Conversion requires at least one valid .db row.");
    return table;
}

// An exclusively created directory owns the temporary output. It is on the same
// filesystem as the destination so rename publishes the complete file on Linux.
class ConversionOutput {
public:
    explicit ConversionOutput(const std::filesystem::path& destination) {
        const auto parent = destination.has_parent_path() ? destination.parent_path() : std::filesystem::path(".");
        const auto nonce = std::chrono::steady_clock::now().time_since_epoch().count();
        for (int attempt = 0; attempt < 100; ++attempt) {
            auto candidate = parent / (".remagx-convert-" + std::to_string(nonce) + "-" + std::to_string(attempt));
            std::error_code error;
            if (std::filesystem::create_directory(candidate, error)) { directory_ = std::move(candidate); return; }
            if (error) throw ProjectDocumentError("Cannot create temporary conversion output beside the .e file.");
        }
        throw ProjectDocumentError("Cannot reserve temporary conversion output.");
    }
    ~ConversionOutput() { std::error_code error; std::filesystem::remove_all(directory_, error); }
    void publish(const std::filesystem::path& destination, const std::string& text) {
        const auto file = directory_ / "tensor.e";
        std::ofstream output(file, std::ios::binary);
        if (!output) throw ProjectDocumentError("Cannot open temporary conversion output.");
        output << text;
        output.close();
        if (!output) throw ProjectDocumentError("Cannot write complete .e conversion output.");
        std::error_code error;
        std::filesystem::rename(file, destination, error);
        if (error) throw ProjectDocumentError("Cannot replace .e conversion output; existing output was retained.");
    }
private:
    std::filesystem::path directory_;
};
}

void convert_terminal_tables(const std::string& basename, std::vector<std::string>& messages) {
    if (basename.empty()) throw ProjectDocumentError("Conversion requires a filename without extension.");
    const auto optical = read_conversion_table(basename, "db", true, messages);
    const auto magnetic = read_conversion_table(basename, "m", false, messages);
    const bool magnetic_enabled = !magnetic.energies.empty();
    if (!magnetic_enabled) messages.push_back("No usable .m table; converting without magneto-optical constants.");
    std::vector<double> optical_values(optical.energies.size() * 2), magnetic_values(optical.energies.size() * 2);
    const auto lookup = [&](const OpticalTable& table, std::vector<double>& output) {
        size_t cursor = 0;
        const int status = remagx_table_lookup(table.energies.data(), table.values.data(), table.energies.size(), 2,
            optical.energies.data(), optical.energies.size(), &cursor, output.data());
        if (status != REMAGX_SUCCESS) throw ProjectDocumentError("Conversion table interpolation failed.");
    };
    lookup(optical, optical_values); lookup(magnetic, magnetic_values);
    size_t out_of_range = 0;
    std::ostringstream output;
    output.imbue(std::locale::classic());
    output << "# ReMagX dielectric tensor; gamma=90 degrees, phi=90 degrees\n"
           << "# E xx.re xx.im xy.re xy.im xz.re xz.im yx.re yx.im yy.re yy.im yz.re yz.im zx.re zx.im zy.re zy.im zz.re zz.im\n"
           << std::setprecision(std::numeric_limits<double>::max_digits10);
    for (size_t row = 0; row < optical.energies.size(); ++row) {
        const double energy = optical.energies[row];
        if (magnetic_enabled && (energy < magnetic.energies.front() || energy > magnetic.energies.back())) ++out_of_range;
        RemagxLayer layer{0, 0, optical_values[row*2], optical_values[row*2+1],
            magnetic_values[row*2], magnetic_values[row*2+1], 90, 90};
        double tensor[18];
        int anisotropic = 0;
        if (remagx_dielectric_tensor(&layer, REMAGX_ISOTROPIC, magnetic_enabled ? 1 : 0, tensor, &anisotropic) != REMAGX_SUCCESS)
            throw ProjectDocumentError("Conversion tensor calculation failed; check optical constants.");
        output << energy;
        for (double value : tensor) output << ' ' << value;
        output << '\n';
    }
    if (out_of_range) messages.push_back(std::to_string(out_of_range) + " energies outside .m range use zero magnetic constants.");
    const std::filesystem::path destination(basename + ".e");
    ConversionOutput temporary(destination);
    temporary.publish(destination, output.str());
    messages.push_back("Converted " + std::to_string(optical.energies.size()) + " rows to " + destination.string() + " (gamma=90, phi=90 degrees).");
}
}
