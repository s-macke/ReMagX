# AGENTS.md: ReMagX web rewrite

Guide for anyone (human or AI agent) working on this repository: the rules, how to work, and a
checklist of what is done and what is still open. Keep the checklist current: tick items in
the same commit that completes them.

## What this is

A browser-local rewrite of **ReMagX** (resonant magnetic X-ray reflectivity: simulate and fit
thin-film multilayers). The legacy program is a Windows C++/Borland application (ReMagX 2.6,
local copy in `old/`, not in git). The new app is a static website: React + TypeScript UI,
numerics in WebAssembly compiled from the ported legacy C++ core; final acceptance remains open.

- Live site: https://s-macke.github.io/ReMagX/ (deployed from `main` on every push)
- Original project: https://remagx.org/
- Production build: **real WASM engine** (D-39 supersedes D-33's mock deployment). Pages publishes only after all CI gates pass. The production worker and static build use the real core; full-engine acceptance remains open. Unsupported operations never fall back to the mock. Production segmentation, element calculations and profiles use the D-41 full-double standard error-function lookup.

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
- Keep original legacy sources unchanged; place build adapters and generated artifacts outside the source tree.
- Use **double precision** for all numerics; no float, long double or arbitrary precision (F-3). Do not emulate legacy float rounding; production error-function generation uses a full-double standard function (D-41).
- Use **descriptive English names** in new code. Never carry over legacy or IDE-generated
  identifiers (`Button1Click`, `TFrame4`, `Edit17`, `Schicht`, `RechenHilfe`, …). Legacy names
  appear only in import mappings, traceability comments and the user-visible Lua script API (D-34, D-22).
- Keep **domain logic in `app/src/model/`** (pure functions, unit tested). React components only
  display state and dispatch actions.
- Follow the **legacy UI concepts and terms** (window layout, tab and section names, menus) in a
  modern layout (D-16, D-18).
- Keep the legacy **hc = 12398.326 eV·Å** for energy↔wavelength conversion (F-34).
- Run all calculations through **`ComputeService`** and the compute worker; the UI never calls
  physics code directly (D-12, D-39).
- The native file format is the **versioned JSON project**; legacy `.all` files are import-only
  and never written (D-8). Projects saved with Levenberg-Marquardt or Evolution import as Simplex
  with a note in the import report (D-27).
- Work **step by step**: one coherent change per commit, all checks green, push to `main`
  (which deploys the site). Update this checklist with the change.
- Before committing, require passing `npm test`, `npm run lint` and `npm run build` in `app/` (the build includes the type check). Reuse passing results for unchanged relevant inputs; do not rerun merely to commit.
- Choose additional checks according to the testing rules below. When `.all` import logic changes, also run the corpus test (see Commands).

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

## Testing: scope and repetition

- During development, run the tests affected by the change. Do not run the complete
  suite after every edit or experiment.
- Run broad original-reference/corpus comparisons when numerical algorithms or data
  preparation change, or when a specific unresolved failure requires them. A UI,
  documentation or unrelated infrastructure change does not by itself justify them.
- For UI/worker changes, select relevant Chromium integration tests. Use the complete
  browser suite when shared behavior or release validation warrants it.
- Reuse completed checks while their relevant source, inputs, build artifacts and
  configuration remain unchanged. Repeat or broaden checks only after a relevant
  change, a failure, or a concrete unresolved concern; state the reason.
- Run expensive builds, browser suites and private-corpus comparisons sequentially
  to avoid resource contention and misleading timeouts. Poll an existing live run;
  do not start a duplicate because it is slow or temporarily silent.
- For documentation-only edits, inspect the diff and run `git diff --check`; do not
  launch numerical or browser comparisons. The pre-commit baseline above still applies.
- Keep D-23/D-28 tolerances and acceptance requirements unchanged. Targeted checks
  establish only their tested scope; unavailable references and incomplete runs
  remain explicitly unverified. Report checks actually performed and material gaps.

## Commands

```sh
cd app
npm ci                    # install; build the WASM core first (see README)
npm run dev               # dev server
npm test                  # unit tests (vitest)
npx tsc -b                # type check only (also part of the build)
npm run lint              # oxlint
npm run build             # static site in app/dist
node scripts/export-project-schema.mjs --check # native schema matches web model/defaults
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
| `compute/` | `ComputeService`, production real-WASM worker and Lua integration; mock retained for development/tests |
| `state/` | App state reducer with undo history, contexts, hooks (`useCalculation`, `useFitRunner`, `usePersistence`, `useEditProject`), IndexedDB autosave and material library |
| `ui/` | Components: menu bar, toolbar, layer table, plot (uPlot), mode panel, side panel with sections, dialogs, script window |
| `../test/` | Legacy fixtures (`default.all`, Tutorials) and the corpus test |

## Checklist

Current working list, structurally reconciled 2026-10-24. This section is the source
of truth for remaining work; the [historical checklist and migration map](docs/analysis/checklist-history-2026-10-24.md)
retain all previous records and detailed evidence. Do not treat historical "remains
open" wording as extra tasks. The [decision journal](docs/brainstorm/2026-10-15-remagx-web-app-refactoring/decisions.md)
wins on scope; the [spec](docs/brainstorm/2026-10-15-remagx-web-app-refactoring/spec.md)
retains the acceptance criteria. The external D-33 plan was unavailable at its
recorded path and its Steps 0–8 have not been verified.

### Meaning of completion

- **Implemented:** the stated workflow exists and has targeted functional evidence.
  This does not establish complete original-project or numerical acceptance.
- **Implementation complete:** all I-items are resolved and each applicable S-item has an
  explicit decision plus its required implementation, or an approved exclusion
  with clear handling. Newly discovered concrete gaps get their own task here;
  do not reopen vague "complete the engine" umbrella tasks.
- **Accepted:** the relevant A-items have recorded results and the user has reviewed
  representative real examples. Unavailable references remain unverified. Final
  manual review does not silently waive AC-4/5/6/9 or replace their tolerances.

Per D-40, finish usable workflows first, then conduct final numerical/corpus and
optimizer-quality review. D-23 remains 1e-10 relative + 1e-15 absolute; D-28 retains
its fit-quality criterion. D-40's provisional log10-reflectivity/asymmetry review
criteria, low/zero-reflectivity treatment and example selection must be confirmed
at final review; 1e-8 is not an agreed cutoff. D-41 requires full double precision
without deliberate rounding. Checklist totals are not progress percentages.

### Implemented workflows — final acceptance tracked separately

| Area | Implemented scope | Remaining home |
|---|---|---|
| Production compute | Real WASM through ComputeService/worker, no mock fallback; double-only lookup (D-39/D-41) | I4, A2, A5 |
| Simulation | Parratt, Matrix/Visnovsky and Zak; compound/element qz and energy paths; beams, analyzer, asymmetry, angular/energy resolution | A2 |
| Layers and profiles | Adaptive segmentation, multi-row layer conversion with preview/application/undo, element density, optical/magnetic profiles and spectra | S1–S3, A2 |
| Optical tables | Imported scalars/tensors, Chantler fallback, approved 277-row Uranium data; complete .F assignment to the selected element (D-37/38/45) | I4, A2 |
| Fitting | Clean Simplex/annealing, bounds, Q regularization, weighted datasets and scripted qz/energy/mixed fits | I4, A3 |
| Lua | Worker execution, persistent hooks, output/line errors, project APIs and cancellation; CalculateReflectivity explicitly excluded (D-43) | I2, I3, A5 |
| UI and files | Legacy project import, JSON save/load, autosave, editing/undo, plots, fit controls and error/recovery dialogs | S4–S7, A5 |
| Native tools | Unchanged original 2.6 reference build; separate public full-double terminal: .all/JSON, -refl, -dicrefl, -fit, -convert, -v; clean optimizers and installation/licence packaging | I1, I3, A1, A4, A5 |
| Regression infrastructure | Public native/WASM and Chromium checks, source inventory and double-precision gates; private comparison tools available locally | S8, A1–A5 |

These are bounded functional statements backed by the historical evidence, not
claims that every imported project works. No implementation is newly claimed by
this documentation change. Maps/-map remain later scope; Fourier is excluded by
D-44 and has been removed (I1).

### Concrete implementation work

Work in this order unless a user decision changes the priority. For every change,
use the targeted checks and reuse rules above; no new broad numerical sweep is
required merely to close a documentation or UI task.

- [x] **I1 — Remove Fourier (D-44).** Remove controls and web/native calculation/fit
  execution paths. Keep old JSON/.all projects readable and explicitly report
  active old Fourier settings; do not silently change their meaning. Update affected
  inventory/tests/docs. Done when no product workflow invokes Fourier and old-file
  handling is verified. Kernel/history cleanup is part of this same task.
  Completed 2026-10-25: controls, transform/rendering paths, native/WASM kernel and
  export removed. Legacy JSON keeps its compatibility field and active settings
  reject explicitly; the UI offers undoable removal. Existing .all import/report
  handling is unchanged. Focused Chromium load/remove/undo/save passes, as do 534
  app tests, lint/build, 371 native/WASM terminal comparisons and precision/inventory
  checks. Historical original-only diagnostics remain separate from the product.
- [x] **I2 — Preserve double coefficients in generated Lua (D-41).** Remove the two
  `toFixed(10)` serializations of beta/delta and betam/deltam in scriptSnippets.ts.
  Done when generated executable numbers round-trip the computed double, including
  small ratios, with a focused regression check; do not round stored numerics.
  Completed 2026-10-25: shortest round-tripping coefficient literals replace fixed
  decimals; -0 uses a floating Lua literal. Seven focused generator/actual-Lua
  checks pass, including tiny/subnormal/large values, signed zero, unchanged layer
  selection and caller state. App regression baseline, lint and build pass.
- [ ] **I3 — Finish the agreed Lua API audit and resulting gaps (D-22/D-43).** Map the
  original registered functions/globals to web and native bindings. Trace GetError,
  which has no current registration, and unresolved fractional-index conversion
  semantics. Distinguish implemented functions, original no-ops, agreed exclusions
  and actual gaps. Done when every required API has an implementation or explicit
  approved handling, and focused hook/error/state checks cover corrections. Ask
  under D-29 before changing semantics; do not restore CalculateReflectivity.
  The [2026-10-25 API audit](docs/analysis/lua-api-audit-2026-10-25.md) maps all 15
  original function registrations, 39 initialized arrays, 18 element methods and
  five hook globals. Remaining concrete blockers: GetError scope/implementation
  (question pending) and fractional array-argument policy. The normal chi-squared
  workflow is separate; the audit does not close final script acceptance.
- [x] **I4 — Resolve unspecified capability gaps.** Replace the old claims of
  "remaining core extraction", "unsupported table kinds" and "remaining fit
  parameters" with a source/inventory-to-production-route audit. Include magnetic
  profile application, accepted optical formats, fit targets/regularization and
  native CLI routing. Done when each in-scope route has an implementation reference
  and targeted evidence, or a named concrete follow-up here. An inventory label
  alone is not runtime evidence. Existing S/A records must not be duplicated.
  Completed 2026-10-25: [production capability audit](docs/analysis/production-capability-audit-2026-10-25.md)
  maps all six original table formats, all 28 fit-target IDs, magnetic-profile
  composition, worker dispatch and native command paths to implementation/evidence.
  The concrete new gap is I5; existing I3/S/A obligations remain separate.
- [x] **I5 — Reject deferred fit targets before evaluation (D-25).** Web worker,
  standalone preparation and optimizer entry, plus native CLI and fit-objective
  construction, reject betaKramersKronig/deltaKramersKronig and
  electronEscapeDepth/electronGain with named deferred-feature guidance before
  optical/script preparation or objective evaluation. Imported target metadata
  remains unchanged; no TEY or Kramers-Kronig physics was added.
  Completed 2026-10-25: focused worker/model checks cover both optimizers, unchanged
  projects and supported-fit recovery. The native CLI gate covers eight named early
  rejections and two supported fits with unchanged input files; it runs in Pages CI.
  App tests, lint/build, native compilation and the precision gate pass. No broad
  private-corpus or numerical-accuracy sweep was repeated.


### Decisions and dependent work

No option below is approved by reorganizing this list. Once decided, implement and
verify that decision before checking the item, or record the approved exclusion
and its user-visible handling. Preserve the original source tree throughout.

- [ ] **S1 — Spline first usable knot.** Original code reads before its array exactly
  at the second stored knot. Choose the continuous stored knot value or explicit
  unavailability at that coordinate (D-29). Close with the chosen endpoint behavior
  and a focused endpoint/interior check; broader profile accuracy belongs to A2.
- [ ] **S2 — Single-row layer conversion.** Original solver/segmentation relies on a
  second storage slot or missing penultimate row. Choose defined homogeneous-medium
  support or an explicit scope exclusion (D-29). Close with conversion/application
  and solver handling that preserves project data. Multi-row conversion already works.
- [ ] **S3 — Out-of-range magnetic-profile bindings.** Current implementation rejects
  these explicitly. Trace the undefined original mappings and ask whether to retain
  explicit unavailability or approve a defined correction (D-29). Do not restore
  obsolete amplitude/width copying from backup code. Close with documented handling
  and focused binding checks; global additive/multiplicative accuracy belongs to A2.
  [Binding trace](docs/analysis/magnetic-binding-audit-2026-10-25.md): the GUI stores
  none using the stored row count, but calculation compares with generated slices.
  Repetition can even turn none into a valid unintended density index. A correction
  using the stored sentinel and rejecting unknown active bindings is awaiting approval.
- [ ] **S4 — Plot Select Area / Fit Lorentzian+Step.** Decide their release scope.
  Close with implementation and focused interaction checks, or an explicit exclusion
  recorded in spec/inventory. Existing plot navigation is already implemented.
  [Plot source review](docs/analysis/plot-area-audit-2026-10-25.md) separates the
  three menu commands from four unrelated TMultiChart activation handlers. Both
  inventory groups retain decision status; the menu-only question does not decide
  the separate multi-chart records.
- [ ] **S5 — Summary window.** Decide its scope and const-qz-from-energy semantics
  before implementation: sizing, refresh, clipboard exports, axes and error display.
  Close with agreed behavior and interaction checks, or a documented exclusion.
- [ ] **S6 — Hidden experimental controls.** Review inventory group
  `hidden-tools-decision` item by item. Close when each control has an explicit
  scope decision and corresponding implementation/deferral/exclusion record.
  [Item-by-item source review](docs/analysis/hidden-controls-audit-2026-10-25.md)
  accounts for all ten IDs (eight controls, two event bindings), including active
  harmonic admixture, hard-coded GIF generation and fringe-spacing analysis.
  Recommended exclusion is pending; hidden does not mean inactive.
- [ ] **S7 — Layer-table coupl. column.** Trace the legacy control (no .all key) and
  decide whether it belongs in the release. Close with agreed data/UI behavior or
  a documented exclusion; do not confuse it with existing profile bindings.
  Source trace: [coupling-column audit](docs/analysis/layer-coupling-column-audit-2026-10-25.md).
  The active 2.6 grid has eight columns; the ninth-column reader is commented out
  and the layer class has no coupling field. Exclusion was proposed; answer pending.
- [ ] **S8 — Private-corpus CI access and integration.** Choose a private repository
  with read-only credentials or a self-hosted runner. Then connect strict import/
  golden gates without private data in public logs/artifacts (D-17.3/D-20, AC-4).
  Close only after the configured runner demonstrably fails on missing corpus and
  comparison failures. Public Pages checks alone do not complete this requirement.

### Final acceptance — after functional work (D-40)

Retain existing passing evidence. Run or repeat comparisons only for changed inputs
or remaining acceptance gaps. Record the exact source/artifact/input provenance,
coverage, failures and unavailable references. A missing reference is not a pass.

- [ ] **A1 — Reference preparation.** Complete private native-2.6 simulation outputs
  and original-optimizer fit references, with source/input provenance and unresolved
  missing-table/script/timeout cases explicitly listed (D-5/D-20/D-32). The reference
  binary already builds; do not rebuild its functionality as another task. Existing
  fit candidates include nine Simplex and one annealing result, not proof of convergence.
- [ ] **A2 — Simulation and derived-view acceptance.** Review user-selected real
  examples and complete the AC-5 native/WASM comparison coverage at D-23. Include all
  three solvers, compound/element qz/energy, both beams/analyzer/asymmetry definitions,
  fast/exact angular and energy convolution, combined roughness/segmentation,
  multi-row conversion, spectra, optical/magnetic and density profiles, and global
  additive/multiplicative magnetic profiles. Review the production D-41 full-double
  lookup and D-45 tensor correction explicitly; comparisons using injected original
  lookup samples do not prove their acceptance. Done with a coverage/results record
  and user review; any unverified requirement or necessary exception stays open.
  Portability follow-up 2026-10-25: the CI Zak asymmetry failure was reproduced
  exactly by enabling the pinned library's explicit FMA branch. The build shim now
  selects its scalar branch on both platforms; the complete public native/WASM
  comparison passes even when the compiler advertises FMA. D-23 is unchanged.
  Pages run 40177396886 for 6304a58 subsequently passed all native/WASM, worker,
  responsiveness and Chromium UI gates and deployed successfully.
- [ ] **A3 — Fit acceptance.** Complete original-project and original-annealing review,
  including broader parameter combinations/Q. AC-9/D-28 still require at least three
  corpus projects with the same project/seed and final chi-squared(new) <=
  chi-squared(original) * (1 + 1e-6). The maintained three-project Simplex gate already
  passes; the separate weak adaptive-fit case, slow case and annealing coverage
  remain unresolved. Do not silently change optimizer policy or treat identical
  objective values as fit-quality acceptance. Kramers-Kronig remains deferred.
- [ ] **A4 — Original rebuild versus Wine.** Resolve the fast-resolution difference
  between native 2.6 and Wine 2.3.1; retain the strict raw qz/R criterion of 1e-6
  (AC-6). Done with the maintained crosscheck report for computable cases and explicit
  unavailable cases; a version-specific exception requires approval, not normalization.
- [ ] **A5 — Final workflow/CLI acceptance.** Review agreed Lua programs, UI/worker
  errors (RX_QZ/DB/CSCRIPT/ESCRIPT/ML/UNKNOWN), cancellation/recovery and data/undo
  preservation, project/table import and save/reload, and native .all/JSON commands
  -refl/-dicrefl/-fit/-convert/-v with optional Lua. Include standard Chromium file
  upload/download fallback, responsive fitting/Stop and static local execution
  (AC-1/3/4/7/7a/7b/8/10–15). Reuse existing checks; add only missing coverage.
  Done when the coverage record links passing evidence and user examples, with
  exclusions and unresolved limitations stated. This is acceptance of implemented
  workflows, not another generic implementation task.

### Updating this list

Tick the concrete item in the commit that completes it and append evidence to the
journal. When a decision reveals implementation work, keep it with the S-item or
create a specific linked I-item; never recreate overlapping engine umbrellas.
Update inventory classifications when scope or implementation changes. Preserve
historical evidence in the linked archive/journal; new progress belongs here and
in the journal, not appended to the frozen archive.
