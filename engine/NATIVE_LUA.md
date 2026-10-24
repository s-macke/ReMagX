# Native Lua integration in progress

`ProjectLuaSession` owns a Lua 5.4 session and isolated numeric project arrays.
Lua-enabled builds now execute BeforeCalculation for unsegmented compound
terminal qz scans without monochromatic energy broadening. Scripts run after
optical refresh and before multilayer packing/solver calls; stderr receives
script messages. Scripted fits, element/segmented scans and energy broadening
still reject explicitly. Full script acceptance remains open.

Build with a system Lua 5.4 development library (Debian/Ubuntu:
`liblua5.4-dev`), then enable `-DREMAGX_BUILD_NATIVE_LUA=ON` when configuring
`engine/`. The default remains OFF while this bridge is in development; the
existing Docker and WASM builds do not acquire a Lua dependency. CI enables it.
Compile-time assertions require Lua 5.4 with IEEE binary64 `lua_Number`.
Local verification used Lua 5.4.9. Patch versions supplied by CI may differ.

The session compiles a program into `Start` without wrapper source lines,
resolves Start on each invocation, and exchanges energy/epsilon/resolution/
energyscan_qz/renewocs globals. Numeric strings are accepted; nonfinite values
reject. Successful return reports renewocs as zero, matching the web runtime.
Compilation/execution failure closes the session. Execution and global access
use protected Lua calls with trivial C++ locals inside the longjmp boundary.

Numeric userdata expose the existing layer, Gaussian-profile, parameter and
f1/f2 arrays, their zero-based indexing, type IDs and array.new/get/set/size.
Aliases share storage. Snapshots preserve input projects and retain double
values without formatting or rounding. Element userdata expose f1/f2 and magnetic factors, slab thickness/roughness/
density, constructor aliases and the legacy shared scratch cell. Element f1/f2
methods and the numeric arrays share storage. Fractional element/slab indices
truncate as in the legacy API. `setf` uses installed native optical tables at the exact supplied energy,
retaining lookup cursors between calls. Missing/out-of-range primary data leave
factors unchanged; absent magnetic data produce zeros. Tensor lookups advance
their cursor but do not assign tensor state. Without installed tables, `setf`
continues to reject explicitly. The explicit begin/apply hook methods exchange scalar state with the project,
retaining the legacy hc = 12398.326 energy/wavelength conversions. Project
replacement refreshes numeric storage without invalidating existing userdata or
Lua globals. Structure changes require a fresh session. The renew flag is consumed
before execution, as in the web workspace. Calculation orchestration is not yet
connected.

Prepared dielectric tensors can be installed before compilation and replaced
without invalidating aliases. All 18 component arrays use the original type IDs;
ID 24 remains unavailable. Reads as well as writes mark the touched tensor
anisotropic. Snapshots return component values and classifications independently
of the saved project. This does not yet connect tensor construction/refresh or
the solver to the script session.

Solution userdata expose qz, R, Rp, Rm and energy columns. Their declared size
stays -1; access uses the current qz length plus each column's own bound.
Replacing the solution keeps existing aliases attached. The same dynamic bound
applies to array.new(-1, type) for other arrays, as in the web runtime. Columns
remain separate; unequal lengths are preserved rather than silently padded.
Actual nested calculation callbacks have not yet been connected.

Project functions now include SetName and SetChemicalFormula with the original
argument-count, numeric/string conversion and embedded-NUL behavior. Text writes
modify existing project fields and preserve unknown metadata. Gauss-Lorentzian
helpers call the maintained native kernels at the stored calculation energy;
changing Lua's energy global alone does not alter their input energy. The original
CalculateDicReflectivity/CalculateEnergyscan no-ops remain no-ops. Deferred commands report explicit unavailability. FillTensors constructs both
layer dielectric tensors and element scattering tensors using the maintained
native kernels; it publishes only after both sets succeed. SetDeltaBeta uses
installed db/m/e tables, retaining per-layer resolution and shared table cursors.
Missing/out-of-range primary data preserve values; successful scalar refresh
replaces tensor state with imported values or the legacy zero/isotropic default.
These functions require the prepared tensor/table workspaces to be installed.

The output installer captures print/write messages through a caller-owned callback,
using the same Lua formatter as the web runtime (concatenated arguments, C-string
termination and %.14g numeric message text). Numeric workspace values are never
changed by message formatting. Library functions are captured before scripts can
replace globals. Callback failures become catchable Lua errors without C++
exceptions crossing the Lua boundary. Captured callback dependencies must outlive
the session, including Lua finalizers during close. Terminal qz integration routes messages to stderr; scientific stdout is buffered
until the whole calculation succeeds.

`ProjectScriptHook` composes the bindings into a reusable prepared project hook.
Its caller supplies current project, dielectric/scattering tensors, table cursors
and renew state. The first call initializes/compiles the selected program; later
calls preserve globals while replacing prepared workspaces. Source or structure
changes reject. Any failure closes the owned session. Success returns project,
tensor classifications, scattering tensors and updated cursors together.
The focused comparison runs this against the actual web createProjectScript
with three successive input states. Solver invocation order, fallback tensor
construction, temporary child sessions and solver-level cancellation remain integration work.

An optional stop predicate is polled before/after execution and every 1000 Lua
instructions during a hook. Cancellation and predicate exceptions latch, close
the session and prevent result publication, even when Lua catches the interrupt
and returns. This is cooperative: a script can replace debug hooks or repeatedly
catch errors, and long-running C calls are not interrupted by instruction hooks.
No process-level deadline or native one-second cancellation guarantee is claimed.
The terminal now uses the first SIGINT for cooperative Stop and restores default
SIGINT handling so a second interrupt terminates even a script that disables hooks.
The count hook is installed only when a stop predicate is supplied.

Run the focused comparison after building `project_lua_tests` and installing
app dependencies:

```
node app/scripts/test-native-lua.mjs build/engine/project_lua_tests build/wasm
```

Seventy-four public synthetic cases compare directly with the actual Wasmoon
runtime, including persistent globals, replaced Start, numeric strings,
array aliases, element methods, repeated workspace refresh, scalar writeback, native/WASM
table lookup with duplicate energies and magnetic/tensor companions, all 18
dielectric component arrays, solution replacement/dynamic bounds and retained
aliases after tensor refresh, project text/functions, tensor construction and
compound table refresh, captured print/write output and callback failures,
complete prepared project hooks, and
unchanged inputs. Six native-only cases cover cooperative cancellation and normal continuation,
plus protected global readback when a metatable throws. The existing
Wasmoon boundary panics for that case; it is not claimed as parity evidence.
No corpus or broad terminal comparison is needed for this isolated component.

Remaining work: calculation functions, calculation-owned
hook state, nested calls and process-level cancellation. Standard-library availability must
be reviewed against the web runtime before activating native scripts. Existing
unresolved script-semantics decisions still apply.

Lua is a system dependency, not copied from the private original program.
It uses the GPL-compatible MIT licence; see the [official Lua licence](https://www.lua.org/license.html).
Distributions containing Lua must retain its copyright and permission notice.
No native Lua binary is distributed by this increment.
