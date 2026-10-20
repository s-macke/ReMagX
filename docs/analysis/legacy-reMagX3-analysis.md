# Legacy reMagX (v2.6.1) analysis

Source: `old/reMagX3/` (snapshot of the ReMagX 2.6 code base plus release zips 1.6 to 2.6).
Analysis date: 2026-10-15.

## 1. What the program does

ReMagX simulates and fits **(resonant, magnetic) X-ray reflectivity** of thin-film multilayers.
Users describe a layer stack (thickness, roughness, optical constants delta/beta and magnetic
delta_m/beta_m, magnetization direction), load measured datasets (reflectivity vs. qz at fixed
energy, or energy scans at fixed qz/angle), and fit model parameters to the data.

Main capabilities (from code, GUI frames and the `.all` state format):

| Area | Features |
|------|----------|
| Scattering formalisms | Parratt (scalar recursion), Zak (magnetic, first order), full 4x4 matrix (Visnovsky, anisotropic/magnetic), "phase", TEY (total electron yield) |
| Scans | qz/angle reflectivity scans, energy scans (fixed qz or fixed angle), asymmetry (XMCD-type, Rp/Rm), transmission, "maps" (2D parameter maps, `CMap`) |
| Sample modes | **Compound mode** (per-layer delta/beta, `.db`/`.m` tables) and **Element mode** (element-resolved density profiles, form factors f1/f2, f1m/f2m) |
| Profiles | Roughness via Nevot-Croce or adaptive layer segmentation (slicing); Gaussian "magnetic" profiles with spline support and coupling to layers |
| Resolution | Angular resolution (fast and exact Gaussian convolution), energy resolution |
| Polarization | Arbitrary complex sigma/pi Jones vectors for two beams, optional polarization analyzer |
| Optical constants | `.db` (E, delta, beta), `.m` (E, delta_m, beta_m), `.ff` (E, f1, f2, Chantler), built-in periodic table (Chantler/Henke data, ~21k lines), Kramers-Kronig fitting (`kkfit`) |
| Fitting | Levenberg-Marquardt (`levmar` library), simulated-annealing-like chi-square fit (`CChiSquareFit`, temperature/dtemp), genetic/evolution algorithm (`CEvolution`), multi-dataset fit, 28 fit-variable types |
| Scripting | Embedded **Lua 5.1** ("default" script and "before calculation" script, multilayer script) |
| Other | Electric field / layer profile viewer, summary, undo/redo, ASCII import, webserver for consistency checks, experimental OpenCL kernel (`reflectivity.cl`) |

## 2. Architecture

```
client/  (Borland C++ Builder VCL GUI, Unit1.cpp ~8.7k lines + ~35 frames)
guidll/  (Borland: materials/settings/summary forms)
   |  calls via C ABI (__stdcall) ----------------------------+
server/  (MinGW-built ReMagX.dll + ReMagX_Terminal.exe)        |
shared/  (numerical core, header-only templates <T>)  <-------+
   simul/CParratt.h, CZak.h, CVisnovsky.h   formalisms
   RechenHilfe.h                            orchestration (resolution, energy res., TEY, element->material)
   LayerSegmentation.h, schicht.h           layer model and slicing
   CFit / CChiSquareFit / Evolution / lm/   fitting
   CStateHandler                            complete program state + (de)serialization of .all
   MaterialConstants*, periodic_table       optical-constant handling
   script*.cpp + lua/                       Lua binding
```

* The DLL boundary is narrow: `CalcReflectivityDLL`, `CalcAsymmetryDLL`, `CalcEScanDLL`,
  `CalcDicEScanDLL`, `CalcEScanParallelDLL`, `FitNewDLL/FitIterateDLL/...`,
  `EvolutionNewDLL/EvolutionIterateDLL`, `StartScriptDLL`, `StartWebserver`
  (`shared/dllbinding.h`). All take a `CDataSet*` and `CStateHandler*`.
* Parallelism via pthreads (per-qz-point work distribution with a mutex-guarded counter).
* Dependencies: MinGW 4.6, Borland C++ Builder XE2, FFTW3, GMP/MPFR, pthreads, Lua 5.1, levmar.
* Code size: ~134k lines incl. vendored libs; the domain core is roughly 15-20k lines.

## 3. Numerical precision (relevant to the new requirement)

All formalisms are templates over the scalar type `T`. `state.precision` selects at runtime
(`server/dllbinding.c`):

| value | type |
|-------|------|
| 0 | `float` |
| 1 | `double` (default) |
| 2 | `long double` (80-bit extended) |
| 3 | `CLNFloat` (MPFR, 200-bit, `shared/bignumber.h`) |

The new app keeps **only double**. The `precision = N` key in legacy `.all` files must be read
and ignored (always double). In the 99 example files found, 28 carry `precision = 1`; the rest
omit the key. Removing the template parameter also removes the GMP/MPFR dependency.

## 4. File formats

### `.all` project/state file (text, `key = value`, `#` comments)
Versioned sections: `fileversion = 1`, `layerversion = 3`, `elementlayerversion = 1`,
`magneticversion = 4`, `fitvariableversion = 1`, `measurementdataversion = 2`.
Contains: layers (`layer_d`, `layer_db`, `layer_material`, `layer_density`, `layer_delta`,
`layer_beta`, `layer_ddelta`, `layer_dbeta`, `layer_maggamma`, `layer_magphi`, `layer_sigma`,
`layer_electron_escape_depth`), element layers, Gaussian functions, fit variables,
global settings (algorithm, resolution, qz range, fit settings, evolution parameters,
polarization, segmentation, scripts) and **embedded measurement data**
(`dataset_qz` / `dataset_R0` pairs, plus per-dataset energy, resolution, multiplier, polarization,
original file path). Files can be large (datasets inline). Repetitive line-per-value encoding.
Some files use CRLF line endings.

### Optical-constant tables
* `.db`: `E(eV)  delta  beta`
* `.m`: `E(eV)  delta_m  beta_m`
* `.ff`: `E(eV)  f1  f2` with header (Z, A, rho)
* `.e`: element-related variant (see TODO: "add magnetization overwrites .e files")

### Measurement data
Plain ASCII columns (e.g. `LCO_900eV.dat`: `E  qz  R` or similar), imported via `LoadASCIIForm`.

## 5. Test corpus available

* `examples/` (~25 directories + `.all` files: Fe, Fe3O4, FeMn, LNO/LAO, LNO/STO, multilayers, slices, ...)
* `Tutorial/` (Tut1-3 with `.db` files and data)
* Release zips 1.6.0 to 2.6 containing the Windows binaries. These can serve as a **reference oracle**
  (for example run `ReMagX_Terminal.exe` under Wine) to produce golden outputs for regression tests.

## 6. Pain points and risks seen in the legacy code

* GUI and logic are tangled (`Unit1.cpp` 8.7k lines). State is one large mutable class.
* Windows-only, obsolete toolchains (Borland XE2, MinGW 4.6).
* Partly German comments/TODOs, several uncertain implementations flagged in CHANGES
  ("new and faster resolution algorithm (I am not sure if I calculate them right, TODO!)").
* Duplicated code (`other/Fitdb/shared` mirrors `shared`, `terminal/` vs `server/`).
* Lua scripting has direct access to the state. Porting it changes the user-facing script API.
* Licence status of the bundled data (Chantler/Henke tables) and libraries (levmar: GPL) matters
  for redistribution.

## 7. Implications for the web rewrite

1. The numerical core (`shared/simul`, `RechenHilfe.h`, `LayerSegmentation.h`, fitting) is the
   candidate for WebAssembly, either by **porting the C++** (Emscripten) or **rewriting**
   (for example Rust, AssemblyScript or C++ from scratch).
2. The `.all` parser and the state model are good TypeScript candidates. The parser must accept
   all versions found in the corpus.
3. The GUI is rewritten entirely. Nothing from VCL is reusable.
4. Browser-local means file access through the File System Access API or upload/download, state
   kept in IndexedDB/OPFS, and long computations in Web Workers.


## Native Parratt reference adapter (2026-10-16)

`tools/golden/legacy/parratt_reference.cpp` calls the original private
`shared/simul/CParratt.h` directly with `double`. It does not copy that implementation,
link an optimizer, load research files, or invoke the TypeScript mock. The build script
checks the compiler-reported non-system include closure against eight reviewed header
hashes in `parratt_sources.json`. Changed, missing or additional dependencies fail closed.
The adapter retains legacy type/field names only as import mappings. Its counter/mutex
symbols satisfy the private container header; they are not part of the future engine API.

```sh
python3 tools/golden/legacy/build_reference.py
LEGACY_ROOT=old/reMagX3 python3 -m unittest discover -s tools/golden/legacy -p 'test_*.py'
```

The default executable is `build/legacy-parratt-reference` (git-ignored). It reads whitespace-
separated numbers from standard input, in this order:

1. Layer count, point count, tensor type (0 isotropic, 1 tetragonal), analyzer (0 both, 1 sigma, 2 pi).
2. Beam sigma-real, sigma-imaginary, pi-real, pi-imaginary. The adapter does not normalize these.
3. One row per layer, substrate first and ambient last: thickness, roughness, delta, beta,
   delta-magnetic, beta-magnetic, gamma-degrees, phi-degrees.
4. One row per point: grazing angle in radians, vacuum wave number in inverse Angstrom,
   magnetization multiplier (normally 0, 1 or -1).

One intensity per point is printed with `%.17g`. Exit 2 means invalid input and exit 3 means
nonfinite output; callers must reject the entire output on any nonzero exit. No curve inputs
or numerical outputs are committed by the tool. Only synthetic adapter tests live in git.
The build uses C++17, `-O2` and `-fno-fast-math`; it requires a compiler and the private source
snapshot, not Wine or Emscripten.

The checks establish adapter wiring against closed-form two-medium Fresnel reflection,
complex beam weights/analyzers, zero contrast and an equivalent partition of one medium.
They do not establish full 2.6 project reconstruction, corpus goldens, optical table/Lua
handling, resolution, matrix/Zak calculations, optimizer references, the Wine comparison,
or native/WASM agreement. Those remain checklist work. The public workflow runs the
source-gate unit test; the numerical adapter tests skip unless private sources are requested.


## Initial cleaned native core (2026-10-16)

`engine/src/parratt.cpp` ports the active Parratt recursion, including magnetic/tetragonal
refractive-index branches, Nevot-Croce roughness, arbitrary complex beam weights and the
three analyzer choices. It preserves the zero-real-kz adjustment to 1e-100 and does not
normalize the supplied beam. No legacy containers, globals, threads, optimizer code,
optical databases or Lua implementation are carried into this core.

The C-compatible API in `engine/include/remagx/core.h` accepts prepared layers and point
arrays, with explicit units and caller-owned output. Input validation and numerical errors
return status codes; failed batches leave output untouched. Callers provide nonoverlapping
valid buffers of the declared lengths. Energy/qz conversion, table interpolation, slicing,
resolution and scripting belong to higher-level work still to be ported.

```sh
cmake -S engine -B build/engine -DCMAKE_BUILD_TYPE=Release
cmake --build build/engine --parallel 2
ctest --test-dir build/engine --output-on-failure
# Adds direct comparisons against the reviewed private 2.6 routine:
LEGACY_ROOT="$PWD/old/reMagX3" ctest --test-dir build/engine --output-on-failure
```

The default build is a shared library so Python can exercise the C ABI. The public tests
cover analytic Fresnel behavior, beam/analyzer weighting, null/invalid inputs, preservation
of inputs and failed-batch output, zero contrast, equivalent layer partitioning, and C header
linkage. A source gate rejects alternate floating-point precision and its negative cases are
tested. With private sources, 120 seeded synthetic stacks compare 4,320 points covering both
tensor types, all analyzers, complex beams, roughness, absorption, different directions,
magnetization reversal, zero/negative/near-critical angles and different wave numbers.
The comparison uses the unchanged AC-5 bound of 1e-10 relative + 1e-15 absolute.
These are prepared-stack component checks, not project/corpus goldens or native/WASM parity.
The website continues to use ComputeService's mock implementation.

### Parratt WebAssembly component

The same C++ core builds as `build/wasm/remagx-core.mjs` and its sibling `.wasm`.
Use Emscripten **6.0.12**, recorded in `engine/emscripten.version`; CI verifies
emsdk commit `35ff8a6d150541276abbc6bae512ca90bcfbe220`. After activating that SDK:

```sh
emcmake cmake -S engine -B build/wasm -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF
cmake --build build/wasm --parallel 2
WASM_MODULE=build/wasm/remagx-core.mjs python3 engine/tests/test_parratt.py build/engine/libremagx_core.so
```

Build the native library first using the commands above. Adding `LEGACY_ROOT=old/reMagX3`
also compares the original routine. The 120 synthetic stacks (4,320 points) are shared
between comparisons; positive values additionally receive logarithmic diagnostics,
while zero pairs and nonpositive mismatches are counted separately. No new tolerance
or low-reflectivity cutoff is imposed.

`engine/wasm/parratt.mjs` accepts prepared numeric rows matching the C structs and returns
an independent `Float64Array`. It validates shape, frees allocated buffers on success
or failure and refreshes heap views after potential memory growth. It does not prepare
projects, load optical tables or run outside the worker in the app: integration is still
pending and the deployed UI continues to use the mock engine.

To run the angular and qz comparisons inside an actual Chromium module worker, install
app dependencies and the Chromium headless shell (`cd app && npx playwright install
--only-shell chromium`), then from the repository root:

```sh
WASM_BROWSER=1 WASM_MODULE=build/wasm/remagx-core.mjs python3 engine/tests/test_parratt.py build/engine/libremagx_core.so
```

The browser check serves only the built module, WASM binary, prepared-stack adapter
and test worker on an ephemeral loopback port. It also enters a long synchronous call
to the actual core, checks browser event-loop response below 200 ms, terminates the
busy worker and requires a replacement worker's calculation within 1 s. The harness
is not deployed and does not substitute for app-level real-engine integration tests.

### Prepared native qz scans

`remagx_parratt_qz` accepts a prepared layer stack, explicit qz coordinates in inverse
Angstrom, fixed energy in eV and one or two complex beams. It computes both dichroic
intensities using opposite magnetization signs (or both zero signs with magnetism off).
The monochromatic result uses beam1 and returns zero in beam2. Inputs are immutable,
outputs commit atomically and status `REMAGX_QZ_ERROR` identifies the legacy qz boundary.

Traceability: `shared/Variablen.cpp` supplies energy conversion;
`shared/RechenHilfe.h` `CalculateResolution` and `CalculateResolutionDic` supply
zero-resolution coordinate conversion and beam selection. The latter permits ratio
`qz/(2*k0) == 1`, whereas the former rejects `abs(ratio) >= 1`. Negative ratios are
skipped after that check. These differences are preserved, not silently unified.

This API does not refresh optical tables, construct layers, generate a scan grid, execute
scripts, convolve resolution or apply postprocessing/asymmetry. Native coverage includes 1,440 original-routine comparisons. The WASM adapter
`calculateParrattQz` returns an independent Float64Array with interleaved beam1/beam2
intensities, preserving status codes on failure and freeing buffers on every exit.
It accepts `layers`, `qz`, `energy`, `beam1`, `beam2`, `tensor`, `analyzer`, `magnetic`
and `mode`; the latter four use the C enums/flags. Both adapters reject sparse arrays.
There are 3,360 additional native/WASM intensity comparisons in Node and Chromium,
for 7,680 values in total. The explicit real-worker ComputeService factory uses guarded project preparation;
the deployed app still uses the mock.

### Compound project preparation stage

`app/src/model/compoundLayers.ts` packs compound layers into the eight-double C API
row layout. It follows `FillLayers` (`shared/RechenHilfe.h`): optical constants and
per-layer magnetization angles are copied directly, with no density scaling or global
angle substitution. Table refresh and BeforeCalculation execution belong before this
stage. Element conversion and adaptive segmentation still require their own ports.

The optional multilayer sequence follows `Interpret`/`ExecuteMultilayer`
(`shared/RechenHilfe.cpp`) and `CVector::Implement`. Substrate and ambient are appended
automatically, so explicitly naming their indices duplicates them. For five source
layers, `2*(1,2)` expands to indices `[0,1,2,1,2,4]`. Nested repetitions, zero repeats
and the defined legacy character-handling quirks are retained. A missing closing
parenthesis fails rather than reproducing an out-of-bounds source read; expansion
is limited to 100,000 rows and 128 nesting levels with explicit errors.

Three unit tests cover expansion, invalid/resource cases and immutable packing. A
local temporary harness compiled the original interpreter with minimal container/state
scaffolding and matched 257 generated/edge-case patterns; this was a focused manual
check, not a committed full-project oracle. No private source or corpus was added to git.

### Initial real Parratt request preparation

`app/src/model/parrattRequest.ts` combines the compound rows with scan coordinates,
experiment energy, complex beam amplitudes and C API flags. This pure preparation
stage is used by the explicit real-worker ComputeService factory. It rejects unfinished physics
and preprocessing rather than returning a request with those effects omitted.

The generated qz grid follows the main legacy calculation action (`Unit1.cpp`
`Button3Click`): `j=1..N`, using `LinInterpolation(0,j,N,min,max)`. Thus the minimum
is excluded and the maximum included; reversed/constant ranges are preserved.
Dataset-point mode instead copies the active dataset coordinates without sorting or
removing repeats. Only qz shifts with magnitude greater than `1e-10` apply, matching
`CDataSet::Adapt`; measured intensities and their scaling are not changed by this stage.
Missing/empty active datasets cause an explicit error. Generated grids are limited
to 1,000,000 points to avoid unbounded allocation.

The initial zero-resolution path rejects non-Parratt algorithms, transmission,
automatic optical refresh, enabled BeforeCalculation source, element mode, segmentation,
Fourier postprocessing. Angular resolution is now handled by the real worker. Experiment energy
and polarizations remain authoritative when borrowing dataset coordinates, matching
the main legacy action. The fast-dichroic upper boundary is stricter than the non-fast
native API, so request preparation rejects ratio `qz/(2*k0) >= 1` for that branch.

### Initial real ComputeService integration

`createRealComputeService` selects a separate module worker through the existing
WorkerComputeService factory. The real handler prepares supported project requests,
lazily loads the WASM core and buffer adapter, and returns normal protocol results.
It supports guarded Parratt reflectivity and dichroic/asymmetry requests; unsupported
operations and preprocessing produce explicit errors with no mock fallback.
`parrattResult.ts` follows `CDataSet::PostModifications` for normalized/difference
asymmetry, including a zero result when the normalized denominator is zero.

The real worker expects `remagx-core.mjs`, `remagx-core.wasm` and `parratt.mjs`
beside its built worker asset. The integration harness stages these from the pinned
WASM build and serves only its isolated generated directory:

```sh
node app/scripts/test-real-service.mjs build/wasm
```

This builds a separate Vite entry under `build/real-service-test`, then uses Chromium
to check the real service's zero-contrast/total-reflection results, asymmetry,
unsupported-operation errors, project immutability and Stop/restart. A test-only marker
immediately before the actual synchronous C API call ensures Stop is checked during
WASM execution; the service then rejects with ComputeCancelled and creates a working
replacement within 1 s. The test entry and assets are not deployed. The main application
still selects the mock; this initial integration does not establish full-engine acceptance.

### Real-worker postprocessing

`postprocessParrattResult` follows `CDataSet::PostModifications` in order: qz-fourth
scaling, exact-pure-pi correction, asymmetry, then independent moving averages of the
intensities and asymmetry. It preserves `IsPi1/IsPi2` exact amplitudes (sigma zero,
pi real one and imaginary zero), including no correction for a phase-rotated or scaled
pi amplitude. Correction uses shifted per-point dataset energies when present and
retains `ToTheta` returning -1 at absolute qz ratio >=1. An absent monochromatic second
beam receives no correction.

The original averaging loop compares signed j to unsigned i+width: for i<width the
loop does not execute and the result becomes zero. This leading-zero behavior is
preserved under D-29; the trailing window clips to available points, and each window
is summed left to right without running-sum reassociation. The model rejects nonfinite
results. Fourier transformation is still unsupported.

A temporary local harness compiled the original PostModifications, MovingAverage and
ToTheta methods with minimal scaffolding (FFT disabled). All 960 output values across
64 scaling/correction/asymmetry/averaging cases matched exactly. This focused manual
comparison supplements unit tests and the actual Chromium ComputeService check; it
is not full-project corpus acceptance and no private source was committed.

### Real-worker angular resolution

`engine/tests/angular_resolution_reference.ts` preserves the active 19-point offset/weight arrays from
`shared/RechenHilfe.h`. Non-fast requests expand qz into shifted coordinates, calculate
them through the WASM batch API and accumulate in legacy order. Width below `1e-10`
uses one sample with weight one at offset -2*width, including the small nonzero shift.
Negative-qz samples contribute zero without renormalization. The stored angularPoints
setting does not change the active legacy kernel.

Fast resolution calculates the original grid once, then follows `GetLinY` from
`RechenHilfe.cpp`: forward searches omit the last interval; an unsuccessful search
returns the original point instead of clamping/extrapolating. Skipped negative-qz
raw points retain the legacy initial intensity one. No width-zero normalization or
weight adjustment is introduced. Resolution precedes postprocessing and asymmetry.

Three domain tests cover sampling and edge rules. A temporary local reference using
the original constants/GetLinY matched 448 outputs across 64 generated grid/width/mode
cases exactly. Chromium additionally checks two synthetic exact-resolution results
against original CParratt<double> outputs with the same 19 weights. This is initial
worker orchestration; full native/C++ resolution and energy convolution remain open.

### Native angular-resolution API

`remagx_parratt_qz_resolution` adds width (inverse Angstrom) and a fast flag to the
prepared qz contract. It implements the same exact/fast legacy behavior in C++,
validates numerical results and leaves output unchanged on failure. The C smoke test
covers linkage. Native tests compare two original-Parratt reference values and 7,200
intensities across 720 cases against the reviewed worker convolution. That comparison
uses Node with `--experimental-strip-types` to load the pure TypeScript reference;
Node is therefore needed for this native test, not for compiling the library itself.

The real worker now uses this C API through WASM. The previous TypeScript
convolution is retained only under engine/tests as a comparison reference. Energy resolution and full project/corpus
acceptance remain open.

### Shared native/WASM resolution integration

`PreparedParrattQzRequest.resolution` carries width and the fast flag. The real worker
passes the original qz grid to the WASM adapter, which calls
`remagx_parratt_qz_resolution`; sample expansion and convolution now occur in C++.
Calls without resolution retain the prepared zero-resolution API for component tests.
Invalid resolution settings fail before allocation, and native failure statuses retain
the existing service error mapping.

The shared Node/Chromium suite compares 14,880 intensities, including 720 resolution
cases (7,200 values) spanning exact/fast, zero/small/nonzero widths, magnetic/tensor
branches and both beams. Maximum positive log10 discrepancy on the recorded build is
about 2.13e-12 decades. Memory-growth and allocation/error-recovery tests exercise the
resolution API too. The TypeScript reference is not imported by the production worker.

### Native optical-table lookup

`remagx_table_lookup` ports `CTable::Get` into a data-only C API. Energies must be
nondecreasing; values/output are row-major with 1–20 columns. A caller-owned cursor
preserves lookup history, including repeated duplicate-energy queries. Exact endpoints
return stored rows (the first row wins if all energies coincide); empty/out-of-range
lookups return zeros. This differs from the mock preview helper's endpoint clamping.
The original 1e-5 duplicate-distance fallback and operation order are retained.

Outputs and cursor commit only on success. Invalid ordering/nonfinite data and
nonfinite interpolation fail clearly. Future automatic refresh must separately apply
`WithinRange` semantics; a zero lookup outside the range does not establish that a
required optical table is usable.

`tables_native` runs analytic/API tests. With `LEGACY_ROOT`, it also extracts only the
reviewed `CTable::Get` method, validates its SHA-256 and compiles it temporarily with
minimal single-thread scaffolding. 14,760 outputs and 80 cursor histories across
1/2/18/20 columns match the original. No private implementation or research data is
committed. WASM export is verified; material-table selection and automatic refresh remain open.

### WASM table adapter

`lookupTable(module, table, queries, cursor=0)` accepts the existing optical-table
shape (`energy` and column-oriented `columns`). It returns independent row-major
`Float64Array` values and the final cursor. Pass that cursor to the next lookup batch
to preserve duplicate-energy history. Buffers are freed after every call; cursor
marshalling uses an explicitly little-endian unsigned 32-bit value and refreshed heap
views after possible growth. Empty tables require at least one empty column.

The shared generated fixtures cover 1/2/18/20 columns, duplicate energies, varying
query direction and out-of-range queries. Both Node and Chromium match 14,760 native
values and 80 final cursors, while the optional private native test compares those
same cases with the hash-gated original method. Adapter tests additionally exercise
cursor continuation/bounds, memory growth, invalid input and allocation cleanup.
This exposes the numerical primitive only; automatic material refresh is not yet wired.

### Energy convolution integration (2026-10-16)

`remagx_energy_resolution` now supplies the post-scan convolution used by the real
monochromatic energy worker. The WASM adapter `convolveEnergy` accepts both interleaved
intensity columns and runs before `postprocessParrattResult`. Width below 1e-10 is
bypassed unchanged; the legacy fixed kernel and GetLinY fallback apply above it.
Native/WASM agreement covers 1,680 values in Node and Chromium; a real-service scan
also checks the combined path against the reviewed interpolation reference. This
supersedes the earlier energy-convolution implementation gaps above, but does not
establish dichroic energy, full native orchestration or private-corpus acceptance.

### Visnovsky quartic prerequisite and limitation (2026-10-16)

The native `remagx_quartic_roots` port follows `CVisnovsky.h` SolvePolynomial,
including principal complex powers, special branches, ten guarded Newton steps
and the subsequent mode ordering. All 244 synthetic cases match the private
original function (1,952 real/imaginary components). General polynomial accuracy
is a separate concern: 125 cases exceed 1e-10 for
`abs(p(root)) / (1 + sum(abs(coefficient) * abs(root)**power))`, with a maximum
about .8773. Thus this routine must not be advertised as a reliable general
quartic solver. The port preserves this legacy behavior; physical Maxwell-matrix
coverage is still needed before drawing conclusions about reflectivity accuracy.

### Generated optical-tensor Maxwell polynomials (2026-10-16)

The native `remagx_maxwell_polynomial` and `remagx_maxwell_roots` primitives now
connect scalar dielectric construction to the anisotropic quartic branch. The
private original expression/function agrees on 4,800 coefficient and 3,840 root
components for 120 generated magnetic tensors at four angles. Of these 480 cases,
124 exceed 1e-10 in the scaled polynomial residual defined above; the maximum is
about 1.0568e-6. This extends the residual observation to generated optical inputs,
but it is not a full-solver accuracy result: tensor classification, analytic
shortcuts, mode vectors, propagation and corpus reflectivity remain unverified.


## Segmentation error-function compatibility study (2026-10-16)

The original `LayerSegmentation.cpp` initializes a 1,001-value error-function table
using NR-labelled gamma routines with float intermediates. The active lookup linearly
interpolates the table; substituting a more accurate function changes its results.
The maintained diagnostic contains only a source hash, temporary-build wrapper and
comparison logic. It never commits or prints the private source or generated table.

Reproduce after building the native core:

```sh
python3 tools/golden/legacy/compare_segmentation_erf.py
LEGACY_ROOT=old/reMagX3 NATIVE_CORE=build/engine/libremagx_core.so python3 -m unittest discover -s tools/golden/legacy -p 'test_*.py'
```

| Candidate | Maximum absolute lookup difference | Lookup points exceeding D-23 | Synthetic reflectivity points exceeding D-23 | Maximum relative reflectivity difference |
|---|---:|---:|---:|---:|
| Same grid/interpolation, table generated with std::erf | 1.64865e-7 | 8,830 / 20,001 | 23 / 200 | 2.59254e-10 |
| Direct std::erf evaluation | 1.21332e-5 | 14,554 / 20,001 | 200 / 200 | 1.52353e-5 |

The reflectivity diagnostic uses the validated native scalar Parratt core with a
synthetic delta=.01/beta=.002 interface, sigma=3 Angstrom, 640 eV, 501 fixed slices,
and qz=.002 through .201 inverse Angstrom. Fixed slicing isolates the function
change; it does **not** exercise the legacy adaptive step selection, magnetic
binding or private corpus. The two candidate curves use identical slices and
calculation settings. Only the error-function values differ.

The current tolerance is unchanged. Neither replacement has been integrated into
the engine. The decision journal records the pending user decision under D-29.


## Active dataset fit objectives (2026-10-16)

`shared/CError.cpp::CalcErrorOfDataset` selects these prepared-data error functions:

| Data | Error metric | Acceptance filters |
|---|---|---|
| Reflectivity, logarithmic | Mean squared log10 difference | Inclusive qz window; measured/calculated positive |
| Reflectivity, linear | Mean squared intensity difference | Same positivity and qz filters |
| Monochromatic energy, logarithmic/linear | Corresponding reflectivity metric | Additionally inclusive energy window |
| Asymmetry, qz or energy | Mean squared signed difference | Inclusive qz window only |
| Dichroic, qz or energy | Sum of both squared log10 differences, divided by accepted rows | Inclusive qz window; all four intensities positive |

The optional residual vector keeps its previous values for skipped rows. Dichroic
rows store the sum of absolute beam log differences there, although the scalar
objective sums their squares. No accepted rows produces zero. These details are
preserved by `remagx_fit_dataset_error`; it does not clamp intensities before logs.
Nonfinite API inputs and numerical overflow report errors atomically.

Before these functions, the legacy orchestration adapts the measured dataset,
applies postmodifications and installs its energy, resolution and polarization.
The serial multi-dataset path sums `errorweight * dataset_error` for active datasets
and adds Qerror regularization. Those preparation/aggregation stages are separate
remaining work; testing prepared residuals does not establish full fit equivalence.


## Original project-loader reference (2026-10-19)

`tools/golden/legacy/state_reference.cpp` calls the original 2.6
`CStateHandler::LoadState`, including its tensor construction and thickness
conversion. It exports energy, per-film layer rows (thickness, roughness, delta,
beta, delta-magnetic, beta-magnetic, gamma, phi), dataset settings, both complex
beam polarizations, all seven measurement columns, element factors/slabs, initial
dielectric/scattering tensors and dataset count as numeric JSON
with 17 significant digits. It does not execute scripts, resolve optical tables,
calculate reflectivity or run fits. This is a project-preparation reference stage,
not a simulation golden-output generator.

The Linux/POSIX builder verifies the complete compiler-reported dependency closure
against `state_sources.json` (28 private files, including five translation units).
Function/data sections and linker garbage collection omit unused methods;
optimizer, Lua, FFT, built-in table and segmentation implementations are not linked.
Only the original declarations needed by the state model are included. No private
source or corpus values are copied into git. Each process owns one loaded state
until exit; it deliberately does not invoke the legacy destructor, which would
require Lua disposal. Reader stdout/stderr are suppressed before loading; failed
loads publish no snapshot. Build failures also suppress compiler diagnostics.

From the repository root:

```sh
python3 tools/golden/legacy/build_state_reference.py
LEGACY_ROOT=old/reMagX3 python3 -m unittest discover -s tools/golden/legacy -p 'test_state_reference.py'
cd app
LEGACY_ROOT=../old/reMagX3 CORPUS_DIR=../old/reMagX3 npm test -- --run test/stateLoaderLegacy.test.ts
```

Without `CORPUS_DIR`, the optional private-source comparison uses the four public
fixtures. With it, the test compares the first film's eight exported layer values,
eight dataset settings, eight polarization components and every measurement-column
value for every discovered project using unchanged D-23 tolerances. Empty original
placeholder datasets are mapped separately; files with no datasets need no placeholder.
Synthetic data additionally exercises settings, column order and default resets.
The importer-only stage does not compare textual metadata, every project field,
tensors, or other films (the optional WASM tensor stage is described below)
and must not be cited as full import or simulation acceptance. Errors use
numeric project IDs and suppress private diagnostics. The public suite skips this
comparison unless `LEGACY_ROOT` is supplied; the manifest check runs in ordinary
Python CI discovery.

A direct full-calculation include probe currently fails on the unused default
`CVisnovsky` constructor assigning its const `transmission` member. No private
source was patched in this step. A full rebuild still needs a reviewed build
adaptation, complete dependency/licence review, project orchestration and golden
validation; this loader adapter does not resolve those remaining requirements.


### Dataset reference extension and EOF diagnosis (2026-10-19)

The dataset comparison covers energy, energy shift, angular resolution, intensity
scale/offset, qz shift, error weight, active flag, both complex beam vectors, and
qz/R/Rp/Rm/asymmetry/energy/TEY arrays. A synthetic paired-dataset case exercises
nondefault settings and the reset to legacy defaults. Private values stay inside
captured subprocess output; failure reports include only project IDs and field groups.

`LoadNextAssignment` checks EOF immediately after `GetLine`, so it ignores the
last assignment if the file has no terminating newline. The web importer already
retained that line. Its behavior is unchanged, but the import report now warns of
this difference. The original-loader test explicitly demonstrates it with a
synthetic final asymmetry value; ordinary parity fixtures use the legacy writer's
newline-terminated format. This is a documented input-format difference, not a
relaxed numerical tolerance or a claim of full parser equivalence.


### Element state and initial WASM tensor comparison (2026-10-19)

The adapter also exports the first film's stored element factors, slab triples
(thickness, density, roughness), full scattering tensors and dielectric tensors
with their original classification. All numeric element factors/slabs are compared
with imported project state; names and other textual metadata are not covered.

To additionally compare original loaded tensors with the actual WASM constructors:

```sh
cd app
LEGACY_ROOT=../old/reMagX3 CORPUS_DIR=../old/reMagX3 WASM_MODULE=../build/wasm/remagx-core.mjs npm test -- --run test/stateLoaderLegacy.test.ts
```

`check_state_tensors.mjs` receives captured snapshots on stdin. It derives both
tensor kinds from the web-imported layer/factor values and calculation directions,
magnetization and tensor settings. This exercises parsing plus native tensor
preparation rather than comparing two calls to the same constructor. The 99 local
projects and six synthetic compound/element-mode cases match 178,236 tensor
components and all dielectric classifications at unchanged D-23 tolerances.
Synthetic cases include all three stored magnetization modes and nonzero magnetic
factors with nontrivial directions. Only aggregate counts are printed; numerical
payloads, input paths and detailed failure diagnostics remain private. Malformed
or empty input and missing-module errors fail without echoing the payload or path.

This is initial state built by LoadState/FillTensors. It does not cover subsequent
optical-table lookup, script mutations, density-profile evaluation, slicing, or
full-project reflectivity. The WASM stage runs only when `WASM_MODULE` is supplied;
it does not make ordinary public tests require a compiled numerical engine.

### Clean-room native annealing primitive (2026-10-20)

`remagx_simplex_annealing` extends the existing independent Nelder–Mead implementation
with thermal comparisons described by Cardoso, Salcedo and de Azevedo (1996), equations
9–10 ([paper](https://doi.org/10.1016/0098-1354(95)00221-9),
[author-hosted PDF](https://pages.up.pt/~up208839/Docs_SFA_Publica_Conferences/SFA_JP_19960101_CCE_The%20Simplex-Simulated%20Annealing.pdf)).
It ranks existing vertices with upward perturbations and trial points with downward
perturbations, while recording the best unperturbed objective. No NR implementation
was read or translated for this addition. It does not implement the paper's additional
adaptive cooling, constraint-replacement or restart schemes.

The primitive accepts temperature, additive change per completed simplex iteration,
and a seed. Temperature is clamped at zero; only zero-temperature states can declare
simplex convergence. Constant/heating schedules remain bounded by iteration/evaluation
limits. `std::mt19937` integer draws are explicitly mapped to the open unit interval;
the sequence is reproducible but does not claim to reproduce the original RNG.
The UI's temperature fields and default values were checked in `FitAlgorithmFrame.dfm`;
its project-level schedule mapping has not yet been integrated or validated.

Zero-temperature runs reproduce the ordinary simplex trajectory exactly. Tests cover
seed replay, quadratic recovery, hard limits, Stop, numerical/argument errors and atomic
outputs. In a tilted double-well test starting at the poorer local minimum, 11 of 12
fixed seeds escape with the selected cooling schedule; the failed seed remains included.
This is evidence of exploration, not a global-convergence or AC-9 fit-quality guarantee.
WASM export, worker fitting, public native-rebuild integration and original-optimizer
reference comparisons remain open. The real worker still rejects annealing requests.

The subsequent WASM increment exports `remagx_simplex_annealing` through
`minimizeAnnealing` in `engine/wasm/optimizer.mjs`. Its 48-byte wasm32 options layout
is checked at compile time (temperature offset 24, additive step 32, uint32 seed 40).
It shares the existing optimizer's owned buffers, copied callback inputs and cleanup
paths. Temperature, step and seed are explicit; no project seed/schedule policy is
silently selected. The native reference generator supplies 16 annealing cases alongside
six ordinary simplex cases. Node and Chromium compare termination, counters, parameters
and true objective values using unchanged D-23. Worker project fitting remains separate.

Worker integration now selects the annealing adapter when requested by the saved fit
algorithm, passing its temperature and additive step. CMultiFit's constructor passes
state.evo.random to CChiSquareFit, so worker annealing uses the saved Evolution seed,
normalized to uint32 as in the Windows reference. Direct domain calls can override it
with an explicit uint32 seed for reference work. No JSON/UI seed field was added.
An earlier seed-zero assumption was corrected after checking that constructor; the
journal records the superseded assumption and the subsequent verification.

The first real-worker recovery test found that thermal search could leave its best
candidate at 34.5 Å on a 35 Å synthetic film. To avoid losing local refinement when
parameter clipping produces a plateau, the native optimizer now rebuilds a simplex
at its best true candidate when temperature first reaches zero, using the initial
edge displacements. It then runs ordinary Nelder–Mead within the remaining budgets.
This is a documented refinement policy of the rewrite, not a claimed legacy trajectory.
Stop and evaluation limits during that transition are tested explicitly. Zero-initial-
temperature behavior remains identical to ordinary simplex. All 12 retained double-well
seeds now escape in the native test, without implying a general global guarantee.

Chromium verifies annealing qz thickness recovery for Parratt, Visnovsky and Zak,
seed replay, best-curve previews, unchanged inputs and forced-worker Stop/recovery.
Original-optimizer quality comparisons and broader energy/mixed/scripted annealing
validation remain open; the deployed app still uses the mock worker.

The expanded Chromium service suite now runs both optimizers against the same
synthetic individual qz/energy reflectivity, asymmetry and dichroic datasets, weighted
mixed datasets, persistent Lua hooks and concurrent metadata merges. Across the three
solvers it checks 42 ordinary/mixed fits, 30 scripted fits and six merges. Generating
thickness/script parameters recover within 1e-6 with objective below 1e-16; dataset-wide
intensity scale recovers within 1e-8. These unchanged thresholds are fixture assertions,
not new corpus-golden tolerances. All cases pass without further production changes.
This remains one-parameter synthetic evidence, not original-optimizer or general
multi-parameter fit acceptance.
