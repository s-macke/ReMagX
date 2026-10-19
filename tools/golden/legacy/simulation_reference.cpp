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
int main(int argc, char** argv) {
    if (argc != 2 && argc != 3) return 2;
    const bool asymmetry = argc == 3;
    if (asymmetry && std::strcmp(argv[2], "--asymmetry") != 0) return 2;
    FILE* output = fdopen(dup(STDOUT_FILENO), "w");
    if (!output) return 3;
    if (!freopen("/dev/null", "w", stdout) || !freopen("/dev/null", "w", stderr)) return 3;
    // Process ownership avoids unrelated destruction paths in the original code.
    auto* state = new CStateHandler;
    if (!state->LoadState(argv[1])) return 4;
    if (state->ocautomatic && (!Getdblist(*state) || !Filldb(*state))) return 6;
    CDataSet data;
    // Unit1.cpp Button3Click copies the selected dataset and adapts it once.
    // The terminal front end adds qzshift a second time; do not reproduce that
    // different entry path when validating the web application's GUI behavior.
    if (state->usemeasurementqz) {
        if (state->activedatasetindex < 0 || state->activedatasetindex >= state->datasets.size()) return 5;
        data = state->datasets[state->activedatasetindex];
        if (data.qz.empty() || data.qz.size() > 1000000) return 5;
        data.Adapt(data.qzshift, data.energyshift, data.multiplicator, data.translation);
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
        data.A.assign(data.qz.size(), 1.0);
    }
    const int status = asymmetry ? CalcAsymmetrie<double>(data, *state)
                                 : CalcReflectivity<double>(data, *state);
    if (status != RX_SUCCESS) return 7;
    if (asymmetry && (data.Rp.size() != data.qz.size() ||
        data.Rm.size() != data.qz.size() || data.A.size() != data.qz.size())) return 8;
    if (data.R.size() != data.qz.size()) return 8;
    std::ostringstream buffer;
    buffer << std::setprecision(17) << "[";
    for (int index = 0; index < data.qz.size(); ++index) {
        if (!std::isfinite(data.qz[index]) || !std::isfinite(data.R[index])) return 8;
        if (index) buffer << ",";
        buffer << "[" << data.qz[index];
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
