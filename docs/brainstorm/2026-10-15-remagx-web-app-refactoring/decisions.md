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

## Rejected Approaches

Rust rewrite of the numerics (approach B): too costly and risky for the MVP. Reconsider if the ported C++ core proves unmaintainable.
Faithful replica of the Borland UI: dated UX, no real benefit (D-16).
Automatic Borland-to-React conversion: no such tool; event handlers mix UI and logic (F-22). The .dfm files are used only as an inventory.
Levenberg-Marquardt fitting via levmar: never worked in practice (F-17), GPL dependency. Reconsider only with a working, licence-compatible implementation and a real need for parameter errors.
TypeScript/AssemblyScript numerics (approach C): no complex-number/numerics ecosystem, performance concerns. Reconsider only for small helper calculations.
Golden data from Wine + 2.3.1 binary: precision limited to %e and outdated version (F-12). Still used for cross-checking the rebuild.
Full feature parity as first release (from D-1): delays a usable product.
`.all` as native file format: verbose, weakly structured, hard to extend (D-8). Reconsider only if the old and new programs must exchange files both ways.

## Open Questions / Assumptions

Q-1: [assumption] How compatible must legacy Lua 5.1 scripts be under Lua 5.4?
- Current assumption: a small compatibility prelude (e.g. `unpack = table.unpack`) plus the same global names (`par`, `energy`, `thickness`, ...) covers the scripts in the example corpus; anything else is reported as a script error with a migration hint.
- Impact if wrong: some legacy projects cannot be computed without manual script edits.
- Evidence so far (F-20): the LNOSTO script runs unchanged under Lua 5.4.

Q-2: [assumption] Can the legacy binaries be run headless (e.g. ReMagX_Terminal.exe under Wine) to produce golden outputs, and which tolerance applies?
- Current assumption: yes; relative tolerance around 1e-10 for pure calculations, looser where algorithms are known to be approximate (fast resolution).
- Impact if wrong: golden data must be produced manually from the GUI, or the acceptance gate changes.
- Partially answered by F-12: headless works, but the existing binaries are 2.3.1 and limit precision to about 1e-6 relative.
- Method resolved by D-5 (native rebuild); the tolerance part is still an assumption (used in spec AC-5).

Q-3: [assumption] Under which licence can the ported code be published on GitHub and remagx.org?
- Current assumption: open, to be confirmed by the user (who has to settle rights with the original authors / Max Planck Society per F-14).
- Impact if wrong: public GitHub hosting (F-9) may be impossible, and NR/levmar code must be replaced depending on the target licence.

Q-4: [assumption] Port the NR-derived Simplex/annealing code or rewrite it clean-room?
- Current assumption: port it first (isolated per D-10) so golden fit results can match legacy with the same seed; replace it with a clean-room implementation before any open-source release.
- Impact if wrong: a public release could infringe the Numerical Recipes licence; a clean-room rewrite changes fit trajectories, so golden fit tests must compare final chi-square/parameters within tolerance instead of exact paths.

Q-5: [assumption] Which legacy features beyond D-3's list are in the MVP?
- Current assumption: everything the golden tests of the corpus need is in the MVP: compound and element mode, Nevot-Croce and adaptive slicing, Gaussian magnetic profiles, arbitrary polarization, asymmetry (Rp/Rm), `.e` tables (F-6). Deferred: transmission, maps, TEY, "Parratt without multiple scattering" (PHASE), Kramers-Kronig fitting, OpenCL, desktop packaging.
- Impact if wrong: MVP is larger or smaller than expected; to be confirmed by the user before implementation.

Q-6: [assumption] How are `.all` projects with `fitalgorithm = 1` (Levenberg-Marquardt) or evolution settings imported?
- Current assumption: they import; the fit algorithm falls back to Simplex, and the import report states the fallback. Evolution parameters are kept in the JSON but unused.
- Impact if wrong: users lose settings or are surprised by a different algorithm.

Q-7: [assumption] Numeric thresholds in the spec: golden fit chi-square within 1e-6 relative (AC-9); Stop ends a computation within 1 s and the UI responds within 200 ms during a fit (AC-10).
- Current assumption: reasonable defaults set by the spec author, not yet confirmed by the user.
- Impact if wrong: ACs fail or are too loose; adjust when measured.

Q-8: [assumption] Spec-author boundaries not yet confirmed by the user: ASK FIRST before loosening a golden tolerance, before deviating from legacy physics (even apparent bugs), and before changing user-visible Lua globals.
- Current assumption: these follow from D-4 (legacy output is the reference) and D-2/Q-1 (script compatibility).
- Impact if wrong: unnecessary escalations, or silent behaviour changes.

Q-9: [assumption] Legacy `old/` tree outside main history: archive or Git LFS?
- Current assumption: kept outside git entirely (current `.gitignore`, F-26); the decision can be revisited.
- Impact if wrong: legacy sources are not versioned alongside the new code.

## Process notes
- 2026-10-15: Several journal writes (F-17..F-25, D-11..D-18 and the "Rejected Approaches" heading) silently failed during the session because an earlier scripted edit removed the anchor heading. They were re-inserted from the session record with unchanged content and are marked as such. Later scripted edits assert that their anchor exists.
- 2026-10-15: Cold review (Step 8) done by a fresh subagent; findings resolved in D-21 and Q-5 to Q-9. Brainstorm closed on user request; the implementation roadmap is deferred.
