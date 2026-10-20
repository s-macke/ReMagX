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
    if (argc < 2 || argc > 8) return 2;
    bool asymmetry = false, energy_scan = false, fixed_angle = false;
    bool fourier = false, multiply = false, divide = false;
    for (int index = 2; index < argc; ++index) {
        if (std::strcmp(argv[index], "--asymmetry") == 0 && !asymmetry) asymmetry = true;
        else if (std::strcmp(argv[index], "--energy") == 0 && !energy_scan) energy_scan = true;
        else if (std::strcmp(argv[index], "--angle") == 0 && !fixed_angle) fixed_angle = true;
        else if (std::strcmp(argv[index], "--fourier") == 0 && !fourier) fourier = true;
        else if (std::strcmp(argv[index], "--multiply-qz4") == 0 && !multiply) multiply = true;
        else if (std::strcmp(argv[index], "--divide-pi") == 0 && !divide) divide = true;
        else return 2;
    }
    if (fixed_angle && !energy_scan) return 2;
    if (fourier && (energy_scan || asymmetry)) return 2;
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
