# AGENTS.md: ReMagX web rewrite

Guide for anyone (human or AI agent) working on this repository: the rules, how to work, and a
checklist of what is done and what is still open. Keep the checklist current: tick items in
the same commit that completes them.

## What this is

A browser-local rewrite of **ReMagX** (resonant magnetic X-ray reflectivity: simulate and fit
thin-film multilayers). The legacy program is a Windows C++/Borland application (ReMagX 2.6,
local copy in `old/`, not in git). The new app is a static website: React + TypeScript UI,
numerics later in WebAssembly compiled from the ported legacy C++ core.

- Live site: https://s-macke.github.io/ReMagX/ (deployed from `main` on every push)
- Original project: https://remagx.org/
- Current phase: **UI first with a mocked compute engine** (decision D-33)

## Source of truth

Read these before deciding anything non-trivial. On ambiguity, the decision journal wins.

- `docs/brainstorm/2026-10-15-remagx-web-app-refactoring/spec.md`: design, acceptance criteria (AC-n), boundaries
- `docs/brainstorm/2026-10-15-remagx-web-app-refactoring/decisions.md`: facts (F-n), decisions (D-n), open questions (Q-n)
- `docs/analysis/legacy-reMagX3-analysis.md`: analysis of the legacy code

AGENTS.md holds only the rules and the checklist; the reasons and details are in the journal.
New decisions are appended to `decisions.md` (never rewrite history: mark entries `REFUTED` or
`superseded-by D-m`). If a new decision changes a rule or a checklist item here, update this
file in the same commit.

## Rules

### Always
- Use **double precision** for all numerics; no float, long double or arbitrary precision (F-3).
- Use **descriptive English names** in new code. Never carry over legacy or IDE-generated
  identifiers (`Button1Click`, `TFrame4`, `Edit17`, `Schicht`, `RechenHilfe`, …). Legacy names
  appear only in import mappings, traceability comments and the user-visible Lua script API (D-34, D-22).
- Keep **domain logic in `app/src/model/`** (pure functions, unit tested). React components only
  display state and dispatch actions.
- Follow the **legacy UI concepts and terms** (window layout, tab and section names, menus) in a
  modern layout (D-16, D-18).
- Keep the legacy **hc = 12398.326 eV·Å** for energy↔wavelength conversion (F-34).
- Run all calculations through **`ComputeService`** and the compute worker; the UI never calls
  physics code directly (D-12, D-33).
- The native file format is the **versioned JSON project**; legacy `.all` files are import-only
  and never written (D-8). Projects saved with Levenberg-Marquardt or Evolution import as Simplex
  with a note in the import report (D-27).
- Work **step by step**: one coherent change per commit, all checks green, push to `main`
  (which deploys the site). Update this checklist with the change.
- Run before every commit (in `app/`): `npm test`, `npm run lint`, `npm run build` (the build includes the type check).
- When `.all` import logic changes, also run the corpus test (see Commands).

### Ask first
- Before adding features outside the agreed scope (spec "Out of Scope", D-25).
- Before loosening a golden-test tolerance or adding an exception (D-29).
- Before deviating from legacy physics, even where legacy looks wrong (D-29).
- Before changing user-visible Lua script globals or their meaning (D-29).

### Never
- Commit **Numerical Recipes** code or code translated from it (licence; optimizers are
  rewritten from the published algorithms, D-32).
- Add dependencies whose licence is **incompatible with GPL-3.0** (D-31).
- Commit the **private test corpus** or other research data (D-20), or the legacy `old/` tree (D-30).
- Tune or test the **mock engine** against legacy numerics; it is a plausible stand-in only (F-35).
  Legacy-exact results are required only of the real WASM engine (AC-5, D-23).
- Silently drop data when importing legacy files; everything unhandled goes into the import report.
- Make Docker mandatory: it is only an optional reproducible build; the product is a static site (D-19).

## Commands

```sh
cd app
npm ci                    # install
npm run dev               # dev server
npm test                  # unit tests (vitest)
npx tsc -b                # type check only (also part of the build)
npm run lint              # oxlint
npm run build             # static site in app/dist
npx playwright install --with-deps --only-shell chromium  # browser-test setup
npm run test:e2e           # Chromium headless against app/dist (build first)
CORPUS_DIR=/path/to/corpus npm run test:corpus   # strict private corpus gate; never skips
```

The **test corpus** is the set of legacy projects in `old/reMagX3` (mainly `examples/`, plus
`Tutorial/` and `bin/`): private, git-ignored, copied along with the folder. Use
`CORPUS_DIR=../old/reMagX3`; all 99 files must import. Further legacy files from the user go
there or into another private folder (D-20); never into git. `test:corpus` fails for an unset,
missing or empty corpus and rejects symbolic links. Test titles use stable numeric IDs; parser
diagnostics and private paths are withheld. The ordinary public `npm test` run skips the corpus
only when `CORPUS_DIR` is entirely unset. An explicitly empty value fails.

Inventory commands (from the repository root; Python 3.10+, no Wine or dependencies):

```sh
tools/inventory/check                            # committed inventory, also checked in CI
tools/inventory/check --legacy-root old/reMagX3    # additionally verify local source freshness
python3 -m unittest discover -s tools/inventory -p 'test_*.py'
python3 tools/inventory/inventory.py report
```

See `tools/inventory/README.md` for regeneration and classification rules. The inventory
contains only GUI metadata; the legacy tree and research data remain private.

## Working with the user

- Work in small steps and get the user's OK before starting the next step; report what was done,
  what was verified and what was not.
- Put decision questions to the user in plain language with the options and their consequences,
  and your recommendation. When asking through a dialog, put the content the user must judge
  into the options themselves (or a file whose path is named): text written just before the
  dialog is hidden by it.
- Before building a legacy feature, look up how the legacy program actually does it
  (`old/reMagX3/client/*.dfm`, `Unit1.cpp`, `shared/`) instead of guessing from screenshots.

## Environment and handoff

- **Legacy sources** are in `old/reMagX3` (629 MB, git-ignored, never committed; D-30). A plain
  `git clone` does not contain them: copy the folder along (e.g. rsync the whole project).
  Important parts: `client/` (Borland GUI: `Unit1.cpp`, `*.dfm`), `guidll/` (more forms),
  `shared/` (numerical core), `examples/` and `Tutorial/` (legacy projects), `bin/` and the
  release zips (Windows binaries).
- **Legacy program under Wine** (reference output, AC-6): copy `old/reMagX3/bin/ReMagX_Terminal.exe`
  with `ReMagX.dll` and the DLLs from `old/reMagX3/bin/` and `old/reMagX3/remagx-terminal/` into an
  empty folder together with a project and its `.db`/`.m` files, then run
  `WINEDEBUG=-all wine ReMagX_Terminal.exe -refl default.all`. It prints `qz R` lines with only
  7 significant digits and is version 2.3.1 (F-12).
- **Browser checks** of the built app: `tools/browser-check/` (headless Chrome via DevTools).
- **Pushing** to `origin` (git@github.com:s-macke/ReMagX.git) needs SSH access to the repository;
  every push to `main` deploys the site.
- Node 22+ is needed for the app and the browser-check scripts.

## Code map (`app/src`)

| Path | Contents |
|---|---|
| `model/` | Project schema (`project.ts`, zod), defaults, layer/slab/dataset editing, fit targets, presets, units, script snippets |
| `import/` | Legacy `.all` importer with report, optical-constant tables, ASCII data import/export |
| `compute/` | `ComputeService` interface, Web Worker client and protocol, **mock** engine (TS Parratt, Nelder-Mead) |
| `state/` | App state reducer with undo history, contexts, hooks (`useCalculation`, `useFitRunner`, `usePersistence`, `useEditProject`), IndexedDB autosave and material library |
| `ui/` | Components: menu bar, toolbar, layer table, plot (uPlot), mode panel, side panel with sections, dialogs, script window |
| `../test/` | Legacy fixtures (`default.all`, Tutorials) and the corpus test |

## Checklist

Status reviewed against the repository, spec and decisions on 2026-10-16. "(partial)" means
an item works but has known gaps, listed under "still to do". Checked UI and mock-engine items
do not establish real-engine acceptance. The source inventory in `tools/inventory/` accounts
for every extracted entry (AC-12); its classifications distinguish remaining UI/engine work
from agreed later features and pending scope decisions. Passing the inventory gate does not
establish full runtime parity.

The implementation plan referenced by D-33 is outside the repository and was unavailable at
its recorded path during this audit. Use the repository spec and decision journal for scope,
and this checklist for implementation status; the external Steps 0–8 have not been verified.

### Done
- [x] Analysis of the legacy code; brainstorm, spec and decision journal (`docs/`)
- [x] git repository, GPL-3.0 licence, public GitHub repo, GitHub Pages deployment on push
- [x] App scaffold: Vite, React, TypeScript (strict), vitest, oxlint
- [x] Project model: versioned JSON schema for imported legacy project settings, layers, datasets and scripts; ignored or unsupported fields are reported by the importer
- [x] Compute interface and Web Worker; mock engine: Parratt σ/π, Nevot-Croce, angular resolution, depth profile, Nelder-Mead fit with stop flag
- [x] Legacy `.all` importer with import report; all 99 legacy example files import
- [x] Optical-constant table readers (`.db`, `.m`, `.e`, `.ff`, `.ffm`), tables persisted in the per-browser IndexedDB material library
- [x] Main window in the legacy layout: layer table, log plot (Hold/Clear/Scale, drag zoom), tabs with collapsible sections, Mode panel (Monochromatic/Dichroic/Asymmetry), menus as in 2.6 (Tools ▸ Script, Scratch shown as later; Help ▸ License)
- [x] Context-dependent sections: Algorithm Parameters only for Simplex with annealing (AC-11; Evolution follows with the evolution fit)
- [x] Side-panel sections Experiment, Sample, Fit with the main legacy fields (partial: missing controls listed below; Map Calculations is a placeholder)
- [x] Preferences dialog; optical and magneto-optical depth-profile views backed by the mock (actual engine profiles remain below, D-26)
- [x] Fit from the UI: parameter table, Start/Stop/χ², live curve during the fit, only fitted values written back (edits made meanwhile are kept), Debug Window with fit messages
- [x] Worker lifecycle: error/messageerror, startup/send failures and service shutdown reject pending work without changing the project; stale callbacks are ignored and a replacement worker is created on the next request (D-7, D-12, D-13; inventory group `worker-lifecycle`)
- [x] Stop controls for fits, χ² and standalone calculations: immediate standalone termination, cooperative fit stop with a 250 ms fallback, no deadline extension on repeated clicks, paused redraw until edit/recalculate; real blocked-worker tests verify cancellation within 1 s (D-12, D-28). Chromium headless AC-10 verification passes (see below).
- [x] Script window: Lua editor (CodeMirror), Default/BeforeCalculation, code generator (execution comes with the engine)
- [x] Autosave in IndexedDB; Open/Save/Save As with file handles; unsaved marker; Ctrl+O/S
- [x] Undo/Redo (Edit menu, Ctrl+Z/Y) with coalesced typing
- [x] ASCII dataset import dialog; "Save diagram data"; "Export Table as ASCII"
- [x] Layer table: material, density, per-layer magnetization; element-mode slab table
- [x] Toolbar: new/open/save, undo/redo, add/remove layer, element mode and navigation, script window
- [x] Built-in examples (default project, Tutorials 1–3)

### UI phase: still to do

Runtime behavior:
- [x] AC-10 verified in Chromium headless against the production build: iteration counter advances at least twice, tab interaction responds within 200 ms during fitting, and Stop settles within 1 s, including blocked fit, reflectivity and χ² workers. Tests verify calculation recovery after termination and run in Pages CI (D-28, D-36).

Remaining work reconciled with the source inventory (2026-10-16):

Missing legacy controls and windows:
- [x] Plot navigation (legacy `Chart1`): mouse-wheel zoom, "Zoom Out", cursor coordinate readout and Scale reset; linear and logarithmic ranges verified.
- [x] Plot exports: clipboard data as paired x/y columns including held curves, clipboard graphic as PNG, Save Picture as JPEG with current axes, zoom and legend; browser clipboard denial is reported.
- [x] Plot Properties: axis ranges and tick interval counts, log toggles, background/border and eight pen colours, line width, font size and points; validated Apply/Cancel, settings isolated per plot view.
- [ ] Decide on plot "Select Area" and "Fit Lorentzian+Step".
- [x] Layer/element cell Fit (On/Off): context menu and Shift+F10, highlighting, undo and synchronized parameter list; covers compound thickness/optical values and element slab/scattering-factor values, using existing Fit-tab defaults.
- [x] In-flight fit/χ² session guards: structural edits, target/dataset changes, project loading and undo/redo invalidate callbacks and clear previews; cancellation survives panel unmounting. Numeric edits remain compatible with valid fit results.
- [x] Layer magnetization fit targets γ/φ select their compound layer, preserve the global direction, require a valid layer index, and follow insertion/deletion with transfer/undo support (legacy MAGGAMMA/MAGPHI).
- [x] Layer and element-slab insertion/deletion: reindex surviving fit targets, preserve bounds/steps and unrelated stacks, remove deleted targets, and restore them with undo; profile binding references are also preserved.
- [x] Compound-layer spectrum menu: δ/β and δm/βm table previews through ComputeService/worker, mouse and keyboard menus, missing-table errors and plot exports. Real per-energy refresh and Lua evaluation remain engine work.
- [x] Properties → Material Settings: read-only name and structural/optical values; draft formula, density, γ/φ and per-layer Fit flags; atomic OK with one undo, Cancel/Escape, and preservation of concurrent unedited values.
- [x] Materials dialog: read-only real/imaginary dielectric tensor supplied through ComputeService; labelled mock preview from imported .e tables or scalar optical values, with Stop for blocked requests. Real-engine tensor evaluation remains pending. The hidden, unbound "Fill Dielectric Tensor" button remains a scope decision.
- [x] "Get optical constants from database" / "Get f1/f2 from database": all matching entries of the active stack, worker-backed mock linear interpolation, explicit skip/zero-magnetic/tensor report, one undo step, stale project/table/session rejection, and Stop within 1 s even for an unresponsive database worker.
- [x] Layer table dielectric-tensor spectra: diagonal, upper and lower groups, six distinct curve colours, clipboard export; mock .e/.db previews through the worker.
- [x] Element δ/β spectrum menu: selected slab index and selected-element energy grid, density-weighted contributions from all elements through the worker; labelled mock interpolation, explicit missing-table/slab errors, live edits/undo and clipboard export.
- [x] Value slider below the layer table: fixed selected-cell baseline (250 = 1×, 1000 = 4×), layer/slab and element-factor cells, Gaussian/spline profile values and script parameters. Unsupported cells disable it; edits recalculate the current view during dragging, one gesture coalesces for undo, and structural/navigation changes clear stale selections.
- [x] Illustrate Segmentation: default-on display checkbox for optical/magneto-optical profiles, stepped curves with zero-boundary strokes, matching clipboard/graphic output, no project edits. The mock illustrates fixed sampling intervals; actual adaptive slices remain engine work.
- [x] Compound-mode "To layer list": worker-backed mock preview, explicit reference-change report, Apply/Cancel/Stop, stale-result rejection, atomic replacement and undo/redo. Preserves outer-layer targets; removes replaced interior targets and unbinds their magnetic profiles with a report.
- [ ] Real adaptive layer-list conversion, including element-mode conversion; the current preview uses fixed mock profile intervals and is disabled in element mode.
- [x] Element Mode: "Show Scattering Factors f1/f2" through the worker, with selected-element navigation, missing-table errors and plot exports. Current mock shows labelled .ff table previews; script-driven evaluation remains engine work.
- [x] Element Mode: "Show Density Profiles" in the Sample section and toolbar; all elements share a depth axis with slab boundary marks, live editing, undo and plot exports. Bounded mock sampling/smoothing is labelled; real density evaluation and scripting remain engine work.
- [x] Material to Elements: worker conversion of formulas/mass densities into aligned element slabs, explicit overwrite/skip/reference report, Apply/Cancel/Stop, stale-project/session rejection and undo. Legacy atomic masses, integer-count syntax and repeated-symbol overwrite are retained; scattering factors start at zero. Multilayer-script expansion remains engine work.
- [x] Active magnetization-profile Fit checkboxes: δ/β amplitude, center and width; synchronized parameter list, undo and safe profile deletion with fit/coupling reindexing. Hidden general Fit placeholders remain pending scope review.
- [x] Magnetization profile spline editor: Build spline creates nine legacy Gaussian samples; edit the five interior y values, retain boundary points, switch Gaussian/spline controls, undo and save. Actual spline evaluation remains engine work.
- [x] Magnetization profile binding: distinct all/air/layer/bulk/none choices using saved legacy indices; layer insertion/deletion preserves bindings (deleted target becomes none). Coupling offers earlier profiles, retaining unusual stored references visibly.
- [ ] Summary window (legacy `guidll/SummaryForm`): chart sizing, refresh, clipboard exports, axis scaling and error display; decide on its const-qz-from-energy conversion before implementation
- [x] Dataset property editor: title/comment, angular resolution and both complex beam polarizations; Energy vs Energy shift follows scan columns; read-only Type/File/Datapoints metadata follows legacy `DataListClick`/`DataListEditorValidate`. Edits support undo and JSON save; numerical handling remains engine-phase work.
- [ ] Review hidden experimental/test controls for scope (inventory group `hidden-tools-decision`); no implicit decision to port or drop them
- [x] Angle (θ) x-axis option: legacy energy conversion for simulation and measured data, matching diagram export, explicit invalid-qz errors; energy/depth axes remain unchanged.
- [ ] Decide on the legacy layer-table "coupl." column (no `.all` key)

Data:
- [x] Per-browser IndexedDB material library (D-13): all five table kinds restore, same-name/kind imports replace prior copies, explicit cache deletion persists, startup races preserve new imports/clears, and storage failures/unreadable records are reported without losing session data. Project JSON and undo history stay separate.
- [ ] Built-in periodic-table/Chantler asset (D-13); licence check of the Chantler/Henke data before shipping it (D-31)
- [ ] Real layer and element spectra: per-energy Filldb/BeforeCalculation evaluation, element conversion and dielectric tensors behind the spectrum service (current compound, tensor and f1/f2 views are mock previews).
- [x] Native optical-table interpolation component: caller-owned cursor, legacy duplicate-energy history, exact endpoints and zero outside range; 14,760 values/80 cursor sequences compared with the private original method. WASM adapter also matches all values/cursors in Node and Chromium, with continuation, memory-growth and cleanup tests. Automatic table refresh remains open.
- [x] Compound scalar refresh preparation: exact material-name lookup, required in-range primary tables, zero missing magnetic constants, shared interpolation cursors and immutable layer copies. Unit tests cover selection, errors and cursor propagation. Real ComputeService now supplies current session tables to the worker; scalar qz reflectivity/asymmetry refresh uses WASM interpolation and the legacy energy/wavelength round trip. Chromium compares automatic and explicit constants, table replacement, missing-table errors and immutability. Tensor refresh and energy scans remain open.
- [x] Energy-scan coordinate preparation: legacy table-range intersection, magnetic range limits when enabled, repeated-addition minimum-inclusive grid and fixed-angle qz conversion. The shared dataset-points checkbox selects energy/qz columns, retaining order and significant shifts. Unit tests cover these rules and nonterminating/oversized grid rejection; initial monochromatic worker integration is complete; full energy-scan acceptance remains open.
- [x] Initial real monochromatic Parratt energy scans through ComputeService: per-energy WASM table refresh, shared cursors, exact angular convolution and whole-scan postprocessing; legacy out-of-range dataset points retain intensity one. Chromium compares a scan against independently prepared per-energy calculations. Energy convolution is now applied through WASM before postprocessing; dichroic energy output, full native scan API and corpus validation remain open; public UI still uses the mock.
- [ ] Automatic optical-constant table use during calculations (energy scans currently keep δ/β constant); legacy interpolation, built-in data and tensor handling behind manual database updates (current actions use mock linear scalar interpolation).

Quality gates:
- [x] Settings/handler inventory: `tools/inventory/` parses 36 DFM forms, `Items->Add` calls and runtime event bindings; 676 entries explicitly reviewed as 530 ported, 29 dropped and 117 deferred. `tools/inventory/check` and parser/gate tests run in Pages CI; optional local source verification detects drift. Deferred UI/engine entries remain MVP work (D-16, D-17.1, AC-12).
- [x] Strict private-corpus runner: `npm run test:corpus` never skips, rejects missing/empty/unreadable roots and symlinks, imports and schema-validates all discovered projects, and sanitizes paths/content from output. All 99 local projects pass; failure-path probes verify nonzero exit and no private-marker leakage.
- [ ] Connect private-corpus access in CI and require the strict runner (D-17.3, D-20, AC-4). The choice of a private repository/read-only credential or a self-hosted runner is pending; Pages still does not supply the corpus. No private data may enter public logs or artifacts.
- [x] Playwright end-to-end tests in Chromium headless (D-36): AC-10 responsiveness/Stop, AC-11 section toggles and persistence, AC-13 static Python hosting with external requests blocked, AC-14 IndexedDB reload restoration, and AC-15 upload/download and direct file-handle Open/Save/Save As. Native picker dialogs are substituted with real browser OPFS handles in headless tests; operating-system dialog interaction is not automated. These tests verify the current UI/mock phase, not real-engine acceptance.

### Engine phase: still to do
- [x] Initial native reference adapter for the original private 2.6 Parratt routine: double instantiation, `%.17g` output, eight-header dependency/hash gate, and analytic adapter checks. This is a component reference only, not a full project/corpus rebuild or WASM acceptance. Build: `python3 tools/golden/legacy/build_reference.py`; verify locally: `LEGACY_ROOT=old/reMagX3 python3 -m unittest discover -s tools/golden/legacy -p 'test_*.py'`. Public CI checks the dependency gate; private-source numerical adapter tests require `LEGACY_ROOT`.
- [ ] Docker build (optional, pinned emsdk + g++ + Node) producing the static site (D-19)
- [ ] Simulation golden outputs from the native legacy 2.6 rebuild for the private corpus (`old/reMagX3/examples`, `Tutorial/`, `bin/`; add further user files privately), separate from original-optimizer fit references (D-5, D-20, D-32).
- [ ] Generate reference fit outputs once on the user's machine with an original legacy build and its original optimizer; keep that build uncommitted and store only its outputs in the private corpus (D-20, D-32).
- [ ] Native rebuild of the legacy 2.6 core for golden data, `%.17g` output, no NR code in the repo (D-5, D-32)
- [ ] Cross-check the rebuild against the Wine 2.3.1 binary within 1e-6 (AC-6)
- [x] Initial cleaned native Parratt kernel: double-only C API, magnetic/tetragonal branches, complex beam weights, analyzers and Nevot-Croce; C/C++ build and precision gate in CI. Compared 4,320 synthetic prepared-stack points with the private 2.6 routine at 1e-10 relative + 1e-15 absolute. Comparison diagnostics also report log10 error for positive pairs, zero pairs and nonpositive mismatches without changing D-23. This is component verification, not corpus or WASM acceptance.
- [ ] Extract and clean the numerical core: double only, descriptive names, data-driven C API; verify the double-only source gate (D-6, D-34, AC-2).
- [x] Initial native fixed-energy qz orchestration for prepared Parratt stacks: legacy energy conversion, non-fast zero-resolution qz boundaries, negative-qz skipping, both beam polarizations and opposite magnetic signs; 1,440 original-routine comparisons plus API failure tests. Exposed through the WASM adapter with 3,360 additional native/WASM intensity comparisons in Node and Chromium. Project preparation, resolution and full scan acceptance remain open.
- [x] Initial compound preparation stage in `model/compoundLayers.ts`: legacy multilayer expansion with implicit substrate/ambient, independent substrate-first C API rows, per-layer directions and unscaled optical constants. Expansion matched 257 local original-interpreter cases; unit tests cover mapping and limits. Table refresh, Lua, element preparation and segmentation remain open.
- [x] Initial real Parratt request preparation: legacy qz grid endpoints and dataset shift threshold, compound rows, energy, complex beams, tensor/analyzer/magnetic flags and fast-dichroic boundary. Unimplemented preprocessing/physics is explicitly rejected. Connected through the explicit real-worker service factory; full project and corpus acceptance remain open.
- [ ] Port Parratt, full 4×4 matrix/Visnovsky and Zak calculations for qz and energy scans; validate each against legacy golden outputs (D-3, D-25, AC-5).
- [ ] Port Nevot-Croce roughness and adaptive layer segmentation, including segmentation settings (D-25, spec §2).
- [ ] Port Gaussian and spline magnetic profiles with coupling (D-25, spec §2).
- [ ] Honor arbitrary complex polarization for both beams and the polarization analyzer; support dichroic reflectivity and both asymmetry definitions (D-25, spec §2).
- [ ] Expose and display δ(z), β(z), δm(z), βm(z) from the actual engine after roughness/slicing (D-26); replace the mock profile data behind the existing views.
- [x] Initial Parratt WASM component: pinned Emscripten 6.0.12, ES module and prepared-stack adapter; 4,320 native/WASM synthetic comparisons, logarithmic diagnostics, memory-growth and error-recovery checks in CI. Chromium also compares all points in a module worker and verifies event-loop response plus termination/recreation during a real WASM call. The public app still uses the mock.
- [ ] Full-engine Emscripten build and corpus golden tests native/WASM within 1e-10 rel + 1e-15 abs (AC-5, D-23)
- [ ] Corpus golden and WASM tests in CI (Pages now runs native analytic/API/precision checks alongside app checks; private legacy comparison is opt-in locally)
- [ ] AC-3 with the real engine: a `precision = 3` project computes bit-identically to `precision = 1`
- [ ] Clean-room Nelder-Mead and annealing in C++ behind the optimizer interface in `engine/src/optim/`, also used by the public legacy rebuild (D-10, D-32).
- [ ] Fit golden tests on at least 3 corpus projects, using the same project and seed: final χ²(new) ≤ χ²(original) × (1 + 1e-6), compared with the private original-optimizer references (D-28, D-32, AC-9).
- [ ] Multi-dataset fits over all datasets flagged for fitting; asymmetry, dichroic and energy-scan fits; honour the additional fit parameters (F-5, D-3)
- [ ] Legacy-exact element density profiles and sampling (including BeforeCalculation); replace the bounded mock behind the existing density view.
- [ ] Element mode and element→material conversion; optical-constant interpolation with the periodic-table data (D-25, spec §2)
- [x] Initial real-worker angular resolution: fixed legacy 19-point kernel, non-fast shifted WASM samples and fast legacy interpolation, including negative-qz handling and small-width behavior. Domain tests, 448 local original-interpolation output comparisons and two original-Parratt browser references pass. Full native/C++ and energy-resolution acceptance remain open.
- [x] Native C++ angular-resolution API for prepared Parratt scans: exact and fast paths, atomic output and C linkage; 7,200 comparisons with reviewed worker convolution plus original-Parratt references. Exported through WASM and used by the real worker; 14,880 combined intensity comparisons pass in Node/Chromium. The earlier TypeScript convolution is retained only as a test reference.
- [x] Native post-scan energy-convolution component: shared legacy 19-point kernel and GetLinY interpolation, width threshold, both beams, negative-sample omission and atomic error output. All 2,520 comparisons with the reviewed interpolation reference pass, including unsorted/duplicate coordinates. WASM export and monochromatic worker integration pass 1,680 additional native/WASM comparisons in Node and Chromium, memory/error tests and a complete convolved energy-scan check.
- [ ] Port angular and energy resolution, including fast/exact convolution; complete dichroic/asymmetry energy scans (D-25, spec §2, AC-5)
- [ ] Legacy error conditions (RX_QZ, RX_DB, RX_CSCRIPT, RX_ESCRIPT, RX_ML, RX_UNKNOWN) as clear UI messages (D-14)
- [ ] Lua scripting with wasmoon and the full legacy script API (D-2, D-22; AC-7, AC-7a, AC-8)
- [x] Initial real-worker ComputeService path for guarded Parratt reflectivity/dichroic/asymmetry requests, with lazy WASM loading, legacy asymmetry definitions, explicit unsupported errors and Chromium Stop/restart verification. Available through `createRealComputeService`; not selected by the deployed app.
- [x] Real-worker qz⁴ scaling, exact pure-π correction and legacy moving averages, preserving preprocessing order and leading-zero averaging behavior. Four domain tests, Chromium service coverage and 960 local original-method output comparisons pass; Fourier postprocessing remains open.
- [ ] Complete the real engine and replace the deployed mock behind `ComputeService` (D-33)
- [ ] Native command-line tool like the legacy `ReMagX_Terminal`: `-refl`, `-dicrefl`, `-fit`, `-convert` (`.db` + `.m` → `.e`), `-v`; `-map` once maps exist; reads `.all` and JSON (D-35)

### Later (agreed, not scheduled)
- Transmission, 2D maps (legacy MapFrame, "Map Calculations"), TEY, "Parratt without multiple scattering" (PHASE), Kramers-Kronig fitting, evolution fit with its section (D-25, D-11)
- Electric-field view |E(z)| (D-26)
- "Scratch" tools of the legacy Tools menu: ask first which are worth keeping (D-25)
- `.all` export (D-8)
- OpenCL, desktop packaging (D-25)

### Dropped (will not be rebuilt)
- Levenberg-Marquardt fitting and parameter standard deviations (D-11, F-17)
- Precision modes and the parallel-computing setting (F-3; the web app always uses double)
- Webserver (D-35)
- File → Exit, splash screen, "Window Stay on Top", the unused EnergyInput dialog and the empty ScanFrame/SettingsFrame frames; the commented-out GetFromDatabaseFrame (its function moves to the layer-table menu)
