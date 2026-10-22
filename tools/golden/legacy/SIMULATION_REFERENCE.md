# Private original simulation reference

Build with `python3 tools/golden/legacy/build_simulation_reference.py` and verify with
`LEGACY_ROOT=old/reMagX3 python3 -m unittest discover -s tools/golden/legacy -p test_simulation_reference.py`.
The build requires GCC/G++, the system FFTW3 development library, and the private legacy tree.
It compiles bundled Lua 5.1.4 from source; no system Lua library or old object files are used.
The 99-file private include/source closure is hash checked before compilation.
`-fpermissive` accepts the original invalid unused Visnovsky default constructor without
editing its source. Compiler diagnostics are captured and withheld from public output.

The executable takes one `.all` path and emits a JSON array of `[qz, R]` pairs with
17 significant digits. Append `--asymmetry` to call the original two-beam routine and
emit `[qz, Rplus, Rminus, asymmetry]` rows instead. The project selects normalized
asymmetry or the beam difference. Both CLI modes initialize calculated columns as GUI
Button3Click does, including when coordinates come from a measured dataset.
Add `--energy` for energy scans; the first output column then contains energy rather
than qz. Combine with `--asymmetry` for both beams and asymmetry. `--angle` selects the
GUI fixed-angle energy option, which is not persisted in the legacy `.all` format;
otherwise generated energy scans use fixed qz. Measured energy/qz columns retain their
order and receive the legacy shifts once. Energy scans always perform strict initial
table refresh, including with automatic constants disabled. Generated energy grids use
the table-range intersection and minimum-inclusive repeated addition; invalid or
nonadvancing grids fail instead of hanging.
For monochromatic qz scans, `--fourier` enables the GUI Fourier checkbox and
emits `[depth, magnitude]` pairs. `--multiply-qz4` and `--divide-pi` enable the
two preceding GUI corrections; averaging still comes from the project.
These three checkbox settings are supplied explicitly because the original loader
does not persist them. Fourier with energy scans or two-beam output is rejected by
this adapter until its unequal output-column lengths are handled.

`python3 tools/golden/legacy/diagnose_fourier_fit.py` reproduces a separate
Fourier-fitting preparation problem with a public synthetic fixture. The reviewed
original `CalcErrorOfDataset` transforms measurement coordinates before passing
them to the reflectivity solver, then ignores the solver's return status. The probe
hash-checks that source, builds the original simulation adapter, and demonstrates
the rejected depth-as-qz input without linking an optimizer. A successful probe
exits zero but reports `acceptancePassed=false`: it proves the failure, not a fit
reference or permission to correct legacy behavior.
Run in the directory containing any required material tables;
use an absolute project path when changing directories. Outputs from research projects
remain private. Standard legacy diagnostics are suppressed and the adapter buffers the
whole finite curve before publishing it. The caller must impose a timeout, particularly
for projects containing scripts. Original Lua retains filesystem/OS access: this is a
local reference tool for trusted projects, not a sandbox or a web runtime.

This stage calls original LoadState, optional Getdblist/Filldb, generated or selected-dataset qz coordinates,
and CalcReflectivity<double>/CalcAsymmetrie<double>, or the serial
CalcEScanEnergyResolution<double>/CalcDicEScan<double> entry points, including original
preparation and postprocessing. It does not reconstruct every GUI GetState/SetOCStrict
path, GUI parallel scheduling or fit workflows. Original non-Borland Lua callbacks retain their
terminal stub behavior. The system FFTW library is not pinned; Fourier results have not
been validated. Original segmentation helpers remain private reference dependencies,
not cleaned double-only production implementations. No original optimizer implementation,
private source, binary, lookup table or research curve is committed.

Tests establish a finite default curve, a zero-contrast curve, an independent pure-sigma
Fresnel interface comparison at D-23, suppressed missing-file diagnostics, and absence of
optimizer linkage. Measured-grid checks cover dataset selection, original order, duplicate
coordinates, the strict shift threshold and invalid/empty selections. Coordinates are checked
exactly; duplicate intensities use D-23 because original fast convolution can differ by rounding.
The adapter follows GUI Button3Click: adapt the selected dataset once, then apply experiment
energy/polarization. It does not reproduce the terminal executable’s second shift.
These do not establish corpus-wide simulation goldens, a cleaned public
native rebuild, WASM whole-project parity, or Wine cross-validation. Those checklist items
remain open.

## Whole-project Chromium diagnostic

Run `node app/scripts/diagnose-project-reference.mjs` from the repository root after
building the real WASM engine and installing Chromium. `LEGACY_ROOT` selects the original
source tree; `WASM_DIRECTORY` selects the directory containing `remagx-core.mjs` and `.wasm`.
The tool rebuilds the hash-gated original reference, generates only public-default-fixture
variants, imports each through the web importer, and calculates through the actual
ComputeService, worker and WASM in Chromium. It checks input immutability and compares
both coordinates and reflectivity with unchanged D-23. Its 24 generated-grid cases cover Parratt,
Visnovsky and Zak, magnetic off/on, zero/nonzero angular resolution and exact/fast modes.
Thirty additional measured-grid cases cover all three algorithms, exact/fast resolution,
selected datasets, unordered/duplicate coordinates and five shifts around the threshold.
Another 24 generated-grid cases compare both beam intensities and both asymmetry
definitions across all three algorithms and zero/nonzero exact/fast angular resolution.
Logarithmic diagnostics describe the first beam; every output column is checked by D-23.
Energy coverage adds 36 generated-grid cases and nine measured-grid cases with synthetic
public db/m tables. These cover table-range intersection, per-energy refresh, fixed qz/angle,
energy convolution, both beams/asymmetry definitions, shifted unordered/duplicate measured
coordinates and all three algorithms. Logarithmic diagnostics still describe the first beam.
It does not cover magnetic profiles, scripted scans, GUI parallel scheduling or private
corpus acceptance.

The JSON result explicitly reports `acceptancePassed`, mismatch counts per case, first
mismatch indices, absolute-error maxima, log10 error for positive pairs and zero/nonpositive
counts. A completed diagnostic exits successfully even when numerical acceptance is false;
use `--require-parity` to require a zero-mismatch exit status. Build/runtime errors always
fail. This is a diagnostic, not a replacement for the acceptance gate or a tolerance exception.

On 2026-10-19 the 14,400 compared values contained 196 D-23 mismatches, all in four
magnetic Visnovsky cases. The other 20 cases passed. Maximum log10 error was about
6.12215e-6. In a separate local isolation probe, identical original-loaded tensors matched
all 300 zero-resolution points in cleaned native C++, while Node/WASM failed 18 points,
matching Chromium. Thus this case's discrepancy lies in native/WASM numerics, not importer
preparation. Platform complex square-root rounding differences were observed at the mode
level; they are not yet proven to explain every mismatch. No numerical implementation or
tolerance change is included in this diagnostic step. Full matrix project acceptance remains
open despite earlier prepared-stack component comparisons.

The observed discrepancy above was resolved later on 2026-10-19: pinned glibc scalar
atan2/cos/asin in the WASM matrix path and C complex square-root/logarithm primitives
restore all 24 project variants at unchanged D-23. The quartic solver is unchanged.
The expanded native/WASM tests include 4,800 intensities from the public magnetic stack
and both beam modes. See `engine/third_party/glibc_math/README.md` for provenance and
scope. This closes the observed regression, not full corpus or general engine acceptance.

The two-beam extension on 2026-10-19 compares 78 cases/43,440 values. Coordinates
and both beam intensities pass D-23, but 196 derived Visnovsky asymmetry values fail
in eight cases; Parratt and Zak pass. Reports include per-column mismatch counts and
the first differing value/reference. The small beam differences are amplified relative
to the derived difference/asymmetry; their arithmetic origin remains under investigation.
The diagnostic correctly reports `acceptancePassed=false` and exits nonzero with
`--require-parity`. The earlier 24-case resolution does not establish asymmetry acceptance.

The derived-asymmetry discrepancy was subsequently resolved on 2026-10-19. Identical
original-loaded tensors first isolated it to WASM arithmetic: native matched all 300
points while WASM failed 32. Matching complex division, sine/cosine reconstruction,
and the pinned native hypot/complex sqrt/log path restores all 78 project variants
(43,440 values) at unchanged D-23. Node and Chromium also check 2,400 derived
asymmetry values independently of their 18,144 passing beam-intensity comparisons.
No quartic branches, Newton steps or tolerance were changed. Full corpus acceptance
remains open.

The energy-scan extension adds 45 public synthetic-table cases. All 123 combined
qz/energy project variants pass unchanged D-23 across 44,610 values. Ten native adapter
checks cover generated table-range intersection, fixed-angle and two-beam output,
measured energy shifts and invalid/nonadvancing grid handling alongside the earlier
qz checks. GUI parallel scheduling and general scripted/private-corpus scans remain open.


The reference now calls the original `erffinit()` before loading a project, matching
GUI, DLL and terminal startup. Without it, segmentation and element-density paths
indexed an uninitialized private lookup table. Public synthetic fixtures cover both
paths; all 11 native adapter tests pass. The original lookup implementation and its
Numerical Recipes dependencies remain confined to the private reference build.

A local 99-project qz execution diagnostic on 2026-10-19 improved from 66 finite
curves and 27 segmentation faults to 93 finite curves with no crashes. Five projects
failed strict table preparation and one exceeded the per-project 10-second limit.
Runs used a disposable copy of the private tree; no private curves were committed.
This checks execution availability, not numerical accuracy or corpus golden acceptance.
The 123 public-project Chromium cases still pass D-23 across 44,610 values.


A follow-up with a 120-second per-project limit completed 94/99 projects with
72,291 finite points and no crashes or timeouts. The previous 10-second timeout
therefore does not establish a calculation failure. The five remaining projects
fail strict table loading: four use element mode without local `.ff` inputs and
omit `usechantlerdatabase`, whose original constructor default is zero; the fifth
uses compound mode without its referenced local `.db` inputs. `ReadElement`
only falls back to built-in Chantler data when that flag is enabled. The adapter
does not enable it or substitute tables from another directory. Complete corpus
references need those input gaps resolved, alongside the remaining preparation
and numerical validation work. No private project names or curves are published.


An initial private Chromium diagnostic imports all 99 unchanged projects and the
optical tables beside each project, then calls real ComputeService qz reflectivity.
The 62 completed curves match the original native reference across 46,600 points
(93,200 coordinate/intensity values) at unchanged D-23, without length mismatches.
First failures for the remaining projects comprise 15 element refresh/preparation,
15 adaptive segmentation, one magnetic profile, four script index errors, one
missing-table input, and one algorithm deferred by D-25. These are first observed
failures; resolving one can expose another. Native reference calls used a disposable
private-tree copy. Private inputs, curves and detailed error messages stay uncommitted.
This diagnostic establishes neither all-project parity nor energy, asymmetry, Lua
or fit acceptance, and it is not connected to CI.


Reference output is now rejected with status 10 when a host-level Lua compilation
or protected execution call fails. The original simulation may otherwise continue
and return a finite curve after reporting a script error. Linker wrappers observe
those statuses without editing the private Lua/legacy implementation; diagnostics
and partial curves remain suppressed. Errors handled inside a running script with
`pcall` or `loadstring` do not trigger rejection. Disabled scripts remain disabled.

The four private `par` index failures above correspond to scripts accessing entries
in projects with no stored script parameters. The original loader also creates an
empty parameter array for these inputs; the web error is not evidence of an import
loss. Earlier finite-reference execution counts did not detect ignored script
errors and must not be interpreted as counts of valid golden curves.


A private adaptive-segmentation diagnostic compares the original lookup with
standard `erf` samples on the identical lookup grid, preserving original lookup
interpolation and the rest of the adaptive calculation. All 15 segmented corpus
projects complete in both variants with matching output lengths. Fourteen exceed
D-23, totaling 17,752 mismatches among 19,586 reflectivity points. Maximum absolute
intensity difference is about 6.67095e-6; maximum log10 difference for positive
pairs is 0.860779 decades. Three projects exceed 0.001 decades and seven exceed
1e-6 decades. These differences are not evidence supporting a rounding-only
tolerance exception. No production replacement or tolerance change is adopted.

The diagnostic uses the hash-verified original source closure, with a temporary
compiler wrapper substituting a translation unit that includes the original
LayerSegmentation.cpp and overrides its initialized lookup samples using
`std::erf`. A linker wrapper intercepts startup initialization. The candidate is
an explicitly modified private diagnostic, not an original golden reference.
Both variants run in a disposable corpus copy. No private source, lookup data or
curves are committed. This measures combined adaptive-path impact; it does not
isolate changes in slice selection from optical values.


The public diagnostic now includes 12 additional mode-2 qz variants with nonzero
Gaussian amplitudes and segmentation disabled. Original CalcMagProfile returns
before profile application in this configuration; Matrix/Zak preparation now
preserves that behavior alongside Parratt. All 135 combined project variants and
51,810 coordinate/intensity values pass D-23. This verifies the disabled-segmentation
branch, not adaptive slicing or actual magnetic-profile application.


## Repeatable private corpus capture

Run `python3 tools/golden/legacy/capture_corpus.py --output build/private-reference-captures/<new-name>`
from the repository root. The tool builds the hash-gated original adapter, copies
the trusted private tree to temporary storage, fingerprints the input snapshot,
and attempts qz reflectivity for every discovered `.all` project. The default
per-project timeout is 120 seconds. It refuses symbolic links, empty input,
nonfinite or malformed curves, existing output directories, and CLI destinations
outside the git-ignored `build/` tree. It never writes into the original corpus.

The private manifest records project IDs/paths and hashes, reference-binary and
source-manifest hashes, curve hashes, point counts, errors and timeouts. Only
aggregate counts appear on stdout. A failed reference has no curve file. A partial
capture exits nonzero and keeps its manifest for diagnosis; `acceptancePassed`
is always false because reference execution alone does not prove parity. Even a
complete capture does not establish GUI scripting equivalence or Wine validation.
The shared disposable input copy is for trusted legacy scripts, not isolation from
filesystem/OS side effects; its fingerprint describes the initial snapshot.
No capture or manifest containing private project details may be committed.

Public runner tests use synthetic inputs and an independent stub executable:
`python3 -m unittest discover -s tools/golden/legacy -p test_capture_corpus.py`.
They also run with the ordinary public Python reference tests in CI; the private
capture itself is local-only until corpus access in CI is resolved.


The error-function study now also reports an independent double-only gamma-based
approximation against original direct-function values, separate from lookup-grid
interpolation. Its series comes from [DLMF 8.7.1](https://dlmf.nist.gov/8.7.E1),
and its backwards finite continued fractions use the even contraction of
[DLMF 8.9.2](https://dlmf.nist.gov/8.9.E2), at a=1/2. The diagnostic stops at
3e-7; it is not a production replacement or a relaxed golden gate. All original
comparisons still use D-23. It fails 9,112/20,001 samples, with maximum absolute
difference about 2.49e-7. Source inspection found single-precision internal state
in the original series and continued-fraction helpers despite double interfaces.
Whether to reproduce that rounding in a narrowly scoped compatibility step is a
pending decision. No original NR code or generated lookup table is committed.

## Fourier column-layout diagnostic

`reference public-project.all --fourier --column-layout` reports only column lengths,
with `acceptancePassed: false`. Combine it with `--asymmetry` and/or `--energy` to
inspect combinations that ordinary curve output intentionally rejects. Run from a
folder containing the project's optical tables for energy scans. This diagnostic
never indexes mismatched output columns or publishes a numerical reference curve.

The full legacy preparation initializes ordinary R even for two-beam calculations.
Consequently, FFT's empty-R early return does not make the Fourier flag a no-op for
those calculations: it transforms the placeholder R and halves qz while retaining
Rp/Rm/A and energy at their original lengths. The GUI energy plot loops over the
energy array and indexes R, so monochromatic energy Fourier output can index beyond
R. The qz two-beam plot instead uses the shortened, transformed qz with untransformed
beam/asymmetry values. These behaviors are not meaningful evidence for a corrected
Fourier display. The real worker continues rejecting those combinations pending an
explicit decision; Fourier fitting has its own separate preparation defect.

The private-source regression uses the public default fixture and synthetic tables
for Parratt, Visnovsky and Zak, comparing baseline and transformed column lengths.
It also verifies that ordinary output still rejects these combinations. Run with:

```sh
LEGACY_ROOT=old/reMagX3 python3 -m unittest discover -s tools/golden/legacy -p test_simulation_reference.py
```


## Private segmented-project worker comparison

With the native reference prerequisites, built WASM and Chromium installed, run:

```sh
node app/scripts/diagnose-private-corpus.mjs
```

`LEGACY_ROOT` defaults to `old/reMagX3`; `WASM_DIRECTORY` defaults to `build/wasm`.
The runner builds the hash-gated original reference, copies the private tree to a
disposable directory, and compares unchanged imported projects with same-directory
optical tables through Chromium and the real ComputeService. A test-only worker
receives 1001 original error-function samples in memory. No samples or private
project/curve data are committed or included in the public browser bundle. The
production worker remains unconfigured pending the lookup precision decision.

The 2026-10-20 local run matched 78 of 99 projects across 66,390 points (132,780
coordinate/intensity values), including all 16 segmented projects that completed
comparison. First worker failures were 16 element/scattering, one table and four
script errors. Maximum absolute difference across compared values was
3.6012859361278515e-14; maximum positive-pair log10 difference was
8.972023124442785e-11. D-23 remains the acceptance test; the logarithmic metric is
supplementary. The runner exits nonzero unless every project matches, and this
run reported `acceptancePassed=false`.

Only numeric project IDs, categories and aggregate metrics are printed. IDs follow
sorted local paths and are stable only for an unchanged tree. Raw reference/browser
errors and paths are withheld. This diagnostic covers qz reflectivity with an
explicit original lookup, not production lookup generation, energy/asymmetry/fit
acceptance or the complete engine. Earlier 62-curve evidence remains historical.


After explicit-lookup element qz routing, the next 2026-10-20 run matches **84/99**
unchanged projects across **67,792 points / 135,584 coordinate-intensity values**,
with no D-23 mismatches. Seventeen compared projects have the segmentation flag;
element mode retains its distinct original sampling path. Maximum absolute error
is 2.050137837272814e-12 and maximum positive-pair log10 error is
8.972023124442785e-11. Remaining first worker failures: ten element/scattering,
one table and four script errors.

The summary now also reports `referenceCounts`: the original adapter completes
90 projects and errors on nine. Six projects with original curves therefore still
lack successful worker comparisons. A reference error alone does not prove a
project invalid: missing inputs, legacy failures and adapter limitations must be
investigated separately. No project is repaired or excluded automatically, and
`acceptancePassed` remains false (exit status 1).


Worker error categories distinguish `deferred-algorithm`, `missing-element-table`,
`element-table-range` and `scattering-tensor-decision` before generic element errors.
This prevents the phrase "without multiple scattering" from being misclassified as
an element-preparation defect. Script context also takes precedence over words in
its diagnostic. Each progress record reports original-reference status separately;
`referenceCompletedFailures` counts only unmatched projects with completed native
curves. Unknown messages remain `other`; raw text and private names stay withheld.

Legacy `ReadElement` can fall back to built-in Chantler data when local table
loading fails and that fallback is enabled. Missing local `.ff` files alone do not
prove invalid project input. The web implementation has not shipped this built-in
data; its scope/licensing decision remains in the checklist. These categories are
diagnostic evidence, not automatic approval to exclude or repair any project.


The classified rerun preserves 84 matches and the numerical metrics above. Its
`referenceCompletedFailures` is `{"deferred-algorithm":1,"missing-element-table":5}`.
Across all projects, worker failures are nine missing-element-table, one deferred
algorithm, one other table failure and four script failures. The nine projects
whose original adapter errors coincide with four missing-element-table, one other
table and four script failures in the worker. This establishes co-occurrence, not
identical causes. None is silently excluded from the strict aggregate gate.


## Element energy coordinate reference

`test_element_energy_grid_is_not_clipped_to_scattering_tables` uses a public
synthetic element stack with Fe.ff covering 750–850 eV, narrower Fe.ffm data and
unrelated compound tables. Original ordinary, fixed-angle and two-beam scans all
retain the requested 700–900 eV grid at 25 eV intervals. `GetMaximumEnergyRange`
searches MATERIAL entries, while fresh element loading populates ELEMENT entries.
The web coordinate preparation preserves this distinction; later per-point
refresh must handle table-range failures without clipping the initial grid.

This evidence concerns fresh project preparation. The legacy GUI also carries a
history-dependent table cache that can retain MATERIAL entries; those session
histories are not reproduced by this fixture or accepted as equivalent. All 15
native simulation-reference tests pass with this addition. Run the existing
`LEGACY_ROOT=old/reMagX3 python3 -m unittest discover -s tools/golden/legacy -p test_simulation_reference.py`
command to reproduce the checks.


## Private energy-scan worker comparison

```sh
node app/scripts/diagnose-private-corpus.mjs --energy
```

This mode invokes the original reference with `--energy` and the real worker's
`calcEnergyScan` on the same unchanged imported projects and same-directory tables.
It compares energy coordinates and reflectivity at D-23, using the same private
explicit original lookup as the qz diagnostic. The scope field is
`private-energy-explicit-original-lookup`; the default command remains qz-only.
The `.all` importer uses the original default fixed-qz energy mode because the
legacy format does not persist the GUI fixed-angle selector. Synthetic fixed-angle
reference tests remain separate.

Reference failures, worker failures and numerical mismatches remain distinct;
missing energy columns/tables or invalid energy ranges are not silently repaired.
Unknown or duplicate arguments fail with sanitized output. This command does not
establish two-beam/asymmetry or fit acceptance and does not configure a production
lookup generator.


The first 99-project energy run on 2026-10-20 produced 23 native reference curves
and matched 19 worker curves across 6,179 points (12,358 coordinate/intensity
values). All compared values meet D-23: maximum absolute difference
1.8943180357666733e-15, maximum positive-pair log10 difference
7.847056338050606e-13. Three compared projects have the segmentation flag. The
original adapter errors on 76 projects; this is a different scope from the qz run
and does not establish that those projects are invalid generally.

Of four unmatched projects with native curves, two lack element tables in the web
path and two initially appeared as generic worker errors. Investigation found a
diagnostic race: the deadline called Stop before rejecting its own promise, so
synchronous ComputeCancelled rejection could win Promise.race and hide a timeout.
The shared diagnostic helper now rejects the deadline first; a fake-clock test
verifies timeout priority, early success/error cleanup and no late Stop. This
changes reporting only, not the 120-second limit or numerical tolerance. Targeted
worker-only follow-up uses the same private inputs and original lookup; it does
not regenerate or replace the native references.


The targeted follow-up confirms **both** previously generic failures are
120-second worker timeouts. Their numerical compatibility remains unproven; a
longer controlled run or runtime investigation is still needed. The full-run
reference counts and 19 matched curves remain unchanged. No input was repaired or
excluded, and `acceptancePassed=false` remains correct.


A prepared WASM optical sampler now copies immutable compound inputs once per
adaptive subdivision instead of once per depth sample. The four independent
tensor states and native arithmetic are unchanged. The optimized preparation
matches 48 original stacks/1,741 layers/31,534 values; ownership, memory growth,
allocation failures and cleanup are checked in Node and Chromium.

The repeated full 99-project energy diagnostic retains all 19 matching curves,
6,179 points and the same maximum errors reported above, with zero D-23
mismatches. Both difficult scans still exceed the unchanged 120-second limit.
Available native curves therefore still comprise 19 matches, two missing-element-
table failures and two worker timeouts. The optimization removes repeated buffer
work but does not resolve full-scan runtime or establish compatibility of those
two curves. No full-scan speedup is claimed; acceptancePassed remains false.


### Runtime follow-up after prepared sampling

Separate worker-only 30-second profiling probes of the two remaining energy
cases used unchanged private inputs and the hash-gated original lookup. They
were stopped for profiling, did not regenerate native references, and do not
replace the 120-second acceptance diagnostic. Instrumentation accumulated call
durations around exported WASM adapters; durations of nested operations must not
be added, and these samples do not establish a whole-scan speedup.

For numeric corpus ID 60, the last reported counters include 8,015 table lookups
(22.459 seconds), 206 completed adaptive subdivisions (4.275 seconds), and
436,239 depth samples (2.028 seconds, nested in subdivision). For ID 67, the last
reported counters include 13,009 table lookups (9.312 seconds); this alone does
not explain the whole 30-second interval. Neither final energy solver wrapper
completed during the probes. Counters are periodic snapshots, not exact totals
at cancellation. No private filenames, tables, scripts or curves are recorded.

Source inspection shows lookupTable in engine/wasm/parratt.mjs validates and
copies every table for every call; remagx_table_lookup also validates the entire
native table on each invocation. A next optimization should prepare immutable
table storage with bounded lifetime and explicit cleanup, while preserving each
caller's cursor, duplicate-energy history, endpoints, range behavior and atomic
failure behavior. Replacing or mutating an input table must not reuse stale
storage. The second case still needs attribution of the remaining runtime;
this evidence does not justify changing physics, scripts or tolerance.


### Request-owned prepared optical tables

The real worker now opens a separate table lookup session for each request and
releases it in the handler's finally block. A session copies each table once to
immutable WASM storage; later requests and replacement objects get fresh storage.
Query buffers and cursor values remain per call, so callers retain their original
independent lookup histories. The native lookup still performs its existing
validation and interpolation on every call. No native arithmetic was changed.

Prepared lookup matches 14,760 native values and 80 cursor sequences in Node and
Chromium. Shared tests cover duplicate energies, endpoints/range behavior,
allocation failures, input snapshot isolation, replacement, numerical errors,
recovery, memory growth and idempotent disposal. The memory-growth check shares
an existing sampler growth exercise; an initial run with additional full-heap growth encountered
a Chromium timeout during concurrent checks and was removed without weakening
the lookup assertion. The final complete Node/Chromium suite passes. Public tests
verify separate request sessions and cleanup after calculation errors; all 495
public tests, lint/build and the full Chromium ComputeService suite pass.


The full unchanged 99-project energy rerun now matches **20 of 23** available
native curves (previously 19). Case 60 completes within the unchanged 120-second
limit and matches all 800 points; case 67 still times out. Total compared output
is 6,979 points/13,958 coordinate-intensity values, with zero D-23 mismatches and
unchanged maximum absolute/log10 errors. Four compared projects have segmentation
enabled. The other two unmatched native curves still lack element tables; the
original adapter still errors on 76 inputs. Acceptance remains false. This proves
one former timeout now completes compatibly, not a fixed whole-scan speedup ratio
or compatibility of the remaining timeout.


### Script workspace measurement copies

After prepared tables, a worker-instrumented 30-second probe of case 67 reports
2,392 completed script hooks taking 27.194 seconds. Their project snapshots take
12.925 seconds (nested within those hooks); 19,137 table lookups take only 0.632
seconds. These periodic counters are not exact cancellation totals and must not
be added. Early adapter-only instrumentation could not attribute time inside the
hook; worker-specific instrumentation was required. The probe is worker-only,
uses unchanged inputs/original lookup, and does not replace a native comparison.

The script workspace now copies numeric dataset columns with Array.slice and
uses structuredClone for the remaining project, including dataset metadata.
Shared measurement-array references remain shared inside each independent copy.
Initialization, replacement and returned snapshots all retain isolated mutable
measurements. No measurement is omitted, no Lua global changes, and no numerical
operation or tolerance changes. Public tests cover all seven columns, negative
zero, tiny/large values, optional columns, replacement and mutations in both
directions; 496 public tests, lint/build, the dedicated Chromium Lua runtime and
full Chromium ComputeService checks pass. Temporary profiling code is removed.


The full unchanged 99-project rerun now matches **21 of 23** available native
energy curves, with no worker timeouts. Case 67 contributes 12,577 newly matched
points. Total output is 19,556 points/39,112 coordinate-intensity values, with
zero D-23 mismatches (maximum absolute difference 4.274358644806853e-15;
maximum positive-pair log10 difference 7.847056338050606e-13). The other two
available native curves still encounter missing element tables; the original
adapter still errors on 76 projects. All projects remain attempted and
acceptancePassed=false remains correct. This closes the two observed runtime
failures, not full energy/asymmetry/fit or corpus acceptance.


### Private two-beam/asymmetry diagnostic

The same corpus runner now accepts `--asymmetry`, alone for qz or together with
`--energy` for energy scans:

```sh
node app/scripts/diagnose-private-corpus.mjs --asymmetry
node app/scripts/diagnose-private-corpus.mjs --energy --asymmetry
```

It requests the corresponding original native two-beam reference and calls
calcAsymmetry/calcEnergyAsymmetry through Chromium ComputeService. Coordinates,
both beam intensities and the stored project's asymmetry definition are compared
independently at unchanged D-23. The aggregate report includes compared value
counts and mismatches per column. Signed/near-zero asymmetry uses the same
absolute-plus-relative criterion; logarithmic diagnostics remain restricted to
positive pairs. Default qz and `--energy` monochromatic modes remain available.

Every project is attempted unchanged. Original-reference errors, missing worker
capabilities/data and numerical mismatches stay separate; duplicate and unknown
options fail without disclosing their content. Public tests exercise isolated
beam/asymmetry mismatches, tolerance behavior, malformed lengths/nonfinite output
and sanitized command failures. This does not establish fit acceptance, approve
production lookup generation, or prove untested alternative asymmetry settings.


The first full 99-project energy-asymmetry run matches 21 of 23 available native
curves: 19,556 points/78,224 values. Coordinate, plus, minus and asymmetry columns
all have zero D-23 mismatches; maximum absolute difference is
6.838973831690964e-14 and maximum positive-pair log10 difference is
2.992806003021542e-10. The absolute allowance in D-23 still applies near zero;
log10 error alone is not the pass/fail criterion. Four matched projects have
segmentation enabled. Two available reference curves encounter missing element
tables; the original adapter errors on 76 projects. There are no worker timeouts.
No project was excluded or modified, and acceptancePassed remains false.


The first full 99-project qz-asymmetry run matches 84 of 90 available native
curves: 67,792 points/271,168 values, including 17 projects with segmentation
selected. All four columns have zero D-23 mismatches (maximum absolute
3.0943025919327738e-12; maximum positive-pair log10 error
8.972023124442785e-11). There are no worker timeouts. Of six unmatched available
native curves, five encounter missing element tables and one uses the deferred
Parratt-without-multiple-scattering algorithm. The original adapter errors on
nine projects. This matches the earlier monochromatic qz coverage while adding
independent second-beam and derived-asymmetry evidence; full corpus acceptance
remains false. Neither run varies each project's stored asymmetry definition.


### Original depth-profile preparation

The native reference and private corpus runner now accept `--profile` as a
separate mode, incompatible with energy/asymmetry flags:

```sh
node app/scripts/diagnose-private-corpus.mjs --profile
```

The native adapter follows the GUI profile path: loaded tensor state, automatic
GetState refresh plus strict database refresh, a temporary BeforeCalculation
script, forced slicing, and original FillLayers. It emits buffered finite
17-digit JSON with `smooth` rows [z, delta, beta, deltaMag, betaMag] and `segments`
rows [start, end, delta, beta, deltaMag, betaMag]. Smooth output retains the
initial point and averages adjacent rows; segments omit the terminal ambient
row, as in both original profile handlers. Original source/lookup hash gates and
optimizer exclusion remain unchanged. Sixteen private native adapter tests pass,
including boundary/average relationships and incompatible-option rejection.

Chromium compares the real depthProfile service output with both reference
sections independently at unchanged D-23. Single-row profiles may have no
interior slices. Output reports smooth-point counts, segment counts, total values
and mismatch counts separately for the two sections; raw research data remain
private. Every project is attempted unchanged, and native errors/timeouts remain
separate from worker failures and numerical discrepancies. Public tests cover
section mismatches, nonfinite values, lengths and sanitized option rejection.


The initial full profile diagnostic compared 84 profiles and matched 82. Two
nonsegmented reflectivity projects (numeric IDs 95/96) produced 325 mismatches in
profile coordinates and scalar optical constants; magnetic columns matched.
Both files omit segmentationmodel. The importer defaulted to global, whereas
the original CSlicing constructor sets model 2, dispatched as local by
LayerSegmentation2. Because the profile handlers force segmentation, this dormant
import-default error became observable here. The importer now uses local when
the key is absent; explicit model mappings are unchanged. A synthetic original
profile test confirms omitted-model output matches explicit model 2 under D-23
and differs from model 1. Seventeen native adapter tests, 503 public app tests,
lint/build and the strict 99-project import corpus gate pass.


After correcting the omitted-model import default, the full unchanged rerun
matches **84 of 89** available native profiles. It compares 35,492 smooth points
and 35,408 segments, totaling 389,908 coordinate/optical values, with zero D-23
mismatches in either section. Maximum absolute difference is
2.220446049250313e-16; maximum positive-pair log10 difference is
1.1429968083120912e-11. Five available references still encounter missing element
tables in the worker. The original adapter errors on nine other projects and
times out on one; that same project also exceeds the worker's 120-second limit.
All 99 projects remain included and acceptancePassed remains false. Production
lookup policy and complete profile/corpus acceptance are still open.


### Remaining profile timeout: expanded-stack workload

A read-only preparation audit of numeric corpus ID 22 (the case timing out in
both implementations) finds seven stored compound layers expanding to 80,162
layers through the unchanged multilayer parser. Automatic optical refresh is
disabled and BeforeCalculation is empty. Every packed value is finite, with
nonnegative thickness and roughness. Both range-padding branches use 30 Å.
The prepared depth extent and configured step limits imply approximately
25,430–38,146 generated slices; these are workload estimates, not measured
output counts or a completed profile comparison.

`adaptive_segmentation.cpp` evaluates four optical samples per slice and then
resamples all but the first. `segmented_optics.cpp` validates and traverses the
whole expanded stack for every local-model sample. Thus this input implies
roughly 10–15 billion layer visits for the optical traversal alone, in addition
to validation. The original local sampler also traverses the expanded stack.
The web subdivision has capacity and nonadvancing-depth guards; there is no
unbounded inner refinement loop in that path. This identifies a substantial
workload consistent with the observed timeouts, not a measured attribution of
all elapsed time and not proof of invalid project data.

Next optimization work should profile the large-stack sampler and investigate
reusing validated immutable input and interface preparation. Any pruning,
aggregation or changed summation order needs unchanged-D-23 evidence, including
local tensor accumulation and duplicate/zero-thickness interfaces. Do not remove
this project, change its multilayer pattern, loosen tolerances or interpret the
120-second limit as a numerical mismatch. The existing full-run timeout remains
the acceptance result; no new full corpus run was performed for this audit.


### Native immutable optical sampler

The WASM prepared sampler now owns a native snapshot created by
`remagx_segmented_optics_prepare`, sampled by `remagx_segmented_optics_sample`
and released by `remagx_segmented_optics_destroy`. The constructor validates
and copies the input stack, optional boundaries/tensors and explicit lookup;
the adapter immediately frees its temporary input buffers. Sampling validates
position and caller-owned tensor state, then uses the exact same arithmetic
routine as the existing one-shot entry point. Summation order, local tensor
accumulation and error-function evaluation are unchanged. No interface pruning
or aggregation is introduced. The large-stack traversal remains per sample.

Native tests compare both APIs across 60 generated stacks plus zero-thickness
variants, with and without tensors, source mutation and atomic invalid-state
failures. The original comparison still matches 19,800 scalar/tensor values
across 60 stacks. Shared Node/Chromium lifecycle checks exercise immutable
inputs, memory growth, host allocation failures, a rejected native constructor,
repeated numerical errors, recovery and exactly-once native handle destruction.
These checks do not simulate every allocator inside the C++ standard library;
constructor exceptions are handled with RAII and allocation-error status.


The full unchanged 99-project profile rerun after this change retains 84/89
available reference matches: 35,492 smooth points, 35,408 segments and 389,908
values, with zero D-23 mismatches. Maximum errors remain
2.220446049250313e-16 absolute and 1.1429968083120912e-11 positive-pair log10.
The large expanded-stack profile still exceeds 120 seconds in both original
and worker. Five available references still lack element tables, and nine
other original runs error. The diagnostic correctly exits nonzero with
acceptancePassed=false. No full-profile speedup factor is established by this
run; removing validation alone does not resolve the outstanding timeout.


### Exact saturated-prefix skipping for local optics

Only one of the timeout case's 80,161 interfaces has equal adjacent scalar
constants. Equal-layer merging therefore does not explain or remove its workload.
The prepared local sampler instead caches depths in the original repeated-addition
order and each prefix's maximum effective roughness. For each sample it searches
for a prefix whose largest depth and width still satisfy the original strict
lookup condition below -5. Since thickness is nonnegative, every preceding
interface then also saturates to -1, giving an exactly zero denominator.
Those terms can be skipped without changing the order of any remaining term.
No approximate tail threshold, suffix aggregation or regrouped sum is used.

Cutoff equality remains in the loop. The constructor falls back to full traversal
if depth or contrast subtraction can overflow, preserving infinity-times-zero
errors. Negative-zero incoming tensor components likewise retain full traversal.
The ambient contribution and independent reusable tensor states are unchanged.
Native tests compare against the unoptimized one-shot entry point at adjacent
representable cutoff positions, varying roughness and zero thickness, unordered
queries, signed-zero states, extreme finite inputs and arbitrary lookup contents.
Node/Chromium checks also exercise nonmonotone queries against full traversal.


The completed 99-project rerun inspected on 2026-10-22 has no worker timeouts.
The large-stack case 22 now completes within the unchanged 120-second deadline;
its report is reference-timeout (workerCompleted), since the original reference
still exceeds that limit. Its numerical acceptance remains unproven. The other
comparisons retain 84/89 available reference matches, 35,492 smooth points plus
35,408 segments, 389,908 values and zero D-23 mismatches. Maximum absolute/log10
errors remain 2.220446049250313e-16 / 1.1429968083120912e-11. Five available
references lack element tables and nine other original runs error. No inputs
were excluded; acceptancePassed remains false.


### Original element-density profiles

Run `node app/scripts/diagnose-private-corpus.mjs --density` for the element-density
view. This option is exclusive with --profile, --energy and --asymmetry. The
native adapter also accepts --density alone, using GUI GetState preparation
(partial automatic refresh or FillTensors), one temporary BeforeCalculation
execution and the original element GetDensity method. The output contains a
common-grid smooth matrix (depth then ordered element densities) and separate
boundary coordinate/density pairs for each element. No element names are emitted.
Range selection, strict upper endpoint and repeated addition follow
DrawDensityProfiles. The original uninitialized range for zero total interior
thickness is explicitly rejected, as are invalid/nonadvancing/oversized grids.
Output remains finite, buffered and 17-digit.

The comparator preserves element order and boundary grouping and checks every
value with unchanged D-23. Native exit 11 means the density view is inapplicable
(non-element mode/no elements); exit 12 identifies an undefined or unsupported
grid. These are kept separate from generic reference errors and timeouts. All
99 inputs are attempted; none is removed to improve the comparison result.

The first full run matches **15/15 available original references**, comprising
4,189 common-grid points, 827 boundary marks and 31,681 numerical values. All
column/boundary mismatch counts and maximum absolute/log10 differences are zero.
Eighty inputs are inapplicable to the element-only view. Four remaining original
runs error and the worker reports script failures; these are not evidence of
invalid projects without further investigation. No reference or worker times
out. The all-input acceptancePassed flag stays false and the diagnostic exits
nonzero, because mode/error cases are not numerical matches. This does not select
a production error-function policy or establish complete scripting acceptance.
