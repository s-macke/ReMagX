#include "remagx/core.h"
int main(void) {
    const RemagxLayer layers[2] = {{0}, {0}};
    const RemagxParrattPoint point = {0.1, 1.0, 0.0};
    const RemagxBeam beam = {1.0, 0.0, 0.0, 0.0};
    double result = -1.0;
    int status = remagx_parratt(layers, 2, &point, 1, &beam, REMAGX_ISOTROPIC, REMAGX_BOTH, &result);
    if (status != REMAGX_SUCCESS || result != 0.0) return 1;
    const double qz = 0.01;
    RemagxReflectivity scan_result = {-1.0, -1.0};
    status = remagx_parratt_qz(layers, 2, &qz, 1, 640.0, &beam, &beam,
        REMAGX_ISOTROPIC, REMAGX_BOTH, 0, REMAGX_DICHROIC, &scan_result);
    if (status != REMAGX_SUCCESS || scan_result.beam1 != 0.0 || scan_result.beam2 != 0.0) return 1;
    status = remagx_parratt_qz_resolution(layers, 2, &qz, 1, 640.0, &beam, &beam,
        REMAGX_ISOTROPIC, REMAGX_BOTH, 0, REMAGX_DICHROIC, .002, 0, &scan_result);
    if (status != REMAGX_SUCCESS || scan_result.beam1 != 0.0 || scan_result.beam2 != 0.0) return 1;
    const double energy = 640.0;
    status = remagx_parratt_energy_scan(layers, 2, &energy, &qz, 0, 1, &beam, &beam,
        REMAGX_ISOTROPIC, REMAGX_BOTH, 0, REMAGX_DICHROIC, .002, .4, &scan_result);
    if (status != REMAGX_SUCCESS || scan_result.beam1 != 0.0 || scan_result.beam2 != 0.0) return 1;
    const double energies[2] = {1.0, 2.0}, values[2] = {2.0, 4.0}, query = 1.5;
    size_t cursor = 0;
    status = remagx_table_lookup(energies, values, 2, 1, &query, 1, &cursor, &result);
    return status != REMAGX_SUCCESS || result != 3.0 || cursor != 1;
}
