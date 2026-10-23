// Independent implementation of the algorithm in Lagarias et al. (1998), section 2.
// https://doi.org/10.1137/S1052623496303470
// Adaptive ordinary-simplex coefficients: Gao and Han (2012), equation 4.1.
// https://doi.org/10.1007/s10589-010-9329-3
// Thermal comparisons: Cardoso, Salcedo and de Azevedo (1996), equations 9-10.
// https://doi.org/10.1016/0098-1354(95)00221-9
// No Numerical Recipes implementation was used. See optimizer.h for API policy.
#include "remagx/optimizer.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <new>
#include <random>
#include <stdexcept>
#include <utility>
#include <vector>

namespace {
struct Halt { int reason; };
struct Failure {};
struct Vertex { std::vector<double> parameters; double value = 0.0; double score = 0.0; };

class Search {
public:
    size_t dimension;
    bool adaptive;
    const RemagxSimplexOptions& options;
    RemagxObjective objective;
    RemagxShouldStop should_stop;
    RemagxFitProgress progress;
    RemagxSimplexReference reference_callback;
    void* context;
    RemagxFitSummary summary{};
    double temperature;
    double temperature_step;
    std::mt19937 random;
    Vertex best;
    std::vector<Vertex> vertices;
    std::vector<std::vector<double>> refinement_offsets;
    std::vector<Vertex> initial_refinement_vertices;

    Search(const double* initial, size_t count, const RemagxSimplexOptions& settings,
           RemagxObjective evaluate, RemagxShouldStop stop, RemagxFitProgress notify, void* user, const RemagxAnnealingOptions* annealing, RemagxSimplexReference reference, bool use_adaptive)
        : dimension(count), adaptive(use_adaptive), options(settings), objective(evaluate), should_stop(stop),
          progress(notify), reference_callback(reference), context(user), temperature(annealing ? annealing->temperature : 0.0),
          temperature_step(annealing ? annealing->temperature_step : 0.0),
          random(annealing ? annealing->seed : 0), best{std::vector<double>(count), 0.0} {
        vertices.reserve(count + 1);
        for (size_t row = 0; row <= count; ++row)
            vertices.push_back({std::vector<double>(initial + row * count, initial + (row + 1) * count), 0.0});
        if (annealing && temperature > 0.0 && temperature_step < 0.0) {
            initial_refinement_vertices = vertices;
            for (size_t row = 1; row <= count; ++row) {
                std::vector<double> offset(count);
                for (size_t column = 0; column < count; ++column)
                    offset[column] = initial[row * count + column] - initial[column];
                refinement_offsets.push_back(std::move(offset));
            }
        }
    }
    void check_stop() const {
        if (should_stop && should_stop(context)) throw Halt{REMAGX_FIT_STOPPED};
    }
    void evaluate(Vertex& vertex) {
        check_stop();
        if (summary.evaluations == options.max_evaluations) throw Halt{REMAGX_FIT_EVALUATION_LIMIT};
        for (double value : vertex.parameters) if (!std::isfinite(value)) throw Failure{};
        double value = std::numeric_limits<double>::quiet_NaN();
        ++summary.evaluations;
        if (objective(vertex.parameters.data(), dimension, context, &value) || !std::isfinite(value))
            throw Failure{};
        vertex.value = value;
        if (!summary.has_best || value < best.value) {
            best = vertex;
            summary.has_best = 1;
            summary.value = value;
        }
    }
    double thermal_score(double value, bool existing) {
        if (temperature == 0.0) return value;
        // Cardoso et al. (1996), equations 9-10; mathematical description only.
        // Existing vertices move up, replacement candidates move down.
        const double uniform = (static_cast<double>(random()) + 0.5) / 4294967296.0;
        const double fluctuation = -temperature * std::log(uniform);
        const double score = existing ? value + fluctuation : value - fluctuation;
        if (!std::isfinite(score)) throw Failure{};
        return score;
    }
    void start_cold_refinement(const std::vector<double>& origin) {
        // A thermal simplex may collapse on a clipped-parameter plateau. Refine
        // the best true candidate using the original simplex edge displacements.
        // This uses the same objective, Stop callback and remaining work budget.
        const auto center = origin;
        for (size_t row = 0; row <= dimension; ++row) {
            vertices[row].parameters = center;
            if (row) for (size_t column = 0; column < dimension; ++column)
                vertices[row].parameters[column] += refinement_offsets[row - 1][column];
            evaluate(vertices[row]);
        }
    }
    void notify() const {
        if (progress) progress(best.parameters.data(), dimension, best.value,
                               summary.iterations, summary.evaluations, context);
    }
    bool converged() const {
        const auto& first = vertices.front();
        for (const auto& vertex : vertices) {
            if (std::abs(vertex.value - first.value) > options.objective_tolerance) return false;
            for (size_t column = 0; column < dimension; ++column)
                if (std::abs(vertex.parameters[column] - first.parameters[column]) > options.parameter_tolerance)
                    return false;
        }
        return true;
    }
    int run() {
        const double count = static_cast<double>(dimension);
        const double expansion = adaptive && dimension >= 2 ? 1.0 + 2.0 / count : 2.0;
        const double contraction = adaptive && dimension >= 2 ? 0.75 - 0.5 / count : 0.5;
        const double shrink_factor = adaptive && dimension >= 2 ? 1.0 - 1.0 / count : 0.5;
        for (auto& vertex : vertices) evaluate(vertex);
        notify();
        for (;;) {
            check_stop();
            for (auto& vertex : vertices) vertex.score = thermal_score(vertex.value, true);
            std::stable_sort(vertices.begin(), vertices.end(), [](const Vertex& left, const Vertex& right) {
                return left.score < right.score;
            });
            if (temperature == 0.0 && converged()) {
                if (initial_refinement_vertices.empty()) return REMAGX_FIT_CONVERGED;
                if (summary.iterations == options.max_iterations) return REMAGX_FIT_ITERATION_LIMIT;
                // The thermal winner may belong to a worse local basin. Also
                // refine the supplied start, retaining the best from both paths.
                // Counters, Stop and the objective context are never reset.
                vertices = std::move(initial_refinement_vertices);
                initial_refinement_vertices.clear();
                for (auto& vertex : vertices) evaluate(vertex);
                continue;
            }
            if (summary.iterations == options.max_iterations) return REMAGX_FIT_ITERATION_LIMIT;
            std::vector<double> reference;
            if (reference_callback) {
                if (summary.evaluations == options.max_evaluations) throw Halt{REMAGX_FIT_EVALUATION_LIMIT};
                reference = vertices.front().parameters;
                if (reference_callback(reference.data(), dimension, REMAGX_REFERENCE_SELECTED,
                        summary.iterations, summary.evaluations, context)) throw Failure{};
            }
            std::vector<double> centroid(dimension, 0.0);
            for (size_t row = 0; row < dimension; ++row)
                for (size_t column = 0; column < dimension; ++column)
                    centroid[column] += vertices[row].parameters[column] / static_cast<double>(dimension);
            // A signed distance from the centroid towards the old worst vertex.
            auto trial = [&](double distance) {
                Vertex vertex{std::vector<double>(dimension), 0.0};
                for (size_t column = 0; column < dimension; ++column)
                    vertex.parameters[column] = centroid[column] + distance *
                        (vertices.back().parameters[column] - centroid[column]);
                evaluate(vertex);
                vertex.score = thermal_score(vertex.value, false);
                return vertex;
            };
            Vertex reflected = trial(-1.0);
            bool shrink = false;
            if (reflected.score < vertices.front().score) {
                Vertex expanded = trial(-expansion);
                vertices.back() = expanded.score < reflected.score ? std::move(expanded) : std::move(reflected);
            } else if (reflected.score < vertices[dimension - 1].score) {
                vertices.back() = std::move(reflected);
            } else if (reflected.score < vertices.back().score) {
                Vertex contracted = trial(-contraction);
                if (contracted.score <= reflected.score) vertices.back() = std::move(contracted);
                else shrink = true;
            } else {
                Vertex contracted = trial(contraction);
                if (contracted.score < vertices.back().score) vertices.back() = std::move(contracted);
                else shrink = true;
            }
            if (shrink) {
                for (size_t row = 1; row <= dimension; ++row) {
                    for (size_t column = 0; column < dimension; ++column)
                        vertices[row].parameters[column] = (1.0 - shrink_factor) * vertices.front().parameters[column] +
                            shrink_factor * vertices[row].parameters[column];
                    evaluate(vertices[row]);
                }
            }
            ++summary.iterations;
            if (reference_callback && reference_callback(reference.data(), dimension, REMAGX_REFERENCE_COMPLETED,
                    summary.iterations, summary.evaluations, context)) throw Failure{};
            notify();
            const double previous_temperature = temperature;
            temperature = std::max(0.0, temperature + temperature_step);
            if (!std::isfinite(temperature)) throw Failure{};
            if (previous_temperature > 0.0 && temperature == 0.0 &&
                summary.iterations < options.max_iterations) start_cold_refinement(best.parameters);
        }
    }
};
}

static int run_optimizer(const double* initial, size_t dimension,
    const RemagxSimplexOptions* options, RemagxObjective objective, RemagxShouldStop should_stop,
    RemagxFitProgress progress, void* context, double* output, RemagxFitSummary* summary,
    const RemagxAnnealingOptions* annealing, RemagxSimplexReference reference = nullptr, bool adaptive = false) {
    if (!initial || !dimension || !options || !objective || !output || !summary ||
        !options->max_iterations || !std::isfinite(options->parameter_tolerance) ||
        !std::isfinite(options->objective_tolerance) || options->parameter_tolerance < 0.0 ||
        options->objective_tolerance < 0.0) return REMAGX_INVALID_ARGUMENT;
    const size_t maximum = std::numeric_limits<size_t>::max();
    if (dimension == maximum || dimension > maximum / sizeof(double) / (dimension + 1))
        return REMAGX_ALLOCATION_ERROR;
    if (options->max_evaluations < dimension + 1) return REMAGX_INVALID_ARGUMENT;
    for (size_t index = 0; index < dimension * (dimension + 1); ++index)
        if (!std::isfinite(initial[index])) return REMAGX_INVALID_ARGUMENT;
    try {
        Search search(initial, dimension, *options, objective, should_stop, progress, context, annealing, reference, adaptive);
        try { search.summary.termination = search.run(); }
        catch (const Halt& halt) { search.summary.termination = halt.reason; }
        if (search.summary.has_best) std::copy(search.best.parameters.begin(), search.best.parameters.end(), output);
        *summary = search.summary;
        return REMAGX_SUCCESS;
    } catch (const Failure&) { return REMAGX_NUMERICAL_ERROR; }
      catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}

extern "C" int remagx_nelder_mead(const double* initial, size_t dimension,
    const RemagxSimplexOptions* options, RemagxObjective objective, RemagxShouldStop should_stop,
    RemagxFitProgress progress, void* context, double* output, RemagxFitSummary* summary) {
    return run_optimizer(initial, dimension, options, objective, should_stop, progress,
                         context, output, summary, nullptr);
}

extern "C" int remagx_nelder_mead_with_reference(const double* initial, size_t dimension,
    const RemagxSimplexOptions* options, RemagxObjective objective, RemagxShouldStop should_stop,
    RemagxFitProgress progress, RemagxSimplexReference reference, void* context,
    double* output, RemagxFitSummary* summary) {
    return run_optimizer(initial, dimension, options, objective, should_stop, progress,
                         context, output, summary, nullptr, reference);
}

extern "C" int remagx_simplex_annealing(const double* initial, size_t dimension,
    const RemagxAnnealingOptions* options, RemagxObjective objective, RemagxShouldStop should_stop,
    RemagxFitProgress progress, void* context, double* output, RemagxFitSummary* summary) {
    if (!options || !std::isfinite(options->temperature) || options->temperature < 0.0 ||
        !std::isfinite(options->temperature_step)) return REMAGX_INVALID_ARGUMENT;
    return run_optimizer(initial, dimension, &options->simplex, objective, should_stop, progress,
                         context, output, summary, options);
}

extern "C" int remagx_nelder_mead_adaptive(const double* initial, size_t dimension,
    const RemagxSimplexOptions* options, RemagxObjective objective, RemagxShouldStop should_stop,
    RemagxFitProgress progress, RemagxSimplexReference reference, void* context,
    double* output, RemagxFitSummary* summary) {
    return run_optimizer(initial, dimension, options, objective, should_stop, progress,
                         context, output, summary, nullptr, reference, true);
}
