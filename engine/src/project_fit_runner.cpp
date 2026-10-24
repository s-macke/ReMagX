#include "remagx/project_fit.hpp"
#include <cmath>
#include <exception>

namespace remagx {
namespace {
struct FitContext {
    ProjectFitObjective& objective;
    const ProjectFitSpace& space;
    const ProjectFitOptions& options;
    std::vector<double> reference;
    std::unique_ptr<ProjectObjectiveResult> best;
    std::exception_ptr failure;
};
int stopped(void* opaque) {
    auto& context = *static_cast<FitContext*>(opaque);
    if (context.failure) return 1;
    try { return context.options.should_stop && context.options.should_stop() ? 1 : 0; }
    catch (...) { context.failure = std::current_exception(); return 1; }
}
int evaluate(const double* coordinates, size_t count, void* opaque, double* output) {
    auto& context = *static_cast<FitContext*>(opaque);
    try {
        const auto values = context.space.decode(std::vector<double>(coordinates, coordinates + count));
        auto result = context.objective.evaluate(values, context.reference);
        *output = result.error;
        if (!context.best || result.error < context.best->error)
            context.best = std::make_unique<ProjectObjectiveResult>(std::move(result));
        return 0;
    } catch (...) { context.failure = std::current_exception(); return 1; }
}
int reference_event(const double* coordinates, size_t count, int phase, size_t, size_t, void* opaque) {
    auto& context = *static_cast<FitContext*>(opaque);
    try {
        if (phase == REMAGX_REFERENCE_SELECTED)
            context.reference = context.space.decode(std::vector<double>(coordinates, coordinates + count));
        else if (!stopped(opaque)) {
            // Refresh current state/reference without replacing a best trial snapshot.
            const auto result = context.objective.evaluate(context.reference, context.reference, true);
            context.reference = result.reference;
        }
        return context.failure ? 1 : 0;
    } catch (...) { context.failure = std::current_exception(); return 1; }
}
}
ProjectFitResult run_project_fit(const ProjectDocument& source, const std::vector<OpticalTable>& tables,
    const ProjectFitOptions& options) {
    ProjectFitObjective objective(source, tables);
    const auto project = objective.prepare_standalone();
    const auto algorithm = project.string("/fit/algorithm");
    if (algorithm != "simplex" && algorithm != "simplex-annealing")
        throw ProjectDocumentError("This native fit optimizer is unavailable.");
    if (!project.array_size("/fit/parameters")) throw ProjectDocumentError("Select at least one fit parameter.");
    ProjectFitSpace space(project);
    FitContext context{objective, space, options, {}, nullptr, nullptr};
    for (size_t index = 0; index < project.array_size("/fit/parameters"); ++index)
        context.reference.push_back(project.number("/fit/parameters/" + std::to_string(index) + "/value"));
    const bool annealing = algorithm == "simplex-annealing";
    RemagxAnnealingOptions thermal{options.simplex, 0, 0, 0};
    if (annealing) {
        thermal.temperature = project.number("/fit/annealing/temperature");
        thermal.temperature_step = project.number("/fit/annealing/temperatureStep");
        const double seed = project.number("/fit/evolution/randomSeed");
        if (!std::isfinite(thermal.temperature) || thermal.temperature < 0 || !std::isfinite(thermal.temperature_step) ||
            !std::isfinite(seed) || std::floor(seed) != seed || std::abs(seed) > 9007199254740991.0)
            throw ProjectDocumentError("Invalid native annealing settings.");
        double wrapped = std::fmod(seed, 4294967296.0);
        if (wrapped < 0) wrapped += 4294967296.0;
        thermal.seed = static_cast<uint32_t>(wrapped);
    }
    if (stopped(&context)) {
        if (context.failure) std::rethrow_exception(context.failure);
        throw ProjectDocumentError("Fit stopped before evaluating a candidate.");
    }
    if (!space.dimensions()) {
        auto best = objective.evaluate(space.decode({}), context.reference);
        return {std::move(best), 0, 1, REMAGX_FIT_CONVERGED};
    }
    std::vector<double> initial, best_coordinates(space.dimensions());
    for (const auto& row : space.simplex()) initial.insert(initial.end(), row.begin(), row.end());
    RemagxFitSummary summary{};
    const int status = annealing
        ? remagx_simplex_annealing(initial.data(), space.dimensions(), &thermal, evaluate, stopped, nullptr,
            &context, best_coordinates.data(), &summary)
        : remagx_nelder_mead_adaptive(initial.data(), space.dimensions(), &options.simplex, evaluate, stopped, nullptr,
            project.number("/fit/occamQ") != 0 ? reference_event : nullptr, &context, best_coordinates.data(), &summary);
    if (context.failure) std::rethrow_exception(context.failure);
    if (status != REMAGX_SUCCESS) throw ProjectDocumentError("Native fit optimizer failed.");
    if (!summary.has_best || !context.best) throw ProjectDocumentError("Fit stopped before evaluating a candidate.");
    if (summary.value != context.best->error) throw ProjectDocumentError("Native fit result is inconsistent with its best evaluated state.");
    return {std::move(*context.best), summary.iterations, summary.evaluations, summary.termination};
}
}
