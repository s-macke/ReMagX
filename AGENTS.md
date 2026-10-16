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
CORPUS_DIR=/path/to/corpus npx vitest run test/corpus.test.ts   # import every legacy .all file
```

The **test corpus** is the set of legacy projects in `old/reMagX3` (mainly `examples/`, plus
`Tutorial/` and `bin/`): private, git-ignored, copied along with the folder. Use
`CORPUS_DIR=../old/reMagX3`; all 99 files must import. Further legacy files from the user go
there or into another private folder (D-20); never into git.

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
| `state/` | App state reducer with undo history, contexts, hooks (`useCalculation`, `useFitRunner`, `usePersistence`, `useEditProject`), IndexedDB autosave |
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
- [x] Optical-constant table readers (`.db`, `.m`, `.e`, `.ff`, `.ffm`), tables held in memory for the session
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
- [ ] Plot (legacy `Chart1`): Properties dialog (axis ranges and tick steps, log toggles, colours, line width, font size, points); decide on "Select Area" and "Fit Lorentzian+Step"
- [ ] Layer table right-click menu: Fit on/off per cell, show δ/β and δm/βm spectrum, dielectric-tensor parts, "Get optical constants from database" / "Get f1/f2 from database", Properties → Materials dialog (name, formula, density, magneto-optics, dielectric tensor, "Fill Dielectric Tensor")
- [ ] Value slider: the horizontal bar directly below the layer table (legacy ScrollBar2, `Unit1.cpp` SchichtEingabeSelectCell / ScrollBar2Change). Disabled until a numeric cell is selected; on selection the thumb is set to 250 of 0–1000, which stands for the cell's value; dragging sets value = position / 250 × original value (0 to 4×) and recalculates the current view live. Works for the layer table (not the db and coupling columns, the vacuum's thickness and σ, or the substrate thickness), the magnetization-profile table and the script-parameter list. Not to be confused with the browser scrollbar of the wide table.
- [ ] Adaptive Layer Segmentation: "To layer list" and "Illustrate Segmentation"
- [ ] Element Mode: "Show Scattering Factors f1/f2", "Show Density Profiles" (also a toolbar button in legacy), "Material to Elements"
- [ ] Magneto-Optics and magnetization profile: "Fit" checkboxes; profile spline "Build spline" and point editing; restore the legacy all-layers binding choice
- [ ] Summary window (legacy `guidll/SummaryForm`): chart sizing, refresh, clipboard exports, axis scaling and error display; decide on its const-qz-from-energy conversion before implementation
- [x] Dataset property editor: title/comment, angular resolution and both complex beam polarizations; Energy vs Energy shift follows scan columns; read-only Type/File/Datapoints metadata follows legacy `DataListClick`/`DataListEditorValidate`. Edits support undo and JSON save; numerical handling remains engine-phase work.
- [ ] Review hidden experimental/test controls for scope (inventory group `hidden-tools-decision`); no implicit decision to port or drop them
- [x] Angle (θ) x-axis option: legacy energy conversion for simulation and measured data, matching diagram export, explicit invalid-qz errors; energy/depth axes remain unchanged.
- [ ] Decide on the legacy layer-table "coupl." column (no `.all` key)

Data:
- [ ] Material library persisted in IndexedDB, plus a built-in periodic-table/Chantler asset (D-13); licence check of the Chantler/Henke data before shipping it (D-31)
- [ ] Optical-constant tables used by calculations (energy scans currently keep δ/β constant)

Quality gates:
- [x] Settings/handler inventory: `tools/inventory/` parses 36 DFM forms, `Items->Add` calls and runtime event bindings; 676 entries explicitly reviewed as 375 ported, 29 dropped and 272 deferred. `tools/inventory/check` and parser/gate tests run in Pages CI; optional local source verification detects drift. Deferred UI/engine entries remain MVP work (D-16, D-17.1, AC-12).
- [ ] Run all private-corpus imports in CI using `CORPUS_DIR` with private data access; fail if the corpus is missing or empty, without publishing research data in the repository, logs or artifacts (D-17.3, D-20, AC-4). Today the Pages workflow does not supply the corpus and the suite skips.
- [x] Playwright end-to-end tests in Chromium headless (D-36): AC-10 responsiveness/Stop, AC-11 section toggles and persistence, AC-13 static Python hosting with external requests blocked, AC-14 IndexedDB reload restoration, and AC-15 upload/download and direct file-handle Open/Save/Save As. Native picker dialogs are substituted with real browser OPFS handles in headless tests; operating-system dialog interaction is not automated. These tests verify the current UI/mock phase, not real-engine acceptance.

### Engine phase: still to do
- [ ] Docker build (optional, pinned emsdk + g++ + Node) producing the static site (D-19)
- [ ] Simulation golden outputs from the native legacy 2.6 rebuild for the private corpus (`old/reMagX3/examples`, `Tutorial/`, `bin/`; add further user files privately), separate from original-optimizer fit references (D-5, D-20, D-32).
- [ ] Generate reference fit outputs once on the user's machine with an original legacy build and its original optimizer; keep that build uncommitted and store only its outputs in the private corpus (D-20, D-32).
- [ ] Native rebuild of the legacy 2.6 core for golden data, `%.17g` output, no NR code in the repo (D-5, D-32)
- [ ] Cross-check the rebuild against the Wine 2.3.1 binary within 1e-6 (AC-6)
- [ ] Extract and clean the numerical core: double only, descriptive names, data-driven C API; verify the double-only source gate (D-6, D-34, AC-2).
- [ ] Port Parratt, full 4×4 matrix/Visnovsky and Zak calculations for qz and energy scans; validate each against legacy golden outputs (D-3, D-25, AC-5).
- [ ] Port Nevot-Croce roughness and adaptive layer segmentation, including segmentation settings (D-25, spec §2).
- [ ] Port Gaussian and spline magnetic profiles with coupling (D-25, spec §2).
- [ ] Honor arbitrary complex polarization for both beams and the polarization analyzer; support dichroic reflectivity and both asymmetry definitions (D-25, spec §2).
- [ ] Expose and display δ(z), β(z), δm(z), βm(z) from the actual engine after roughness/slicing (D-26); replace the mock profile data behind the existing views.
- [ ] Emscripten build; golden tests native and WASM within 1e-10 rel + 1e-15 abs (AC-5, D-23)
- [ ] Golden and WASM tests in CI (today `pages.yml` runs only lint, test and build)
- [ ] AC-3 with the real engine: a `precision = 3` project computes bit-identically to `precision = 1`
- [ ] Clean-room Nelder-Mead and annealing in C++ behind the optimizer interface in `engine/src/optim/`, also used by the public legacy rebuild (D-10, D-32).
- [ ] Fit golden tests on at least 3 corpus projects, using the same project and seed: final χ²(new) ≤ χ²(original) × (1 + 1e-6), compared with the private original-optimizer references (D-28, D-32, AC-9).
- [ ] Multi-dataset fits over all datasets flagged for fitting; asymmetry, dichroic and energy-scan fits; honour the additional fit parameters (F-5, D-3)
- [ ] Element mode and element→material conversion; optical-constant interpolation with the periodic-table data (D-25, spec §2)
- [ ] Port angular and energy resolution, including fast/exact convolution; complete dichroic/asymmetry energy scans (D-25, spec §2, AC-5)
- [ ] Legacy error conditions (RX_QZ, RX_DB, RX_CSCRIPT, RX_ESCRIPT, RX_ML, RX_UNKNOWN) as clear UI messages (D-14)
- [ ] Lua scripting with wasmoon and the full legacy script API (D-2, D-22; AC-7, AC-7a, AC-8)
- [ ] Replace the mock with the WASM engine behind `ComputeService` (D-33)
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
