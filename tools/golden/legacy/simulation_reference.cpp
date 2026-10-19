// Boundary adapter for the unmodified private simulation implementation.
// Legacy identifiers occur only at this traceability boundary.
#include <cmath>
#include <cstdio>
#include <iomanip>
#include <sstream>
#include <unistd.h>
#include <pthread.h>
#include "CStateHandler.h"
#include "RechenHilfe.h"
int memorycounterequal = 0, memorycounterassign = 0, memorycounterreserve = 0;
pthread_mutex_t vectorcountermutex = PTHREAD_MUTEX_INITIALIZER;
int main(int argc, char** argv) {
    if (argc != 2) return 2;
    FILE* output = fdopen(dup(STDOUT_FILENO), "w");
    if (!output) return 3;
    if (!freopen("/dev/null", "w", stdout) || !freopen("/dev/null", "w", stderr)) return 3;
    // Process ownership avoids unrelated destruction paths in the original code.
    auto* state = new CStateHandler;
    if (!state->LoadState(argv[1])) return 4;
    if (state->numberofpoints <= 0 || state->numberofpoints > 1000000) return 5;
    if (state->ocautomatic && (!Getdblist(*state) || !Filldb(*state))) return 6;
    CDataSet data;
    for (int index = 1; index <= state->numberofpoints; ++index)
        data.qz.push_back(LinInterpolation(0, index, state->numberofpoints, state->qzmin, state->qzmax));
    data.polarization = state->polarization;
    data.energy = state->Var.LambdaToEnergy();
    if (CalcReflectivity<double>(data, *state) != RX_SUCCESS) return 7;
    if (data.R.size() != data.qz.size()) return 8;
    std::ostringstream buffer;
    buffer << std::setprecision(17) << "[";
    for (int index = 0; index < data.qz.size(); ++index) {
        if (!std::isfinite(data.qz[index]) || !std::isfinite(data.R[index])) return 8;
        if (index) buffer << ",";
        buffer << "[" << data.qz[index] << "," << data.R[index] << "]";
    }
    buffer << "]\n";
    const auto result = buffer.str();
    if (fwrite(result.data(), 1, result.size(), output) != result.size()) return 9;
    return fclose(output) == 0 ? 0 : 9;
}
