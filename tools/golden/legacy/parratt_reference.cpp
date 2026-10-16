// Adapter to the private 2.6 header, not a copy of its implementation.
// Legacy identifiers below are import mappings only (D-34).
#include <cmath>
#include <cstdio>
#include <iostream>
#include <limits>
#include <pthread.h>

// Mapping from shared/CStateHandler.h; avoid importing the full application state.
constexpr int TENSORTETRAGONAL = 1;
#include "simul/CParratt.h"

// Runtime symbols required by the legacy CVector import.
int memorycounterequal = 0;
int memorycounterassign = 0;
int memorycounterreserve = 0;
pthread_mutex_t vectorcountermutex = PTHREAD_MUTEX_INITIALIZER;

static bool read_number(double& value) {
    return static_cast<bool>(std::cin >> value) && std::isfinite(value);
}

int main() {
    static_assert(std::numeric_limits<double>::is_iec559 && sizeof(double) == 8);
    int layer_count = 0, point_count = 0, tensor_type = 0, analyzer = 0;
    if (!(std::cin >> layer_count >> point_count >> tensor_type >> analyzer) ||
        layer_count < 2 || layer_count > 100000 || point_count < 1 || point_count > 10000000 ||
        tensor_type < 0 || tensor_type > 1 || analyzer < 0 || analyzer > 2) return 2;
    CPolarization polarization;
    if (!read_number(polarization.ray1sigmare) || !read_number(polarization.ray1sigmaim) ||
        !read_number(polarization.ray1pire) || !read_number(polarization.ray1piim)) return 2;
    CVector<Schicht<double>> layers;
    for (int index = 0; index < layer_count; ++index) {
        Schicht<double> layer;
        if (!read_number(layer.d) || !read_number(layer.sigma) ||
            !read_number(layer.oc.delta) || !read_number(layer.oc.beta) ||
            !read_number(layer.oc.deltam) || !read_number(layer.oc.betam) ||
            !read_number(layer.maggamma) || !read_number(layer.magphi) ||
            layer.d < 0 || layer.sigma < 0) return 2;
        layers.push_back(layer);
    }
    CParratt<double> calculation(layers, tensor_type);
    for (int index = 0; index < point_count; ++index) {
        double angle = 0, wave_number = 0, magnetization = 0;
        if (!read_number(angle) || !read_number(wave_number) || !read_number(magnetization) ||
            wave_number <= 0) return 2;
        const double intensity = calculation.BerechneIntensitaet(angle, wave_number, magnetization, polarization, 1, analyzer);
        if (!std::isfinite(intensity)) return 3;
        std::printf("%.17g\n", intensity);
    }
    std::cin >> std::ws;
    return std::cin.eof() ? 0 : 2;
}
