# Lua API audit — 2026-10-25

This is the source/binding audit for checklist I3, not full script acceptance.
Scope follows D-22, D-25 and D-43; final real-project evidence belongs to A5.
No legacy source, private project or Numerical Recipes implementation is copied here.

## Sources and current integration

Original registrations: `old/reMagX3/shared/script.cpp` (constructor and StartScript),
`scriptmetaarray.cpp`, `scriptmetaobject.cpp` and `scriptfunctions.cpp`. The original
files were read in place and remain unchanged. Extraction from script.cpp found
15 function registrations and 39 initialized array names/type IDs.

Current web implementation:
[bindings](../../app/src/compute/lua/functions.ts),
[arrays](../../app/src/compute/lua/arrays.ts),
[elements](../../app/src/compute/lua/elements.ts),
[runtime](../../app/src/compute/lua/runtime.ts),
[calculation integration](../../app/src/compute/lua/beforeCalculation.ts).
The native counterparts are in [project_lua.cpp](../../engine/src/project_lua.cpp)
(including ProjectScriptHook).
The native library requires a Lua-enabled build; no-Lua builds reject scripts.

“Implemented” below means registration and a connected implementation exist in
both runtimes. It does not imply all legacy argument/error edge cases or arbitrary
scripts have been accepted. Existing tests are evidence, not fresh runs in this audit.

## Registered functions

| Original name | Web and native status | Evidence / remaining qualification |
|---|---|---|
| print | Implemented output binding | output.ts / native output installer; luaOutput tests and native parity driver |
| write | Implemented output binding | Same captured output path; preserves original concatenation semantics |
| CalculateReflectivity | Explicit excluded-command error | D-43; named source-line failure, not a missing global |
| FillTensors | Implemented | scriptOptics / native tensor workspaces; layer and element tensors |
| CalculateDicReflectivity | Registered original no-op | Original function bodies return zero Lua results; luaFunctions tests |
| CalculateEnergyscan | Registered original no-op | Same; this does not disable ordinary energy scans |
| ShowMatrixEigenvalues | Named deferred-feature error | Deferred tooling under D-22/D-25; no undefined global |
| ShowEScanEigenvalues | Named deferred-feature error | Same |
| GetError | **Missing in both bindings** | GUI calculates a new fit objective; non-Borland original returns zero. Scope question is pending; see below |
| SetChemicalFormula | Implemented | Workspace text update; native/Wasmoon argument/text cases |
| SetName | Implemented | Optical-table name update; shared lookup/cache behavior |
| SetDeltaBeta | Implemented | scriptOptics and native table refresh; partial/range handling |
| KramersKronigRange | Named deferred-feature error | D-25; Kramers-Kronig fitting remains deferred |
| GetGaussLorentzianImag | Implemented | Maintained double kernel through both bindings |
| GetGaussLorentzianReal | Implemented | Maintained double kernel through both bindings |

There are eight implemented calculation/text/output functions, two original no-ops,
three explicit deferred commands, one approved exclusion and one missing command.
GetError must not be treated as covered by the CalculateReflectivity exclusion.

## Arrays: all 39 initialized names

| Original type IDs | Names | Current backing |
|---|---|---|
| 0–5 | delta, beta, sigma, thickness, deltam, betam | scriptArrays layer workspace / native project arrays |
| 6–10 | solution_qz, solution_R, solution_Rp, solution_Rm, solution_energy | scriptSolution / native solution workspace; see limitation below |
| 11–14 | gauss_delta, gauss_beta, gauss_variance, gauss_z | scriptArrays profile workspace / native project arrays |
| 15–23 | exx_r, exy_r, exz_r, eyx_r, eyy_r, eyz_r, ezx_r, ezy_r, ezz_r | scriptTensors / native tensor component arrays |
| 25–33 | exx_i, exy_i, exz_i, eyx_i, eyy_i, eyz_i, ezx_i, ezy_i, ezz_i | Same, imaginary components |
| 34 | par | Script fit-parameter workspace |
| 35–36 | f1, f2 | Element factor workspace shared with element objects |
| 37–39 | density, maggamma, magphi | Layer scalar/direction workspace |

`array.new`, `array.get`, `array.set`, `array.size` and bracket access exist in both
runtimes. Names/type IDs match the original initialization list. ID 24 is an enum
entry without an initialized name or valid value accessor in the original; it is
explicitly rejected, not a missing supported tensor array.

Arrays use the original highest-index convention, including -1; aliases share
backing data. Solution arrays preserve separate column lengths and dynamic qz
bounds. The solution workspaces are implemented, but production hooks initialize
an empty solution and do not publish nested CalculateReflectivity results: that
command is excluded by D-43. Do not infer another solver-publication requirement
from retained array userdata. Tensor component access marks its tensor anisotropic,
matching the original accessor side effect.

Bounds and finite-value checks avoid undefined original memory access. Fractional
array arguments are still rejected pending the policy resolution below. This is
not a claim of complete legacy integer-conversion parity.

## Element objects and hook globals

Both runtimes register `element` and per-element named userdata. Their 18 methods
are accounted for: `new`; `getf1`, `getf2`, `getf1m`, `getf2m`; `setf1`, `setf2`,
`setf1m`, `setf2m`; `setf`; `getsigma`, `setsigma`; `getthickness`, `setthickness`;
`getdensity`, `setdensity`; `get`, `set`.

Factor/slab methods use the corresponding element workspace, with aliases shared
with f1/f2 arrays. `setf` copies scalar factors only and advances companion-table
cursors; D-45 full-tensor assignment belongs to optical refresh, not this method.
`get`/`set` preserve the original process-wide scratch value rather than acting as
slab accessors. Constructor/slab indices use direct C conversion in the original;
current bindings truncate them separately from the array policy.

The five StartScript globals are present in both runtimes: `energy`, `epsilon`,
`resolution`, `energyscan_qz`, `renewocs`. The first four are read back; renewocs is
an invocation input consumed by the calculation lifecycle. `Start` is compiled
from Default/BeforeCalculation code and remains mutable, as in the original.
The original duplicates one energy assignment; that is not a second global.

`CScriptPointer` and registry entries `state`, `chart`, `debugwindow` are original
host implementation handles used by its callbacks. Current callbacks use owned
host workspaces instead of exposing those raw pointers; they are not numerical
project variables. Standard Lua libraries are a separate Lua 5.1→5.4 compatibility
surface under D-2, not additional ReMagX registrations. Native/Wasmoon library and
real-script compatibility remains part of A5; native OS facilities must not be
mistaken for browser facilities.

## Concrete unresolved work

1. **GetError:** the outer `#ifdef __BORLANDC__` at scriptfunctions.cpp:293 selects
   the GUI implementation at line 458; its `#else` selects the zero-return stub at
   line 710. The GUI creates CMultiFit and calls Error with an empty variable vector.
   Implementing it requires the objective, hook lifetime/recursion, state and failure
   behavior, not a constant-zero stand-in. Asked the user whether to retain this
   script-only command or explicitly exclude it. Neither answer is inferred; normal
   UI chi-squared and fitting remain in scope and operational.
2. **Fractional array arguments:** original array.new sizes/type IDs and array
   indices use luaL_checkint. A follow-up binary/source trace now establishes which
   branch the supplied GUI library uses; see the artifact evidence below. It uses
   the Lua 5.1 add-large-constant conversion, yielding nearest-even integers under
   the normal nearest rounding mode. Current web/native bindings reject fractions.
   Asked whether to adopt that ordinary original conversion for valid array
   arguments, or approve continued explicit rejection as a documented deviation.
   No answer is inferred. Out-of-range/invalid access remains an error, and the
   separate direct-cast element/slab argument policy is unchanged.
3. **Final integration acceptance:** existing alias, tensor, factor, solution,
   output, hook lifecycle, native parity and worker tests establish their stated
   cases. A5 still requires representative original-script review, including
   standard-library differences and final error/cancellation/data preservation.

I3 remains open for the first two items. This audit found no further missing named
ReMagX registration in the enumerated supported surface; that finding does not
certify every semantic edge case or constitute final A5 acceptance.

## Fractional-index artifact evidence (follow-up, 2026-10-25)

The original `guidll/guidll.cbproj` explicitly links
`shared/lua/lib/lua5.1.lib` for Win32 and compiles the script/array bindings. This
library is a Borland-compatible OMF archive, not proof of a modern rebuild's
compiler choices. Its public symbol `_lua_tointeger` is in segment 1 at offset
0x670 in its object module. A read-only OMF record inspection recovered the
92-byte function/data span and its add-constant conversion sequence.

The corresponding span occurs exactly once in the supplied `bin/guidll.dll`,
at file offset 0x137fcc: 84 bytes match, with only the eight relocation operand
bytes for one external call and the constant address masked. The linked constant
at virtual address 0x538a24 is exactly 6755399441055744. The code loads the argument,
adds that constant, stores a double and returns its low integer word. This is the
non-Microsoft Pentium branch in the bundled luaconf.h, not the truncating cast
branch. The source `luaL_checkinteger` calls lua_tointeger; `luaL_checkint` then
casts that returned integer, and the array binding uses it for size/type/index.

Artifact SHA-256 identifiers (files remain private and unchanged):

- `shared/lua/lib/lua5.1.lib`:
  `dac2e3e05e5b5a40fd3497cc33ddd93660ae82a15c103f654da67d9991510990`
- `bin/guidll.dll`:
  `d451f2a81975a6a257fd44c1b7d682feba7a108e6cf3ab73f2f3f9494d048002`

For ordinary in-range values under round-to-nearest, the routine yields nearest
integers with ties to even. This establishes the compiled branch for these two
artifacts. No live GUI floating-point control word or original script execution
was measured in this trace; it does not establish behavior under deliberately
altered rounding modes, overflow or malformed array accesses. No private binary,
object bytes, disassembly listing or original-source modification is committed.
The proposed implementation policy concerns only integer API arguments; it does
not quantize stored project values or any numerical calculation. I3 stays open
for the explicit policy choice and GetError decision.
