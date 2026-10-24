# Native terminal integration

`remagx-terminal` is a native C++ executable linked to the same numerical core as
WebAssembly. It does not use Node, the browser, private original sources, or the
original optimizer. Command integration is partial; the D-35 checklist item remains
open.

```sh
cmake -S engine -B build/engine -DCMAKE_BUILD_TYPE=Release
cmake --build build/engine --target remagx_terminal --parallel 2
build/engine/remagx-terminal -v
build/engine/remagx-terminal -refl project.json
build/engine/remagx-terminal -dicrefl project.json
build/engine/remagx-terminal -refl project.all
build/engine/remagx-terminal -fit project.json > fitted.json
```

Input is a validated version-1 JSON project or an imported legacy `.all` file.
The `.all` extension is case-insensitive; reports and unknown-key summaries go to
stderr. Legacy files are read-only. See `NATIVE_PROJECT.md` for import rules. The supported
calculation path supports compound mode with manual or automatic optical constants,
Nevot–Croce or adaptive compound roughness, and element mode with saved or automatically refreshed factors/tensors.
Scripted paths currently require an optional Lua-enabled build and are limited as described below. Parratt, Matrix and Zak support both complex beams,
analyzers, magnetic/tetragonal settings and exact/fast angular convolution.
Manual compound preparation rebuilds dielectric tensors from scalar values, as the web
engine does; stored automatic tensor overrides are ignored in manual mode.
Density is not multiplied into already supplied compound optical constants.

Element preparation samples each profile through the existing native density kernel
using the D-41 double-erf lookup, then combines saved f1/f2 and magnetic factors
through the shared optical kernel. The original fixed-step grid, thickest-profile
roughness margin, tolerance-based layer reduction and final-sample replacement
are retained; no values are rounded. Manual Matrix calculations preserve saved scattering
tensors (absent tensors start at zero), and every generated tensor is classified
anisotropic, including boundaries. Density batches hold at most 256 values per
element. Compound multilayer patterns and compound segmentation/profile settings
do not apply to this conversion. Each broadened energy sample regenerates its
stack at that energy. Empty/invalid density profiles,
nonadvancing/excessive grids and single-row conversion reject before curve output.

Enabled multilayer patterns expand before solver packing, including nested
repetitions, zero repetitions and explicit duplicate substrate/ambient references.
The implicit substrate and ambient are retained. Defined original character
handling is preserved (ignored characters can join digits; a top-level `)` or NUL
terminates parsing). The web parser's safe-integer, depth-128 and 100,000-layer
limits apply; malformed/out-of-range/oversized patterns fail without partial
output. Each repeated row copies all optical values, roughness and local magnetic
directions before Matrix tensor construction.

Adaptive compound segmentation composes the existing native density sampler and
subdivision core with the approved full-double error-function lookup. Global and
local overlap models retain their distinct tensor arithmetic, including four
independent reusable tensor states. Depth bounds, exclusion of ambient from the
anisotropy classification scan, zero generated roughness and default 90° magnetic
directions follow the existing web/original preparation. Imported or retained
matrix tensors are prepared before sampling. Expanded multilayer stacks are
segmented separately at each energy sample; stored input layers remain intact.

Generated stacks are limited to one million rows. Invalid minimum/maximum steps,
numerical sampling errors or a single generated row reject before output. Single
row support remains a separate physics decision. Magnetic profile mode now applies mixed Gaussian/spline functions at adjacent
segment midpoints, with the original reversed layer bindings and density weights.
Stored layer depths are expanded by the multilayer mapping without rebuilding
cumulative depths across repeats. The substrate sample is skipped. Sum/product
application preserves profile order; zero amplitudes and the original none-binding
sentinel skip before binding or spline evaluation. Stored amplitude/width coupling
references remain metadata, matching the active original implementation. Prepared
Matrix tensors are not altered by this scalar profile stage.

Invalid original-stack bindings and the undefined first usable spline knot still
reject explicitly; their existing D-29 decisions remain open.

Automatic compound constants use `.db` (delta/beta), `.m` (magnetic constants)
and `.e` (18 tensor components) files. Like the original terminal, names resolve
relative to the **current working directory**, not automatically beside the JSON
file. Run the command from the table directory; names are exact and extensions
are appended without case folding or path rewriting. Tables are loaded once per
name and refreshed in stored layer order before multilayer expansion. Scalar
and tensor interpolation use the shared native lookup with per-table cursors.

Missing/empty/out-of-range primary tables retain saved optical fields and tensor
classification, with stderr warnings. Successful primary lookups replace scalar
values; absent magnetic companions clear magnetic constants. Nonempty `.e`
companions supply anisotropic tensors, including the original zero lookup outside
the companion's range. Missing `.e` companions cause scalar tensor construction
only after a successful primary refresh. Manual mode ignores all table files and
rebuilds tensors. The saved project and files remain unchanged.

The reader accepts whitespace-separated decimal/scientific finite double values,
ignores blank/comment lines, sorts energies stably and reports skipped malformed
rows and extra columns on stderr. Such diagnostics do not echo file contents.
Unreadable/nonregular table files fail explicitly.

Automatic element constants use exact-name `.ff` and `.ffm` files from the same
working directory. Missing/empty/out-of-range primary data retain existing factors
and scattering tensors with a warning. Successful refresh clears absent magnetic
factors and constructs current scattering tensors with the global direction,
magnetization and tensor settings. Factors, tensors and interpolation cursors carry
between energy samples. A nonempty `.F` companion rejects only when its primary
refresh is reached, pending the original cross-element assignment decision.

With `useChantlerDatabase`, missing/empty `.ff` data fall back to the same embedded
asset as the web app. Nonempty local data take precedence even outside their range;
magnetic/full-tensor companions remain attached. Exact-case, first-match symbol
lookup preserves the original duplicate Ti entry and unavailable Tl name. The
native build embeds `app/src/data/chantler.json`, including its copyright and
permission metadata, and derives symbols from `legacyAtomicMasses.ts`. No private
source or network fetch is needed. D-37 permits redistribution; D-38 uses only the
277 stored uranium rows. The data retain the NIST/U.S. Secretary of Commerce
copyright notice in the source asset and embedded binary. Manual mode ignores all
files and the database fallback.

The terminal preserves the original command's coordinate convention:

- Generated grids have `points` entries from zero through `qzMax`, inclusive;
  `qzMin` is ignored. The web UI uses its separate existing grid convention.
- Dataset grids retain order, duplicates and negative coordinates. The terminal
  adds the saved `qzShift` once, including shifts smaller than 1e-10, matching the
  original terminal's direct addition. No data column or saved project is changed.
- `-refl` prints `qz R`; `-dicrefl` prints `qz Rp Rm`. Output uses the classic locale
  and 17 significant digits, sufficient to recover each double without reducing
  it to measurement precision. There are no headers or progress messages on stdout.

The integrated postprocessing applies qz^4, the pure-pi correction, then the
original moving average. Monochromatic Fourier processing follows these steps
through the existing core transform; its first output column contains depth in
Angstrom and the row count is halved. Dichroic Fourier remains explicitly
unavailable pending the recorded column-semantics decision.

Polarization correction follows the original terminal's **dataset** metadata,
not the solver's experiment settings. A generated grid has the original default
first sigma beam, second pi beam and 10 eV dataset energy. A measured grid uses
the selected dataset's beams and energy (or its per-point energy column). The
terminal adds qzShift but does not apply the saved energyShift to that column.
These conventions can yield surprising corrections; they are preserved rather
than silently replaced with the web UI's preparation behavior. The actual solver
still uses the experiment energy and beams.

Monochromatic energy broadening above 1e-6 eV evaluates the existing nineteen-point
quadrature at fixed angles. Optical state and table cursors carry between samples;
range-skipped layers retain their most recently prepared values. Each sample uses
a fresh default dataset for postprocessing, so measured energy columns and pi
correction do not propagate into these samples. qz^4 and averaging happen before
weighted summation. The returned coordinates are the original terminal grid;
negative coordinates use the original zero-angle sample behavior. Repeated
missing/range warnings are emitted once. Nonpositive/nonfinite sample energies
or any numerical failure reject the whole calculation without partial output.

Widths at or below 1e-6 eV keep the unbroadened path. The original dichroic qz route
does not use this energy broadening setting. Broadening together with Fourier
remains explicitly unavailable, as in the web implementation, pending review of
the original mismatched array lengths.

Remaining Lua integration, standalone energy-scan commands, transactional file replacement
and `-convert` remain to be integrated. `-map` follows the separately
agreed map implementation. Unsupported commands/settings report an error; they
never run a simplified calculation while silently ignoring active preparation.
The original terminal's broken `.db`/`.m` → `.e` conversion is a separate pending
decision and is not implemented here.

An invalid invocation returns exit code 2. Input/calculation failures return 1
and report a bounded diagnostic to stderr, without scientific output. The entire
curve and its text representation are prepared before stdout is written. An OS
output failure can still interrupt that final write; this is not transactional
filesystem output. Valid calculations and `-v`/`--help` return 0. Original input
files are opened read-only.

Validation uses public synthetic projects only:

```sh
node app/scripts/test-native-terminal.mjs build/engine/remagx-terminal build/wasm
```

275 cases compare 2,903 output values with actual WASM through the production web
preparation at unchanged D-23 tolerance. They cover all three solvers, both modes,
complex beams, analyzers, both angular convolution paths, tetragonal/nonmagnetic
settings, qz^4, polarization correction with independent dataset/solver metadata,
monochromatic Fourier, energy-width thresholds, both angular convolution paths
combined with energy broadening, serial partial table refresh, global/local
segmentation across all solvers/modes, segmented Matrix energy broadening and
imported tensor composition, mixed Gaussian/spline sum/product profiles with
layer binding and energy broadening, manual element density/optical conversion,
stored/missing scattering tensors, element grid/reduction and energy broadening,
automatic scalar/magnetic refresh, serial range skips, .F rejection, built-in
Chantler fallback, local precedence, exact-case Ti/Tl lookup and uranium, averaging,
shifted/unsorted/repeated coordinates and eight
multilayer patterns across all solvers and both output modes. Dedicated native
parser tests cover limits, empty groups, nested patterns, ignored characters,
embedded NUL and recovery. Further
checks cover automatic scalar/magnetic/tensor refresh, retained isotropic and
anisotropic state, missing/empty/out-of-range tables, malformed-row diagnostics,
nonregular file errors, explicit unsupported operations, malformed schema, invalid qz,
numerical overflow, missing input, input preservation and successful recovery.
The existing tetragonal/magnetization-off singularity at zero incidence is checked
against the WASM numerical-error status; it is not hidden by shifting coordinates
or substituting a result. Direct `.all` entry-point checks cover both commands/all three solvers, report
visibility, input preservation, invalid versions/schema and Lua failures and unsupported scripted paths.
Native/web schema and bit-exact serialization checks
remain separate. These checks establish the implemented integration, not full
original-terminal or full-corpus acceptance.


## Fitting

`-fit project.json` (or `.all`) initializes stored tensors/optics, validates active
data and runs the maintained adaptive Simplex or seeded annealing optimizer. It
supports qz/energy and mixed datasets through the native objective, including
ordered bounds, fixed rows, serial optical state and Q reference callbacks.
The best evaluated project is serialized as version-1 JSON on stdout; input files
are never rewritten. Error, iteration/evaluation counts and termination code go
to stderr (0 converged, 1 evaluation limit, 2 iteration limit, 3 stopped). Redirect
stdout to a new filename to keep the result. The output is prepared in memory
before writing; OS write failures are not transactional.

Defaults match the web optimizer: 10,000 evaluations, 5,000 iterations, normalized
parameter tolerance 1e-9 and objective tolerance 1e-14. These are optimizer stopping
settings, not measurement rounding or changes to numerical comparison tolerance.
Ctrl+C requests cooperative cancellation between objective calls and returns the
best evaluated project if one exists; stopping before any candidate is an error.
The callback-level Stop-before-start path is tested; OS-signal timing is not yet
covered by an automated test. Scripted fitting remains unavailable; the compound qz script path is described below.

The focused fit-start gate now covers 47 actual-WASM initialization/optimizer
cases: three solvers, adaptive/annealing, explicit Q references, work limits,
fixed rows, Stop-before-start, failure and recovery. CLI smoke checks cover qz and
energy fitted JSON, missing-table failure with empty stdout and input preservation.
No original-optimizer convergence/corpus acceptance is implied.

## Qz scripts

Install system Lua 5.4 development headers/library and configure with
`-DREMAGX_BUILD_NATIVE_LUA=ON` to enable BeforeCalculation for `-refl`/`-dicrefl`
in compound mode with Nevot-Croce or adaptive segmentation, or in element mode,
without monochromatic energy broadening. Default/Docker builds without this option still reject active scripts.
Automatic table refresh precedes the hook; scalar values, tensors, energy,
angular width and epsilon then feed the three existing solvers. Script output
is sent to stderr. Project inputs stay unchanged and failures publish no
scientific stdout. Scripted fit/energy-broadened paths remain unavailable.

The first Ctrl+C requests cooperative Stop; a second Ctrl+C terminates the
process using default SIGINT handling, including scripts that disable debug hooks.
This does not impose an automatic wall-clock deadline. The focused gate covers
36 native/actual-WASM comparisons, three rejection cases and two real SIGINT
checks (cooperative loop and disabled-hook loop):

```
node app/scripts/test-native-scripted-qz.mjs build/engine/remagx-terminal build/wasm
```

The original all-zero-tensor fixture failed in both native and WASM Matrix:
SetDeltaBeta without an imported tensor followed by direct tensor access marks
the zero tensor anisotropic. The valid integration fixture explicitly calls
FillTensors before component editing. No solver or tolerance was changed.

Segmented compound scripts preserve the pre-hook stored depths for magnetic-profile
binding while using post-hook thicknesses, optical constants and profile amplitudes
for adaptive sampling/application. The focused comparisons include bound profiles
and Lua thickness/center/amplitude edits with all three solvers and both beam modes.

Element qz hooks run after factor refresh and before density sampling/conversion.
Current f1/f2/magnetic factors, slab edits, stored/refreshed scattering tensors and
script energy feed the prepared conversion without a second table refresh.
The inactive compound film retains its stored tensor state for Lua access. Tests
cover manual/automatic factors, element.setf, shared f1 arrays, density/thickness
edits and FillTensors across all solvers and both beam modes. The unresolved .F
assignment decision still applies; no tensor-refresh correction is introduced.
