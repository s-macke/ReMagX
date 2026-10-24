#pragma once
#include "project_document.hpp"
#include <memory>
#include <string>
namespace remagx {
struct ScriptHookValues {
    double energy, epsilon, resolution, energy_scan_qz, renew_optical_constants;
};
// Calculation-owned Lua 5.4 session with isolated numeric project arrays.
// Element/tensor/function bindings and calculation hooks are still required
// before this bridge can enable CLI scripts.
class ProjectLuaSession {
public:
    ProjectLuaSession();
    ~ProjectLuaSession();
    void compile(const std::string& source, bool before_calculation);
    ScriptHookValues run_hook(const ScriptHookValues& input);
    void install_project_arrays(const ProjectDocument& project);
    ProjectDocument project_snapshot() const;
    void close() noexcept;
private:
    struct State;
    std::unique_ptr<State> state_;
};
}
