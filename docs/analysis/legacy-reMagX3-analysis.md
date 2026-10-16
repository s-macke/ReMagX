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

To run the same 4,320 comparisons inside an actual Chromium module worker, install
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
scripts, convolve resolution or apply postprocessing/asymmetry. It currently has native
coverage, including 1,440 original-routine comparisons; exposing it through the WASM
adapter and integrating project preparation into ComputeService remain separate work.
