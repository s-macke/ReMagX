// Boundary adapter for the unmodified private spectrum/table/Lua implementation.
// Legacy identifiers occur only at this traceability boundary.
#include <cmath>
#include <cstdlib>
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

// GUI spectrum handlers in Unit1.cpp: GetState, SetOCStrict(false), local
// CScript construction, then Filldb/StartScript per selected table energy.
int main(int argc, char** argv) {
    if (argc != 5) return 2;
    const bool factors = std::strcmp(argv[2], "factors") == 0;
    const bool magnetic = std::strcmp(argv[2], "magnetic") == 0;
    if (!factors && !magnetic && std::strcmp(argv[2], "optical") != 0) return 2;
    char* end = nullptr;
    const long layer_index = std::strtol(argv[3], &end, 10);
    if (!*argv[3] || *end || layer_index < 0 || layer_index > 1000000) return 2;
    const long element_index = std::strtol(argv[4], &end, 10);
    if (!*argv[4] || *end || element_index < 0 || element_index > 1000000) return 2;
    FILE* output = fdopen(dup(STDOUT_FILENO), "w");
    if (!output || !freopen("/dev/null", "w", stdout) || !freopen("/dev/null", "w", stderr)) return 3;
    erffinit();
    auto* state = new CStateHandler;
    if (!state->LoadState(argv[1])) return 4;
    auto* film = state->GetActiveFilm();
    const bool element_mode = film->mode == ELEMENT;
    if ((factors && !element_mode) || (magnetic && element_mode)) return 5;
    if (element_mode) {
        if (element_index >= film->el.size()) return 5;
        state->elindex = element_index;
        if (!factors) for (int index = 0; index < film->el.size(); ++index)
            if (layer_index >= film->el[index].mfs.size()) return 5;
    } else if (layer_index >= film->mfs.size()) return 5;
    // Populate the same current table cache that the GUI passes to GetState.
    // Partial lookup failure is intentionally not promoted to a strict error.
    Getdblist(*state);
    if (state->ocautomatic) Filldb(*state); else FillTensors(*state);
    Getdblist(*state); // SetOCStrict(false) loads but does not refresh constants.
    const int table_index = Findoc(element_mode ? film->el[element_index].element : film->mfs[layer_index].dbname,
        state->dblist, element_mode ? ELEMENT : MATERIAL);
    if (table_index < 0) return 6;
    const CTable table = element_mode ? state->dblist[table_index].fftable
        : magnetic ? state->dblist[table_index].mtable : state->dblist[table_index].dbtable;
    if (table.entry.empty()) return 6;
    CScript script(*state, BEFORECALCULATION, NULL, NULL);
    if (script_failed) return 7;
    std::ostringstream buffer;
    buffer << std::setprecision(17) << "[";
    bool first = true;
    for (unsigned index = 0; index < table.entry.size(); ++index) {
        const double energy = table.entry[index].x;
        if (factors && energy == 0.0) continue;
        if (!std::isfinite(energy) || energy <= 0.0) return 8;
        state->Var.lambda = state->Var.EnergyToLambda(energy);
        Filldb(*state);
        script.StartScript(NULL, NULL);
        if (script_failed) return 7;
        double first_value = 0.0, second_value = 0.0;
        if (factors) {
            first_value = film->el[element_index].f1;
            second_value = film->el[element_index].f2;
        } else if (element_mode) {
            for (int element = 0; element < film->el.size(); ++element) {
                const double density = film->el[element].mfs[layer_index].density;
                first_value += film->el[element].f1 * density / energy / energy * .0004151761541 * 1e6;
                second_value += film->el[element].f2 * density / energy / energy * .0004151761541 * 1e6;
            }
        } else {
            first_value = magnetic ? film->mfs[layer_index].oc.deltam : film->mfs[layer_index].oc.delta;
            second_value = magnetic ? film->mfs[layer_index].oc.betam : film->mfs[layer_index].oc.beta;
        }
        if (!std::isfinite(first_value) || !std::isfinite(second_value)) return 8;
        if (!first) buffer << ",";
        first = false;
        buffer << "[" << energy << "," << first_value << "," << second_value << "]";
    }
    if (first) return 8;
    buffer << "]\n";
    const auto result = buffer.str();
    if (fwrite(result.data(), 1, result.size(), output) != result.size()) return 9;
    return fclose(output) == 0 ? 0 : 9;
}
