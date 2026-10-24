#pragma once
#include "project_document.hpp"
#include "optical_tables.hpp"
#include <memory>
#include <functional>
#include <array>
#include <string>
namespace remagx {
struct ScriptSolution {
    std::vector<double> qz, reflectivity, reflectivity_plus, reflectivity_minus, energy;
};
struct ScriptDielectricTensor {
    std::array<double, 18> values;
    bool anisotropic;
};
struct ScriptHookValues {
    double energy, epsilon, resolution, energy_scan_qz, renew_optical_constants;
};
// Calculation-owned Lua 5.4 session with isolated numeric arrays and elements.
// Solver orchestration and cancellation are still required before CLI activation.
class ProjectLuaSession {
public:
    ProjectLuaSession();
    ~ProjectLuaSession();
    void compile(const std::string& source, bool before_calculation);
    ScriptHookValues run_hook(const ScriptHookValues& input);
    void install_project_arrays(const ProjectDocument& project);
    ProjectDocument project_snapshot() const;
    void install_output(std::function<void(const std::string&)> emit);
    void install_project_functions();
    void fill_tensors();
    void set_delta_beta(double index, double energy);
    void replace_scattering_tensors(const std::vector<std::array<double, 18>>& tensors);
    std::vector<std::array<double, 18>> scattering_snapshot() const;
    void set_layer_text(double index, bool optical_table, const std::string& value);
    double calculation_energy() const;
    void install_solution();
    void replace_solution(const ScriptSolution& solution);
    ScriptSolution solution_snapshot() const;
    void install_tensors(const std::vector<ScriptDielectricTensor>& tensors);
    void replace_tensors(const std::vector<ScriptDielectricTensor>& tensors);
    std::vector<ScriptDielectricTensor> tensor_snapshot() const;
    void install_tables(const std::vector<OpticalTable>& tables);
    void replace_table_cursors(const std::vector<size_t>& cursors);
    std::vector<size_t> table_cursors() const;
    void replace_project(const ProjectDocument& project, double renew_optical_constants = 0);
    ScriptHookValues begin_hook();
    void apply_hook(const ScriptHookValues& result);
    void close() noexcept;
private:
    struct State;
    std::unique_ptr<State> state_;
};
struct ScriptProjectResult {
    ProjectDocument project;
    std::vector<ScriptDielectricTensor> tensors;
    std::vector<std::array<double,18>> scattering;
    std::vector<size_t> cursors;
};
// Caller supplies prepared optical state and owns invocation/refresh ordering.
class ProjectScriptHook {
public:
    ProjectScriptHook(std::vector<OpticalTable> tables,
        std::function<void(const std::string&)> emit, bool before_calculation = true);
    ScriptProjectResult run(const ProjectDocument& project,
        const std::vector<ScriptDielectricTensor>& tensors,
        const std::vector<std::array<double,18>>& scattering,
        const std::vector<size_t>& cursors, double renew = 0);
private:
    ProjectLuaSession session_;
    std::vector<OpticalTable> tables_;
    std::function<void(const std::string&)> emit_;
    bool before_calculation_, initialized_ = false, closed_ = false;
    std::string source_;
};
}
