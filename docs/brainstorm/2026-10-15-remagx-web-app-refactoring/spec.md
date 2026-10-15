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

- The legacy app depends on obsolete toolchains (Borland C++ Builder XE2, MinGW 4.6) and runs only
  on Windows. The numerical core is a header-only C++ template library behind a narrow C API (F-4).
- Precision modes float / long double / MPFR exist in the legacy code. Only double is kept, and
  legacy projects are computed in double whatever their saved `precision` value (F-3, F-4).
- Real projects rely on embedded Lua scripts (F-11), so scripting is part of the MVP (D-2, D-3).
- Distribution: public website remagx.org plus a GitHub repository, possibly GitHub-only later,
  which requires a static, server-less build (F-9).
- Everything must build in Docker and live in git (F-18, F-19).
- The licence is not yet decided; the legacy code is "all rights reserved" (MPG) and contains
  Numerical Recipes-derived code (F-14, Q-3).

## Design

### 1. Architecture (D-6, D-7)

```
┌──────────── Browser tab (static site: remagx.org / GitHub Pages) ────────────┐
│  UI: React + TypeScript + Vite (D-9)                                         │
│        │  typed messages (project model as plain data)                       │
│        ▼                                                                     │
│  Compute Web Worker                                                          │
│   ├─ wasmoon (Lua 5.4)  "before calculation" / multilayer scripts   (D-2)    │
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
  Levenberg-Marquardt (F-17). Whether the NR-derived code is ported or rewritten clean-room
  depends on the licence (Q-4).

### 3. Scripting (D-2, D-12)

- wasmoon (Lua 5.4) runs inside the compute worker.
- Legacy globals are provided with legacy semantics: `par` (0-based), `energy`, `thickness`,
  `delta`, `beta`, ... The bridge builds Lua tables itself with numeric keys, because automatic
  JS→Lua conversion yields string keys (F-21).
- A small Lua 5.1 compatibility prelude (e.g. `unpack`) is loaded before user scripts (Q-1).
- The "before calculation" script runs before every model evaluation (every fit iteration).
  Measured cost is about 32 µs per call (F-20).
- Script errors are shown with line numbers (D-14).

### 4. Project model and files (D-8, D-13, D-14, F-25)

- Native format: versioned JSON with a schema; TypeScript types plus runtime validation.
- Legacy `.all` is import-only. The importer:
  - accepts LF and CRLF, decodes as UTF-8 and tolerates invalid bytes (Latin-1 only in comments);
  - supports all section versions found in the corpus (`fileversion`, `layerversion`,
    `elementlayerversion`, `magneticversion`, `fitvariableversion`, `measurementdataversion`);
  - ignores `precision` and always uses double;
  - imports embedded datasets and Lua scripts;
  - produces an import report listing ignored or unsupported keys.
- Optical-constant tables (`.db`, `.m`, `.ff`) are imported into a per-browser material library;
  the built-in periodic-table data ships as a static asset.
- Storage: IndexedDB autosave; open/save via the File System Access API on Chromium, with an
  upload/download fallback on Firefox/Safari.

### 5. User interface (D-16, D-18, D-13)

- Same concepts and terms as legacy: menu (File / Edit / Mode / Layer / Tools), tabs
  Experiment-General / Sample / Fit, layer table, dataset list, plot area.
- Collapsible section side panel per tab (accordion), with the legacy section names, independent
  expand/collapse, scrolling and context-dependent visibility (e.g. algorithm-specific sections).
  Collapsed state is a per-user local preference (F-23).
- Plots with uPlot (log axes, many points).
- A script parses the legacy `.dfm` files and the `Items->Add` calls into a settings/handler
  inventory (F-22, F-24). It serves as the completeness checklist: every entry is marked
  ported / dropped / deferred. Logic from legacy event handlers is moved into the TS model or the
  engine, never copied into components.

### 6. Error handling (D-14)

- Legacy RX_* conditions (qz beyond 90°, missing `.db`/`.m`/`.ff`, script compile/run errors,
  multilayer parse errors) become clear UI messages.
- Fits can be cancelled (stop flag; worker termination as fallback). Worker crashes are reported
  and do not lose the project (autosave).

### 7. Validation (D-4, D-5, D-17)

- Golden data: the legacy 2.6 core and terminal are rebuilt natively (modern g++, double,
  `%.17g` output) and run on the corpus (`old/reMagX3/examples`, `Tutorial`, plus
  user-supplied files, F-25).
- The rebuild is cross-checked against the shipped 2.3.1 terminal under Wine at about 1e-6
  relative (F-12).
- The new engine is compared to golden data in both builds: native in C++ tests and WASM in Node.
- A few Playwright end-to-end tests cover import → simulate → fit → save in the browser.

### 8. Build, VCS and layout (D-15, F-18, F-19)

- A pinned Docker image (emsdk + g++ + Node) builds and tests everything:
  `docker compose run build`, `docker compose run test`. CI uses the same image.
- git repository. The legacy `old/` tree and release zips are kept out of the main history
  (archive or Git LFS).
- Layout: `engine/` (C++, native + Emscripten), `app/` (React + Vite), `tools/golden/`
  (rebuild of legacy core + generator), `tools/inventory/` (.dfm parser), `docker/`, `docs/`.

## Acceptance Criteria

- AC-1: The system SHALL build the native engine, the WASM engine and the web app from a clean
  checkout inside the pinned Docker image.
  DoD: `git clone … && docker compose run build` exits 0 and produces `app/dist/index.html` and `engine.wasm`.
- AC-2: The system SHALL perform every numerical calculation in IEEE-754 double precision only.
  DoD: `grep -rE "long double|float\b|mpfr|CLNFloat" engine/src` returns 0 hits (excluding
  explicitly whitelisted I/O conversions); `docker compose run test` passes.
- AC-3: When a legacy `.all` file containing `precision = 0|2|3` is imported, the system SHALL
  compute it in double precision and SHALL list the overridden `precision` key in the import report.
  DoD: test fixture with `precision = 3` imports; report contains "precision"; result equals the
  `precision = 1` variant bit-for-bit.
- AC-4: When any file of the import corpus (LF or CRLF line endings) is imported, the system SHALL
  produce a valid JSON project without throwing, and SHALL list every unrecognized key in the
  import report.
  DoD: CI test iterates over all corpus `.all` files: 100 % import, 0 exceptions, schema
  validation passes; the corpus contains both LF and CRLF variants.
- AC-5: When an MVP project (Parratt, full matrix or Zak; qz or energy scan; with or without
  angular/energy resolution) is calculated, the system SHALL match the golden output of the native
  legacy rebuild within relative tolerance 1e-10 per point (looser per-case tolerances MAY be set
  only for explicitly listed cases, with a reason).
  DoD: `docker compose run test` golden suite green for both the native and the WASM build.
- AC-6: The native legacy rebuild SHALL agree with the shipped Wine-run 2.3.1 terminal within
  1e-6 relative on all corpus files that 2.3.1 can compute.
  DoD: `tools/golden/crosscheck` report shows 0 mismatches (listed exceptions need a documented reason).
- AC-7: When a project with a legacy "before calculation" Lua script is calculated, the system SHALL
  execute it with legacy global semantics (0-based `par`, `energy`, `thickness`, `delta`, `beta`)
  and SHALL match the golden output (AC-5 tolerance).
  DoD: golden tests for LNOSTO.all, NiL3_try2.all and PNO_LSAT.all pass.
- AC-8: If a Lua script fails to compile or run, the system SHALL show the error with its line number
  and SHALL NOT change the project.
  DoD: unit test with a script containing a syntax error on line 3 yields a message containing "3".
- AC-9: When a fit is started with Simplex or Simplex+annealing, the system SHALL reach a final
  chi-square no worse than the legacy rebuild's on the same project and seed (within 1e-6 relative).
  DoD: golden fit tests on at least 3 corpus projects pass.
- AC-10: While a fit or calculation is running, the UI SHALL stay responsive and SHALL show
  per-iteration progress; when the user presses Stop, the computation SHALL end within 1 s.
  DoD: Playwright test: start a fit, click a tab during the fit (UI responds < 200 ms), press Stop,
  status "stopped" within 1 s.
- AC-11: The UI SHALL provide the legacy collapsible section panels (General, Sample, Fit) with the
  legacy section names and context-dependent visibility.
  DoD: Playwright test: each section header toggles its body; selecting a different fit algorithm
  shows/hides the algorithm-specific sections.
- AC-12: Before the MVP release, every entry of the legacy settings/handler inventory SHALL be marked
  ported, dropped (with reason) or deferred.
  DoD: `tools/inventory/check` exits 0 (no unmarked entries).
- AC-13: The system SHALL run fully client-side as a static site without any server-side
  component.
  DoD: serving `app/dist` with `python3 -m http.server` and running the Playwright suite passes with
  the network otherwise blocked.
- AC-14: When the user reloads the page, the system SHALL restore the last autosaved project.
  DoD: Playwright test: edit a layer thickness, reload, the value is preserved.
- AC-15: The system SHOULD load and save project files directly via the File System Access API where
  available, and SHALL offer upload/download otherwise.
  DoD: Playwright tests in Chromium (direct save) and Firefox (download) pass.

## Boundaries

- ALWAYS: keep the golden test suite green; refactor legacy C++ only in steps that keep it green (D-17.5).
- ALWAYS: keep optimizer code (NR-derived, any third-party) isolated behind the optimizer interface (D-10).
- ALWAYS: add every new legacy file the user supplies to the import/golden corpus (F-25).
- ALWAYS: build and test through the Docker image; local builds must not need anything the image lacks (F-18).
- ALWAYS: commit work to git; keep the legacy `old/` tree and binaries out of the main history (F-19, D-15).
- ASK FIRST: before adding any feature outside the MVP scope (D-3, Out of Scope).
- ASK FIRST: before loosening a golden tolerance or adding a golden exception.
- ASK FIRST: before deviating from legacy physics behaviour, even if the legacy behaviour looks like a bug; document confirmed deviations.
- ASK FIRST: before changing the user-visible Lua globals or semantics.
- NEVER: publish the repository or the site publicly before the licence question (Q-3) is decided (D-17.4).
- NEVER: reintroduce single, extended or arbitrary precision (F-3).
- NEVER: silently drop data or keys during `.all` import; everything unhandled goes into the import report.
- NEVER: put domain logic in React components; it belongs in the TS model or the engine.

## Out of Scope (MVP)

- Levenberg-Marquardt fitting and parameter standard deviations (D-11, F-17).
- Evolutionary fit algorithm (CEvolution) (D-11).
- 2D maps, TEY, "Parratt without multiple scattering" (legacy PHASE algorithm), Kramers-Kronig fitting, webserver, OpenCL (D-3).
- `.all` export / round-trip with legacy ReMagX (D-8).
- Shared or collaborative features, accounts, server back end (F-2).
- Desktop packaging (Electron/Tauri).
- Rewriting the engine in Rust (rejected, see decisions.md).
