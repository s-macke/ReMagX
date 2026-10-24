// Import boundary for the unchanged private CMultiFit objective. These member
// names are the legacy ABI, not names used by the new optimizer implementation.
// No legacy search method is provided: link the remagx optimizer C API instead.
#include "CChiSquareFit.h"
#include <cmath>

CChiSquareFit::CChiSquareFit(const CVector<TFitVariable> parameters,
                           const unsigned long seed)
    : tempptr(0.0), dtempptr(0.0), lasterror(0.0), vars(parameters),
      firstsimplex(true), eb(0.0), besterror(0.0), irand(seed), drand(seed) {
    for (int index = 0; index < vars.size(); ++index) {
        // Initialization metadata shared with model/realFitSimplex.ts. Bounds
        // clipping belongs to evaluation; the initial Q reference stays raw.
        double step = std::abs(0.05 * vars[index].var);
        if (step <= 1e-7) step = std::abs(0.05 * vars[index].ub);
        vars[index].delta = step <= 1e-7 ? 1e-8 : step;
        activevars.push_back(vars[index].var);
    }
}
