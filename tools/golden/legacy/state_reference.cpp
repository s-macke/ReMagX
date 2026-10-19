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
        const auto tensorJson = [&](const CMATRIX<double>& tensor) {
            json << '[';
            for (int row = 0; row < 3; ++row) for (int column = 0; column < 3; ++column) {
                if (row || column) json << ',';
                number(tensor.a[row][column].real()); json << ',';
                number(tensor.a[row][column].imag());
            }
            json << ']';
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
        json << "],\"dielectricTensors\":[";
        const auto* film = state->GetActiveFilm();
        for (int index = 0; index < film->mfs.size(); ++index) {
            if (index) json << ',';
            json << "{\"anisotropic\":" << (film->mfs[index].oc.epsilontype != ISOTROPIC ? "true" : "false") << ",\"values\":";
            tensorJson(film->mfs[index].oc.epsilon);
            json << '}';
        }
        json << "],\"elements\":[";
        for (int index = 0; index < film->el.size(); ++index) {
            if (index) json << ',';
            const auto& element = film->el[index];
            json << "{\"factors\":[";
            number(element.f1); json << ','; number(element.f2); json << ',';
            number(element.f1m); json << ','; number(element.f2m);
            json << "],\"tensor\":"; tensorJson(element.F);
            json << ",\"slabs\":[";
            for (int slab = 0; slab < element.mfs.size(); ++slab) {
                if (slab) json << ',';
                json << '[';
                number(element.mfs[slab].d); json << ',';
                number(element.mfs[slab].density); json << ',';
                number(element.mfs[slab].sigma); json << ']';
            }
            json << "]}";
        }
        json << "],\"datasetCount\":" << state->datasets.size() << ",\"datasets\":[";
        for (int index = 0; index < state->datasets.size(); ++index) {
            if (index) json << ',';
            const auto& data = state->datasets[index];
            const auto& beam = data.polarization;
            const double settings[] = {data.energy, data.energyshift, data.resolution,
                data.multiplicator, data.translation, data.qzshift, data.errorweight,
                double(data.active != 0)};
            const double polarization[] = {beam.ray1sigmare, beam.ray1sigmaim, beam.ray1pire, beam.ray1piim,
                beam.ray2sigmare, beam.ray2sigmaim, beam.ray2pire, beam.ray2piim};
            json << "{\"settings\":[";
            for (int column = 0; column < 8; ++column) {
                if (column) json << ',';
                number(settings[column]);
            }
            json << "],\"polarization\":[";
            for (int column = 0; column < 8; ++column) {
                if (column) json << ',';
                number(polarization[column]);
            }
            json << "],\"columns\":[";
            const CVector<double>* columns[] = {&data.qz, &data.R, &data.Rp, &data.Rm, &data.A, &data.eng, &data.tey};
            for (int column = 0; column < 7; ++column) {
                if (column) json << ',';
                json << '[';
                for (int point = 0; point < columns[column]->size(); ++point) {
                    if (point) json << ',';
                    number((*columns[column])[point]);
                }
                json << ']';
            }
            json << "]}";
        }
        json << "]}";
        if (fputs(json.str().c_str(), output) < 0 || fclose(output)) return 5;
        return 0;
    } catch (...) { return 6; }
}
