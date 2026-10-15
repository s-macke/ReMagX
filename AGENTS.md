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

New decisions are appended to `decisions.md` (never rewrite history: mark entries `REFUTED` or
`superseded-by D-m`).

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
- Work **step by step**: one coherent change per commit, all checks green, push to `main`
  (which deploys the site). Update this checklist with the change.
- Run before every commit (in `app/`): `npm test`, `npx tsc -b`, `npm run lint`, `npm run build`.
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
npx tsc -b                # type check
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
| `state/` | App state reducer with undo history, contexts, hooks (calculation, fit runner, autosave, edit) |
| `ui/` | Components: menu bar, layer table, plot (uPlot), side panel with sections, dialogs, script window |
| `../test/` | Legacy fixtures (`default.all`, Tutorials) and the corpus test |

## Checklist

### Done
- [x] Analysis of the legacy code; brainstorm, spec and decision journal (`docs/`)
- [x] git repository, GPL-3.0 licence, public GitHub repo, GitHub Pages deployment on push
- [x] App scaffold: Vite, React, TypeScript (strict), vitest, oxlint
- [x] Project model: versioned JSON schema covering everything in legacy `.all` files
- [x] Compute interface and Web Worker; mock engine (Parratt σ/π, Nevot-Croce, resolution, profile, fit with stop)
- [x] Legacy `.all` importer with import report; all 99 legacy example files import
- [x] Optical-constant table readers (`.db`, `.m`, `.e`, `.ff`, `.ffm`)
- [x] Main window like the legacy layout: layer table, log plot (Hold/Clear/Scale), tabs with collapsible sections, Mode panel, menus
- [x] All side-panel sections (Experiment, Sample, Fit) with the legacy fields
- [x] Preferences dialog; optical and magneto-optical depth-profile views
- [x] Fit from the UI: parameter table, Start/Stop/χ², live progress, results written back (mock)
- [x] Script window: Lua editor (CodeMirror), Default/BeforeCalculation, code generator (execution pending)
- [x] Autosave in IndexedDB; Open/Save/Save As with file handles; unsaved marker; Ctrl+O/S
- [x] Undo/Redo (Edit menu, Ctrl+Z/Y) with coalesced typing
- [x] ASCII dataset import dialog; "Save diagram data"; "Export Table as ASCII"
- [x] Layer table: material, density, per-layer magnetization; element-mode slab table
- [x] Built-in examples (default project, Tutorials 1–3)
- [x] Toolbar under the menu: new/open/save, undo/redo, add/remove layer, element mode and navigation, script window

### UI phase: still to do
- [ ] Summary window (legacy `guidll/SummaryForm`)
- [ ] Electric-field view |E(z)| (D-26: later)
- [ ] "Scratch" tools of the legacy Tools menu (decide which are worth keeping)
- [ ] Angle (θ) x-axis option; Sensitivity mode
- [ ] Settings/handler inventory from the legacy `.dfm` files and `Items->Add` calls; mark each ported/dropped/deferred (AC-12)
- [ ] Playwright end-to-end tests in Chromium and Firefox (AC-10, AC-11, AC-13, AC-14, AC-15)
- [ ] Optical-constant tables used by calculations (energy scans currently keep δ/β constant)

### Engine phase: still to do
- [ ] Docker build (optional, pinned emsdk + g++ + Node) producing the static site (D-19)
- [ ] Private corpus repo/folder seeded with legacy examples; golden outputs (D-20)
- [ ] Native rebuild of the legacy 2.6 core for golden data, `%.17g` output, no NR code in the repo (D-5, D-32)
- [ ] Cross-check the rebuild against the Wine 2.3.1 binary within 1e-6 (AC-6)
- [ ] Extract and clean the numerical core: double only, descriptive names, data-driven C API (D-6, D-34)
- [ ] Emscripten build; golden tests native and WASM within 1e-10 rel + 1e-15 abs (AC-5, D-23)
- [ ] Clean-room Nelder-Mead and annealing in C++ (D-32); fit golden tests (AC-9)
- [ ] Lua scripting with wasmoon and the full legacy script API (D-2, D-22; AC-7, AC-7a, AC-8)
- [ ] Replace the mock with the WASM engine behind `ComputeService` (D-33)
- [ ] Later features: transmission, maps, TEY, Kramers-Kronig, evolution fit (D-25)
