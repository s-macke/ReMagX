#include "remagx/core.h"
int main(void) {
    const RemagxLayer layers[2] = {{0}, {0}};
    const RemagxParrattPoint point = {0.1, 1.0, 0.0};
    const RemagxBeam beam = {1.0, 0.0, 0.0, 0.0};
    double result = -1.0;
    int status = remagx_parratt(layers, 2, &point, 1, &beam, REMAGX_ISOTROPIC, REMAGX_BOTH, &result);
    return status != REMAGX_SUCCESS || result != 0.0;
}
