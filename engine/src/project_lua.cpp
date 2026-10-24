#include "remagx/project_lua.hpp"
#include <lua.hpp>
#include <cmath>
#include <limits>
#include <type_traits>
#include <optional>
#include <vector>

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
    if (value < 0 || value > handle->maximum || value >= static_cast<double>(handle->array->values.size()))
        luaL_error(vm, "%s: index out of range", handle->array->name);
    return static_cast<size_t>(value);
}
int array_get(lua_State* vm) {
    auto* handle = array_handle(vm); const size_t index = array_index(vm, handle);
    lua_pushnumber(vm, handle->array->values[index]); return 1;
}
int array_set(lua_State* vm) {
    const double value = numeric_argument(vm, 3, false);
    auto* handle = array_handle(vm); const size_t index = array_index(vm, handle);
    handle->array->values[index] = value; return 0;
}
int array_size(lua_State* vm) { lua_pushnumber(vm, array_handle(vm)->maximum); return 1; }
void push_array(lua_State* vm, NumericArray* array, double maximum) {
    auto* handle = static_cast<ArrayHandle*>(lua_newuserdatauv(vm, sizeof(ArrayHandle), 0));
    *handle = {array, maximum}; luaL_getmetatable(vm, "LuaBook.array"); lua_setmetatable(vm, -2);
}
int array_new(lua_State* vm) {
    auto* arrays = static_cast<std::vector<NumericArray>*>(lua_touserdata(vm, lua_upvalueindex(1)));
    const double maximum = numeric_argument(vm, 1, true), type = numeric_argument(vm, 2, true);
    for (auto& array : *arrays) if (type == array.type) { push_array(vm, &array, maximum); return 1; }
    return luaL_error(vm, "array.new: unsupported type");
}
int install_arrays(lua_State* vm) {
    auto* arrays = static_cast<std::vector<NumericArray>*>(lua_touserdata(vm, 1));
    luaL_newmetatable(vm, "LuaBook.array");
    lua_pushcfunction(vm, array_get); lua_setfield(vm, -2, "__index");
    lua_pushcfunction(vm, array_set); lua_setfield(vm, -2, "__newindex"); lua_pop(vm, 1);
    lua_newtable(vm);
    lua_pushlightuserdata(vm, arrays); lua_pushcclosure(vm, array_new, 1); lua_setfield(vm, -2, "new");
    lua_pushcfunction(vm, array_get); lua_setfield(vm, -2, "get");
    lua_pushcfunction(vm, array_set); lua_setfield(vm, -2, "set");
    lua_pushcfunction(vm, array_size); lua_setfield(vm, -2, "size"); lua_setglobal(vm, "array");
    for (auto& array : *arrays) { push_array(vm, &array, static_cast<double>(array.values.size()) - 1); lua_setglobal(vm, array.name); }
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
    std::optional<ProjectDocument> project;
    std::vector<NumericArray> arrays;
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
    std::vector<NumericArray> arrays;
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
    lua_pushcfunction(state_->vm, install_arrays); lua_pushlightuserdata(state_->vm, &state_->arrays);
    if (lua_pcall(state_->vm, 1, 0, 0) != LUA_OK) {
        const char* message = lua_tostring(state_->vm, -1);
        const std::string detail = message ? message : "Cannot install project arrays";
        close(); throw ProjectDocumentError(detail);
    }
}
ProjectDocument ProjectLuaSession::project_snapshot() const {
    if (!state_ || !state_->project) throw ProjectDocumentError("No active Lua project workspace.");
    std::vector<std::pair<std::string, double>> edits;
    for (const auto& array : state_->arrays) for (size_t index = 0; index < array.values.size(); ++index)
        edits.emplace_back(array.paths[index], array.values[index]);
    return state_->project->with_calculation_numbers(edits);
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
