// Synthetic integration check of the legacy metadata ABI only; no optimizer
// implementation or research input is read from the private tree.
#include "CChiSquareFit.h"
#include <cmath>
#include <stdexcept>

class ParameterStateProbe final : public CChiSquareFit {
public:
    explicit ParameterStateProbe(const CVector<TFitVariable>& parameters)
        : CChiSquareFit(parameters, 123) {}
private:
    double Error(CVector<TFitVariable>&) override { return 0.0; }
};

int main() {
    CVector<TFitVariable> parameters;
    for (int index = 0; index < 4; ++index) {
        TFitVariable parameter;
        parameter.var = index == 0 ? 40.0 : index == 1 ? -100.0 : 0.0;
        parameter.ub = index == 2 ? 10.0 : index == 3 ? 0.0 : 20.0;
        parameter.lb = -20.0;
        parameter.delta = 999.0;
        parameter.id = index;
        parameter.additional_id = index + 1;
        parameters.push_back(parameter);
    }
    ParameterStateProbe state(parameters);
    const double expected[] = {2.0, 5.0, 0.5, 1e-8};
    if (state.vars.size() != 4 || state.activevars.size() != 4 || !state.x.empty()) return 1;
    for (int index = 0; index < 4; ++index) {
        if (state.vars[index].delta != expected[index] ||
            state.activevars[index] != parameters[index].var ||
            state.vars[index].var != parameters[index].var ||
            state.vars[index].id != parameters[index].id ||
            state.vars[index].additional_id != parameters[index].additional_id ||
            parameters[index].delta != 999.0) return 2;
    }
    state.vars[0].var = 5.0;
    if (state.activevars[0] != 40.0 || parameters[0].var != 40.0) return 3;
    ParameterStateProbe empty(CVector<TFitVariable>{});
    if (!empty.vars.empty() || !empty.activevars.empty()) return 4;
    return 0;
}
