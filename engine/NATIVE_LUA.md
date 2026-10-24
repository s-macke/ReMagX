# Native Lua integration in progress

`ProjectLuaSession` owns a Lua 5.4 session and isolated numeric project arrays.
It is not enabled in terminal calculations yet: nonempty enabled
BeforeCalculation scripts still reject until the complete bridge is connected.
This component does not establish full script acceptance.

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
truncate as in the legacy API. `setf` explicitly rejects until table lookup is
connected. The scalar hook return is separate from
project snapshots; energy/wavelength state application is not connected yet.

Run the focused comparison after building `project_lua_tests` and installing
app dependencies:

```
node app/scripts/test-native-lua.mjs build/engine/project_lua_tests
```

Twenty public synthetic cases compare directly with the actual Wasmoon
runtime, including persistent globals, replaced Start, numeric strings,
array aliases, element methods, failures and unchanged inputs. A separate native-only case
verifies protected global readback when a metatable throws. The existing
Wasmoon boundary panics for that case; it is not claimed as parity evidence.
No corpus or broad terminal comparison is needed for this isolated component.

Remaining work: dynamic array bounds, workspace replacement between hooks,
element table lookup, tensor/solution bindings, project functions and output, calculation-owned
hook state, nested calls and cancellation. Standard-library availability must
be reviewed against the web runtime before activating native scripts. Existing
unresolved script-semantics decisions still apply.

Lua is a system dependency, not copied from the private original program.
It uses the GPL-compatible MIT licence; see the [official Lua licence](https://www.lua.org/license.html).
Distributions containing Lua must retain its copyright and permission notice.
No native Lua binary is distributed by this increment.
