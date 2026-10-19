// Private original .all loader adapter. This emits numeric state only; it does
// not call an optimizer, generate a curve, load optical tables or execute Lua.
// Legacy member names here are boundary mappings, not new domain identifiers.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iomanip>
#include <sstream>
#include <pthread.h>
#include <unistd.h>
#include "CStateHandler.h"

int memorycounterequal = 0, memorycounterassign = 0, memorycounterreserve = 0;
pthread_mutex_t vectorcountermutex = PTHREAD_MUTEX_INITIALIZER;

int main(int argc, char** argv) {
    if (argc != 2) return 2;
    // The original reader can print private diagnostics. Only the completed
    // numeric JSON snapshot is allowed on the adapter's original stdout.
    FILE* output = fdopen(dup(STDOUT_FILENO), "w");
    if (!output || !freopen("/dev/null", "w", stdout) || !freopen("/dev/null", "w", stderr)) return 3;
    try {
        // One project per process. Deliberately process-owned: destruction of
        // legacy state pulls in Lua disposal, which this loader never uses.
        auto* state = new CStateHandler;
        if (!state->LoadState(argv[1])) return 4;
        std::ostringstream json;
        json << std::setprecision(17);
        const auto number = [&](double value) {
            if (!std::isfinite(value)) throw 1;
            json << value;
        };
        json << "{\"energy\":";
        number(state->Var.LambdaToEnergy());
        json << ",\"films\":[";
        for (int film = 0; film < state->films.size(); ++film) {
            if (film) json << ',';
            json << '[';
            const auto& layers = state->films[film].mfs;
            for (int index = 0; index < layers.size(); ++index) {
                if (index) json << ',';
                const auto& layer = layers[index];
                const double values[] = {layer.d, layer.sigma, layer.oc.delta, layer.oc.beta,
                    layer.oc.deltam, layer.oc.betam, layer.maggamma, layer.magphi};
                json << '[';
                for (int column = 0; column < 8; ++column) {
                    if (column) json << ',';
                    number(values[column]);
                }
                json << ']';
            }
            json << ']';
        }
        json << "],\"datasetCount\":" << state->datasets.size() << '}';
        if (fputs(json.str().c_str(), output) < 0 || fclose(output)) return 5;
        return 0;
    } catch (...) { return 6; }
}
