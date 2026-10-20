#include "remagx/optimizer.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <functional>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
struct Harness {
    std::function<double(const std::vector<double>&)> function;
    std::vector<std::vector<double>> visited;
    std::vector<double> progress_values;
    size_t stop_after = std::numeric_limits<size_t>::max();
    size_t fail_at = std::numeric_limits<size_t>::max();
    size_t progress_iterations = 0;
};
int objective(const double* parameters, size_t count, void* context, double* value) {
    auto& harness = *static_cast<Harness*>(context);
    harness.visited.emplace_back(parameters, parameters + count);
    if (harness.visited.size() == harness.fail_at) return 1;
    *value = harness.function(harness.visited.back());
    return 0;
}
int stop(void* context) {
    auto& harness = *static_cast<Harness*>(context);
    return harness.visited.size() >= harness.stop_after;
}
void progress(const double*, size_t, double value, size_t iterations, size_t evaluations, void* context) {
    auto& harness = *static_cast<Harness*>(context);
    require(evaluations == harness.visited.size(), "progress evaluation count");
    require(iterations == harness.progress_values.size(), "progress iteration count");
    if (!harness.progress_values.empty()) require(value <= harness.progress_values.back(), "best must not increase");
    harness.progress_values.push_back(value);
    harness.progress_iterations = iterations;
}
RemagxSimplexOptions defaults() { return {10000, 5000, 1e-9, 1e-14}; }
RemagxFitSummary run(const std::vector<double>& simplex, size_t dimension, Harness& harness,
                     std::vector<double>& best, RemagxSimplexOptions options = defaults()) {
    auto unchanged = simplex;
    RemagxFitSummary summary{};
    require(remagx_nelder_mead(simplex.data(), dimension, &options, objective, stop, progress,
                              &harness, best.data(), &summary) == REMAGX_SUCCESS, "search failed");
    require(simplex == unchanged, "simplex modified");
    require(summary.evaluations == harness.visited.size(), "summary evaluation count");
    if (summary.has_best) require(summary.value == harness.function(best), "best value mismatch");
    return summary;
}
void convergence() {
    for (size_t dimension : {size_t(1), size_t(2), size_t(5)}) {
        Harness harness;
        harness.function = [](const auto& point) {
            double sum = 0;
            for (size_t i = 0; i < point.size(); ++i) {
                const double offset = point[i] - static_cast<double>(i + 1);
                sum += static_cast<double>(i + 1) * offset * offset;
            }
            return sum;
        };
        std::vector<double> simplex(dimension * (dimension + 1), -2.0), best(dimension);
        for (size_t row = 1; row <= dimension; ++row) simplex[row * dimension + row - 1] += .5;
        auto result = run(simplex, dimension, harness, best);
        require(result.termination == REMAGX_FIT_CONVERGED && result.value < 1e-16, "quadratic convergence");
        for (size_t i = 0; i < dimension; ++i) require(std::abs(best[i] - (i + 1)) < 1e-8, "quadratic parameter recovery");
        Harness repeated;
        repeated.function = harness.function;
        std::vector<double> repeated_best(dimension);
        auto repeat_result = run(simplex, dimension, repeated, repeated_best);
        require(best == repeated_best && harness.visited == repeated.visited &&
                result.evaluations == repeat_result.evaluations, "deterministic replay");
    }
    Harness rosenbrock;
    rosenbrock.function = [](const auto& point) {
        const double curved = point[1] - point[0] * point[0];
        return 100.0 * curved * curved + (1.0 - point[0]) * (1.0 - point[0]);
    };
    std::vector<double> best(2);
    auto result = run({-1.2, 1, -1.1, 1, -1.2, 1.1}, 2, rosenbrock, best);
    require(result.termination == REMAGX_FIT_CONVERGED && result.value < 1e-16 &&
            std::abs(best[0] - 1) < 1e-8 && std::abs(best[1] - 1) < 1e-8, "Rosenbrock recovery");
}
void reflectivity_recovery() {
    const RemagxBeam beam{1, 0, 0, 0};
    std::vector<double> coordinates(40);
    for (size_t i = 0; i < coordinates.size(); ++i) coordinates[i] = .01 + .003 * static_cast<double>(i);
    auto curve = [&](double thickness, double delta) {
        const RemagxLayer layers[] = {
            {0, 2, .01, .002, 0, 0, 0, 0},
            {thickness, 1, delta, .001, 0, 0, 0, 0},
            {0, 0, 0, 0, 0, 0, 0, 0}};
        std::vector<RemagxReflectivity> result(coordinates.size());
        require(remagx_parratt_qz(layers, 3, coordinates.data(), coordinates.size(), 640, &beam,
                nullptr, REMAGX_ISOTROPIC, REMAGX_BOTH, 0, REMAGX_MONOCHROMATIC, result.data()) == 0,
                "synthetic reflectivity calculation");
        return result;
    };
    const auto target = curve(35, .006);
    Harness harness;
    harness.function = [&](const auto& point) {
        const auto calculated = curve(point[0], point[1]);
        double residual = 0;
        for (size_t i = 0; i < target.size(); ++i) {
            const double difference = std::log10(calculated[i].beam1) - std::log10(target[i].beam1);
            residual += difference * difference;
        }
        return residual;
    };
    std::vector<double> best(2);
    // Retain the first investigated start: convergence of the simplex alone is
    // not proof of recovering the generating parameters on this nonlinear objective.
    Harness narrow;
    narrow.function = harness.function;
    const auto narrow_result = run({30, .005, 33, .005, 30, .006}, 2, narrow, best);
    require(narrow_result.termination == REMAGX_FIT_CONVERGED && narrow_result.value > 1e-3,
            "non-global convergence regression");
    const auto result = run({30, .005, 40, .005, 30, .007}, 2, harness, best);
    require(result.termination == REMAGX_FIT_CONVERGED && result.value < 1e-16 &&
            std::abs(best[0] - 35) < 1e-7 && std::abs(best[1] - .006) < 1e-10,
            "recover thickness and delta using native log-reflectivity objective");
}
void moves_and_limits() {
    // Hand-calculated one-dimensional trial positions exercise every two-trial branch.
    for (const auto& values : std::vector<std::vector<double>>{
            {1, 4, 0, -1}, {1, 4, 0, .5}, {1, 4, 2, 1.5}, {1, 4, 5, 2}, {1, 4, 5, 4, 4}}) {
        Harness harness;
        const bool expanding = values[2] == 0;
        const bool outside = values[2] == 2;
        const double fourth = expanding ? -4 : outside ? -1 : 1;
        harness.function = [values, fourth](const auto& point) {
            if (point[0] == 0) return values[0];
            if (point[0] == 2) return values[1];
            if (point[0] == -2) return values[2];
            if (point[0] == fourth) return values[3];
            throw std::runtime_error("unexpected trial point");
        };
        auto options = defaults(); options.max_iterations = 1;
        std::vector<double> best(1);
        auto result = run({0, 2}, 1, harness, best, options);
        require(result.termination == REMAGX_FIT_ITERATION_LIMIT && result.iterations == 1, "iteration budget");
        require(harness.visited[2][0] == -2 && harness.visited[3][0] == fourth &&
                harness.visited.size() == values.size(), "move geometry");
        if (values.size() == 5) require(harness.visited[4][0] == 1, "shrink point");
        if (expanding) require(best[0] == (values[3] < values[2] ? -4 : -2), "expansion selection");
    }
    Harness reflection;
    reflection.function = [](const auto& point) {
        if (point == std::vector<double>{0, 0}) return 1.0;
        if (point == std::vector<double>{2, 0}) return 2.0;
        if (point == std::vector<double>{0, 2}) return 4.0;
        require(point == std::vector<double>({2, -2}), "reflection geometry");
        return 1.5;
    };
    std::vector<double> best(2);
    auto options = defaults(); options.max_iterations = 1;
    run({0, 0, 2, 0, 0, 2}, 2, reflection, best, options);
    require(reflection.visited.size() == 4, "unneeded contraction after reflection");
    // A flat objective must shrink spatially, not immediately report convergence.
    for (size_t budget : {size_t(3), size_t(4), size_t(5), size_t(6), size_t(7)}) {
        Harness flat; flat.function = [](const auto&) { return 1.0; };
        options = defaults(); options.max_evaluations = budget;
        auto result = run({0, 0, 2, 0, 0, 2}, 2, flat, best, options);
        require(result.termination == REMAGX_FIT_EVALUATION_LIMIT && result.evaluations == budget, "hard evaluation cap during shrink");
    }
    Harness flat; flat.function = [](const auto&) { return 1.0; };
    auto result = run({0, 0, 2, 0, 0, 2}, 2, flat, best);
    require(result.termination == REMAGX_FIT_CONVERGED && result.iterations > 20, "flat objective spatial convergence");
}
void stop_and_errors() {
    for (size_t count : {size_t(0), size_t(1), size_t(2), size_t(3), size_t(5)}) {
        Harness harness; harness.function = [](const auto& point) { return (point[0] + 4) * (point[0] + 4); };
        harness.stop_after = count;
        std::vector<double> best(1, 123);
        auto result = run({0, 2}, 1, harness, best);
        require(result.termination == REMAGX_FIT_STOPPED && result.evaluations == count, "cooperative stop");
        if (!count) require(!result.has_best && best[0] == 123, "pre-evaluation stop");
        if (count == 3) require(best[0] == -2 && result.iterations == 0, "retain trial before unfinished expansion");
    }
    const double simplex[] = {0, 2};
    auto options = defaults();
    double best = 123;
    RemagxFitSummary summary{99, 99, 99, 99, 99};
    const auto before = summary;
    Harness harness; harness.function = [](const auto& point) { return point[0] * point[0]; };
    auto failure = [&](const double* initial, size_t dimension, int expected) {
        const int status = remagx_nelder_mead(initial, dimension, &options, objective, nullptr, nullptr,
                                             &harness, &best, &summary);
        require(status == expected && best == 123 && std::memcmp(&summary, &before, sizeof(summary)) == 0,
                "failure must preserve outputs");
    };
    failure(simplex, 0, REMAGX_INVALID_ARGUMENT);
    failure(nullptr, 1, REMAGX_INVALID_ARGUMENT);
    failure(simplex, std::numeric_limits<size_t>::max(), REMAGX_ALLOCATION_ERROR);
    options.max_evaluations = 1; failure(simplex, 1, REMAGX_INVALID_ARGUMENT);
    options = defaults(); options.parameter_tolerance = -1; failure(simplex, 1, REMAGX_INVALID_ARGUMENT);
    options = defaults(); options.objective_tolerance = std::numeric_limits<double>::infinity();
    failure(simplex, 1, REMAGX_INVALID_ARGUMENT);
    options = defaults();
    const double invalid[] = {0, std::numeric_limits<double>::quiet_NaN()};
    failure(invalid, 1, REMAGX_INVALID_ARGUMENT);
    require(harness.visited.empty(), "invalid input reached objective");
    harness.fail_at = 2; failure(simplex, 1, REMAGX_NUMERICAL_ERROR);
    harness.fail_at = std::numeric_limits<size_t>::max();
    harness.function = [](const auto&) { return std::numeric_limits<double>::infinity(); };
    failure(simplex, 1, REMAGX_NUMERICAL_ERROR);
    harness.function = [](const auto& point) { return point[0] > 0 ? 2.0 : 1.0; };
    const double huge[] = {-1e308, 1e308};
    failure(huge, 1, REMAGX_NUMERICAL_ERROR);
}
RemagxFitSummary run_annealing(const std::vector<double>& simplex, size_t dimension,
    Harness& harness, std::vector<double>& best, RemagxAnnealingOptions options) {
    auto unchanged = simplex;
    RemagxFitSummary summary{};
    require(remagx_simplex_annealing(simplex.data(), dimension, &options, objective, stop,
        progress, &harness, best.data(), &summary) == REMAGX_SUCCESS, "annealing failed");
    require(simplex == unchanged, "annealing changed initial simplex");
    require(summary.evaluations == harness.visited.size(), "annealing evaluation count");
    if (summary.has_best) require(summary.value == harness.function(best), "annealing reported thermal score");
    return summary;
}
void annealing() {
    const std::vector<double> initial{0, 0, 1, 0, 0, 1};
    const auto quadratic = [](const std::vector<double>& point) {
        return (point[0] - 3) * (point[0] - 3) + 2 * (point[1] + 2) * (point[1] + 2);
    };
    Harness cold, ordinary;
    cold.function = ordinary.function = quadratic;
    std::vector<double> cold_best(2), ordinary_best(2);
    const auto plain = run(initial, 2, ordinary, ordinary_best);
    const auto frozen = run_annealing(initial, 2, cold, cold_best, {defaults(), 0, 0, 42});
    require(cold.visited == ordinary.visited && cold_best == ordinary_best &&
        frozen.evaluations == plain.evaluations && frozen.iterations == plain.iterations &&
        frozen.termination == plain.termination, "zero temperature changed ordinary simplex");

    Harness first, replay, other_seed;
    first.function = replay.function = other_seed.function = quadratic;
    std::vector<double> best(2), again(2), other(2);
    RemagxAnnealingOptions settings{defaults(), 2, -.02, 42};
    const auto summary = run_annealing(initial, 2, first, best, settings);
    const auto repeated = run_annealing(initial, 2, replay, again, settings);
    require(first.visited == replay.visited && best == again && summary.value == repeated.value,
        "seeded annealing did not replay");
    require(summary.iterations >= 100 && summary.termination == REMAGX_FIT_CONVERGED,
        "annealing converged before cooling");
    require(summary.value < 1e-12, "annealing quadratic recovery");
    settings.seed = 43;
    run_annealing(initial, 2, other_seed, other, settings);
    require(first.visited != other_seed.visited && first.visited != ordinary.visited,
        "thermal search ignored random seed or temperature");

    Harness bounded;
    bounded.function = quadratic;
    settings = {defaults(), 1, 0, 7};
    settings.simplex.max_iterations = 5;
    const auto limited = run_annealing(initial, 2, bounded, best, settings);
    require(limited.termination == REMAGX_FIT_ITERATION_LIMIT && limited.iterations == 5,
        "constant-temperature iteration budget");
    Harness stopped;
    stopped.function = quadratic;
    stopped.stop_after = 4;
    const auto interrupted = run_annealing(initial, 2, stopped, best, settings);
    require(interrupted.termination == REMAGX_FIT_STOPPED && interrupted.evaluations == 4,
        "annealing Stop during iteration");
    Harness evaluation_limited;
    evaluation_limited.function = quadratic;
    settings.simplex.max_evaluations = 4;
    const auto exhausted = run_annealing(initial, 2, evaluation_limited, best, settings);
    require(exhausted.termination == REMAGX_FIT_EVALUATION_LIMIT && exhausted.evaluations == 4,
        "annealing evaluation budget");

    // The asymmetric double well has a positive local minimum near +2 and
    // a lower one near -2. Keep the full seed set; do not select a winning seed.
    const auto double_well = [](const std::vector<double>& point) {
        const double squared = point[0] * point[0] - 4;
        return squared * squared + .3 * point[0];
    };
    Harness local;
    local.function = double_well;
    std::vector<double> local_best(1);
    const auto local_result = run({2, 2.2}, 1, local, local_best);
    require(local_result.value > .5, "double-well baseline no longer tests a local trap");
    size_t escaped = 0;
    for (uint32_t seed = 0; seed < 12; ++seed) {
        Harness global;
        global.function = double_well;
        const auto result = run_annealing({2, 2.2}, 1, global, local_best,
            {defaults(), 10, -.01, seed});
        if (result.value < -.5) ++escaped;
    }
    require(escaped > 0, "annealing never escaped the double-well local trap");
    std::cout << "Annealing double-well escapes: " << escaped << "/12 seeds.\n";

    Harness failed;
    failed.function = quadratic;
    auto invalid = [&](double temperature, double step, int expected) {
        RemagxAnnealingOptions options{defaults(), temperature, step, 1};
        double output[] = {123, 456};
        RemagxFitSummary result{99, 99, 99, 99, 99};
        const auto before = result;
        require(remagx_simplex_annealing(initial.data(), 2, &options, objective, stop, progress,
            &failed, output, &result) == expected, "annealing error classification");
        require(output[0] == 123 && output[1] == 456 &&
            std::memcmp(&before, &result, sizeof(result)) == 0, "annealing error changed output");
    };
    invalid(-1, -.01, REMAGX_INVALID_ARGUMENT);
    invalid(std::numeric_limits<double>::infinity(), -.01, REMAGX_INVALID_ARGUMENT);
    invalid(1, std::numeric_limits<double>::quiet_NaN(), REMAGX_INVALID_ARGUMENT);
    require(failed.visited.empty(), "invalid temperature invoked objective");
    failed.fail_at = 2;
    invalid(1, -.01, REMAGX_NUMERICAL_ERROR);
    failed.visited.clear();
    failed.fail_at = std::numeric_limits<size_t>::max();
    failed.function = [](const auto&) { return std::numeric_limits<double>::max(); };
    invalid(std::numeric_limits<double>::max(), 0, REMAGX_NUMERICAL_ERROR);
    Harness stopped_before_start;
    stopped_before_start.function = quadratic;
    stopped_before_start.stop_after = 0;
    best = {123, 456};
    const auto untouched = run_annealing(initial, 2, stopped_before_start, best,
        {defaults(), 1, -.01, 1});
    require(!untouched.has_best && untouched.evaluations == 0 &&
        untouched.termination == REMAGX_FIT_STOPPED && best == std::vector<double>({123, 456}),
        "annealing Stop before initialization changed parameters");
}
int main() {
    try { convergence(); reflectivity_recovery(); moves_and_limits(); stop_and_errors(); annealing(); }
    catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
    std::cout << "Native simplex: recovery, deterministic moves, limits, Stop and atomic errors passed.\n";
}
