# Native project documents

The `remagx_project` C++17 library provides an immutable document boundary for
version-1 `remagx-project` JSON. It has no dependency on the private original tree,
Node or the WASM runtime. It supplies the document boundary for the partial
[native terminal integration](NATIVE_TERMINAL.md); full terminal support remains open.

```sh
cmake -S engine -B build/engine -DCMAKE_BUILD_TYPE=Release
cmake --build build/engine --target project_document_tests --parallel 2
ctest --test-dir build/engine -R '^(project_document|double_precision_gate)$' --output-on-failure
# After app dependencies are installed; validation tooling only, not a runtime dependency:
node app/scripts/export-project-schema.mjs --check
node app/scripts/test-native-project.mjs build/engine/project_document_tests
```

`remagx/project_document.hpp` exposes parsing, serialization, JSON-pointer numeric
reads and immutable numeric replacement, plus typed string/boolean/null/array-size
queries for native preparation. A replacement requires an existing
numeric target; it cannot silently create keys or grow arrays. Failed parsing or
editing leaves the original document unchanged. The class handles JSON text;
filesystem transactions belong to the future CLI/file layer.

The parser checks the complete exported version-1 web schema, including nested
field types, choices, numeric bounds, integer constraints, tensor lengths, minimum
layer count and equal lengths of known dataset columns. Immutable edits undergo
the same validation. **Calculation capability and runtime checks remain separate
work.** Schema validity alone does not establish that a solver supports a project.
Unknown members
are retained, including metadata the current engine does not interpret. Duplicate
keys are rejected instead of silently discarding an earlier value. Nesting beyond
256 levels, unescaped NUL, malformed JSON and overflowing numbers fail explicitly;
error messages do not quote input strings or scripts.

All numeric tokens become doubles, matching browser `Number` storage. The parser
preserves integer `-0`, escaped strings and the full range of finite doubles.
Serialization uses a representation that parses back to the same double, without
rounding values to a fixed number of decimal places. Tests compare double bits for
negative zero, subnormals, very small/large values and adjacent representable
numbers; native numeric edits retain unrelated fields and source isolation.

The native parser is the unmodified, hash-pinned MIT-licensed nlohmann/json 3.12.0
single header (see `third_party/nlohmann_json/README.md`). It is built only for
native targets; browser model and WASM numerical assets do not include it.

The cross-language check round-trips the default project and four public legacy
fixtures after import through the existing web model. It verifies every field,
extra metadata and double values, then validates the result with the actual web
schema. It runs in Pages CI after native tests and app dependency installation.
It also compares acceptance of 2,311 synthetic field/boundary mutations against
the actual web validator, including optional fields, nullable indices, all enum
choices, safe integers, array lengths and unknown dataset columns. It does not use
the private corpus or establish native solver parity.

The committed `schema/project-v1.schema.json` is generated from
`app/src/model/project.ts`; CMake embeds it without requiring Node. After changing
the web schema or defaults, run `node app/scripts/export-project-schema.mjs` and
review both generated files. CI checks freshness. The exporter rejects unsupported
schema keywords and unmapped custom refinements; the native interpreter also
rejects unknown schema keywords. Dataset column-length equality is the one
explicit custom extension. The interpreter supports only this exported subset,
not arbitrary third-party JSON Schema documents. Unknown project fields remain
preserved, while the web validator accepts and strips them.

## Legacy `.all` import

`parse_legacy_assignments` provides the native `.all` lexical boundary. It accepts
UTF-8 bytes using the web importer's replacement decoding and initial-BOM handling,
retains line numbers and comment markers, removes CR characters and ordinary
spaces according to the existing loader rules, and preserves the separate script
text representation. Tabs are not removed. A final assignment without a newline
is returned with an explicit diagnostic flag, matching the web importer; the
original loader ignores that final line.

`legacy_number_prefix` recognizes decimal/integer prefixes as the web importer
does, including Unicode leading whitespace, incomplete exponents, signed zero,
subnormals and overflow. Both paths store doubles. Missing prefixes return no
value so the eventual importer can retain the field default with a warning;
overflow remains nonfinite for subsequent schema rejection rather than silently
saturating to the largest double.

`import_legacy_project` maps complete assignments to a validated `ProjectDocument`
and a structured import report. It preserves ordered layer/element/profile/fit and
dataset sections, legacy z-to-thickness conversion, spline pairing, dataset-column
repairs, placeholder active-index mapping, script text and fit-id/initial-step
semantics. Unsupported old tabular versions reject; schema-invalid/nonfinite
projects cannot become calculation inputs. A final finite-value walk prevents
JSON serialization from turning nonfinite nullable fields into accepted nulls.

Legacy defaults, row defaults, fit-id names and intentionally ignored-key reasons
are exported from the authoritative web importer into the committed
`schema/legacy-import-defaults.json`. The existing schema export/check command
maintains both assets. No TypeScript or Node runtime is required by the terminal.

The report records messages with severity and optional source line, and every
unknown key with its count and first line. Native wording is concise English;
message severity/line order and unknown-key records agree with the web importer.
Public/synthetic comparisons cover 978 cases; the opt-in private comparison passes
all 99 projects with every imported project field matching. This is import parity,
not numerical acceptance of those projects. Run the public comparison with
`node app/scripts/test-native-import.mjs build/engine/legacy_import_tests`; set
`CORPUS_DIR` for private inputs, which stay in memory and never enter diagnostics.

The terminal recognizes `.all` extensions case-insensitively and prints import
reports to stderr before calculating. It never writes legacy files. Imported Lua
and other unsupported calculation capabilities still reject explicitly.
The maintained `test-native-assignments.mjs` check compares 1,372 public/synthetic
inputs against production web tokenization and its number-prefix rules, and runs
in Pages CI. Native project-schema and numerical gates remain separate.

## Native fit initialization

`ProjectFitSpace` prepares the same dimensionless axis simplex as the web's real
fit runner. It clips starting values with ordered lower/upper comparisons,
retains fixed rows outside the free dimensions, ignores saved step metadata and
uses the legacy five-percent initialization rule with its documented fallbacks.
Adjacent/subnormal intervals retain a distinct endpoint when a computed addition
cannot move the origin. Decoding preserves zero-coordinate origins exactly and
rejects nonfinite candidates; `bound` clips only at candidate application time.
An empty simplex means the eventual runner must evaluate the fixed candidate once.

`fit_regularization` consumes an explicit reference vector and retains the
candidate-based `abs(value) < 1e-6` threshold and ordered multiplication/accumulation
from the original objective. The caller must maintain the different ordinary
Simplex and annealing reference lifetimes; this helper does not invent or update
the reference. Nonfinite inputs/results reject, including invalid vectors when Q
is zero. No parameter or project is mutated.

These are preparation components, not a finished `-fit` command. Serial
dataset/optical/script evaluation, optimizer callbacks, result selection and fitted
JSON output remain to be connected. Parameter application is described below. The public
`test-native-fit-space.mjs` gate compares 259 synthetic cases with the production
web preparation, including fixed/mixed scales, duplicate targets, clipping,
signed zero, adjacent/subnormal bounds, overflow and Q thresholds. No original
optimizer source or trajectory equivalence is involved.


## Fit candidates and persistence

`apply_project_fit_parameters` applies bounded candidate values in fit-row order.
Compound fields and magnetization directions use the layer index; profiles,
elements and slabs retain their respective selectors. Angular resolution updates
the experiment and enabled datasets; intensity scaling updates enabled datasets
only. Qz/energy shifts use the supplied current dataset even when it is inactive.
Missing script slots are skipped while their bounded fit rows remain available to
the optimizer and Q term. Other missing/deferred targets reject the whole update.
Repeated targets preserve list-order writes, and every fit row retains its own
bounded value. Source projects, measurements and unknown metadata remain intact.

The immutable `with_calculation_numbers` batch updates existing numeric targets
only, requires finite doubles and preserves input on any failure. Calculation
states can temporarily contain values outside persisted field domains, as the
web fit does; solver preparation remains responsible for their numerical use.
`serialize` validates such states before producing project JSON. Existing parsing
and ordinary `with_number` edits retain full schema validation. A later valid
candidate can restore an invalid intermediate state without a lossy round trip.
The validation marker is held by the document view, not mutable shared storage.

The public `test-native-fit-parameters.mjs` gate compares 186 scenarios with the
production web helper: all target kinds, missing selectors, active/current dataset
semantics, duplicate/fixed rows, missing script slots, signed zero, failure
atomicity and repeated invalid/valid candidates. It compares every numeric field,
full serializable projects and the web schema's saveability result. These checks
prove candidate mapping and the persistence boundary, not full fit convergence.


## Fit measurements and dataset errors

`prepare_fit_dataset` selects and validates one dataset, copies its energy, angular
resolution and polarization into a calculation context, and retains raw stored
columns. Measured columns apply shifts only above the original 1e-10 threshold,
then offset/scale, qz^4, pure-pi correction, asymmetry reconstruction and averaging.
Error modes follow available columns (R before A before paired beams), with
separate energy modes. Fourier fitting is excluded by D-44 and rejects active legacy settings explicitly.

`evaluate_fit_dataset` requires matching calculation coordinates and selected
column lengths, calls the shared native error kernel, then applies dataset weight.
A zero weight does not bypass validation. All arithmetic remains double; no
measurement rounding or tolerance changes are introduced.

The maintained `test-native-dataset.mjs` comparison covers 110 public cases against
the actual web preparation and WASM error kernel, including all eight modes,
combined postprocessing, averaging boundaries, tiny shifts, invalid candidates,
coordinate mismatch, nonfinite curves, unknown metadata and unchanged input.
This is measurement/error preparation only: curve calculation, serial optical/Lua
state, total objective/Q, optimizer callbacks and fitted-project output remain
separate native-fit integration work.


## Native qz fit curves

`calculate_fit_dataset_qz` connects prepared measurement coordinates and dataset
context to the existing three native solvers, including angular convolution,
compound segmentation and monochromatic energy broadening. It computes asymmetry
after qz^4/polarization corrections and before independent moving averages, as
CDataSet::PostModifications does. Terminal grid/default metadata semantics remain
separate. Energy-broadened fits preserve the web wrapper's last-sample secondary
columns while accumulating the monochromatic curve over nineteen samples.

The public `test-native-fit-curves.mjs` gate compares 108 calculations and their
weighted dataset errors with production web preparation and actual WASM: all three
solvers, logarithmic/linear/asymmetry/paired errors, unsorted duplicate coordinates,
thresholded shifts, complex polarization/analyzer, exact/fast angular convolution,
segmentation, averaging and energy broadening with polarization corrections.
Unsupported native Lua and energy-scan requests reject explicitly, followed by
successful recovery in the same process. This API calculates one qz dataset; it
does not yet supply the serial fit state or a complete command-line fit runner.


## Native energy fit curves

`calculate_fit_dataset` routes prepared qz or energy datasets through the native
core. Energy scans refresh compound/element tables at every point even with
automatic constants disabled, retain partial refresh state on missing/range skips,
apply exact angular resolution and whole-scan energy convolution before final
postprocessing. Skipped points retain the original unit reflectivity placeholder.
The API returns aligned energy coordinates for the shared dataset-error evaluator.

The public gate now covers 204 qz/energy comparisons, including all eight error
modes, compound/element preparation, range skips, missing tables, segmentation,
polarization corrections and energy convolution. It also checks all 1001 production
lookup doubles exactly between native and WASM. The initial segmented Zak
asymmetry mismatch was caused by nine standard-library erf samples differing by
at most 1.1102230246251565e-16. A controlled injected-table diagnostic isolated that
cause; the final production gate passes using the same pinned musl standard erf
source and existing pinned exp on both targets. No tolerance was changed.

Serial cross-dataset fit state, native Lua, optimizer callbacks and fitted-project
output remain open. This does not complete the native CLI or corpus acceptance.


## Serial dataset objective

`evaluate_project_datasets` evaluates active datasets in stored order, carries
optical scalars, tensor state and lookup cursors through qz/energy calculations,
and accumulates weighted dataset means. It returns updated calculation context,
optical scalar fields and observed curves/indices; measured columns and unknown
project metadata remain intact. Inactive datasets are untouched, zero-weight
datasets still calculate, and a failure publishes no partial result or input edits.
Optical carryover does not overwrite current thickness, roughness or directions.

The maintained gate includes 52 serial scenarios against actual web/WASM
orchestration: compound/element mode, automatic/manual constants, both dataset
orders, range skips, energy broadening, final project state, inactive/all-inactive
data, zero-weight numerical failure, unsupported Lua and subsequent recovery.
An initial manual-element test lacked the stored scattering tensor state required
by the web helper; it now supplies the production initialization.

This is one dataset pass. Persistent state across optimizer candidates, candidate
refresh hooks, native Lua, Q/reference callbacks and fitted output remain open.


## Persistent candidate objective and Q

`ProjectFitObjective` retains the current project, optical tensors and lookup
cursors between candidate calls. Each call applies bounded values in order,
synchronizes candidate optical scalar targets into the retained state, performs
the automatic pre-dataset refresh at the current energy, evaluates datasets and
adds Q using the caller's explicit reference. Reference-refresh calls use the
bounded candidate itself as the reference. Only successful calls commit the next
state; returned project/value/reference snapshots do not alias later candidates.

The maintained comparison covers 48 sequences of seven calls (336 candidate
attempts): compound/element mode, all solvers, manual/automatic optics, mixed scan
orders, energy broadening, changed scalar/geometry/shift/scale targets, clipping,
explicit Q references and recovery after invalid references/candidate lengths.
Expected values come from the production mapping, refresh, dataset and Q helpers.
This proves the objective component, not the complete runRealFit lifecycle.
Standalone initial tensor/strict-optics preparation, native Lua, optimizer event
wiring, best-result tracking and fitted JSON output remain integration work.


## Standalone fit initialization

`ProjectFitObjective::prepare_standalone` now mirrors fit-start GetState and
prepareStandaloneFit. Manual mode builds both stored films' tensors before any
candidate is applied; automatic mode starts from stored tensors and performs
partial refresh. Active/nonempty datasets are required. Separate strict refreshes
run for automatic constants and for active energy data, preserving shared cursors
when both apply. Failure leaves the objective's project/state untouched, and
preparation after a successful candidate is rejected. Native Lua remains pending.

The focused `test-native-fit-start.mjs` gate compares 32 cases with the actual
prepareStandaloneFit + runRealFit fixed-parameter path across all solvers, both
material modes and qz/energy scans. It changes geometry and optical scalar targets
in the first candidate to verify that initial manual tensor state is retained.
Missing/out-of-range primary tables and inactive/empty datasets reject explicitly.
This completes the implemented non-scripted initialization component; native
optimizer wiring, cancellation, best-result tracking and fitted output remain.


## Optimizer orchestration

`run_project_fit` connects standalone preparation, dimensionless simplex decoding
and the persistent objective to the existing adaptive Simplex/annealing C API.
Callbacks contain exceptions and rethrow them at the native boundary. Ordinary
Q callbacks select/decode a reference and refresh its bounded state after a
completed round without replacing the best trial. Annealing retains the saved
reference and applies the web uint32 seed conversion. The retained best snapshot
contains its actual evaluated project, bounded values and reference; the final
core best value must match it. Fixed rows bypass the optimizer, and cancellation
before any evaluation reports an explicit failure. CLI JSON output now exists;
native Lua and full original-project fit acceptance remain open.
