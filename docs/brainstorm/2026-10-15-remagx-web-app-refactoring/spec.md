# reMagX Web: browser-local TypeScript app with a WebAssembly numerics engine

> **Decision Journal:** Rationale, rejected alternatives, and implicit knowledge
> are documented in `decisions.md` (same directory).
> On ambiguity: **check there FIRST** before choosing your own interpretation.
> Legacy analysis: `docs/analysis/legacy-reMagX3-analysis.md`.

## Goal

Replace the Windows-only ReMagX 2.6 (C++ core + Borland VCL GUI) with a static web application
that runs entirely in the browser: a React/TypeScript UI with a WebAssembly engine compiled from
the ported legacy C++ numerical core, double precision only (F-1, F-2, F-3). The first release is
a core MVP that lets existing users open their legacy `.all` projects, including the embedded
Lua scripts, and simulate and fit them with results matching legacy ReMagX (D-3, D-4).

## Context

- The legacy app depends on obsolete toolchains (Borland C++ Builder XE2, MinGW 4.6.2 or newer) and runs only
  on Windows. The numerical core is a C++ template core (headers plus .cpp files) behind a narrow C API (F-4, F-28).
- Precision modes float / long double / MPFR exist in the legacy code. Only double is kept, and
  legacy projects are computed in double whatever their saved `precision` value (F-3, F-4).
- Real projects rely on embedded Lua scripts (F-11), so scripting is part of the MVP (D-2, D-3).
- Distribution: public website remagx.org plus a GitHub repository, possibly GitHub-only later,
  which requires a static, server-less build (F-9).
- The code lives in git (F-19, F-26). Docker is offered as an optional, reproducible build; the deliverable is a static website (F-27, D-19).
- The test corpus of legacy projects is private and lives outside the main repo (D-20).
- Licence: GPL-3.0; the repository https://github.com/s-macke/ReMagX is public (D-31, F-32). The
  rights to the legacy code are cleared for publication (F-33). The legacy Numerical Recipes-derived
  optimizer code is not covered and is rewritten (D-32).

## Design

### 1. Architecture (D-6, D-7)

```
┌──────────── Browser tab (static site: remagx.org / GitHub Pages) ────────────┐
│  UI: React + TypeScript + Vite (D-9)                                         │
│        │  typed messages (project model as plain data)                       │
│        ▼                                                                     │
│  Compute Web Worker                                                          │
│   ├─ wasmoon (Lua 5.4)  "before calculation" scripts                (D-2)    │
│   ├─ engine.wasm        ported C++ core, double only, Emscripten    (D-6)    │
│   └─ fit loop           Simplex + Simplex/annealing, in C++         (D-11)   │
│  Storage: IndexedDB autosave; File System Access API / upload-download (D-13)│
└──────────────────────────────────────────────────────────────────────────────┘
Native build of the same C++ core → golden-data generator + CI regression tests (D-5)
```

### 2. Numerics engine (D-6, D-10, D-11)

- Source: the legacy `shared/` numerical code (Parratt, Zak, full 4x4 matrix/Visnovsky,
  layer segmentation, Nevot-Croce roughness, angular and energy resolution, element→material
  conversion, optical-constant interpolation, chi-square fit framework). It is converted to UTF-8
  (F-16), fixed to `double` (template parameter removed or fixed), and stripped of MPFR, pthreads,
  Lua, webserver and Windows-specific code.
- API: a small, data-driven C/C++ interface (project model in → curves/fit progress out). No
  GUI or global state assumptions.
- Two build targets from one code base: native (g++, for golden data and tests) and Emscripten
  (`engine.wasm` for the browser).
- Optimizers sit behind one optimizer interface in their own source directory (D-10). MVP
  algorithms: Simplex (Nelder-Mead) and Simplex with simulated annealing (D-11). No
  Levenberg-Marquardt (F-17). Both are new implementations in `engine/src/optim/`, written from the
  published algorithm descriptions and not translated from the Numerical Recipes code (D-32).
- MVP physics scope (D-3, D-25): Parratt, full 4x4 matrix, Zak; qz and energy scans; angular and
  energy resolution; compound and element mode; Nevot-Croce roughness and adaptive slicing;
  Gaussian magnetic profiles (spline, coupling); arbitrary polarization with analyzer; asymmetry
  (both definitions). The engine also exposes the sliced depth profile for the profile view (D-26).

### 3. Scripting (D-2, D-12)

- wasmoon (Lua 5.4) runs inside the compute worker.
- The legacy ReMagX script API is provided with legacy semantics, except CalculateReflectivity and GetError, explicitly excluded by D-43/D-49 (D-22, names per F-30):
  arrays (`par` 0-based, `delta`, `beta`, `thickness`, `sigma`, `density`, `deltam`, `betam`,
  `gauss_*`, tensor components `exx_r` … `ezz_i`), element objects with their methods, functions
  (`SetChemicalFormula`, `FillTensors`, `print`, `write`, ...) and globals (`energy`, `epsilon`,
  `resolution`, ...). Names that need non-MVP features raise a clear "not supported yet" error.
- The bridge builds Lua tables itself with numeric keys, because automatic JS→Lua conversion
  yields string keys (F-21). No Lua 5.1 shim is needed for the corpus (F-30).
- The "before calculation" script runs before every model evaluation (every fit iteration).
  Measured cost is about 32 µs per call (F-20).
- Script errors are shown with line numbers (D-14).

### 4. Project model and files (D-8, D-13, D-14, F-25)

- Native format: versioned JSON with a schema; TypeScript types plus runtime validation.
- Legacy `.all` is import-only. The importer:
  - accepts LF and CRLF, decodes as UTF-8 and tolerates invalid bytes (Latin-1 only in comments);
  - supports all section versions found in the corpus (`fileversion`, `layerversion`,
    `elementlayerversion`, `magneticversion`, `fitvariableversion`, `measurementdataversion`; F-29);
  - ignores `precision` and always uses double;
  - imports embedded datasets and Lua scripts;
  - imports projects using Levenberg-Marquardt or evolution settings with a fallback to Simplex,
    stated in the import report; `evo_*` settings are kept unused (D-27);
  - produces an import report listing ignored or unsupported keys.
- Optical-constant tables (`.db`, `.m`, `.ff`, `.e`; F-6, D-25) are imported into a per-browser material library;
  the built-in periodic-table data ships as a static asset.
- Storage: IndexedDB autosave; open/save via the File System Access API on Chromium, with an
  upload/download fallback on Firefox/Safari.

### 5. User interface (D-16, D-18, D-13)

- Same concepts and terms as legacy (D-16): main menu modelled on the legacy one (File, Edit, Mode,
  Layer, Tools, Preferences, Help; F-29), tabs Experiment-General / Sample / Fit, layer table,
  dataset list, plot area.
- Collapsible section side panel per tab (accordion), with the legacy section names, independent
  expand/collapse, scrolling and context-dependent visibility (e.g. algorithm-specific sections).
  Collapsed state is a per-user local preference (D-18; panel behaviour per F-23).
- Plots with uPlot (log axes, many points): reflectivity/energy-scan plots and the depth-profile
  view of delta, beta, delta_m, beta_m vs. z (D-26).
- A script parses the legacy `.dfm` files and the `Items->Add` calls into a settings/handler
  inventory (F-22, F-24). It serves as the completeness checklist: every entry is marked
  ported / dropped / deferred. Logic from legacy event handlers is moved into the TS model or the
  engine, never copied into components.

### 6. Error handling (D-14)

- Legacy RX_* conditions (F-29: angles above 90°, missing `.db` files, script compile/run errors,
  multilayer script parse errors, unknown error) become clear UI messages.
- Fits can be cancelled (stop flag; worker termination as fallback, D-12). Because the project is
  autosaved (D-13), a crashed worker does not lose the project.

### 7. Validation (D-4, D-5, D-17)

- Golden data: the legacy 2.6 core and terminal are rebuilt natively (modern g++, double,
  `%.17g` output) and run on the corpus (D-5). The public rebuild uses the rewritten optimizers;
  reference fit results come from an original build with the NR code, run once on the user's
  machine and never committed. Only its output is stored, in the private corpus (D-32).
- Corpus: a separate private folder/repo passed as `CORPUS_DIR` (D-20), seeded with
  `old/reMagX3/examples` and `Tutorial` and growing with user-supplied files (F-25). The main repo
  holds only small shareable fixtures.
- The rebuild is cross-checked against the shipped 2.3.1 terminal under Wine at about 1e-6
  relative on all corpus files 2.3.1 can compute (F-12, D-17.2).
- The new engine is compared to golden data in both builds: native in C++ tests and WASM in Node.
- A few Playwright end-to-end tests cover import → simulate → fit → save in the browser.

### 8. Build, VCS and layout (D-19, D-20, F-26, F-27)

- Output: a static website (`app/dist`) plus `engine.wasm`, which can be served by any static host.
- Docker is an optional, reproducible build: a pinned image (emsdk + g++ + Node) and
  `docker compose run build`. Building with a local toolchain is also possible; tests are not tied
  to Docker.
- git repository. The legacy `old/` tree and release zips stay outside git (`.gitignore`; D-30). The legacy
  sources needed for original golden data remain private and unchanged;
  `tools/golden/legacy/` versions only maintained adapters, provenance and tooling
  (D-30/D-32), never the original optimizer implementation.
- Layout: `engine/` (C++, native + Emscripten), `app/` (React + Vite), `tools/golden/`
  (rebuild of legacy core + generator), `tools/inventory/` (.dfm parser), `docker/`, `docs/`.

## Acceptance Criteria

- AC-1: The system SHALL build from a clean checkout to a static site (`app/dist` including
  `engine.wasm`) using the provided Docker build (D-19).
  DoD: `git clone … && docker compose run build` exits 0 and produces `app/dist/index.html` and an `engine.wasm` under `app/dist`.
- AC-2: The system SHALL perform every numerical calculation in IEEE-754 double precision only.
  DoD: `grep -rnE "long double|\bfloat\b|mpfr|CLNFloat" engine/src` returns 0 hits; the golden test suite passes.
- AC-3: When a legacy `.all` file containing `precision = 0|2|3` is imported, the system SHALL
  compute it in double precision and SHALL list the overridden `precision` key in the import report.
  DoD: test fixture with `precision = 3` imports; report contains "precision"; result equals the
  `precision = 1` variant bit-for-bit.
- AC-4: When any file of the import corpus (LF or CRLF line endings, UTF-8 with possibly invalid
  bytes) is imported, the system SHALL produce a valid JSON project without throwing, and SHALL list
  every unrecognized key in the import report (D-17.3).
  DoD: test iterates over all corpus `.all` files: 100 % import, 0 exceptions, schema validation
  passes; fixtures include an LF file, a CRLF file and a file with Latin-1 bytes; a fixture with an
  injected unknown key `foo_bar = 1` yields a report entry "foo_bar".
- AC-5: When an MVP project (Parratt, full matrix or Zak; qz or energy scan; with or without
  angular/energy resolution) is calculated, the system SHALL match the golden output of the native
  legacy rebuild per data point with |new − ref| ≤ 1e-10·|ref| + 1e-15 (D-23); looser per-case
  tolerances MAY be set only for explicitly listed cases, with a reason.
  DoD: golden suite green for both the native build and the WASM build (in Node).
- AC-6: The golden-data tooling SHALL show that the native legacy rebuild agrees with the shipped Wine-run 2.3.1 terminal within
  1e-6 relative on all corpus files that 2.3.1 can compute (D-17.2).
  DoD: `tools/golden/crosscheck` report shows 0 mismatches (listed exceptions need a documented reason).
- AC-7: When a project with a legacy "before calculation" Lua script is calculated, the system SHALL
  execute it with the agreed legacy script API (D-22, excluding CalculateReflectivity/GetError per D-43/D-49) and SHALL match the golden output (AC-5 tolerance).
  DoD: golden tests for all corpus projects with non-empty scripts pass (at least LNOSTO.all,
  NiL3_try2.all, PNO_LSAT.all).
- AC-7a: If a script calls a legacy API name that needs a non-MVP feature, the system SHALL report
  "not supported yet" with the name and line number instead of an undefined-name error (D-22).
  DoD: unit test calling `KramersKronigRange()` yields a message containing "KramersKronigRange" and "not supported".
  The excluded `CalculateReflectivity()` and `GetError()` commands report their name, source line and "not supported (excluded from project scope)" (D-43/D-49).
- AC-7b: When a `.all` file with `fitalgorithm = 1` is imported, the system SHALL set the fit
  algorithm to Simplex and SHALL state the fallback in the import report (D-27).
  DoD: fixture import yields `fit.algorithm == "simplex"` and a report entry mentioning Levenberg-Marquardt.
- AC-8: If a Lua script fails to compile or run, the system SHALL show the error with its line number
  and SHALL NOT change the project.
  DoD: unit test with a script containing a syntax error on line 3 yields a message containing "3",
  and the serialized project JSON is byte-identical before and after the run.
- AC-9: When a fit is started with Simplex or Simplex+annealing, the system SHALL reach a final
  chi-square ≤ the original legacy program's × (1 + 1e-6) on the same project (D-28, D-32).
  DoD: golden fit tests on at least 3 corpus projects pass.
- AC-10: While a fit or calculation is running, the UI SHALL stay responsive and SHALL show
  per-iteration progress; when the user presses Stop, the computation SHALL end within 1 s
  (D-28).
  DoD: Playwright test: start a fit; the iteration counter increases at least twice; click a tab
  during the fit (UI responds < 200 ms); press Stop; status "stopped" within 1 s.
- AC-11: The UI SHALL provide the legacy collapsible section panels (General, Sample, Fit) with the
  legacy section names, context-dependent visibility and per-user persisted expand/collapse state
  (D-18).
  DoD: Playwright test: each section header toggles its body; selecting a different fit algorithm
  shows/hides the algorithm-specific sections; after a reload, a collapsed section is still collapsed.
- AC-12: When the MVP release is built, the inventory check SHALL fail unless every entry of the
  legacy settings/handler inventory is marked ported, dropped (with reason) or deferred (D-17.1).
  DoD: `tools/inventory/check` exits 0 (no unmarked entries).
- AC-13: The system SHALL run fully client-side as a static site without any server-side
  component.
  DoD: serving `app/dist` with `python3 -m http.server` and running the Playwright suite passes with
  the network otherwise blocked.
- AC-14: When the user reloads the page, the system SHALL restore the last autosaved project.
  DoD: Playwright test: edit a layer thickness, reload, the value is preserved.
- AC-15: While running in a browser that supports the File System Access API, the system SHALL load
  and save project files directly through it; while running in a browser without it, the system
  SHALL offer upload/download instead (D-13).
  DoD: Playwright tests in Chromium headless cover direct save and upload/download with the
  File System Access API unavailable (D-36 supersedes the original Firefox test requirement).

## Boundaries

- ALWAYS: keep the golden test suite green; refactor legacy C++ only in steps that keep it green (D-17.5).
- ALWAYS: keep optimizers behind the optimizer interface in `engine/src/optim/` (D-10).
- NEVER: commit Numerical Recipes code, or code translated from it, anywhere in the repository (D-32).
- NEVER: add third-party code whose licence is incompatible with GPL-3.0 (D-31).
- ALWAYS: add every new legacy file the user supplies to the private corpus (F-25, D-20).
- ALWAYS: keep the Docker build working and producing the static site (D-19).
- ALWAYS: commit work to git; keep the legacy `old/` tree and binaries out of the main history (F-19, D-19).
- NEVER: commit corpus or research data to the main repo (D-20).
- ASK FIRST: before adding any feature outside the MVP scope (D-3, Out of Scope).
- ASK FIRST: before loosening a golden tolerance or adding a golden exception (D-29).
- ASK FIRST: before deviating from legacy physics behaviour, even if the legacy behaviour looks like a bug; document confirmed deviations (D-29).
- ASK FIRST: before changing the user-visible Lua globals or semantics (D-29).
- ALWAYS: keep the GPL-3.0 `LICENSE` file and licence headers consistent (D-31).
- NEVER: reintroduce single, extended or arbitrary precision (F-3).
- NEVER: silently drop data or keys during `.all` import; everything unhandled goes into the import report.
- NEVER: put domain logic in React components; it belongs in the TS model or the engine.
- NEVER: carry over legacy or IDE-generated identifiers (`Button1Click`, `TFrame4`, `Edit17`, `Schicht`, ...) into new code; use descriptive English names. Legacy names appear only in import/inventory mappings, traceability comments, and the user-visible Lua API (D-34, D-22).

## Out of Scope (MVP)

- Fourier transformation, Fourier plots and Fourier fitting are excluded (D-44). Their UI and execution paths are removed. Saved-project/import compatibility is retained; active legacy JSON Fourier settings are explicitly reported with an undoable removal action.

- Levenberg-Marquardt fitting and parameter standard deviations (D-11, F-17).
- Evolutionary fit algorithm (CEvolution) (D-11).
- 2D maps, TEY, webserver (D-3); transmission, "Parratt without multiple scattering" (legacy PHASE
  algorithm), Kramers-Kronig fitting, "Scratch" tools, OpenCL (D-25).
- Electric-field view |E(z)| (D-26).
- `.all` export / round-trip with legacy ReMagX (D-8).
- Shared or collaborative features, accounts, server back end (F-2).
- Desktop packaging (Electron/Tauri) (D-25; the deliverable is a static site, F-27).
- Rewriting the engine in Rust (rejected, see decisions.md).

## Open questions

Current unresolved decisions and their dependent work are tracked in [AGENTS.md](../../../AGENTS.md#decisions-and-dependent-work), S1–S8. The decision journal governs their resolution. Earlier D-22 to D-32 decisions did not resolve subsequently discovered legacy defects or all UI/infrastructure scope questions.


### Approved scope clarifications (2026-10-25)

- D-46: magnetic splines return the stored ordinate at the first usable knot; the original undefined read is not reproduced.
- D-47: single-medium layer conversion is excluded for now; reject application explicitly and preserve project data. Multi-row conversion remains in scope.
- D-48: private-corpus CI integration is deferred; private acceptance checks run locally. AC-4 behavior and AC-5/6/9 criteria remain unchanged. Public CI continues without private data.

- D-49: GetError is explicitly excluded; its named error does not disable ordinary chi-squared calculation or fitting.
- D-50: Lua array integer arguments use nearest-integer conversion with ties to even; numeric values retain full double precision. Nonfinite arguments, signed-32-bit overflow and invalid accesses remain errors.

- D-51: magnetic-profile none uses the stored layer count before repetition/subdivision and always disables the profile. Reject unknown active bindings; preserve other valid mappings and zero-amplitude skips.

Summary scope clarification (D-52, 2026-10-25): include the all-dataset measured/calculated overview with weighted errors, sizing/layout, axis scaling and full clipboard data/graphic exports. It is a snapshot on opening; Update changes layout only. Exclude the additional “Build const-qz from const-energy” interpolation command for now; TEY remains deferred. Preserve project data and undo state, and support cancellation and explicit errors through the real worker.

D-53 (2026-10-26): the obsolete layer-table coupl. column is excluded. Use Tools → Script → Code Generator → coupling of layers and BeforeCalculation for layer relationships. Original 2.6 does not serialize this column, so no synthetic import warning is added; unrelated magnetic-profile couplings remain supported.

D-54 (2026-10-26): implement plot Select/Clear Area and Lorentzian+Step fitting. Selection is chart-local and independent of project fit windows. Use the original second plot series and inclusive x interval, with the same six-parameter line shape and unweighted residual objective. The consistent curve/export result correction and separate unused multi-chart container disposition remain pending; area selection alone does not complete S4.

D-55/D-56 (2026-10-27): Lorentzian+Step fitting uses one consistent best evaluated candidate for its curve, reported squared error and parameter/expression export. The unused 1/2/4-chart container is excluded; the ordinary plot and Summary remain supported. This resolves the two pending D-54 choices without changing the analytic line shape or project fitting.
