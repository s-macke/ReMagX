// Boundary adapter for the unmodified private simulation implementation.
// Legacy identifiers occur only at this traceability boundary.
#include <cmath>
#include <cstring>
#include <cstdio>
#include <iomanip>
#include <sstream>
#include <unistd.h>
#include <pthread.h>
#include "CStateHandler.h"
#include "RechenHilfe.h"
int memorycounterequal = 0, memorycounterassign = 0, memorycounterreserve = 0;
pthread_mutex_t vectorcountermutex = PTHREAD_MUTEX_INITIALIZER;
// Observe host Lua failures without modifying the private implementation. The
// original simulation can continue after reporting one; such curves are not goldens.
static bool script_failed = false;
static unsigned protected_call_depth = 0;
extern "C" int __real_lua_pcall(lua_State*, int, int, int);
extern "C" int __wrap_lua_pcall(lua_State* state, int arguments, int results, int handler) {
    ++protected_call_depth;
    const int status = __real_lua_pcall(state, arguments, results, handler);
    --protected_call_depth;
    if (protected_call_depth == 0 && status != 0) script_failed = true;
    return status;
}
extern "C" int __real_luaL_loadbuffer(lua_State*, const char*, size_t, const char*);
extern "C" int __wrap_luaL_loadbuffer(lua_State* state, const char* text, size_t size, const char* name) {
    const int status = __real_luaL_loadbuffer(state, text, size, name);
    if (protected_call_depth == 0 && status != 0) script_failed = true;
    return status;
}

int main(int argc, char** argv) {
    if (argc < 2 || argc > 9) return 2;
    bool asymmetry = false, energy_scan = false, fixed_angle = false, profile = false, density = false, layer_list = false;
    bool fourier = false, multiply = false, divide = false, column_layout = false;
    for (int index = 2; index < argc; ++index) {
        if (std::strcmp(argv[index], "--layers") == 0 && !layer_list) layer_list = true;
        else if (std::strcmp(argv[index], "--density") == 0 && !density) density = true;
        else if (std::strcmp(argv[index], "--profile") == 0 && !profile) profile = true;
        else if (std::strcmp(argv[index], "--column-layout") == 0 && !column_layout) column_layout = true;
        else if (std::strcmp(argv[index], "--asymmetry") == 0 && !asymmetry) asymmetry = true;
        else if (std::strcmp(argv[index], "--energy") == 0 && !energy_scan) energy_scan = true;
        else if (std::strcmp(argv[index], "--angle") == 0 && !fixed_angle) fixed_angle = true;
        else if (std::strcmp(argv[index], "--fourier") == 0 && !fourier) fourier = true;
        else if (std::strcmp(argv[index], "--multiply-qz4") == 0 && !multiply) multiply = true;
        else if (std::strcmp(argv[index], "--divide-pi") == 0 && !divide) divide = true;
        else return 2;
    }
    if (layer_list && (density || profile || energy_scan || asymmetry || fixed_angle || fourier || multiply || divide || column_layout)) return 2;
    if (density && (profile || energy_scan || asymmetry || fixed_angle || fourier || multiply || divide || column_layout)) return 2;
    if (profile && (energy_scan || asymmetry || fixed_angle || fourier || multiply || divide || column_layout)) return 2;
    if (fixed_angle && !energy_scan) return 2;
    if (fourier && (energy_scan || asymmetry) && !column_layout) return 2;
    FILE* output = fdopen(dup(STDOUT_FILENO), "w");
    if (!output) return 3;
    if (!freopen("/dev/null", "w", stdout) || !freopen("/dev/null", "w", stderr)) return 3;
    // Unit1.cpp GUI startup and server/dllbinding.c initialize this before use.
    // The original lookup implementation/table stays in the private legacy build.
    erffinit();
    // Process ownership avoids unrelated destruction paths in the original code.
    auto* state = new CStateHandler;
    if (!state->LoadState(argv[1])) return 4;
    // GUI postprocessing checkboxes are not persisted by LoadState.
    state->postfft = fourier;
    state->postmultiply = multiply;
    state->postdivide = divide;
    if (density) {
        // Unit1.cpp ShowDensityProfilesClick: GetState without SetOCStrict,
        // temporary BeforeCalculation, then DrawDensityProfiles/GetDensity.
        if (state->ocautomatic) { Getdblist(*state); Filldb(*state); }
        else FillTensors(*state);
        CScript(*state, BEFORECALCULATION, NULL, NULL);
        if (script_failed) return 7;
        const auto* film = state->GetActiveFilm();
        if (film->mode != ELEMENT || film->el.empty()) return 11;
        const auto& elements = film->el;
        double total = 0.0, roughness = 0.0;
        for (int element = 0; element < elements.size(); ++element) {
            double thickness = 0.0;
            for (int layer = 1; layer < elements[element].mfs.size() - 1; ++layer)
                thickness += elements[element].mfs[layer].d;
            if (thickness > total) {
                total = thickness;
                roughness = elements[element].mfs[elements[element].mfs.size() - 2].sigma;
            }
        }
        // The GUI leaves maxsigma uninitialized when no positive stack wins.
        const double maximum = total + 30.0 + roughness * 2.0;
        const double step = state->slicing.minlayerthickness;
        if (total <= 0.0 || !std::isfinite(maximum) || !std::isfinite(step) || step <= 0.0) return 12;
        std::ostringstream buffer;
        buffer << std::setprecision(17) << "{\"smooth\":[";
        size_t count = 0;
        for (double depth = -30.0; depth < maximum;) {
            if (++count > 1000000) return 12;
            if (count > 1) buffer << ",";
            buffer << "[" << depth;
            for (int element = 0; element < elements.size(); ++element) {
                const double value = elements[element].GetDensity(depth);
                if (!std::isfinite(value)) return 8;
                buffer << "," << value;
            }
            buffer << "]";
            const double next = depth + step;
            if (next <= depth) return 12;
            depth = next;
        }
        buffer << "],\"boundaries\":[";
        for (int element = 0; element < elements.size(); ++element) {
            if (element) buffer << ",";
            buffer << "[";
            double depth = 0.0;
            for (int layer = 1; layer < elements[element].mfs.size(); ++layer) {
                if (layer > 1) buffer << ",";
                const double value = elements[element].GetDensity(depth);
                if (!std::isfinite(depth) || !std::isfinite(value)) return 8;
                buffer << "[" << depth << "," << value << "]";
                if (layer < elements[element].mfs.size() - 1) depth += elements[element].mfs[layer].d;
            }
            buffer << "]";
        }
        buffer << "]}\n";
        const auto result = buffer.str();
        if (fwrite(result.data(), 1, result.size(), output) != result.size()) return 9;
        return fclose(output) == 0 ? 0 : 9;
    }
    if (profile || layer_list) {
        // GUI GetState followed by SetOCStrict, then the temporary profile hook.
        if (state->ocautomatic) {
            Getdblist(*state); Filldb(*state);
            if (!Getdblist(*state) || !Filldb(*state)) return 6;
        }
        CScript(*state, BEFORECALCULATION, NULL, NULL);
        if (script_failed) return 7;
        state->slicing.layersegmentationmode = 1;
        CVector<Schicht<double>> layers;
        if (FillLayers<double>(*state, state->GetActiveFilm()->mfs, layers) != RX_SUCCESS || layers.empty()) return 8;
        std::ostringstream buffer;
        buffer << std::setprecision(17);
        auto write_row = [&](const std::vector<double>& values) {
            buffer << "[";
            for (size_t index = 0; index < values.size(); ++index) {
                if (!std::isfinite(values[index])) return false;
                if (index) buffer << ",";
                buffer << values[index];
            }
            buffer << "]";
            return true;
        };
        if (layer_list) {
            // Button13Click writes FillLayers output, then assigns dbname unknown.
            buffer << "[";
            for (int index = 0; index < layers.size(); ++index) {
                auto& layer = layers[index];
                layer.dbname = CString("unknown");
                std::vector<double> values = {layer.d, layer.sigma, layer.oc.delta, layer.oc.beta,
                    layer.oc.deltam, layer.oc.betam, layer.maggamma, layer.magphi,
                    layer.density, layer.electron_escape_depth, layer.material.empty() ? 1. : 0.,
                    layer.dbname == CString("unknown") ? 1. : 0.};
                if (state->algorithm == MATRIX) {
                    values.push_back(layer.oc.epsilontype == ANISOTROPIC ? 1. : 0.);
                    for (int row = 0; row < 3; ++row) for (int column = 0; column < 3; ++column) {
                        values.push_back(layer.oc.epsilon.a[row][column].real());
                        values.push_back(layer.oc.epsilon.a[row][column].imag());
                    }
                }
                if (index) buffer << ",";
                if (!write_row(values)) return 8;
            }
            buffer << "]\n";
            const auto result = buffer.str();
            if (fwrite(result.data(), 1, result.size(), output) != result.size()) return 9;
            return fclose(output) == 0 ? 0 : 9;
        }
        buffer << "{\"smooth\":[";
        if (!write_row({layers[0].z, layers[0].oc.delta, layers[0].oc.beta, layers[0].oc.deltam, layers[0].oc.betam})) return 8;
        for (int index = 1; index < layers.size() - 1; ++index) {
            buffer << ",";
            const auto& current = layers[index]; const auto& next = layers[index + 1];
            if (!write_row({current.z, (current.oc.delta + next.oc.delta) / 2., (current.oc.beta + next.oc.beta) / 2.,
                (current.oc.deltam + next.oc.deltam) / 2., (current.oc.betam + next.oc.betam) / 2.})) return 8;
        }
        buffer << "],\"segments\":[";
        for (int index = 1; index < layers.size() - 1; ++index) {
            if (index > 1) buffer << ",";
            const auto& current = layers[index];
            if (!write_row({layers[index - 1].z, current.z, current.oc.delta, current.oc.beta, current.oc.deltam, current.oc.betam})) return 8;
        }
        buffer << "]}\n";
        const auto result = buffer.str();
        if (fwrite(result.data(), 1, result.size(), output) != result.size()) return 9;
        return fclose(output) == 0 ? 0 : 9;
    }
    if ((energy_scan || state->ocautomatic) && (!Getdblist(*state) || !Filldb(*state))) return 6;
    CDataSet data;
    // Unit1.cpp Button3Click copies the selected dataset and adapts it once.
    // The terminal front end adds qzshift a second time; do not reproduce that
    // different entry path when validating the web application's GUI behavior.
    if (state->usemeasurementqz) {
        if (state->activedatasetindex < 0 || state->activedatasetindex >= state->datasets.size()) return 5;
        data = state->datasets[state->activedatasetindex];
        if (data.qz.empty() || data.qz.size() > 1000000) return 5;
        data.Adapt(data.qzshift, data.energyshift, data.multiplicator, data.translation);
        if (energy_scan && data.eng.size() != data.qz.size()) return 5;
    } else if (energy_scan) {
        if (state->numberofpoints < 2 || state->numberofpoints > 1000000) return 5;
        double minimum, maximum;
        GetMaximumEnergyRange(*state, minimum, maximum);
        if (minimum < state->engscanmin) minimum = state->engscanmin;
        if (maximum > state->engscanmax) maximum = state->engscanmax;
        const double step = (maximum - minimum) / state->numberofpoints;
        if (!std::isfinite(minimum) || !std::isfinite(maximum) || minimum <= 0 ||
            maximum <= minimum || !std::isfinite(step) || minimum + step <= minimum) return 5;
        // GUI Button24Click includes the minimum and advances by repeated addition.
        for (double energy = minimum; energy <= maximum; energy += step) {
            if (data.eng.size() >= 1000002 || energy + step <= energy) return 5;
            data.eng.push_back(energy);
            data.qz.push_back(fixed_angle
                ? 2.0 * Variablen::EnergyTok0(energy) * std::sin(state->engscanangle / 180.0 * M_PI)
                : state->engscanqz);
        }
    } else {
        if (state->numberofpoints <= 0 || state->numberofpoints > 1000000) return 5;
        for (int index = 1; index <= state->numberofpoints; ++index)
            data.qz.push_back(LinInterpolation(0, index, state->numberofpoints, state->qzmin, state->qzmax));
    }
    data.polarization = state->polarization;
    data.energy = state->Var.LambdaToEnergy();
    // GUI Button3Click initializes calculated columns even for a copied dataset.
    data.R.assign(data.qz.size(), 1.0);
    data.Rp.assign(data.qz.size(), 1.0);
    if (asymmetry) {
        data.Rm.assign(data.qz.size(), 1.0);
        data.A.assign(data.qz.size(), energy_scan ? 0.0 : 1.0);
    }
    const int status = energy_scan
        ? (asymmetry ? CalcDicEScan<double>(data, *state) : CalcEScanEnergyResolution<double>(data, *state))
        : (asymmetry ? CalcAsymmetrie<double>(data, *state) : CalcReflectivity<double>(data, *state));
    if (script_failed) return 10;
    if (status != RX_SUCCESS) return 7;
    // Diagnostic metadata only: do not index mismatched columns or publish a curve.
    // This mode intentionally bypasses the ordinary curve-shape rejection below.
    if (column_layout) {
        const int written = fprintf(output,
            "{\"acceptancePassed\":false,\"qz\":%zu,\"energy\":%zu,"
            "\"reflectivity\":%zu,\"plus\":%zu,\"minus\":%zu,\"asymmetry\":%zu}\n",
            data.qz.size(), data.eng.size(), data.R.size(), data.Rp.size(), data.Rm.size(), data.A.size());
        if (written < 0) return 9;
        return fclose(output) == 0 ? 0 : 9;
    }
    if (asymmetry && (data.Rp.size() != data.qz.size() ||
        data.Rm.size() != data.qz.size() || data.A.size() != data.qz.size())) return 8;
    if (data.R.size() != data.qz.size()) return 8;
    std::ostringstream buffer;
    buffer << std::setprecision(17) << "[";
    for (int index = 0; index < data.qz.size(); ++index) {
        if (!std::isfinite(data.qz[index]) || !std::isfinite(data.R[index])) return 8;
        if (index) buffer << ",";
        const double coordinate = energy_scan ? data.eng[index] : data.qz[index];
        if (!std::isfinite(coordinate)) return 8;
        buffer << "[" << coordinate;
        if (asymmetry) {
            if (!std::isfinite(data.Rp[index]) || !std::isfinite(data.Rm[index]) ||
                !std::isfinite(data.A[index])) return 8;
            buffer << "," << data.Rp[index] << "," << data.Rm[index] << "," << data.A[index];
        } else buffer << "," << data.R[index];
        buffer << "]";
    }
    buffer << "]\n";
    const auto result = buffer.str();
    if (fwrite(result.data(), 1, result.size(), output) != result.size()) return 9;
    return fclose(output) == 0 ? 0 : 9;
}
