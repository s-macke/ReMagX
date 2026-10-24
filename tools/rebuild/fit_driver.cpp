// Boundary adapter for the unmodified private simulation implementation.
// Legacy identifiers occur only at this traceability boundary.
#include <cmath>
#include <cstring>
#include <cstdio>
#include <iomanip>
#include <sstream>
#include <fstream>
#include "remagx/optimizer.h"
#include <csignal>
#include <limits>
#include <stdexcept>
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


#include "CFit.h"
#include "dllbinding.h"
static bool calculation_failed = false;
static int record(int status, const CDataSet* data) {
    if (status != RX_SUCCESS) calculation_failed = true;
    const CVector<double>* columns[] = {&data->qz, &data->eng, &data->R, &data->Rp, &data->Rm, &data->A};
    for (const auto* values : columns) for (int i = 0; i < values->size(); ++i)
        if (!std::isfinite((*values)[i])) calculation_failed = true;
    return status;
}
extern "C" int CalcReflectivityDLL(CDataSet* data, CStateHandler* state) { return record(CalcReflectivity<double>(*data, *state), data); }
extern "C" int CalcAsymmetryDLL(CDataSet* data, CStateHandler* state) { return record(CalcAsymmetrie<double>(*data, *state), data); }
extern "C" int CalcEScanDLL(CDataSet* data, CStateHandler* state) { return record(CalcEScan<double>(*data, *state), data); }
extern "C" int CalcDicEScanDLL(CDataSet* data, CStateHandler* state) { return record(CalcDicEScan<double>(*data, *state), data); }
extern "C" int CalcEScanParallelDLL(CDataSet* data, CStateHandler* state) { return CalcEScanDLL(data, state); }
// The driver reports fit values only. It is not the D-35 project-file exporter.
static volatile std::sig_atomic_t interrupted = 0;
static void interrupt_fit(int) { interrupted = 1; }

struct FitContext {
    CMultiFit& fit;
    CVector<TFitVariable> saved;
    std::vector<double> origins, scales, best_values, best_reference;
    std::vector<int> axes;
    size_t reference_refreshes = 0;
    double best_error = std::numeric_limits<double>::infinity();

    explicit FitContext(CMultiFit& objective) : fit(objective), saved(objective.vars) {
        for (int index = 0; index < saved.size(); ++index) {
            const auto& parameter = saved[index];
            if (!std::isfinite(parameter.var) || !std::isfinite(parameter.lb) ||
                !std::isfinite(parameter.ub) || parameter.lb > parameter.ub)
                throw std::runtime_error("Invalid fit bounds");
            double origin = parameter.var;
            if (origin < parameter.lb) origin = parameter.lb;
            if (origin > parameter.ub) origin = parameter.ub;
            origins.push_back(origin);
            if (parameter.lb == parameter.ub) continue;
            double other = std::min(parameter.ub, origin + parameter.delta);
            if (other == origin) other = std::max(parameter.lb, origin - parameter.delta);
            if (other == origin) other = origin != parameter.ub ? parameter.ub : parameter.lb;
            const double scale = other - origin;
            if (!std::isfinite(scale) || scale == 0.0) throw std::runtime_error("Invalid fit scale");
            axes.push_back(index);
            scales.push_back(scale);
        }
    }
    std::vector<double> decode(const double* coordinates, size_t count) const {
        if (count != axes.size()) throw std::runtime_error("Wrong fit dimension");
        auto values = origins;
        for (size_t index = 0; index < count; ++index) {
            const double coordinate = coordinates[index];
            if (!std::isfinite(coordinate)) throw std::runtime_error("Nonfinite coordinate");
            values[axes[index]] = coordinate == 0.0 ? origins[axes[index]]
                : origins[axes[index]] + coordinate * scales[index];
            if (!std::isfinite(values[axes[index]])) throw std::runtime_error("Fit coordinate overflow");
        }
        return values;
    }
    double evaluate(std::vector<double> values, bool reference_refresh = false) {
        auto candidate = saved;
        for (int index = 0; index < saved.size(); ++index) {
            if (values[index] < saved[index].lb) values[index] = saved[index].lb;
            if (values[index] > saved[index].ub) values[index] = saved[index].ub;
            candidate[index].var = values[index];
            if (reference_refresh) fit.activevars[index] = values[index];
        }
        if (reference_refresh) ++reference_refreshes;
        const double error = fit.Error(candidate);
        if (script_failed || calculation_failed || !std::isfinite(error))
            throw std::runtime_error("Original objective failed");
        if (!reference_refresh && error < best_error) {
            best_error = error;
            best_values = values;
            best_reference.clear();
            for (int index = 0; index < fit.activevars.size(); ++index)
                best_reference.push_back(fit.activevars[index]);
        }
        return error;
    }
};

static int evaluate_candidate(const double* coordinates, size_t count, void* pointer, double* value) {
    try {
        auto& context = *static_cast<FitContext*>(pointer);
        *value = context.evaluate(context.decode(coordinates, count));
        return 0;
    } catch (...) { return 1; }
}
static int update_reference(const double* coordinates, size_t count, int phase,
                            size_t, size_t, void* pointer) {
    try {
        auto& context = *static_cast<FitContext*>(pointer);
        if (phase == REMAGX_REFERENCE_SELECTED) {
            const auto values = context.decode(coordinates, count);
            for (int index = 0; index < context.fit.activevars.size(); ++index)
                context.fit.activevars[index] = values[index];
        } else if (!interrupted) {
            std::vector<double> values;
            for (int index = 0; index < context.fit.activevars.size(); ++index)
                values.push_back(context.fit.activevars[index]);
            context.evaluate(values, true);
        }
        return 0;
    } catch (...) { return 1; }
}
static int should_stop(void*) { return interrupted ? 1 : 0; }

int main(int argc, char** argv) {
    if (argc != 4 && argc != 5) {
        std::fprintf(stderr, "usage: fit-integration project.all max-evaluations max-iterations [Q]\n");
        return 2;
    }
    // Original loader/Lua diagnostics can contain research paths or input lines.
    // Emit only the explicit JSON result on success and a bounded status on error.
    FILE* output = fdopen(dup(STDOUT_FILENO), "w");
    if (!output || !freopen("/dev/null", "w", stdout) || !freopen("/dev/null", "w", stderr)) return 3;
    try {
        const auto limit = [](const char* text) -> size_t {
            size_t consumed = 0;
            const std::string value(text);
            if (value.empty() || value.find_first_not_of("0123456789") != std::string::npos)
                throw std::runtime_error("Invalid limit");
            const auto result = std::stoull(value, &consumed);
            if (consumed != value.size() || result == 0 || result > 1000000)
                throw std::runtime_error("Invalid limit");
            return static_cast<size_t>(result);
        };
        const RemagxSimplexOptions options{limit(argv[2]), limit(argv[3]), 1e-9, 1e-14};
        std::signal(SIGINT, interrupt_fit);
        erffinit();
        CStateHandler state;
        if (!state.LoadState(argv[1])) return 4;
        if (argc == 5) {
            size_t consumed = 0;
            const std::string weight(argv[4]);
            state.Qerror = std::stod(weight, &consumed);
            if (consumed != weight.size() || !std::isfinite(state.Qerror)) return 6;
        }
        if (state.fitalgorithm != 0 && state.fitalgorithm != 2) return 5;
        if (state.fitvariables.empty() || !std::isfinite(state.Qerror)) return 6;
        if (state.fitalgorithm == 2 && (!std::isfinite(state.temp) || state.temp < 0.0 ||
                                       !std::isfinite(state.dtemp))) return 6;
        bool energy = false;
        int active = 0;
        for (int index = 0; index < state.datasets.size(); ++index) if (state.datasets[index].active) {
            ++active;
            if (state.datasets[index].qz.empty()) return 6;
            energy = energy || !state.datasets[index].eng.empty();
        }
        if (!active) return 6;
        for (int index = 0; index < state.fitvariables.size(); ++index)
            if (state.fitvariables[index].id == BETALIST) return 5;
        state.parallelization = false;
        if (state.ocautomatic) { Getdblist(state); Filldb(state); }
        else FillTensors(state);
        if ((state.ocautomatic || energy) && (!Getdblist(state) || !Filldb(state))) return 7;
        CMultiFit fit(state);
        if (script_failed) return 8;
        FitContext context(fit);
        const size_t dimension = context.axes.size();
        // Bound quadratic simplex storage before allocating it.
        if (dimension > 10000 || options.max_evaluations < dimension + 1) return 6;
        std::vector<double> simplex((dimension + 1) * dimension, 0.0), best(dimension);
        for (size_t index = 0; index < dimension; ++index) simplex[(index + 1) * dimension + index] = 1.0;
        RemagxFitSummary summary{};
        int status = REMAGX_SUCCESS;
        if (!dimension) {
            if (interrupted) return 9;
            summary.value = context.evaluate(context.origins);
            summary.has_best = 1;
            summary.evaluations = 1;
        } else if (state.fitalgorithm == 2) {
            const RemagxAnnealingOptions settings{options, state.temp, state.dtemp,
                                                 static_cast<uint32_t>(state.evo.random)};
            status = remagx_simplex_annealing(simplex.data(), dimension, &settings, evaluate_candidate,
                should_stop, nullptr, &context, best.data(), &summary);
        } else {
            status = remagx_nelder_mead_adaptive(simplex.data(), dimension, &options, evaluate_candidate,
                should_stop, nullptr, state.Qerror != 0.0 ? update_reference : nullptr,
                &context, best.data(), &summary);
        }
        if (status != REMAGX_SUCCESS || !summary.has_best || summary.value != context.best_error) return 10;
        std::ostringstream json;
        json << std::setprecision(17) << "{\"iterations\":" << summary.iterations
             << ",\"evaluations\":" << summary.evaluations << ",\"termination\":" << summary.termination
             << ",\"algorithm\":" << state.fitalgorithm << ",\"seed\":" << static_cast<uint32_t>(state.evo.random)
             << ",\"referenceRefreshes\":" << context.reference_refreshes
             << ",\"error\":" << summary.value << ",\"values\":[";
        for (size_t index = 0; index < context.best_values.size(); ++index) {
            if (index) json << ',';
            json << context.best_values[index];
        }
        json << "],\"regularizationReference\":[";
        for (size_t index = 0; index < context.best_reference.size(); ++index) {
            if (index) json << ',';
            json << context.best_reference[index];
        }
        json << "]}\n";
        const auto text = json.str();
        if (fwrite(text.data(), 1, text.size(), output) != text.size()) return 11;
        return fclose(output) == 0 ? 0 : 11;
    } catch (...) { return 12; }
}
