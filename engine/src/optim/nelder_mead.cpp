// Independent implementation of the algorithm in Lagarias et al. (1998), section 2.
// https://doi.org/10.1137/S1052623496303470
// No Numerical Recipes implementation was used. See optimizer.h for API policy.
#include "remagx/optimizer.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <new>
#include <stdexcept>
#include <utility>
#include <vector>

namespace {
struct Halt { int reason; };
struct Failure {};
struct Vertex { std::vector<double> parameters; double value = 0.0; };

class Search {
public:
    size_t dimension;
    const RemagxSimplexOptions& options;
    RemagxObjective objective;
    RemagxShouldStop should_stop;
    RemagxFitProgress progress;
    void* context;
    RemagxFitSummary summary{};
    Vertex best;
    std::vector<Vertex> vertices;

    Search(const double* initial, size_t count, const RemagxSimplexOptions& settings,
           RemagxObjective evaluate, RemagxShouldStop stop, RemagxFitProgress notify, void* user)
        : dimension(count), options(settings), objective(evaluate), should_stop(stop),
          progress(notify), context(user), best{std::vector<double>(count), 0.0} {
        vertices.reserve(count + 1);
        for (size_t row = 0; row <= count; ++row)
            vertices.push_back({std::vector<double>(initial + row * count, initial + (row + 1) * count), 0.0});
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
        for (auto& vertex : vertices) evaluate(vertex);
        notify();
        for (;;) {
            check_stop();
            std::stable_sort(vertices.begin(), vertices.end(), [](const Vertex& left, const Vertex& right) {
                return left.value < right.value;
            });
            if (converged()) return REMAGX_FIT_CONVERGED;
            if (summary.iterations == options.max_iterations) return REMAGX_FIT_ITERATION_LIMIT;
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
                return vertex;
            };
            Vertex reflected = trial(-1.0);
            bool shrink = false;
            if (reflected.value < vertices.front().value) {
                Vertex expanded = trial(-2.0);
                vertices.back() = expanded.value < reflected.value ? std::move(expanded) : std::move(reflected);
            } else if (reflected.value < vertices[dimension - 1].value) {
                vertices.back() = std::move(reflected);
            } else if (reflected.value < vertices.back().value) {
                Vertex contracted = trial(-0.5);
                if (contracted.value <= reflected.value) vertices.back() = std::move(contracted);
                else shrink = true;
            } else {
                Vertex contracted = trial(0.5);
                if (contracted.value < vertices.back().value) vertices.back() = std::move(contracted);
                else shrink = true;
            }
            if (shrink) {
                for (size_t row = 1; row <= dimension; ++row) {
                    for (size_t column = 0; column < dimension; ++column)
                        vertices[row].parameters[column] = 0.5 * vertices.front().parameters[column] +
                            0.5 * vertices[row].parameters[column];
                    evaluate(vertices[row]);
                }
            }
            ++summary.iterations;
            notify();
        }
    }
};
}

extern "C" int remagx_nelder_mead(const double* initial, size_t dimension,
    const RemagxSimplexOptions* options, RemagxObjective objective, RemagxShouldStop should_stop,
    RemagxFitProgress progress, void* context, double* output, RemagxFitSummary* summary) {
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
        Search search(initial, dimension, *options, objective, should_stop, progress, context);
        try { search.summary.termination = search.run(); }
        catch (const Halt& halt) { search.summary.termination = halt.reason; }
        if (search.summary.has_best) std::copy(search.best.parameters.begin(), search.best.parameters.end(), output);
        *summary = search.summary;
        return REMAGX_SUCCESS;
    } catch (const Failure&) { return REMAGX_NUMERICAL_ERROR; }
      catch (const std::bad_alloc&) { return REMAGX_ALLOCATION_ERROR; }
      catch (const std::length_error&) { return REMAGX_ALLOCATION_ERROR; }
}
