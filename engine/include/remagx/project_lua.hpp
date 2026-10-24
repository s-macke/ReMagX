#pragma once
#include "project_document.hpp"
#include "optical_tables.hpp"
#include <memory>
#include <array>
#include <string>
namespace remagx {
struct ScriptDielectricTensor {
    std::array<double, 18> values;
    bool anisotropic;
};
struct ScriptHookValues {
    double energy, epsilon, resolution, energy_scan_qz, renew_optical_constants;
};
// Calculation-owned Lua 5.4 session with isolated numeric arrays and elements.
// Solution/function bindings and calculation hooks are still required
// before this bridge can enable CLI scripts.
class ProjectLuaSession {
public:
    ProjectLuaSession();
    ~ProjectLuaSession();
    void compile(const std::string& source, bool before_calculation);
    ScriptHookValues run_hook(const ScriptHookValues& input);
    void install_project_arrays(const ProjectDocument& project);
    ProjectDocument project_snapshot() const;
    void install_tensors(const std::vector<ScriptDielectricTensor>& tensors);
    void replace_tensors(const std::vector<ScriptDielectricTensor>& tensors);
    std::vector<ScriptDielectricTensor> tensor_snapshot() const;
    void install_tables(const std::vector<OpticalTable>& tables);
    void replace_project(const ProjectDocument& project, double renew_optical_constants = 0);
    ScriptHookValues begin_hook();
    void apply_hook(const ScriptHookValues& result);
    void close() noexcept;
private:
    struct State;
    std::unique_ptr<State> state_;
};
}
