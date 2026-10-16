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
CORPUS_DIR=/path/to/corpus npx vitest run test/corpus.test.ts   # import every legacy .all file
```

The legacy example files in `old/reMagX3` can serve as a local corpus
(`CORPUS_DIR=../old/reMagX3`); all 99 must import.

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

Status of the UI-first phase as of the last audit (2026-10-15). "(partial)" means the item works
but has known gaps, listed under "still to do".

### Done
- [x] Analysis of the legacy code; brainstorm, spec and decision journal (`docs/`)
- [x] git repository, GPL-3.0 licence, public GitHub repo, GitHub Pages deployment on push
- [x] App scaffold: Vite, React, TypeScript (strict), vitest, oxlint
- [x] Project model: versioned JSON schema covering everything legacy `.all` files store
- [x] Compute interface and Web Worker; mock engine: Parratt σ/π, Nevot-Croce, angular resolution, depth profile, Nelder-Mead fit with stop flag
- [x] Legacy `.all` importer with import report; all 99 legacy example files import
- [x] Optical-constant table readers (`.db`, `.m`, `.e`, `.ff`, `.ffm`), tables held in memory for the session
- [x] Main window in the legacy layout: layer table, log plot (Hold/Clear/Scale, drag zoom), tabs with collapsible sections, Mode panel (Monochromatic/Dichroic/Asymmetry), menus as in 2.6 (Tools ▸ Script, Scratch shown as later; Help ▸ License)
- [x] Context-dependent sections: Algorithm Parameters only for Simplex with annealing (AC-11; Evolution follows with the evolution fit)
- [x] Side-panel sections Experiment, Sample, Fit with the main legacy fields (partial: missing controls listed below; Map Calculations is a placeholder)
- [x] Preferences dialog; optical and magneto-optical depth-profile views
- [x] Fit from the UI: parameter table, Start/Stop/χ², live curve during the fit, only fitted values written back (edits made meanwhile are kept), Debug Window with fit messages
- [x] Stop fallback: a worker that ignores Stop for 2 s is terminated and restarted (D-12)
- [x] Script window: Lua editor (CodeMirror), Default/BeforeCalculation, code generator (execution comes with the engine)
- [x] Autosave in IndexedDB; Open/Save/Save As with file handles; unsaved marker; Ctrl+O/S
- [x] Undo/Redo (Edit menu, Ctrl+Z/Y) with coalesced typing
- [x] ASCII dataset import dialog; "Save diagram data"; "Export Table as ASCII"
- [x] Layer table: material, density, per-layer magnetization; element-mode slab table
- [x] Toolbar: new/open/save, undo/redo, add/remove layer, element mode and navigation, script window
- [x] Built-in examples (default project, Tutorials 1–3)

### UI phase: still to do

Fixes found in the audit:
- [ ] Move remaining domain logic out of components into `model/`: "Apply to all layers" (Magneto-Optics), value transfer in the fit parameter table, measured-series selection and diagram export (`App.tsx`)

Missing legacy controls and windows:
- [ ] Plot (legacy `Chart1`): mouse-wheel zoom and "Zoom Out", cursor coordinate readout, Properties dialog (axis ranges, log toggles, colours, line width, font size, points), copy data/graphic to the clipboard, save picture; decide on "Select Area" and "Fit Lorentzian+Step"
- [ ] Layer table right-click menu: Fit on/off per cell, show δ/β and δm/βm spectrum, dielectric-tensor parts, "Get optical constants from database" / "Get f1/f2 from database", Properties → Materials dialog (name, formula, density, magneto-optics, dielectric tensor, "Fill Dielectric Tensor")
- [ ] Value slider for live tweaking of the selected layer/parameter cell (legacy ScrollBar2)
- [ ] Adaptive Layer Segmentation: "To layer list" and "Illustrate Segmentation"
- [ ] Element Mode: "Show Scattering Factors f1/f2", "Show Density Profiles" (also a toolbar button in legacy), "Material to Elements"
- [ ] Magneto-Optics and magnetization profile: "Fit" checkboxes; profile spline "Build spline" and point editing
- [ ] Summary window (legacy `guidll/SummaryForm`)
- [ ] Angle (θ) x-axis option
- [ ] Decide on the legacy layer-table "coupl." column (no `.all` key)

Data:
- [ ] Material library persisted in IndexedDB, plus a built-in periodic-table/Chantler asset (D-13); licence check of the Chantler/Henke data before shipping it (D-31)
- [ ] Optical-constant tables used by calculations (energy scans currently keep δ/β constant)

Quality gates:
- [ ] Settings/handler inventory: `tools/inventory/` parser of the legacy `.dfm` files and `Items->Add` calls, and `tools/inventory/check`, which fails on entries not marked ported/dropped/deferred (AC-12)
- [ ] Playwright end-to-end tests in Chromium and Firefox (AC-10, AC-11, AC-13, AC-14, AC-15)

### Engine phase: still to do
- [ ] Docker build (optional, pinned emsdk + g++ + Node) producing the static site (D-19)
- [ ] Private corpus repo/folder seeded with legacy examples; golden outputs (D-20)
- [ ] Native rebuild of the legacy 2.6 core for golden data, `%.17g` output, no NR code in the repo (D-5, D-32)
- [ ] Cross-check the rebuild against the Wine 2.3.1 binary within 1e-6 (AC-6)
- [ ] Extract and clean the numerical core: double only, descriptive names, data-driven C API (D-6, D-34)
- [ ] Emscripten build; golden tests native and WASM within 1e-10 rel + 1e-15 abs (AC-5, D-23)
- [ ] Golden and WASM tests in CI (today `pages.yml` runs only lint, test and build)
- [ ] AC-3 with the real engine: a `precision = 3` project computes bit-identically to `precision = 1`
- [ ] Clean-room Nelder-Mead and annealing in C++ (D-32); fit golden tests (AC-9)
- [ ] Multi-dataset fits over all datasets flagged for fitting; asymmetry, dichroic and energy-scan fits; honour the additional fit parameters (F-5, D-3)
- [ ] Element mode and element→material conversion; optical-constant interpolation with the periodic-table data (D-25, spec §2)
- [ ] Energy resolution and dichroic/asymmetry energy scans
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
