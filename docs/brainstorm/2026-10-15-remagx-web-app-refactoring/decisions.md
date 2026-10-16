# Decision Journal — reMagX web application refactoring (TypeScript + WebAssembly)

## Established Facts
<!-- F-N: [status] <fact> (Source: <how verified>)
     status = verified | assumed | REFUTED -->

F-1: [verified] Goal: refactor reMagX into a complete web application in TypeScript, with WebAssembly for numerical calculations. (Source: Task.md)
F-2: [verified] Browser-local first; shared/collaborative features may come later. (Source: Task.md)
F-3: [verified] Only double precision is used for numerics; single, extended and arbitrary precision modes are dropped. Legacy projects are computed in double regardless of their saved `precision` value. (Source: Task.md)
F-4: [verified] Legacy code (v2.6.1) is a C++ template core (`shared/`, templated on scalar T) behind a narrow C DLL API, with a Borland VCL GUI on top. Precision switch: 0=float, 1=double, 2=long double, 3=MPFR 200-bit (`server/dllbinding.c`, `shared/bignumber.h`). (Source: code analysis, docs/analysis/legacy-reMagX3-analysis.md)
F-5: [verified] Legacy feature set: Parratt, Zak, full 4x4 matrix (Visnovsky), phase and TEY formalisms; qz scans, energy scans, asymmetry, transmission, maps; compound and element modes; Nevot-Croce and adaptive slicing; Gaussian magnetic profiles; angular and energy resolution; arbitrary polarization; LM, chi-square/annealing and evolutionary fits; embedded Lua 5.1 scripting. (Source: code analysis)
F-6: [verified] The project format is the text `.all` file (key = value, versioned sections, measurement data embedded inline); optical constants live in `.db`/`.m`/`.ff`/`.e` ASCII tables. There are 99 `.all` files in the corpus; 28 contain `precision = 1`, the rest omit it. (Source: grep over old/reMagX3)
F-7: [verified] Release zips 1.6.0 to 2.6 with Windows binaries (incl. `ReMagX_Terminal.exe`) exist and could serve as a reference oracle for regression outputs. (Source: directory listing)
F-8: [verified] Project website: https://remagx.org/ (Source: Task.md)
F-9: [verified] Distribution: public website (remagx.org) plus a GitHub repository/archive; hosting may move fully to GitHub in the future (e.g. GitHub Pages). Implies a static, server-less build. (Source: user answer, 2026-10-15)
F-10: [verified] Lua can run in the browser: `wasmoon` 1.16.0 (real Lua 5.4 VM compiled to WASM, MIT) and `fengari` 0.1.5 (Lua 5.3 VM in JS, MIT). Alternatively, the original Lua 5.1 C sources (already vendored in `shared/lua`) can be compiled with Emscripten into the numerics WASM module. Legacy scripts are written against Lua 5.1, so 5.3/5.4 VMs might need small script changes (e.g. `unpack`, `setfenv`, `module`). (Source: npm registry query 2026-10-15; vendored sources in old/reMagX3/shared/lua)
F-11: [verified] Real legacy projects depend on embedded Lua scripts (`scriptline = ...` in `.all`). For example LNOSTO.all, NiL3_try2.all and PNO_LSAT.all compute optical constants from Lorentz oscillators driven by fit parameters (`par[0]`, `energy`) or couple thicknesses (`thickness[2] = 98.5 - thickness[1]`). Without scripting, these projects load but compute different results. (Source: grep over old/reMagX3 `.all` files; 59 files contain a script section)
F-12: [verified] Spike: the legacy `ReMagX_Terminal.exe` runs headless under Wine on this machine (`wine ReMagX_Terminal.exe -refl default.all` gives 300 qz/R lines, exit code 0). Limits: (a) output is printed with `%e`, i.e. only 7 significant digits (relative resolution about 1e-6 to 1e-7); (b) the only terminal binaries are version 2.3.1 (bin/, ReMagX_Terminal.zip from 2013). The 2.6 release ships only the GUI, so golden data from 2.6 would need the GUI or a rebuild from source. CLI modes: -refl, -dicrefl, -fit, -map, -convert. (Source: spike in scratchpad, 2026-10-15)
F-13: [verified] Spike: the legacy core header chain (`RechenHilfe.h`, which pulls in CParratt/CZak/CVisnovsky, LayerSegmentation, CStateHandler, MaterialConstants, script.h) with `CalcReflectivityEnergyResolution<double>` instantiated passes `g++ -std=c++17 -fsyntax-only` with exactly 1 error (assignment to a const member in `simul/CVisnovsky.h:24`, a trivial fix). The .cpp files and linking were not tested. Emscripten is not installed on this machine. (Source: spike in scratchpad, 2026-10-15)
F-14: [verified] Legacy licence: "All rights reserved by the authors and the Max Planck Society" (MPI-MF Stuttgart, Dept. Schuetz, 2009). Any use or distribution needs written permission, and results must cite ReMagX. Third-party parts: the Simplex code is from "Numerical Recipes" (amoeba/amotry, amebsa/amotsa), whose licence does not allow redistributing the source; the Levenberg-Marquardt code is levmar (GPL v2). (Source: client/LicenseForm.dfm, shared/lm/LICENSE, shared/CChiSquareFit.cpp)
F-15: [verified] Legacy fit algorithms (`fitalgorithm`): 0 = Simplex (NR amoeba), 1 = Levenberg-Marquardt (levmar `dlevmar_bc_dif`, box constraints, numeric Jacobian, gives standard deviations from the covariance), 2 = Simplex with simulated annealing (NR amebsa). The evolutionary algorithm (`CEvolution`) runs separately. (Source: shared/CChiSquareFit.cpp, server/ReMagX_Terminal.cpp)
F-16: [verified] Some legacy sources are Latin-1 encoded (German umlauts), so plain grep treats them as binary. Porting needs a UTF-8 conversion step. (Source: `file shared/CChiSquareFit.cpp`)
F-17: [verified] The user reports that the legacy Levenberg-Marquardt fit (levmar) "never worked" in practice; users fit with Simplex and Simplex+annealing. (Source: user answer, 2026-10-15) [re-inserted 2026-10-15: written live during the session, but the original edit silently failed because of a missing anchor; content unchanged]
F-18: [REFUTED] Requirement: everything (native C++ core, Emscripten WASM build, web app, golden-data tools) must build inside Docker. (Source: user message, 2026-10-15) [re-inserted 2026-10-15: written live during the session, but the original edit silently failed because of a missing anchor; content unchanged]
     Erratum: "everything must build inside Docker" overstated the requirement; the user wants Docker only as a build option, and the deliverable is a static site. Corrected in F-27.
F-19: [verified] Requirement: the project uses git for version control. At brainstorm time the working directory is not yet a git repository. (Source: user message, 2026-10-15; environment check) [re-inserted 2026-10-15: written live during the session, but the original edit silently failed because of a missing anchor; content unchanged]
F-20: [verified] Spike: the real LNOSTO.all "before calculation" script (5 Lorentz oscillators driven by `par[0..4]` and `energy`, writing `delta[1]`/`beta[1]`) runs unchanged under wasmoon 1.16 (Lua 5.4, Node 22) in about 32 µs per call when the parameters are passed as scalars and the tables stay on the Lua side. The script runs once per energy/evaluation, not per qz point, so the overhead is negligible next to a reflectivity calculation. (Source: scratchpad/luaspike/bench.mjs, 2026-10-15) [re-inserted 2026-10-15: written live during the session, but the original edit silently failed because of a missing anchor; content unchanged]
F-21: [verified] Spike: passing a JS object to wasmoon produces a Lua table with string keys (`{0:1}` → `par["0"]`), so legacy 0-based `par[0]` is nil. The bridge must build Lua tables itself (numeric keys, 0-based `par`) and cannot rely on automatic JS→Lua conversion. (Source: same spike, first run failed with "attempt to perform arithmetic on a nil value") [re-inserted 2026-10-15: written live during the session, but the original edit silently failed because of a missing anchor; content unchanged]
F-22: [verified] Legacy Borland UI size: 36 .dfm forms/frames with 517 components (124 TLabel, 89 TEdit, 58 TButton, 55 TMenuItem, 28 TCheckBox, 16 TRadioGroup, 6 TStringGrid, custom TChart1, ...) and about 196 event handlers in the client/guidll C++ files, many with mixed UI and domain logic (Unit1.cpp ~8.7k lines). .dfm files are text and machine-readable. (Source: grep over client/, guidll/) [re-inserted 2026-10-15: written live during the session, but the original edit silently failed because of a missing anchor; content unchanged]
F-23: [verified] The legacy right-hand panel is a custom collapsible "box" panel (`client/BoxFrames.h`, class TFrame4). It is a scroll box of sections, each with a clickable header bar that expands or collapses its frame; the stack is laid out again on toggle and scrolls with the mouse wheel. Three instances: GeneralFrames (Const. Energy Settings, X-Axis, Resolution, Simulation Parameters, Polarization, Map Calculations), SampleFrames (Dataset, Adaptive Layer Segmentation, Optical Constants Database, Element Mode, Magneto-Optics, Additional Magnetization profile), FitFrames (Algorithm, Additional Fit Parameters, Fitting window, Algorithm Parameters, Parameters, Start/Stop, Evolution, Debug Window). Sections are also shown or hidden by context through an `active[]` flag, e.g. "Evolution" replaces "Algorithm Parameters" and "Start/Stop" when the evolution algorithm is selected (`Unit1.cpp` RadioGroup1Click), and a (now commented-out) simple mode hides advanced sections and resets defaults. (Source: client/BoxFrames.h, client/Unit1.cpp lines 406-433, 6030-6085, 6530-6552; user pointed it out) [re-inserted 2026-10-15: written live during the session, but the original edit silently failed because of a missing anchor; content unchanged]
F-24: [verified] Many option lists (algorithm, roughness model, precision, asymmetry definition, error function, ...) are filled in code (`Items->Add` in `Unit1.cpp`), not in the .dfm files. A .dfm-only inventory is therefore incomplete; the inventory script must also scan the `Items->Add` calls. (Source: client/Unit1.cpp lines 155-300) [re-inserted 2026-10-15: written live during the session, but the original edit silently failed because of a missing anchor; content unchanged]
F-25: [verified] `.all` import input conditions per user: files may use LF or CRLF; content is essentially ASCII and may be decoded as Unicode (UTF-8; F-16 Latin-1 umlauts only matter in comments). The user will supply many more legacy files for comparison, so the golden/import corpus will grow well beyond the 99 files found. (Source: user note on pre-mortem, 2026-10-15) [re-inserted 2026-10-15: written live during the session, but the original edit silently failed because of a missing anchor; content unchanged]
F-26: [verified] git repository initialized in the project root on 2026-10-15 (updates F-19). `.gitignore` excludes `/old/` (legacy sources, binaries, release zips), node_modules, build output, `*.wasm`, `*.exe`, `*.dll`. No commit made yet. (Source: `git init`, user approval)
F-27: [verified] Docker is wanted only as a build (compile) option. The final product is a static website that runs in the browser; running, developing and testing are not tied to Docker. (Source: user message, 2026-10-15)
F-28: [verified] The legacy core is not header-only: the formalisms are templates in headers (`shared/simul/*.h`, `RechenHilfe.h`), but `shared/` also contains .cpp files (e.g. CChiSquareFit.cpp, CStateHandler.cpp, MaterialConstants.cpp, LayerSegmentation.cpp). The legacy toolchain is Borland C++ Builder XE2 (GUI) and MinGW 4.6.2 or newer (DLL). (Source: `ls old/reMagX3/shared`, old/reMagX3/Readme.txt)
F-29: [verified] Legacy `.all` section version keys present in the corpus: `fileversion = 1`, `layerversion = 3`, `elementlayerversion = 1`, `magneticversion = 4`, `fitvariableversion = 1`, `measurementdataversion = 2`. Legacy error codes (`RX_STATUS` in CStateHandler.h): RX_QZ (angles above 90°), RX_CSCRIPT, RX_ESCRIPT, RX_UNKNOWN, RX_DB (db files missing), RX_ML (multilayer script parse error). Legacy main menu: File, Edit, Mode, Layer, Tools, Preferences, Help. (Source: grep over corpus; shared/CStateHandler.h; client/Unit1.dfm)
F-30: [verified] The corpus scripts (1,136 non-empty, non-comment lines across all `.all` files outside backup/) use no Lua 5.1-only standard-library features (no unpack, setfenv/getfenv, module, table.getn, loadstring, math.mod, gfind). They depend entirely on the ReMagX script API: arrays `delta`, `beta`, `par`, `thickness`, `sigma`, `density`, `deltam`, `betam`, `gauss_delta`, `gauss_beta`, dielectric-tensor components `exx_r` … `ezz_i`; element objects with `setsigma`/`getsigma`/`setthickness`/`getthickness`/`setdensity`/`getdensity`/`setf`/`get`/`set`; functions `SetChemicalFormula`, `FillTensors`, `print`. The legacy engine registers further globals: `energy`, `epsilon`, `resolution`, `energyscan_qz`, `renewocs`, `write`, `CalculateReflectivity`, `CalculateDicReflectivity`, `CalculateEnergyscan`, `ShowMatrixEigenvalues`, `ShowEScanEigenvalues`, `GetError`, `SetName`, `SetDeltaBeta`, `KramersKronigRange`, `GetGaussLorentzianReal`/`Imag`. (Source: grep over corpus scripts; shared/script.cpp, scriptmetaobject.cpp, scriptmetaarray.cpp)
F-31: [verified] git branch is `main`; remote `origin` = https://github.com/s-macke/ReMagX.git (added 2026-10-15, nothing pushed yet). An anonymous GitHub API request for that repo returns 404, so it is private or not yet created. (Source: git remote -v; curl api.github.com)
F-32: [verified] The user made https://github.com/s-macke/ReMagX public (2026-10-15). The GitHub API shows: public, empty (size 0, nothing pushed yet), no licence set. This affects F-31, the NEVER-publish boundary (D-17.4), D-24 (porting NR code as-is) and D-30 (legacy sources copied into tools/golden/legacy/). (Source: user message; api.github.com)
F-33: [verified] The user states that the rights to the legacy ReMagX code are cleared, so the ported engine (D-6) and the legacy rebuild for golden data (D-5, D-30) may be published under GPL-3.0. The Numerical Recipes-derived code (F-14) is not covered and stays excluded. (Source: user answer, 2026-10-15; who cleared it is not recorded)
F-34: [verified] The legacy program uses hc = 12398.326 eV·Å for energy↔wavelength conversion (`shared/Variablen.cpp`, with the comment "the last 3 digits are probably wrong"; CODATA: 12398.41984). This is a 7.6e-6 relative difference, larger than the golden tolerance (D-23), so the engine port must keep the legacy value (D-29). The web app's shared unit module uses it too. (Source: old/reMagX3/shared/Variablen.cpp)
F-35: [verified] User guideline: the TypeScript mock engine (D-33) is by definition not an exact reproduction of the legacy numerics; it is not tuned or tested against legacy output. Legacy-exact numerics are only required of the real WASM engine (AC-5). (Source: user message, 2026-10-15)

## Decisions & Rationale

D-1: [superseded-by D-3] **First release = core MVP, not full parity**
- Evaluated: core MVP (Parratt + matrix/Zak, qz & energy scans, resolution, .all import, 1-2 fit algorithms); full feature parity with 2.6; simulation-only first.
- Rejected full parity: long time without a usable product, high risk.
- Rejected simulation-only: fitting is the main reason people use ReMagX; deferring it delays real validation.
- Chosen because: fastest route to a validated, usable core; Lua scripting, maps, TEY, webserver etc. follow later.

D-2: [accepted] **Lua scripting via wasmoon (Lua 5.4 in WASM), in the MVP**
- Evaluated: original Lua 5.1 compiled into the numerics WASM module (legacy-exact); wasmoon Lua 5.4 (npm, MIT); fengari Lua 5.3 (pure JS); defer scripting.
- Rejected Lua 5.1 in our own module: pins us to an outdated Lua and adds custom build/binding work.
- Rejected fengari: pure JS (slower), Lua 5.3 and less actively maintained than wasmoon.
- Rejected deferring: many real projects depend on scripts (F-11), so they would compute different results.
- Chosen because: ready-made, maintained, modern language; the user accepts that some legacy scripts may need small edits (see Q-1).

D-3: [accepted] **MVP scope = core simulation + fitting + Lua scripting** (replaces D-1)
- Same as D-1 (Parratt + matrix/Zak, qz & energy scans, resolution, .all import, 1-2 fit algorithms) plus Lua scripting (D-2), because of F-11.
- Still deferred: maps, TEY, webserver, other secondary tools.

D-4: [accepted] **Correctness = golden tests against legacy ReMagX output**
- Evaluated: golden outputs from legacy binaries (double precision) on the example corpus; analytic/physics-only tests; both.
- Rejected physics-only: no objective regression baseline for complex projects (magnetic, multi-dataset, scripts).
- Rejected "both" for now: user prefers the legacy program as the reference. Analytic tests may still be added as unit tests, but they are not the acceptance gate.
- Chosen because: objective, automatable pass/fail on real user projects; the legacy release binaries exist (F-7). Tolerance to be fixed later (see Q-2).

D-5: [accepted] **Golden data from a native Linux rebuild of the legacy 2.6 core** (refines D-4, answers Q-2)
- Evaluated: native rebuild of 2.6 `shared/` + terminal with modern g++, double only, `%.17g` output; Wine + 2.3.1 binary (F-12); Wine now and rebuild later.
- Rejected Wine + 2.3.1: only about 1e-6 precision, old version (no 2.4-2.6 changes), Wine needed in CI.
- Rejected Wine first: produces throwaway golden data with the wrong version and tolerance.
- Chosen because: full double precision, current version, runs in CI. A few cases are cross-checked against the Wine binary to detect differences introduced by the rebuild.

D-6: [accepted] **Numerics engine = ported and cleaned legacy C++ core, compiled to WASM with Emscripten**
- Evaluated: (A) port the legacy C++ numerical core (double-only, no MPFR/pthreads/Lua/webserver, clean data-driven API) with Emscripten; (B) clean-room rewrite in Rust to WASM; (C) TypeScript/AssemblyScript only; A now and B later.
- Rejected B: weeks of re-implementing 4x4 matrix, Zak and resolution physics, with subtle correctness risk.
- Rejected C: no complex-number/numerics ecosystem in AssemblyScript; plain TS too slow for fit loops.
- Rejected "A now, B later": not planned; can be reconsidered after the MVP.
- Chosen because: the physics is proven, the header chain already compiles with modern g++ (F-13), the native rebuild for golden data (D-5) is the same work, and golden tests (D-4) pass almost by construction.
- Consequence: one C++ code base, two build targets (native for golden data and tests, Emscripten for the browser).

D-7: [accepted] **Architecture: static site, UI thread + compute Web Worker hosting engine.wasm, wasmoon and the fit loop** (presented to the user; framework, storage details still open)
- The UI sends the project model as plain data to a dedicated compute worker; results and fit progress stream back. Long fits never block the UI.
- Same C++ core built natively for golden data and CI (D-5, D-6).
- Fits the static hosting constraint (F-9) and browser-local first (F-2).

D-8: [accepted] **Native project format = versioned JSON with a schema; legacy `.all` is import-only**
- Evaluated: JSON plus .all import; .all as native format; JSON plus a guaranteed .all round-trip.
- Rejected .all native: verbose, weakly structured, hard to extend.
- Rejected round-trip: extra work and testing for a shrinking legacy user base; .all export may be added later.
- Chosen because: validation, diffing and extension are easy. The .all importer ignores `precision` and always uses double (F-3) and must accept every version in the corpus (F-6).

D-9: [accepted] **Front end = React + TypeScript + Vite**
- Evaluated: React, Svelte(Kit), Vue 3 (all with Vite).
- Rejected Svelte/Vue: smaller ecosystems for complex data grids, a code editor for Lua and plotting wrappers.
- Chosen because: largest ecosystem and contributor pool.

D-10: [accepted] **Licence undecided, so third-party fit code is isolated and replaceable**
- Evaluated: GPL-3.0 (keep levmar, rewrite NR); permissive (replace levmar and NR); source-available/proprietary; decide later.
- Chosen: decide later (Q-3). Design consequence: Numerical Recipes code (Simplex, Simplex2) and levmar sit behind one optimizer interface in their own source directory, so they can be swapped without touching the physics. No other NR- or GPL-derived code may enter the core.

D-11: [accepted] **MVP fit algorithms = Simplex (Nelder-Mead) + Simplex with simulated annealing; no Levenberg-Marquardt** [re-inserted 2026-10-15: written live during the session, but the original edit silently failed because of a missing anchor; content unchanged]
- Evaluated: LM plus a clean-room simplex; port all three as-is; LM only; (user's choice) Simplex plus annealing only.
- Rejected LM: never worked in practice (F-17); dropping it also removes the GPL levmar dependency (F-14).
- Chosen because: these are the algorithms users rely on. They sit behind the optimizer interface (D-10). Whether they are ported from the NR-derived code or rewritten clean-room is tied to the licence decision (Q-3, Q-4).
- Not in the MVP: evolutionary algorithm (CEvolution), parameter standard deviations (legacy produced them via levmar covariance).

D-12: [accepted] **Data flow and Lua placement**: project model as TS types with schema validation → compute Web Worker → wasmoon Lua scripts (legacy globals `par`, `energy`, `thickness`, ...) → engine.wasm. The "before calculation" script runs before every model evaluation. Results and per-iteration fit progress stream back; cancel via stop flag, worker termination as fallback. (Source: design-draft.md, accepted by user) [re-inserted 2026-10-15: written live during the session, but the original edit silently failed because of a missing anchor; content unchanged]

D-13: [accepted] **Storage and files**: IndexedDB autosave; File System Access API on Chromium, upload/download fallback on Firefox/Safari; imported .db/.m/.ff tables go into a per-browser material library; built-in periodic-table data ships as a static asset. Plots with uPlot. (Source: design-draft.md, accepted by user) [re-inserted 2026-10-15: written live during the session, but the original edit silently failed because of a missing anchor; content unchanged]

D-14: [accepted] **Error handling**: legacy RX_* error codes become user-facing messages; Lua errors show line numbers; `.all` import shows a report of ignored/unsupported keys, including that `precision` is overridden to double. (Source: design-draft.md, accepted by user) [re-inserted 2026-10-15: written live during the session, but the original edit silently failed because of a missing anchor; content unchanged]

D-15: [superseded-by D-19] **Testing, build and repo**: native C++ build plus golden data is the regression gate; the same golden tests run against the WASM build in Node; a few Playwright end-to-end tests. A pinned Docker image (emsdk + g++ + Node) builds and tests everything via `docker compose run build|test`, and CI uses the same image (F-18). git repository with the legacy `old/` tree and release zips kept out of the main history (F-19). Layout: `engine/`, `app/`, `tools/golden/`, `docker/`, `docs/`. (Source: design-draft.md, accepted by user) [re-inserted 2026-10-15: written live during the session, but the original edit silently failed because of a missing anchor; content unchanged]

D-16: [accepted] **UI = same concepts as legacy, modern web layout** [re-inserted 2026-10-15: written live during the session, but the original edit silently failed because of a missing anchor; content unchanged]
- Evaluated: same concepts with modern layout; faithful replica of the Borland forms; fresh redesign.
- Rejected replica: carries old UX debt, looks dated, little gain.
- Rejected fresh redesign: existing users must relearn, more design effort.
- Chosen because: keeps the familiar structure (Experiment / Sample / Fit, layer table, dataset list, same terminology) while modernizing. A script parses the 36 .dfm files (F-22) into a settings inventory that serves as a completeness checklist. UI logic from the event handlers is moved by hand into the TS model or the engine, never copied into components.

D-17: [accepted] **Pre-mortem mitigations (all five accepted by the user)** [re-inserted 2026-10-15: written live during the session, but the original edit silently failed because of a missing anchor; content unchanged]
1. Hidden logic lost (domain logic in Unit1.cpp handlers never ported). Mitigation: a handler and settings inventory (.dfm + `Items->Add` scan, F-22, F-24); every entry marked ported / dropped / deferred before the MVP release. Lands in: acceptance criterion (spec AC-12).
2. Golden reference wrong (the native rebuild differs from the shipped binaries: compiler, x87 vs SSE, uninitialized variables). Mitigation: cross-check the rebuild against the Wine binary at 1e-6 relative on the corpus. Lands in: acceptance criterion (spec AC-6).
3. `.all` import fails on real files. Mitigation: every corpus file imports in CI; LF and CRLF accepted; decode as UTF-8 with invalid bytes tolerated (F-25); no silent drops (import report, D-14); the corpus is designed to grow with user-supplied files. Lands in: acceptance criterion (spec AC-4) and boundaries (NEVER silently drop; ALWAYS add supplied files to corpus).
4. Licence blocks release. Mitigation: the repository stays private and nothing is published until Q-3 is decided; NR code isolated (D-10). Lands in: boundary (NEVER publish before licence decided).
5. The port drifts into a rewrite. Mitigation: refactor legacy C++ only while golden tests are green; no non-MVP features without asking. Lands in: boundaries (ALWAYS keep golden green / ASK FIRST before non-MVP features).

D-18: [accepted] **Keep the collapsible section panel concept** (consequence of D-16, F-23) [re-inserted 2026-10-15: written live during the session, but the original edit silently failed because of a missing anchor; content unchanged]
- The React UI has an accordion-style side panel per tab (General/Experiment, Sample, Fit) with the same section names, independent expand/collapse, scrolling, and context-dependent visibility (e.g. algorithm-specific sections). Expanded/collapsed state is remembered per user (local UI preference).

D-19: [accepted] **Docker is an optional, reproducible build; output is a static site** (replaces D-15, based on F-27)
- A Dockerfile/compose setup (pinned emsdk + g++ + Node) is provided as the reproducible way to build the native engine, the WASM engine and the static web app (`app/dist`). Building with a local toolchain stays possible; tests are not tied to Docker.
- Unchanged from D-15: native C++ build plus golden data is the regression gate; the same golden tests run against the WASM build in Node; a few Playwright end-to-end tests; git with `old/` out of history; layout `engine/`, `app/`, `tools/golden/`, `docker/`, `docs/`, plus `tools/inventory/` for the D-16/D-17.1 inventory script.

D-20: [accepted] **Test corpus lives in a separate private folder/repo**
- Evaluated: separate private location (e.g. `../reMagX4-corpus`, passed as `CORPUS_DIR`); inside the main repo (Git LFS); both.
- Rejected in-repo: legacy projects may contain unpublished research data, which would become public along with the repo (F-9).
- Rejected both: unnecessary for now.
- Chosen because: keeps research data private; the main repo holds only a few small shareable fixtures. Initial corpus: `old/reMagX3/examples`, `old/reMagX3/Tutorial`, plus files supplied by the user (F-25).

D-21: [accepted] **Resolution of the cold spec review (Step 8)**
- Spec fixed: "header-only" removed (F-28); wrong F-23 citation for persisted panel state replaced by D-18; D-10's "no other NR/GPL code in the core" added to Boundaries; D-17.3 encoding added to AC-4; AC-15 restructured to match D-13; AC-12 rewritten in EARS form; DoDs of AC-2, AC-4, AC-8, AC-10, AC-11 tightened; AC-1 adapted to D-19; corpus via D-20.
- Spec details that had no journal source were either grounded (F-28, F-29) or recorded as explicit assumptions (Q-5 to Q-9), and the spec cites those Q-entries.
- D-5 said "a few cases" for the Wine cross-check; D-17.2 later extended this to all corpus files 2.3.1 can compute. D-17.2 applies.

D-22: [accepted] **Full legacy ReMagX script API on Lua 5.4** (resolves Q-1)
- Evaluated: full legacy API; only the names used in the corpus; a new API plus a migration tool.
- Rejected corpus-only: user scripts outside the corpus would fail with generic "undefined" errors.
- Rejected new API: every legacy script would need migrating; the rewriter adds risk.
- Chosen because: the Lua 5.4 language is no obstacle (F-30), so implementing all legacy names (arrays, element objects, functions, globals per F-30) lets old scripts run unchanged. Names that need non-MVP features (e.g. KramersKronigRange, ShowMatrixEigenvalues, ShowEScanEigenvalues) raise a clear "not supported yet" error instead of being undefined.

D-23: [accepted] **Golden tolerance: |new − ref| ≤ 1e-10·|ref| + 1e-15 per data point** (resolves the tolerance part of Q-2)
- Evaluated: 1e-10 relative with a 1e-15 absolute floor; 1e-8 relative (+1e-14); bit-exact.
- Rejected 1e-8: subtle regressions between 1e-10 and 1e-8 would go unnoticed.
- Rejected bit-exact: breaks on reordered sums, different libm (WASM vs glibc) and compiler flags; it would block cleanup.
- Chosen because: same code and double precision leave only ~1e-15 to 1e-13 differences, so 1e-10 has headroom yet catches physics changes; the floor avoids false alarms in deep minima. Native builds use `-ffp-contract=off` so native and WASM round the same way. Applies to every compared quantity (R, Rp, Rm, asymmetry, ...). Exceptions only for listed cases with a reason (ASK FIRST).

D-24: [superseded-by D-32] **Optimizers: port the NR-derived code as-is first, replace it clean-room before any public release** (resolves Q-4)
- Evaluated: port first and rewrite before release; clean-room now; port and keep.
- Rejected clean-room now: fit paths would differ from legacy during the physics port, leaving golden fit tests with only final chi-square.
- Rejected port and keep: the NR licence forbids source redistribution, blocking any public release.
- Chosen because: during private development the ported code (isolated in `engine/src/optim/legacy_nr/`, D-10) gives the same fit paths as legacy with the same seed. Before a public release (or once Q-3 requires it), a clean-room Nelder-Mead and annealing implementation in `engine/src/optim/` replaces it. It is written from the published algorithms, not copied, and validated by final chi-square ≤ legacy chi-square (+1e-6 relative).

D-25: [accepted] **MVP feature split** (resolves Q-5, extends D-3)
- In the MVP, besides D-3: compound and element mode; Nevot-Croce roughness and adaptive slicing; Gaussian magnetic profiles (with spline and coupling); arbitrary polarization (sigma/pi, analyzer); asymmetry (Rp/Rm, both definitions); `.db`/`.m`/`.ff`/`.e` tables.
- Later: transmission, 2D maps, TEY, Parratt without multiple scattering (PHASE), Kramers-Kronig fitting, evolution fit, "Scratch" tools, webserver, OpenCL, desktop packaging.
- Evaluated: this split; a smaller MVP (compound mode only); a bigger MVP (plus transmission, maps, evolution).
- Rejected smaller: element-mode corpus projects could not be golden-tested.
- Rejected bigger: delays the first usable release.
- Open detail: the layer/electric-field viewer (legacy "Show layers and electric field") was shown with a question mark; see Q-10.

D-26: [accepted] **Depth-profile view in the MVP; electric-field view later** (resolves Q-10)
- MVP: a plot of delta(z), beta(z), delta_m(z) and beta_m(z) as the engine uses them after roughness/slicing, as a sanity check of the sample model.
- Later: |E(z)| inside the sample (legacy CReflDetails).
- Evaluated: profile only; profile plus field; neither.

D-27: [accepted] **LM/evolution projects import with a Simplex fallback** (resolves Q-6)
- `fitalgorithm = 1` (LM) imports as Simplex, and the import report says "Levenberg-Marquardt is not available; switched to Simplex." `evo_*` keys are kept in the JSON (`fit.evolution`), unused until evolution exists.
- Evaluated: Simplex fallback with a note; annealing fallback; ask the user in an import dialog.
- Rejected annealing fallback: slower; Simplex is the legacy default (fitalgorithm 0).
- Rejected dialog: interrupts batch imports (large corpus, F-25).

D-28: [accepted] **Thresholds confirmed** (resolves Q-7): golden fit final chi-square ≤ legacy × (1 + 1e-6) with the same project and seed; Stop ends a running fit or calculation within 1 s; the UI reacts to a click within 200 ms during a fit. All measured by automated tests.
- Evaluated: as proposed; stricter (0.5 s / 100 ms, needs cancellation inside single evaluations); looser (3 s / 500 ms, chi-square 1e-4).

D-29: [accepted] **All three ASK FIRST rules confirmed** (resolves Q-8): ask before loosening a golden tolerance or adding an exception; ask before deviating from legacy physics, even apparent bugs (confirmed deviations are documented); ask before changing user-visible Lua globals or semantics.

D-30: [accepted] **Legacy `old/` tree stays outside git** (resolves Q-9)
- `old/` stays ignored and lives only on disk and in the user's backup. The legacy sources needed for golden data (`shared/`, terminal) are copied into `tools/golden/legacy/` and are therefore versioned.
- Evaluated: keep outside git; separate private repo (with LFS); main repo with Git LFS.
- Rejected main repo with LFS: large repo, and all-rights-reserved legacy code and binaries would follow the repo if it ever goes public.
- Rejected separate repo: one more repo to manage, no current need.

D-31: [accepted] **Licence = GPL-3.0** (resolves Q-3; D-10's "decide later" is settled)
- Evaluated: MIT, GPL-3.0, Apache-2.0, no licence yet.
- Chosen by the user after making the repo public (F-32): derivatives must stay open source.
- Consequences: Numerical Recipes-derived code must never be pushed (its licence forbids source redistribution), so D-24's "port as-is first" must be revisited. Publishing legacy-derived code (the ported engine, D-6; the golden rebuild, D-30) requires the rights to the legacy code (F-14).

D-32: [accepted] **Rewrite Simplex and annealing from the published algorithms now; reference fit results from the original code, generated locally only** (replaces D-24, due to D-31 and F-32)
- The engine gets new Nelder-Mead and simplex simulated-annealing implementations (GPL-3.0) in `engine/src/optim/`, written from the published algorithm descriptions and not translated from the Numerical Recipes code. The legacy rebuild in `tools/golden/legacy/` uses this rewrite too, so the public repo contains no NR code.
- Reference fit results are generated once on the user's machine with an original legacy build (with NR code) that is never committed anywhere. Only the output data is stored, in the private corpus (D-20).
- Fit test (AC-9): final chi-square(new) ≤ chi-square(original) × (1 + 1e-6); step-by-step paths are not compared (D-28).
- Evaluated: original code locally only for references; rewrite only with synthetic parameter-recovery tests.
- Rejected rewrite-only: there would be no comparison against the original program's fit quality.

D-33: [accepted] **Build the UI first against a mocked compute interface**
- The React UI is built before the C++→WASM port, against a `ComputeService` interface. A `MockComputeService` runs in a real Web Worker; later a `WasmComputeService` replaces it without UI changes (fits D-7, D-12).
- The mock computes real curves with a small scalar Parratt + Nevot-Croce in TypeScript, so the UI can be judged with realistic behaviour. The real `.all` importer (D-8, D-27) is part of this phase.
- Evaluated mock data: TS mini-Parratt; purely synthetic curves; recorded legacy outputs. Rejected synthetic: does not respond like real physics. Rejected recorded outputs: edits would not change the curve.
- Evaluated importer timing: real importer now; hand-made sample projects only. Rejected samples-only: real legacy projects could not be viewed.
- Plan: /home/sebastian/.claude/plans/ok-so-what-next-dapper-cook.md (Steps 0-8). (Source: user, 2026-10-15)

D-34: [accepted] **Ported code gets proper, descriptive names; legacy names are not kept**
- No Borland/IDE-generated or legacy names survive the port: no `Button1Click`, `RadioGroup1Click`, `TFrame4`, `Edit17`, `Schicht`, `RechenHilfe`, `CLNFloat`, etc. Functions, components, types and variables are named after what they do or represent (e.g. `onAlgorithmChange`, `SectionPanel`, `Layer`, `calcReflectivity`), in English.
- Applies to the TypeScript UI and to the ported C++ engine. Legacy names may appear only in mapping tables, such as the `.all` key importer, the inventory (legacy component → new element), and comments that reference the legacy source for traceability.
- Exception: the user-visible Lua script API keeps its legacy names (D-22), because renaming would break users' scripts.
- (Source: user instruction, 2026-10-15)

D-35: [accepted] **Command-line tool from the native engine build, in the engine phase; the legacy webserver stays dropped**
- The legacy program had a console mode (`ReMagX_Terminal.exe [options] statefile`: -refl, -dicrefl, -fit, -map, -convert, -v; F-12) and a webserver started from the Settings dialog.
- Decision: a native CLI built from the same C++ engine as the WASM target (D-6), with the legacy options, reading legacy `.all` and JSON projects and writing results as text (fit: the fitted project). `-map` follows once maps exist (D-25).
- Evaluated: native CLI in the engine phase; Node.js CLI on the WASM engine; later/optional.
- Rejected Node CLI: needs Node at runtime; the native build exists anyway.
- Rejected later/optional: cheap once the native build exists, and useful for batch runs.
- The webserver is not rebuilt: the product itself is a static website (F-27, D-19). (Source: user answer, 2026-10-15)

## Rejected Approaches

Rust rewrite of the numerics (approach B): too costly and risky for the MVP. Reconsider if the ported C++ core proves unmaintainable.
Faithful replica of the Borland UI: dated UX, no real benefit (D-16).
Automatic Borland-to-React conversion: no such tool; event handlers mix UI and logic (F-22). The .dfm files are used only as an inventory.
Levenberg-Marquardt fitting via levmar: never worked in practice (F-17), GPL dependency. Reconsider only with a working, licence-compatible implementation and a real need for parameter errors.
New modern script API with automatic migration of legacy scripts: every script must be migrated, and the rewriter is a risk (D-22).
Porting the Numerical Recipes optimizer code as-is (D-24): impossible in a public GPL-3.0 repo, because the NR licence forbids source redistribution (D-32).
TypeScript/AssemblyScript numerics (approach C): no complex-number/numerics ecosystem, performance concerns. Reconsider only for small helper calculations.
Golden data from Wine + 2.3.1 binary: precision limited to %e and outdated version (F-12). Still used for cross-checking the rebuild.
Full feature parity as first release (from D-1): delays a usable product.
`.all` as native file format: verbose, weakly structured, hard to extend (D-8). Reconsider only if the old and new programs must exchange files both ways.

## Open Questions / Assumptions

Q-1: [resolved by D-22] How compatible must legacy Lua 5.1 scripts be under Lua 5.4?
- Current assumption: a small compatibility prelude (e.g. `unpack = table.unpack`) plus the same global names (`par`, `energy`, `thickness`, ...) covers the scripts in the example corpus; anything else is reported as a script error with a migration hint.
- Impact if wrong: some legacy projects cannot be computed without manual script edits.
- Evidence so far (F-20): the LNOSTO script runs unchanged under Lua 5.4.

Q-2: [resolved by D-5 and D-23] Can the legacy binaries be run headless (e.g. ReMagX_Terminal.exe under Wine) to produce golden outputs, and which tolerance applies?
- Current assumption: yes; relative tolerance around 1e-10 for pure calculations, looser where algorithms are known to be approximate (fast resolution).
- Impact if wrong: golden data must be produced manually from the GUI, or the acceptance gate changes.
- Partially answered by F-12: headless works, but the existing binaries are 2.3.1 and limit precision to about 1e-6 relative.
- Method resolved by D-5 (native rebuild); the tolerance part is still an assumption (used in spec AC-5).

Q-3: [resolved by D-31] Under which licence can the ported code be published on GitHub and remagx.org?
- Current assumption: open, to be confirmed by the user (who has to settle rights with the original authors / Max Planck Society per F-14).
- 2026-10-15 review: the user confirmed it stays open for now. Development continues privately; pushing to `origin` (F-31) is fine only while that repo is private.
- Impact if wrong: public GitHub hosting (F-9) may be impossible, and NR/levmar code must be replaced depending on the target licence.

Q-4: [resolved by D-24] Port the NR-derived Simplex/annealing code or rewrite it clean-room?
- Current assumption: port it first (isolated per D-10) so golden fit results can match legacy with the same seed; replace it with a clean-room implementation before any open-source release.
- Impact if wrong: a public release could infringe the Numerical Recipes licence; a clean-room rewrite changes fit trajectories, so golden fit tests must compare final chi-square/parameters within tolerance instead of exact paths.

Q-5: [resolved by D-25] Which legacy features beyond D-3's list are in the MVP?
- Current assumption: everything the golden tests of the corpus need is in the MVP: compound and element mode, Nevot-Croce and adaptive slicing, Gaussian magnetic profiles, arbitrary polarization, asymmetry (Rp/Rm), `.e` tables (F-6). Deferred: transmission, maps, TEY, "Parratt without multiple scattering" (PHASE), Kramers-Kronig fitting, OpenCL, desktop packaging.
- Impact if wrong: MVP is larger or smaller than expected; to be confirmed by the user before implementation.

Q-6: [resolved by D-27] How are `.all` projects with `fitalgorithm = 1` (Levenberg-Marquardt) or evolution settings imported?
- Current assumption: they import; the fit algorithm falls back to Simplex, and the import report states the fallback. Evolution parameters are kept in the JSON but unused.
- Impact if wrong: users lose settings or are surprised by a different algorithm.

Q-7: [resolved by D-28] Numeric thresholds in the spec: golden fit chi-square within 1e-6 relative (AC-9); Stop ends a computation within 1 s and the UI responds within 200 ms during a fit (AC-10).
- Current assumption: reasonable defaults set by the spec author, not yet confirmed by the user.
- Impact if wrong: ACs fail or are too loose; adjust when measured.

Q-8: [resolved by D-29] Spec-author boundaries not yet confirmed by the user: ASK FIRST before loosening a golden tolerance, before deviating from legacy physics (even apparent bugs), and before changing user-visible Lua globals.
- Current assumption: these follow from D-4 (legacy output is the reference) and D-2/Q-1 (script compatibility).
- Impact if wrong: unnecessary escalations, or silent behaviour changes.

Q-9: [resolved by D-30] Legacy `old/` tree outside main history: archive or Git LFS?
- Current assumption: kept outside git entirely (current `.gitignore`, F-26); the decision can be revisited.
- Impact if wrong: legacy sources are not versioned alongside the new code.

Q-10: [resolved by D-26] Is the layer profile / electric field viewer part of the MVP?
- Current assumption: to be asked.
- Impact if wrong: users miss a diagnostic view, or MVP effort grows.

## Process notes
- 2026-10-15: Several journal writes (F-17..F-25, D-11..D-18 and the "Rejected Approaches" heading) silently failed during the session because an earlier scripted edit removed the anchor heading. They were re-inserted from the session record with unchanged content and are marked as such. Later scripted edits assert that their anchor exists.
- 2026-10-15: Cold review (Step 8) done by a fresh subagent; findings resolved in D-21 and Q-5 to Q-9. Brainstorm closed on user request; the implementation roadmap is deferred.
- 2026-10-15: Open assumptions reviewed one by one with the user: Q-1, Q-2 and Q-4 to Q-10 resolved (D-22 to D-30); only Q-3 (licence) remains open.
- 2026-10-15: Repo made public by the user (F-32). Licence decided as GPL-3.0 (D-31), legacy rights cleared (F-33), NR code replaced by a rewrite (D-32). No open questions remain.

- 2026-10-16: Checklist audit against the repository, spec and accepted decisions. Expanded AGENTS.md to track the MVP physics explicitly, distinguish mock UI completion from real-engine acceptance, record the D-28 cancellation gap, separate original-optimizer fit references from rebuild simulation goldens, and track private-corpus CI. UI completeness remains provisional pending the D-16/D-17 inventory. No scope decisions changed. The external implementation plan cited in D-33 was unavailable at its recorded path; its historical reference is retained, but Steps 0–8 were not verified. Use the repository spec and journal for scope and AGENTS.md for current status.

- 2026-10-16: Implemented the D-16/D-17.1 inventory and AC-12 gate in `tools/inventory/`: 36 DFM forms plus uncommented dynamic items and event assignments from the immediate client/guidll sources and headers, excluding historical backups. Committed metadata and explicit review groups let CI check completeness without the private legacy tree; optional source verification checks the snapshot against local sources. All 676 entries are classified (364 ported UI entries, 29 dropped, 283 deferred with UI/engine/later/decision phases). Deferred MVP work is not moved out of scope. Added dataset-editor omissions, profile all-layers binding, plot tick steps and Summary details to AGENTS.md; hidden experiments and Summary conversion remain explicit scope questions. No physics, Lua API or accepted scope decisions changed. Wine is unnecessary for this tooling; it remains needed for AC-6.

- 2026-10-16: Completed worker failure recovery under D-7/D-12/D-13. Worker errors, unreadable messages, startup and send failures now reject pending work and release the worker without mutating the project. Creation is lazy, including after failure or Stop fallback, so a load failure cannot trigger a restart loop; service disposal is final and stale callbacks are ignored. Updated the worker-lifecycle inventory group to ported. The existing 2 s Stop fallback and the separate D-28/AC-10 cancellation task remain unchanged. Service tests cover failure/retry and project preservation; browser verification was unavailable because Chrome/Chromium is not installed.

- 2026-10-16: Implemented Stop for all shared-worker work under D-12/D-28: standalone calculations terminate immediately; fits receive a cooperative stop with a non-extendable 250 ms fallback. Cancellation is a normal Stopped result/status, clears queued work, suppresses late progress, and preserves the project on forced termination. Automatic plot redraw stays paused until an edit or explicit calculation; scan buttons can recalculate the same view, and chi-square evaluation also enables Stop. Tests cover all service request types, cancellation races, reducer pause/resume and real blocked Node worker termination within 1 s. The stop-deadline inventory group now records the implemented controls; AC-10 browser progress, <200 ms interaction and end-to-end Stop timing remain unchecked because no browser binary is available. No numerical behavior or scope decisions changed.

D-36: [accepted] **Chromium headless is the automated browser-test target.** The user explicitly requested removing Firefox on 2026-10-16; Chromium is sufficient for testing. This supersedes the two-browser test requirement in AC-15 and the checklist, without removing the D-13 upload/download fallback. Test that fallback in Chromium with the File System Access API unavailable.

- 2026-10-16: Added Playwright AC-10 tests against the built static app, using synthetic mock data only. Tests observe two fit-progress advances, tab response below 200 ms, and Stop below 1 s, including workers blocked in fit, reflectivity and chi-square requests; subsequent calculation must return a result. The test harness injects the blocking loop into the served worker without production hooks. Chromium headless runs in Pages CI; AC-11/13/14/15 remain open. Playwright is Apache-2.0 licensed (GPL-3.0 compatible). Earlier browser-unavailability notes describe the environment before browser installation.

- 2026-10-16: Completed current UI-phase Playwright coverage for AC-11/13/14/15 in Chromium headless. All suites use Python static hosting and reject external network requests. Tests exercise every current section header, conditional annealing controls, persisted section state, IndexedDB restoration after an edit, upload/download JSON round-trip, and direct Open/Save/Save As using real browser OPFS handles supplied instead of native picker dialogs. OS dialog interaction is outside headless automation; no production file API is mocked beyond the picker boundary. Autosave polling waits for the stored record before reload. No production behavior or scope changed.

- 2026-10-16: Completed the dataset property editor against legacy DatasetFrame.dfm and Unit1.cpp DataListClick/DataListEditorValidate. Added title/comment (Comment is accepted by the legacy handler although absent from its DFM rows), angular resolution, both complex beam editors, and read-only Type/File/Datapoints. Energy scans show Energy shift; other datasets show Energy, preserving both stored values. Reused the experiment beam editor and existing model presets. Chromium verifies isolated edits, undo/redo, nonnegative resolution validation and full JSON save preservation. Inventory now has 369 ported, 29 dropped and 278 deferred entries. No mock physics or scope changed; full numerical use of these dataset settings remains engine work.

- 2026-10-16: Implemented the theta x-axis control after reviewing legacy DrawReflectivity, DrawReflectivityMag and asymmetry drawing in Unit1.cpp. Both simulated and corrected measured qz coordinates use the current experiment energy and legacy hc = 12398.326 for asin(qz/(2*k0)) in degrees. Plot and diagram export share the conversion; qz stays stored unchanged, energy scans and depth profiles retain their axes, and invalid conversion reports an error rather than clamping. Held curves are displayed only on matching axes. Unit tests verify conversion, boundary handling and source preservation; Chromium verifies axis switching and exported coordinates. Inventory now has 371 ported, 29 dropped and 276 deferred entries. No compute physics changed.

- 2026-10-16: Added plot wheel zoom and cursor readout after inspecting Chart1.cpp ChartMouseMove, wheel handlers and OnZoomIn/Out. Wheel zoom uses half/double visible extents centered on the pointer; logarithmic scales transform in log space. A Zoom Out button expands around the plot center, while Scale fits the data again. Invalid/overflowing ranges are rejected. Cursor readout uses the displayed coordinates, including theta and depth/energy axes. Properties, clipboard/picture export and pending area-selection decisions remain open. Inventory now has 372 ported, 29 dropped and 275 deferred entries.

- 2026-10-16: Added chart clipboard and picture exports based on Chart1.cpp OnSendDataToClipboard/OnSendGraphicToClipboard/OnSavePicture. Clipboard text retains side-by-side x/y pairs, including held data; unequal lengths use blank cells instead of legacy out-of-bounds access or invented zeros. Graphic export captures the rendered axes/current zoom and adds the legend with an opaque theme background; clipboard uses browser-supported PNG and Save Picture retains legacy JPEG. Errors are visible without mutating project state. Chromium checks real clipboard text/PNG, JPEG download and permission-denial handling. Inventory now has 375 ported, 29 dropped and 272 deferred entries. Properties and pending plot-area scope questions remain open.

- 2026-10-16: Implemented Plot Properties from Chart1PropertyForm and Chart1 drawing code. Steps are interval counts (1–30) with linear/log interpolation, not an absolute step size. Supports explicit ranges, log axes, background/border and eight pen colors, font size, line width and points; Cancel discards changes. Validation rejects non-increasing/nonfinite ranges and nonpositive log bounds. Properties remain session-local and isolated by axis/view; exports reflect appearance. Browser tests check validation, applied canvas/legend colors, exact ranges, Cancel and view isolation. Inventory now has 426 ported, 29 dropped and 221 deferred entries. Plot-area selection/Lorentzian scope questions remain open; no physics changed.

- 2026-10-16: Added cell Fit (On/Off) after reviewing OnFitSchichtEingabe and AddFitVariable. Supported cells follow the legacy target mapping: compound thickness/optical constants/roughness, element slab thickness/density/roughness and element scattering factors; compound density and per-layer angles are not mapped to unrelated parameters. Mouse and keyboard menus, fit highlighting, undo and parameter-list synchronization use pure model actions. New entries intentionally reuse the web Fit-tab factory and its existing initial bounds; this does not establish legacy optimizer acceptance. Chromium checks compound toggling and element isolation. Inventory now has 428 ported, 29 dropped and 219 deferred entries. Remaining table-menu actions and the value slider stay open.

- 2026-10-16: Implemented the four active profile Fit checkboxes from OnCheckBoxDelta/Beta/Variance/ZClick, reusing the existing Fit-tab parameter defaults. Profile deletion removes its fit targets and safely reindexes surviving targets and amplitude/width couplings; undo restores the project. The MagnetizationDirectionFrame and MzFrame general Fit controls are hidden/disabled, and OnMagFitCheckBoxClick is commented out: these three inventory entries move to pending hidden-controls scope review, not ported or dropped. Unit and Chromium tests cover reference preservation, parameter synchronization, selection, deletion and undo. Inventory now has 432 ported, 29 dropped and 215 deferred entries. Actual profile fitting remains engine-phase work; spline editing and all-layers binding remain open.

- 2026-10-16: Added profile Build spline and point editing from Button7Click, ShowGaussFunc/GetGaussEingabe and CGaussFunc::BuildSpline(4). Nine samples span center ±6 widths; only the five interior y values are editable. Zero delta amplitude or zero width produces zero values as in legacy initialization. Building replaces existing samples and enables spline mode; toggling retains Gaussian values and spline points, and Gaussian Fit/coupling controls hide while spline editing is active. Nonfinite generated values report an error without changing the project. Unit and Chromium checks cover sample positions, values, boundaries, undo, mode switches and JSON save. This is editor initialization, not spline interpolation or real-engine validation. Inventory now has 434 ported, 29 dropped and 213 deferred entries. Binding all/none and legacy coupling choices remain open.

- 2026-10-16: Corrected profile binding display using ShowGaussFunc/GetGaussEingabe and RechenHilfe.h: saved null represents legacy -1 (all), zero is air, count-1 is bulk, count is none. The existing raw legacy indices remain unchanged in JSON and imports; no schema migration or importer change is needed. Layer insertion/deletion now remaps valid bindings to preserve their target, with a deleted target becoming none. Earlier-profile coupling choices match legacy; unusual stored references remain visible and are not silently cleared. Unit and Chromium tests cover binding preservation, distinct options, undo, earlier-profile choices and JSON saving. Inventory now has 445 ported, 29 dropped and 202 deferred entries. Numerical binding/coupling behavior remains engine work.

- Validation note: the full browser run exposed a 5 s PNG clipboard assertion timeout. Temporary instrumentation confirmed delayed asynchronous canvas encoding (an image callback took about 6.7 s). The export-completion assertion now allows 15 s; actual clipboard image/content checks remain, and no AC-10 timing or numerical tolerance changed. Instrumentation was removed.

- Follow-up found while reviewing layer mutations: layer-indexed fit parameters are not yet remapped by insertLayerAbove/removeLayer. Recorded an explicit checklist task; this binding change only remaps profile bindings.

- 2026-10-16: Completed the layer-mutation follow-up for both compound layers and element slabs. A shared fit-target remapping function preserves surviving indices and parameter settings, removes targets for deleted entries, and leaves profile/script/global targets and other element stacks untouched. Invalid structural indices are rejected without mutating the project. Unit tests cover insertion/deletion round trips, boundary layers/slabs, bounds/steps, stack isolation and invalid indices; Chromium checks cell highlighting, parameter counts and undo. No importer or numerical engine changes.

- Follow-up: useFitRunner still captures the original indexed targets for progress/results. Structural edits or project replacement during a running fit need stale-result protection beyond remapping the saved parameter list; recorded separately in the checklist.

- 2026-10-16: Added fit/chi-square session epochs under D-7/D-12/D-13. Current structural editors (layer/slab/profile/script-parameter counts, sample mode, element identity, fit target lists, active dataset and immutable measurement columns), explicit project loads and undo/redo invalidate old callbacks and clear live preview values. Callbacks for progress, completion, error, debug output and Stop pause state must match the current session. Ordinary numeric edits remain compatible with result application. A provider-level effect disposes the invalidated service immediately, even when the Fit section is unmounted, and the next calculation creates a fresh worker. Unit tests cover late callbacks after edit/undo/load, valid result merging, dataset/slab changes and newer sessions; blocked-worker Chromium tests cover structural edit/load outside the Fit panel and calculation recovery. No numerical engine or importer changes; inventory totals remain 445 ported, 29 dropped and 202 deferred.

- 2026-10-16: Implemented ScrollBar2 value scaling from SchichtEingabeSelectCell, StringGrid1SelectCell, GaussEingabeSelectCell and ScrollBar2Change. Selection captures a fixed reference at 250 of 0–1000; values scale from 0 to 4× without compounding. Eligible layer/slab and element-factor cells, Gaussian values, interior spline y values and script parameters share the bar below the layer table. Text cells, ambient thickness/roughness and substrate thickness are excluded. Typing refreshes the baseline; undo/load/structural edits, element navigation and target unmount clear selection. One gesture coalesces into one undo step. Current-view calculation uses a 120 ms throttle while a value cell is selected, so continuous dragging does not wait for release; all calculations still use ComputeService. Unit and Chromium tests cover fixed scaling, negative/zero values, boundary exclusions, profile/script/element isolation, undo and worker requests during an active drag. Inventory now has 454 ported, 29 dropped and 193 deferred entries. Mock/real-engine boundaries are unchanged.

- 2026-10-16: Added compound-layer delta/beta and deltam/betam spectrum actions after reviewing OnZeigeDeltaBetaSpektrum/OnZeigeDeltaMBetaMSpektrum and Filldb. Legacy refreshes constants and runs BeforeCalculation at every source-table energy. The UI-phase worker therefore exposes a layerSpectrum query with project, layer index and session tables; its mock returns explicitly labelled table previews from .db/.m samples without changing project energy or constants. Full per-energy refresh, Lua and element/tensor conversion are separately tracked engine work, not claimed here. Menus support right-click and Shift+F10 from numeric and text cells; existing plot navigation, properties and exports apply. Missing/empty tables report actionable errors, and changing the table cache recalculates the view. Worker and Chromium tests cover transferred samples, magnetic sign/zero values, errors, keyboard menus, clipboard output and project preservation. Inventory now has 456 ported, 29 dropped and 191 deferred entries.

- 2026-10-16: Implemented the D-13 per-browser material library in a separate versioned IndexedDB database (remagx-materials), retaining the existing project autosave database/version. All five imported table kinds persist; record validation checks kind, finite values, dimensions and sorted energy. Imports replace only matching material/kind entries. Restore merges behind newer session imports, and an explicit clear during startup prevents old records returning. Writes are serialized and acknowledge transaction completion; explicit cache deletion clears storage, while normal saves upsert and preserve unreadable/future-version records. Failures and unreadable records remain visible, and in-memory tables remain usable. Unit tests cover replacement, validation, restore races and stale save notifications; Chromium checks every table kind across reload, replacement, persistent clear, record preservation and denied storage. Project JSON and undo history remain separate. Built-in data, its licence review and real numerical table use remain open; inventory totals remain 456 ported, 29 dropped and 191 deferred.

- 2026-10-16: Added Element Mode → Show Scattering Factors f1/f2 after reviewing ShowScatteringFactorsClick. The selected element determines the .ff energy grid; zero-energy rows are omitted, axes are linear and both factors remain visible, including negative/zero values. A new ComputeService worker query supplies the current mock table preview, preserving project values and reporting missing/invalid data. Navigation refreshes the view; plot exports remain available. Legacy Filldb and BeforeCalculation at every energy are explicitly deferred to the real engine. Service and Chromium checks cover table selection, energy filtering, errors, navigation, clipboard values and project preservation. Inventory now has 458 ported, 29 dropped and 189 deferred entries.

- 2026-10-16: Added Element Mode Show Density Profiles in the Sample section and toolbar after reviewing ShowDensityProfilesClick, DrawDensityProfiles and ElementLayerSystem::GetDensity. All elements share substrate-relative z coordinates and a linear density axis; small slab-boundary marks follow the current profiles and appear in graphic exports. ComputeService/worker supplies a bounded 401-point base grid plus interfaces and approximate smooth slab windows for the UI phase. This is explicitly labelled mock output, not legacy-exact sampling/density or Lua execution; those remain engine work. Service tests cover shared grids, substrate/ambient values, boundaries, roughness/thickness/density edits, invalid stacks and project preservation; Chromium covers both controls, all-element legends, exported values, edits and undo. Inventory now has 461 ported, 29 dropped and 186 deferred entries.

- 2026-10-16: Materials dialog review found and corrected a prerequisite fit-target mapping error: CStateHandler::ImplementFitVariable/TransferToFitVariables and MaterialFormButtonOkClick use MAGGAMMA/MAGPHI with a layer additional_id, whereas the web target helpers used the global direction. Both targets now select, name, read/write and remap a compound layer. Missing indices remain visible as unresolved targets and never overwrite global values; importer/schema stay unchanged. Unit checks cover indexed result application, invalid targets, bounds/steps and structural edits; Chromium checks layer selection, value transfer and undo. MaterialsForm.dfm also establishes that Name/Thickness/Roughness/optical values/tensors are disabled or read-only; only formula, density, angles and Fit are editable. Fill Dielectric Tensor is hidden and has no bound handler, so its inventory entry moves to pending hidden-controls scope, not dropped or implemented. Inventory totals remain 461 ported, 29 dropped and 186 deferred.

- 2026-10-16: Added Properties → Material Settings from numeric and text layer menus, preserving MaterialsForm read-only structural/optical values and editable formula/density/angles/Fit flags. Drafts apply in one undo step on OK; Cancel/Escape discard them, invalid density is rejected, and updates merge only edited fields so concurrent fit results remain intact. Structural/project invalidation closes the dialog rather than applying to a shifted layer. Existing Fit bounds/steps are preserved. Unit and Chromium tests cover field isolation, fit creation/removal, concurrent values, read-only controls, invalid input, mouse/keyboard opening, cancellation and undo. Tensor display remains explicitly unavailable and deferred instead of showing invented values; its inventory entries stay open. Inventory now has 494 ported, 29 dropped and 153 deferred entries.

- 2026-10-16: Added both Get database context actions after reviewing GetdbButtonClick, Filldb and Getdb/Getff. They affect all entries of the active stack, preserve missing/out-of-range primary entries, and report absent magnetic tables that reset magnetic scalars to zero. ComputeService returns scalar patches; the current mock uses linear interpolation and endpoint holding for magnetic tables, with explicit reports for that approximation and unapplied .e tensors. Updates are atomic/undoable and require unchanged source project, library and session epoch. A regression test exposed that the worker-cancellation count only advances for active fits; database results and the Materials dialog now use fitEpoch, which advances on structural edits, load and undo/redo even without a running fit. This corrects the previous Materials guard claim. Reports wait while another dialog is open. Unit/browser checks cover both modes, full-stack updates, skipped entries, undo and stale results; legacy interpolation, built-in data and tensors remain engine work. Inventory now has 496 ported, 29 dropped and 151 deferred entries.

- 2026-10-16: Database requests also enable the shared Stop control. An injected blocked-worker Chromium test verifies termination below 1 s, a visible Stopped report and successful calculation recovery. The full 36-test Chromium suite passed before this final Stop integration, followed by the new cancellation test; 136 unit tests, lint, build and inventory checks pass.

- 2026-10-16: Added dielectric-tensor spectrum groups and Material Settings matrices after reviewing OnShowDiagonalEpsilon/OnShowTopEpsilon/OnShowBottomEpsilon and MaterialsForm. Diagonal curves show 1−Re and Im; off-diagonal groups show Re and Im, with six distinct colours. ComputeService supplies all nine complex components, preferring the .e energy grid and otherwise .db for spectra. The labelled mock uses linear .e interpolation or scalar construction; full Filldb/BeforeCalculation and real-engine validation remain open. Material matrices are read-only snapshots, with Stop for blocked requests. Unit and Chromium checks cover component exports, interpolation, scalar fallback, layout, project preservation and blocked-worker recovery. Hidden Fill Dielectric Tensor remains a scope decision. Inventory now has 520 ported, 29 dropped and 127 deferred entries.

- 2026-10-16: Added the element-table delta/beta spectrum action after reviewing OnZeigeDeltaBetaSpektrum. The selected element supplies the .ff grid; all elements contribute their density at the selected slab index. The worker supplies a labelled mock preview using linear interpolation/endpoint holding; zero-energy rows are omitted, missing tables or slab densities report errors, and no project values change. Keyboard/mouse menus, density edits, undo and exports are covered. Full Filldb/BeforeCalculation and numerical acceptance remain engine work. Five menu inventory entries move to ported; the grid entry stays deferred for the existing coupl. scope decision. Inventory totals: 525 ported, 29 dropped, 122 deferred.

- 2026-10-16: Added Illustrate Segmentation after reviewing ShowProfileButtonClick, Button10Click and the default-checked DFM control. Both optical profile views render stepped values and delta/deltam boundary strokes to zero when checked; unchecked views retain smooth samples. ComputeService depth-profile results can carry explicit segment intervals. The mock supplies fixed sampling intervals, clearly labelled and not adaptive segmentation acceptance. Display state is separate from project/undo; exports share the plotted points. To layer list remains open because it replaces the material stack and needs guarded reference handling. Inventory totals: 526 ported, 29 dropped, 121 deferred.

- 2026-10-16: Added compound-mode To layer list after reviewing Button13Click (FillLayers, unknown database names, replacement of the material stack). A dedicated worker query supplies a labelled fixed-interval mock conversion; adaptive slicing, automatic optical refresh, Lua and element-mode conversion stay open. The dialog previews the layer count and reference effects before Apply, supports Cancel/Stop, and rejects changed project/library/session snapshots. Generated intervals carry sampled optical values, zero roughness and unknown names; other material metadata comes from the original midpoint layer. Replaced interior/unresolved layer fit targets are removed; outer targets follow substrate/ambient. Interior/unresolved magnetic bindings become none with an explicit report; profile values, couplings and scripts remain. One undo restores everything. Every replacement invalidates the fit session even if layer count is unchanged. Inventory totals: 528 ported, 29 dropped, 119 deferred.
