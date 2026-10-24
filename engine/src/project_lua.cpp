#include "remagx/project_lua.hpp"
#include <lua.hpp>
#include "remagx/core.h"
#include <cmath>
#include <limits>
#include <type_traits>
#include <optional>
#include <vector>
#include <array>
#include <deque>

static_assert(LUA_VERSION_NUM == 504, "Native scripting requires the web-compatible Lua 5.4 API");
static_assert(std::is_same<lua_Number, double>::value && sizeof(lua_Number) == 8 &&
    std::numeric_limits<lua_Number>::is_iec559, "Lua numbers must use IEEE binary64");
namespace remagx {
namespace {
struct NumericArray {
    const char* name;
    int type;
    std::vector<std::string> paths;
    std::vector<double> values;
    std::vector<ScriptDielectricTensor>* tensors = nullptr;
    size_t tensor_offset = 0;
    std::vector<double>* solution = nullptr;
    const double* dynamic_maximum = nullptr;
};
struct ArrayHandle { NumericArray* array; double maximum; };
double numeric_argument(lua_State* vm, int index, bool integer) {
    if (!lua_isnumber(vm, index)) luaL_error(vm, "argument %d: number expected", index);
    const double value = lua_tonumber(vm, index);
    if (!std::isfinite(value)) luaL_error(vm, "argument %d: finite number expected", index);
    if (integer && (std::floor(value) != value || std::abs(value) > 9007199254740991.0))
        luaL_error(vm, "argument %d: safe integer expected", index);
    return value;
}
ArrayHandle* array_handle(lua_State* vm) { return static_cast<ArrayHandle*>(luaL_checkudata(vm, 1, "LuaBook.array")); }
size_t array_index(lua_State* vm, ArrayHandle* handle) {
    const double value = numeric_argument(vm, 2, true);
    const double maximum = handle->maximum == -1 && handle->array->dynamic_maximum ? *handle->array->dynamic_maximum : handle->maximum;
    const size_t count = handle->array->solution ? handle->array->solution->size() : handle->array->values.size();
    if (value < 0 || value > maximum || value >= static_cast<double>(count))
        luaL_error(vm, "%s: index out of range", handle->array->name);
    return static_cast<size_t>(value);
}
int array_get(lua_State* vm) {
    auto* handle = array_handle(vm); const size_t index = array_index(vm, handle);
    auto* array = handle->array;
    if (array->tensors) {
        (*array->tensors)[index].anisotropic = true;
        lua_pushnumber(vm, (*array->tensors)[index].values[array->tensor_offset]);
    } else lua_pushnumber(vm, array->solution ? (*array->solution)[index] : array->values[index]);
    return 1;
}
int array_set(lua_State* vm) {
    const double value = numeric_argument(vm, 3, false);
    auto* handle = array_handle(vm); const size_t index = array_index(vm, handle);
    auto* array = handle->array;
    if (array->tensors) {
        (*array->tensors)[index].anisotropic = true;
        (*array->tensors)[index].values[array->tensor_offset] = value;
    } else if (array->solution) (*array->solution)[index] = value;
    else array->values[index] = value;
    return 0;
}
int array_size(lua_State* vm) { lua_pushnumber(vm, array_handle(vm)->maximum); return 1; }
void push_array(lua_State* vm, NumericArray* array, double maximum) {
    auto* handle = static_cast<ArrayHandle*>(lua_newuserdatauv(vm, sizeof(ArrayHandle), 0));
    *handle = {array, maximum}; luaL_getmetatable(vm, "LuaBook.array"); lua_setmetatable(vm, -2);
}
int array_new(lua_State* vm) {
    auto* arrays = static_cast<std::deque<NumericArray>*>(lua_touserdata(vm, lua_upvalueindex(1)));
    const double maximum = numeric_argument(vm, 1, true), type = numeric_argument(vm, 2, true);
    for (auto& array : *arrays) if (type == array.type) { push_array(vm, &array, maximum); return 1; }
    return luaL_error(vm, "array.new: unsupported type");
}
int install_arrays(lua_State* vm) {
    auto* arrays = static_cast<std::deque<NumericArray>*>(lua_touserdata(vm, 1));
    luaL_newmetatable(vm, "LuaBook.array");
    lua_pushcfunction(vm, array_get); lua_setfield(vm, -2, "__index");
    lua_pushcfunction(vm, array_set); lua_setfield(vm, -2, "__newindex"); lua_pop(vm, 1);
    lua_newtable(vm);
    lua_pushlightuserdata(vm, arrays); lua_pushcclosure(vm, array_new, 1); lua_setfield(vm, -2, "new");
    lua_pushcfunction(vm, array_get); lua_setfield(vm, -2, "get");
    lua_pushcfunction(vm, array_set); lua_setfield(vm, -2, "set");
    lua_pushcfunction(vm, array_size); lua_setfield(vm, -2, "size"); lua_setglobal(vm, "array");
    for (auto& array : *arrays) { push_array(vm, &array, array.solution ? -1 : static_cast<double>(array.values.size()) - 1); lua_setglobal(vm, array.name); }
    return 0;
}
// User-visible methods follow scriptmetaobject.cpp and the web element bridge.
struct ScriptTables {
    bool installed = false;
    std::vector<OpticalTable> tables;
    std::vector<size_t> cursors;
};
struct ElementBinding {
    std::string name, path;
    NumericArray *first, *second;
    size_t index;
    ScriptTables* tables;
    double magnetic_first, magnetic_second;
    std::vector<std::array<double, 3>> slabs;
};
struct ElementHandle { ElementBinding* binding; };
double element_scratch = 3.14; // Legacy process-wide scratch cell, shared across sessions.
ElementBinding* element_binding(lua_State* vm) {
    return static_cast<ElementHandle*>(luaL_checkudata(vm, 1, "ElementObject"))->binding;
}
size_t element_index(lua_State* vm, int argument, size_t count) {
    const double index = std::trunc(numeric_argument(vm, argument, false));
    if (index < 0 || index > 9007199254740991.0 || index >= static_cast<double>(count))
        luaL_error(vm, "Element index out of range");
    return static_cast<size_t>(index);
}
void push_element(lua_State* vm, ElementBinding* binding) {
    auto* handle = static_cast<ElementHandle*>(lua_newuserdatauv(vm, sizeof(ElementHandle), 0));
    handle->binding = binding;
    luaL_getmetatable(vm, "ElementObject"); lua_setmetatable(vm, -2);
}
int element_new(lua_State* vm) {
    auto* elements = static_cast<std::vector<ElementBinding>*>(lua_touserdata(vm, lua_upvalueindex(1)));
    const size_t index = element_index(vm, 1, elements->size());
    push_element(vm, &(*elements)[index]); return 1;
}
template<int Field, bool Write> int element_factor(lua_State* vm) {
    auto* binding = element_binding(vm);
    double* value;
    if constexpr (Field == 0) value = &binding->first->values[binding->index];
    else if constexpr (Field == 1) value = &binding->second->values[binding->index];
    else if constexpr (Field == 2) value = &binding->magnetic_first;
    else value = &binding->magnetic_second;
    if constexpr (Write) { *value = numeric_argument(vm, 2, false); return 0; }
    else { lua_pushnumber(vm, *value); return 1; }
}
template<int Field, bool Write> int element_slab(lua_State* vm) {
    auto* binding = element_binding(vm);
    const size_t index = element_index(vm, 2, binding->slabs.size());
    if constexpr (Write) { binding->slabs[index][Field] = numeric_argument(vm, 3, false); return 0; }
    else { lua_pushnumber(vm, binding->slabs[index][Field]); return 1; }
}
int element_get(lua_State* vm) { element_binding(vm); lua_pushnumber(vm, element_scratch); return 1; }
int element_set(lua_State* vm) {
    const double value = numeric_argument(vm, 3, false);
    element_binding(vm); element_scratch = value; return 0;
}
size_t find_script_table(const ScriptTables* state, const std::string& name, const char* kind, bool nonempty = false) {
    for (size_t index = 0; index < state->tables.size(); ++index)
        if (state->tables[index].name == name && state->tables[index].kind == kind &&
            (!nonempty || !state->tables[index].energies.empty())) return index;
    return state->tables.size();
}
void read_script_table(lua_State* vm, ScriptTables* state, size_t index, double energy, size_t width, double* output) {
    if (index == state->tables.size() || state->tables[index].energies.empty()) return;
    const auto& table = state->tables[index];
    if (table.width != width || remagx_table_lookup(table.energies.data(), table.values.data(),
            table.energies.size(), width, &energy, 1, &state->cursors[index], output) != 0)
        luaL_error(vm, "Invalid scattering factors in %s.%s", table.name.c_str(), table.kind.c_str());
}
int element_lookup(lua_State* vm) {
    auto* binding = element_binding(vm);
    const double energy = numeric_argument(vm, 2, false);
    auto* state = binding->tables;
    if (!state->installed) return luaL_error(vm, "element.setf: native table lookup is not available");
    const size_t primary = find_script_table(state, binding->name, "ff");
    if (primary == state->tables.size() || state->tables[primary].energies.empty() ||
        energy < state->tables[primary].energies.front() || energy > state->tables[primary].energies.back()) return 0;
    double scalar[2]{}, magnetic[2]{}, tensor[18]{};
    read_script_table(vm, state, primary, energy, 2, scalar);
    read_script_table(vm, state, find_script_table(state, binding->name, "ffm", true), energy, 2, magnetic);
    // Getff advances the tensor cursor too; setf copies only scalar factors.
    read_script_table(vm, state, find_script_table(state, binding->name, "f", true), energy, 18, tensor);
    binding->first->values[binding->index] = scalar[0];
    binding->second->values[binding->index] = scalar[1];
    binding->magnetic_first = magnetic[0]; binding->magnetic_second = magnetic[1];
    return 0;
}
int install_elements(lua_State* vm) {
    auto* elements = static_cast<std::vector<ElementBinding>*>(lua_touserdata(vm, 1));
    luaL_newmetatable(vm, "ElementObject");
    const luaL_Reg methods[] = {
        {"getf1", element_factor<0,false>}, {"setf1", element_factor<0,true>},
        {"getf2", element_factor<1,false>}, {"setf2", element_factor<1,true>},
        {"getf1m", element_factor<2,false>}, {"setf1m", element_factor<2,true>},
        {"getf2m", element_factor<3,false>}, {"setf2m", element_factor<3,true>},
        {"getthickness", element_slab<0,false>}, {"setthickness", element_slab<0,true>},
        {"getsigma", element_slab<1,false>}, {"setsigma", element_slab<1,true>},
        {"getdensity", element_slab<2,false>}, {"setdensity", element_slab<2,true>},
        {"get", element_get}, {"set", element_set}, {"setf", element_lookup}, {nullptr,nullptr}
    };
    luaL_setfuncs(vm, methods, 0);
    lua_pushlightuserdata(vm, elements); lua_pushcclosure(vm, element_new, 1); lua_setfield(vm, -2, "new");
    lua_pushvalue(vm, -1); lua_setfield(vm, -2, "__index"); lua_setglobal(vm, "element");
    for (auto& binding : *elements) { push_element(vm, &binding); lua_setglobal(vm, binding.name.c_str()); }
    return 0;
}
struct ProjectFunctions { ProjectLuaSession* session; std::string error; };
template<bool OpticalTable> int set_layer_text(lua_State* vm) {
    if (lua_gettop(vm) != 2) return 0;
    auto* context = static_cast<ProjectFunctions*>(lua_touserdata(vm, lua_upvalueindex(1)));
    const double index = std::trunc(lua_tonumber(vm, 1));
    const bool is_string = lua_isstring(vm, 2);
    if (OpticalTable && !is_string) return luaL_error(vm, "SetName: string or number expected");
    const char* value = is_string ? lua_tostring(vm, 2) : "";
    bool failed = false;
    try { context->session->set_layer_text(index, OpticalTable, value); }
    catch (const std::exception& error) { context->error = error.what(); failed = true; }
    if (failed) return luaL_error(vm, "%s", context->error.c_str());
    return 0;
}
template<bool Real> int line_shape(lua_State* vm) {
    if (lua_gettop(vm) != 4) return 0;
    auto* context = static_cast<ProjectFunctions*>(lua_touserdata(vm, lua_upvalueindex(1)));
    double energy = 0, result = 0;
    bool failed = false;
    try { energy = context->session->calculation_energy(); }
    catch (const std::exception& error) { context->error = error.what(); failed = true; }
    if (failed) return luaL_error(vm, "%s", context->error.c_str());
    const auto calculate = Real ? remagx_gauss_lorentzian_real : remagx_gauss_lorentzian_imag;
    if (calculate(energy, lua_tonumber(vm,1), lua_tonumber(vm,2), lua_tonumber(vm,3), lua_tonumber(vm,4), &result) != 0)
        return luaL_error(vm, "GetGaussLorentzian%s: invalid or nonfinite result", Real ? "Real" : "Imag");
    lua_pushnumber(vm, result); return 1;
}
template<bool Fill> int optical_function(lua_State* vm) {
    if (!Fill && lua_gettop(vm) != 2) return 0;
    auto* context = static_cast<ProjectFunctions*>(lua_touserdata(vm, lua_upvalueindex(1)));
    const double index = std::trunc(lua_tonumber(vm, 1)), energy = lua_tonumber(vm, 2);
    bool failed = false;
    try {
        if constexpr (Fill) context->session->fill_tensors();
        else context->session->set_delta_beta(index, energy);
    } catch (const std::exception& error) { context->error = error.what(); failed = true; }
    if (failed) return luaL_error(vm, "%s", context->error.c_str());
    return 0;
}
int no_operation(lua_State*) { return 0; }
int unavailable_function(lua_State* vm) {
    const char* name = lua_tostring(vm, lua_upvalueindex(1));
    return luaL_error(vm, "%s: not supported yet", name);
}
int install_functions(lua_State* vm) {
    auto* context = static_cast<ProjectFunctions*>(lua_touserdata(vm, 1));
    const luaL_Reg functions[] = {{"SetName", set_layer_text<true>}, {"SetChemicalFormula", set_layer_text<false>},
        {"FillTensors", optical_function<true>}, {"SetDeltaBeta", optical_function<false>},
        {"GetGaussLorentzianReal", line_shape<true>}, {"GetGaussLorentzianImag", line_shape<false>}, {nullptr,nullptr}};
    for (const auto* function = functions; function->name; ++function) {
        lua_pushlightuserdata(vm, context); lua_pushcclosure(vm, function->func, 1); lua_setglobal(vm, function->name);
    }
    for (const char* name : {"CalculateDicReflectivity", "CalculateEnergyscan"}) {
        lua_pushcfunction(vm, no_operation); lua_setglobal(vm, name);
    }
    for (const char* name : {"KramersKronigRange", "ShowMatrixEigenvalues", "ShowEScanEigenvalues"}) {
        lua_pushstring(vm, name); lua_pushcclosure(vm, unavailable_function, 1); lua_setglobal(vm, name);
    }
    return 0;
}
struct HookRequest { ScriptHookValues input, output; };
// Keep only trivial locals inside Lua's longjmp boundary.
int execute_hook(lua_State* vm) {
    auto* request = static_cast<HookRequest*>(lua_touserdata(vm, 1));
    const char* names[] = {"energy", "epsilon", "resolution", "energyscan_qz", "renewocs"};
    const double values[] = {request->input.energy, request->input.epsilon, request->input.resolution,
        request->input.energy_scan_qz, request->input.renew_optical_constants};
    for (size_t index = 0; index < 5; ++index) {
        if (!std::isfinite(values[index])) return luaL_error(vm, "Invalid script input %s", names[index]);
        lua_pushnumber(vm, values[index]); lua_setglobal(vm, names[index]);
    }
    lua_getglobal(vm, "Start"); lua_call(vm, 0, 0);
    double result[4];
    for (size_t index = 0; index < 4; ++index) {
        lua_getglobal(vm, names[index]);
        if (!lua_isnumber(vm, -1)) return luaL_error(vm, "Script global %s must be numeric", names[index]);
        result[index] = lua_tonumber(vm, -1); lua_pop(vm, 1);
        if (!std::isfinite(result[index])) return luaL_error(vm, "Script global %s must be finite", names[index]);
    }
    request->output = {result[0], result[1], result[2], result[3], 0};
    return 0;
}
int install_program(lua_State* vm) { lua_pushvalue(vm, 1); lua_setglobal(vm, "Start"); return 0; }
}
struct ProjectLuaSession::State {
    lua_State* vm = nullptr;
    bool compiled = false;
    ProjectFunctions functions{nullptr, {}};
    double wavelength = 0, renew_optical_constants = 0;
    std::optional<ProjectDocument> project;
    std::deque<NumericArray> arrays;
    std::vector<ElementBinding> elements;
    ScriptTables tables;
    bool solution_installed = false;
    ScriptSolution solution;
    double solution_maximum = -1;
    bool tensors_installed = false;
    std::vector<ScriptDielectricTensor> tensors;
    std::vector<std::array<double, 18>> scattering;
    std::vector<std::optional<size_t>> resolved_tables;
    ~State() { if (vm) lua_close(vm); }
};
ProjectLuaSession::ProjectLuaSession() : state_(std::make_unique<State>()) {
    state_->vm = luaL_newstate();
    if (!state_->vm) throw ProjectDocumentError("Insufficient Lua session memory.");
    luaL_openlibs(state_->vm);
}
ProjectLuaSession::~ProjectLuaSession() = default;
void ProjectLuaSession::close() noexcept { state_.reset(); }
void ProjectLuaSession::install_project_arrays(const ProjectDocument& project) {
    if (!state_) throw ProjectDocumentError("Lua session is closed.");
    if (state_->project) throw ProjectDocumentError("Project arrays already installed.");
    std::deque<NumericArray> arrays;
    const auto add = [&](const char* name, int type, const char* owner, const char* field) {
        NumericArray array{name, type, {}, {}};
        for (size_t index = 0; index < project.array_size(owner); ++index) {
            const std::string path = std::string(owner) + "/" + std::to_string(index) + field;
            array.paths.push_back(path); array.values.push_back(project.number(path));
        }
        arrays.push_back(std::move(array));
    };
    add("delta",0,"/sample/layers","/delta"); add("beta",1,"/sample/layers","/beta");
    add("sigma",2,"/sample/layers","/roughness"); add("thickness",3,"/sample/layers","/thickness");
    add("deltam",4,"/sample/layers","/deltaMag"); add("betam",5,"/sample/layers","/betaMag");
    add("density",37,"/sample/layers","/density");
    add("maggamma",38,"/sample/layers","/magnetization/gamma"); add("magphi",39,"/sample/layers","/magnetization/phi");
    add("gauss_delta",11,"/sample/depthProfileFunctions","/deltaAmplitude");
    add("gauss_beta",12,"/sample/depthProfileFunctions","/betaAmplitude");
    add("gauss_variance",13,"/sample/depthProfileFunctions","/width"); add("gauss_z",14,"/sample/depthProfileFunctions","/center");
    add("par",34,"/scripts/parameters",""); add("f1",35,"/sample/elementProfiles","/f1"); add("f2",36,"/sample/elementProfiles","/f2");
    state_->arrays = std::move(arrays);
    state_->project = project;
    state_->resolved_tables.resize(project.array_size("/sample/layers"));
    state_->wavelength = 12398.326 / project.number("/experiment/energy");
    auto* first = &state_->arrays[state_->arrays.size() - 2];
    auto* second = &state_->arrays.back();
    for (size_t index = 0; index < first->values.size(); ++index) {
        const std::string path = "/sample/elementProfiles/" + std::to_string(index);
        ElementBinding binding{project.string(path + "/element"), path, first, second, index, &state_->tables,
            project.number(path + "/f1Mag"), project.number(path + "/f2Mag"), {}};
        for (size_t slab = 0; slab < project.array_size(path + "/slabs"); ++slab) {
            const std::string row = path + "/slabs/" + std::to_string(slab);
            binding.slabs.push_back({project.number(row + "/thickness"), project.number(row + "/roughness"),
                project.number(row + "/density")});
        }
        state_->elements.push_back(std::move(binding));
    }
    lua_pushcfunction(state_->vm, install_arrays); lua_pushlightuserdata(state_->vm, &state_->arrays);
    if (lua_pcall(state_->vm, 1, 0, 0) != LUA_OK) {
        const char* message = lua_tostring(state_->vm, -1);
        const std::string detail = message ? message : "Cannot install project arrays";
        close(); throw ProjectDocumentError(detail);
    }
    lua_pushcfunction(state_->vm, install_elements); lua_pushlightuserdata(state_->vm, &state_->elements);
    if (lua_pcall(state_->vm, 1, 0, 0) != LUA_OK) {
        const char* message = lua_tostring(state_->vm, -1);
        const std::string detail = message ? message : "Cannot install project elements";
        close(); throw ProjectDocumentError(detail);
    }
}
ProjectDocument ProjectLuaSession::project_snapshot() const {
    if (!state_ || !state_->project) throw ProjectDocumentError("No active Lua project workspace.");
    std::vector<std::pair<std::string, double>> edits;
    for (const auto& array : state_->arrays) for (size_t index = 0; index < array.paths.size(); ++index)
        edits.emplace_back(array.paths[index], array.values[index]);
    for (const auto& binding : state_->elements) {
        edits.emplace_back(binding.path + "/f1Mag", binding.magnetic_first);
        edits.emplace_back(binding.path + "/f2Mag", binding.magnetic_second);
        for (size_t index = 0; index < binding.slabs.size(); ++index) {
            const std::string row = binding.path + "/slabs/" + std::to_string(index);
            edits.emplace_back(row + "/thickness", binding.slabs[index][0]);
            edits.emplace_back(row + "/roughness", binding.slabs[index][1]);
            edits.emplace_back(row + "/density", binding.slabs[index][2]);
        }
    }
    return state_->project->with_calculation_numbers(edits);
}
namespace {
void validate_script_tensors(const std::vector<ScriptDielectricTensor>& tensors) {
    for (const auto& tensor : tensors) for (const double value : tensor.values)
        if (!std::isfinite(value)) throw ProjectDocumentError("Invalid script dielectric tensor");
}
}
void ProjectLuaSession::replace_scattering_tensors(const std::vector<std::array<double,18>>& tensors) {
    if (!state_ || !state_->project) throw ProjectDocumentError("No active Lua project workspace.");
    if (tensors.size() != state_->elements.size()) throw ProjectDocumentError("Scattering tensor element count changed");
    for (const auto& tensor : tensors) for (double value : tensor)
        if (!std::isfinite(value)) throw ProjectDocumentError("Invalid element scattering tensor");
    state_->scattering = tensors;
}
std::vector<std::array<double,18>> ProjectLuaSession::scattering_snapshot() const {
    if (!state_) throw ProjectDocumentError("Lua session is closed.");
    return state_->scattering;
}
void ProjectLuaSession::fill_tensors() {
    if (!state_ || !state_->tensors_installed) throw ProjectDocumentError("FillTensors: native tensor workspace is unavailable");
    const auto project = project_snapshot();
    const size_t count = project.array_size("/sample/layers");
    if (count != state_->tensors.size()) throw ProjectDocumentError("Script tensor layer count changed");
    if (state_->scattering.size() != state_->elements.size())
        throw ProjectDocumentError("FillTensors: native element scattering tensors are not available");
    const int mode = project.string("/calculation/tensorContribution") == "tetragonal" ? 1 : 0;
    const int magnetic = project.string("/calculation/magnetization/mode") == "none" ? 0 : 1;
    std::vector<ScriptDielectricTensor> tensors(count);
    for (size_t index = 0; index < count; ++index) {
        const std::string path = "/sample/layers/" + std::to_string(index);
        const RemagxLayer layer{project.number(path+"/thickness"), project.number(path+"/roughness"),
            project.number(path+"/delta"), project.number(path+"/beta"), project.number(path+"/deltaMag"), project.number(path+"/betaMag"),
            project.number(path+"/magnetization/gamma"), project.number(path+"/magnetization/phi")};
        int anisotropic = 0;
        if (remagx_dielectric_tensor(&layer, mode, magnetic, tensors[index].values.data(), &anisotropic) != 0)
            throw ProjectDocumentError("FillTensors: dielectric construction failed");
        tensors[index].anisotropic = anisotropic != 0;
    }
    std::vector<std::array<double,18>> scattering(state_->elements.size());
    for (size_t index = 0; index < scattering.size(); ++index) {
        const auto& element = state_->elements[index];
        const double factors[] = {element.first->values[index], element.second->values[index], element.magnetic_first, element.magnetic_second};
        if (remagx_scattering_tensor(factors, project.number("/calculation/magnetization/direction/gamma"),
                project.number("/calculation/magnetization/direction/phi"), mode, magnetic, scattering[index].data()) != 0)
            throw ProjectDocumentError("FillTensors: scattering construction failed");
    }
    state_->tensors = std::move(tensors); state_->scattering = std::move(scattering);
}
void ProjectLuaSession::set_delta_beta(double index, double energy) {
    if (!state_ || !state_->project || !state_->tensors_installed || !state_->tables.installed)
        throw ProjectDocumentError("SetDeltaBeta: native table/tensor workspace is unavailable");
    if (!std::isfinite(index) || std::trunc(index) != index || index < 0 || index > 9007199254740991.0 ||
        index >= static_cast<double>(state_->resolved_tables.size())) throw ProjectDocumentError("SetDeltaBeta: layer index out of range");
    if (!std::isfinite(energy)) throw ProjectDocumentError("SetDeltaBeta: energy must be finite");
    const size_t layer = static_cast<size_t>(index);
    if (layer >= state_->tensors.size()) throw ProjectDocumentError("Script tensor layer count changed");
    auto& state = state_->tables;
    auto& resolved = state_->resolved_tables[layer];
    if (!resolved) {
        const auto name = state_->project->string("/sample/layers/" + std::to_string(layer) + "/opticalTable");
        const size_t found = find_script_table(&state, name, "db");
        if (found < state.tables.size()) resolved = found;
    }
    if (!resolved) return;
    const auto& table = state.tables[*resolved];
    if (table.energies.empty() || energy < table.energies.front() || energy > table.energies.back()) return;
    const auto read = [&](size_t table_index, size_t width, double* output) {
        if (table_index == state.tables.size() || state.tables[table_index].energies.empty()) return;
        const auto& source = state.tables[table_index];
        if (source.width != width || remagx_table_lookup(source.energies.data(), source.values.data(), source.energies.size(),
                width, &energy, 1, &state.cursors[table_index], output) != 0)
            throw ProjectDocumentError("SetDeltaBeta: invalid optical table values");
    };
    double scalar[2]{}, magnetic[2]{};
    read(*resolved, 2, scalar);
    read(find_script_table(&state, table.name, "m"), 2, magnetic);
    const size_t tensor_index = find_script_table(&state, table.name, "e");
    ScriptDielectricTensor tensor{{}, false};
    if (tensor_index < state.tables.size() && !state.tables[tensor_index].energies.empty()) {
        read(tensor_index, 18, tensor.values.data()); tensor.anisotropic = true;
    }
    state_->tensors[layer] = tensor;
    const double values[] = {scalar[0], scalar[1], magnetic[0], magnetic[1]};
    const int types[] = {0,1,4,5};
    for (auto& array : state_->arrays) for (size_t field = 0; field < 4; ++field)
        if (array.type == types[field]) array.values[layer] = values[field];
}
void ProjectLuaSession::install_project_functions() {
    if (!state_ || !state_->project) throw ProjectDocumentError("No active Lua project workspace.");
    if (state_->compiled) throw ProjectDocumentError("Install project functions before compiling Lua");
    state_->functions.session = this;
    lua_pushcfunction(state_->vm, install_functions); lua_pushlightuserdata(state_->vm, &state_->functions);
    if (lua_pcall(state_->vm, 1, 0, 0) != LUA_OK) {
        const char* message = lua_tostring(state_->vm, -1);
        const std::string detail = message ? message : "Cannot install project functions";
        close(); throw ProjectDocumentError(detail);
    }
}
void ProjectLuaSession::set_layer_text(double index, bool optical_table, const std::string& value) {
    if (!state_ || !state_->project) throw ProjectDocumentError("No active Lua project workspace.");
    if (!std::isfinite(index) || std::trunc(index) != index || index < 0 || index > 9007199254740991.0 ||
        index >= static_cast<double>(state_->project->array_size("/sample/layers")))
        throw ProjectDocumentError("Layer index out of range");
    state_->project = state_->project->with_calculation_string("/sample/layers/" + std::to_string(static_cast<size_t>(index)) +
        (optical_table ? "/opticalTable" : "/material"), value);
}
double ProjectLuaSession::calculation_energy() const {
    if (!state_ || !state_->project) throw ProjectDocumentError("No active Lua project workspace.");
    return 12398.326 / state_->wavelength;
}
void ProjectLuaSession::install_solution() {
    if (!state_ || !state_->project) throw ProjectDocumentError("No active Lua project workspace.");
    if (state_->compiled || state_->solution_installed) throw ProjectDocumentError("Install solution once before compiling Lua");
    const char* names[] = {"solution_qz", "solution_R", "solution_Rp", "solution_Rm", "solution_energy"};
    std::vector<double>* columns[] = {&state_->solution.qz, &state_->solution.reflectivity,
        &state_->solution.reflectivity_plus, &state_->solution.reflectivity_minus, &state_->solution.energy};
    for (size_t index = 0; index < 5; ++index)
        state_->arrays.push_back({names[index], static_cast<int>(index + 6), {}, {}, nullptr, 0, columns[index]});
    for (auto& array : state_->arrays) array.dynamic_maximum = &state_->solution_maximum;
    lua_pushcfunction(state_->vm, install_arrays); lua_pushlightuserdata(state_->vm, &state_->arrays);
    if (lua_pcall(state_->vm, 1, 0, 0) != LUA_OK) {
        const char* message = lua_tostring(state_->vm, -1);
        const std::string detail = message ? message : "Cannot install solution arrays";
        close(); throw ProjectDocumentError(detail);
    }
    state_->solution_installed = true;
}
void ProjectLuaSession::replace_solution(const ScriptSolution& solution) {
    if (!state_ || !state_->solution_installed) throw ProjectDocumentError("No active Lua solution workspace.");
    for (const auto* column : {&solution.qz, &solution.reflectivity, &solution.reflectivity_plus,
            &solution.reflectivity_minus, &solution.energy})
        for (double value : *column) if (!std::isfinite(value)) throw ProjectDocumentError("Invalid script solution column");
    auto copy = solution;
    state_->solution = std::move(copy);
    state_->solution_maximum = static_cast<double>(state_->solution.qz.size()) - 1;
}
ScriptSolution ProjectLuaSession::solution_snapshot() const {
    if (!state_ || !state_->solution_installed) throw ProjectDocumentError("No active Lua solution workspace.");
    return state_->solution;
}
void ProjectLuaSession::install_tensors(const std::vector<ScriptDielectricTensor>& tensors) {
    if (!state_ || !state_->project) throw ProjectDocumentError("No active Lua project workspace.");
    if (state_->compiled || state_->tensors_installed) throw ProjectDocumentError("Install tensors once before compiling Lua");
    validate_script_tensors(tensors);
    state_->tensors = tensors;
    const char* names[] = {"exx_r", "exx_i", "exy_r", "exy_i", "exz_r", "exz_i",
        "eyx_r", "eyx_i", "eyy_r", "eyy_i", "eyz_r", "eyz_i", "ezx_r", "ezx_i", "ezy_r", "ezy_i", "ezz_r", "ezz_i"};
    // Deque appends preserve addresses held by existing element and array userdata.
    for (size_t offset = 0; offset < 18; ++offset) {
        const int type = static_cast<int>((offset % 2 == 0 ? 15 : 25) + offset / 2);
        state_->arrays.push_back({names[offset], type, {}, std::vector<double>(tensors.size()), &state_->tensors, offset, nullptr, &state_->solution_maximum});
    }
    lua_pushcfunction(state_->vm, install_arrays); lua_pushlightuserdata(state_->vm, &state_->arrays);
    if (lua_pcall(state_->vm, 1, 0, 0) != LUA_OK) {
        const char* message = lua_tostring(state_->vm, -1);
        const std::string detail = message ? message : "Cannot install tensor arrays";
        close(); throw ProjectDocumentError(detail);
    }
    state_->tensors_installed = true;
}
void ProjectLuaSession::replace_tensors(const std::vector<ScriptDielectricTensor>& tensors) {
    if (!state_ || !state_->tensors_installed) throw ProjectDocumentError("No active Lua tensor workspace.");
    if (tensors.size() != state_->tensors.size()) throw ProjectDocumentError("Script tensor layer count changed");
    validate_script_tensors(tensors);
    state_->tensors = tensors;
}
std::vector<ScriptDielectricTensor> ProjectLuaSession::tensor_snapshot() const {
    if (!state_ || !state_->tensors_installed) throw ProjectDocumentError("No active Lua tensor workspace.");
    return state_->tensors;
}
void ProjectLuaSession::install_tables(const std::vector<OpticalTable>& tables) {
    if (!state_) throw ProjectDocumentError("Lua session is closed.");
    if (state_->tables.installed) throw ProjectDocumentError("Lua tables already installed.");
    ScriptTables prepared{true, tables, std::vector<size_t>(tables.size(), 0)};
    for (const auto& table : tables) {
        if (table.width == 0 || table.width > 20 || table.values.size() / table.width != table.energies.size() ||
            table.values.size() % table.width != 0) throw ProjectDocumentError("Invalid Lua optical table shape");
        RemagxTable* checked = nullptr;
        const int status = remagx_table_prepare(table.energies.data(), table.values.data(), table.energies.size(), table.width, &checked);
        remagx_table_destroy(checked);
        if (status != 0) throw ProjectDocumentError("Invalid Lua optical table values");
    }
    state_->tables = std::move(prepared);
}
void ProjectLuaSession::replace_project(const ProjectDocument& project, double renew) {
    if (!state_ || !state_->project) throw ProjectDocumentError("No active Lua project workspace.");
    const auto& previous = *state_->project;
    bool same = project.string("/sample/mode") == previous.string("/sample/mode");
    for (const char* path : {"/sample/layers", "/sample/depthProfileFunctions", "/sample/elementProfiles", "/scripts/parameters"})
        same = same && project.array_size(path) == previous.array_size(path);
    for (const auto& binding : state_->elements)
        same = same && project.string(binding.path + "/element") == binding.name &&
            project.array_size(binding.path + "/slabs") == binding.slabs.size();
    if (!same) throw ProjectDocumentError("Script project structure changed; create a new session");
    const double energy = project.number("/experiment/energy");
    const double wavelength = energy == previous.number("/experiment/energy") ? state_->wavelength : 12398.326 / energy;
    if (!(wavelength > 0) || !std::isfinite(wavelength) || !std::isfinite(renew))
        throw ProjectDocumentError("Invalid script project refresh");
    // Prepare every numeric read before changing live storage; existing userdata
    // retain their binding addresses and script globals survive the refresh.
    auto arrays = state_->arrays;
    auto elements = state_->elements;
    for (auto& array : arrays) for (size_t index = 0; index < array.paths.size(); ++index)
        array.values[index] = project.number(array.paths[index]);
    for (auto& binding : elements) {
        binding.magnetic_first = project.number(binding.path + "/f1Mag");
        binding.magnetic_second = project.number(binding.path + "/f2Mag");
        for (size_t index = 0; index < binding.slabs.size(); ++index) {
            const std::string path = binding.path + "/slabs/" + std::to_string(index);
            binding.slabs[index] = {project.number(path + "/thickness"), project.number(path + "/roughness"),
                project.number(path + "/density")};
        }
    }
    state_->project = project;
    for (size_t index = 0; index < arrays.size(); ++index) state_->arrays[index].values.swap(arrays[index].values);
    for (size_t index = 0; index < elements.size(); ++index) {
        auto& target = state_->elements[index];
        target.magnetic_first = elements[index].magnetic_first;
        target.magnetic_second = elements[index].magnetic_second;
        target.slabs.swap(elements[index].slabs);
    }
    state_->wavelength = wavelength; state_->renew_optical_constants = renew;
}
ScriptHookValues ProjectLuaSession::begin_hook() {
    if (!state_ || !state_->project) throw ProjectDocumentError("No active Lua project workspace.");
    const auto& project = *state_->project;
    const ScriptHookValues result{12398.326 / state_->wavelength, project.number("/calculation/epsilon"),
        project.number("/experiment/resolution/angularFwhm"), project.number("/experiment/energyScan/qz"),
        state_->renew_optical_constants};
    state_->renew_optical_constants = 0; // Nested calls consume the cleared state.
    return result;
}
void ProjectLuaSession::apply_hook(const ScriptHookValues& result) {
    if (!state_ || !state_->project) throw ProjectDocumentError("No active Lua project workspace.");
    const double wavelength = 12398.326 / result.energy;
    if (!(wavelength > 0) || !std::isfinite(wavelength) || !std::isfinite(result.energy) ||
        !std::isfinite(result.epsilon) || !std::isfinite(result.resolution) || !std::isfinite(result.energy_scan_qz))
        throw ProjectDocumentError("Invalid script result state");
    auto project = state_->project->with_calculation_numbers({
        {"/experiment/energy", 12398.326 / wavelength}, {"/calculation/epsilon", result.epsilon},
        {"/experiment/resolution/angularFwhm", result.resolution}, {"/experiment/energyScan/qz", result.energy_scan_qz}});
    state_->project = std::move(project); state_->wavelength = wavelength;
}
void ProjectLuaSession::compile(const std::string& source, bool before_calculation) {
    if (!state_) throw ProjectDocumentError("Lua session is closed.");
    const char* name = before_calculation ? "@BeforeCalculation" : "@Default";
    if (luaL_loadbuffer(state_->vm, source.data(), source.size(), name) != LUA_OK) {
        const char* message = lua_tostring(state_->vm, -1);
        const std::string detail = message ? message : "Unknown Lua compilation failure";
        close();
        throw ProjectDocumentError("Lua compilation failed: " + detail);
    }
    lua_pushcfunction(state_->vm, install_program);
    lua_insert(state_->vm, -2);
    if (lua_pcall(state_->vm, 1, 0, 0) != LUA_OK) {
        const char* message = lua_tostring(state_->vm, -1);
        const std::string detail = message ? message : "Cannot install Lua entry function";
        close(); throw ProjectDocumentError("Lua compilation failed: " + detail);
    }
    state_->compiled = true;
}
ScriptHookValues ProjectLuaSession::run_hook(const ScriptHookValues& input) {
    if (!state_) throw ProjectDocumentError("Lua session is closed.");
    if (!state_->compiled) throw ProjectDocumentError("Lua script has not been compiled.");
    auto* vm = state_->vm;
    const int top = lua_gettop(vm);
    HookRequest request{input, {}};
    lua_pushcfunction(vm, execute_hook); lua_pushlightuserdata(vm, &request);
    if (lua_pcall(vm, 1, 0, 0) != LUA_OK) {
        const char* message = lua_tostring(vm, -1);
        const std::string detail = message ? message : "Unknown Lua execution failure";
        close(); throw ProjectDocumentError("Lua execution failed: " + detail);
    }
    lua_settop(vm, top);
    return request.output;
}
}
