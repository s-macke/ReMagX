# End-to-end workflow review — 2026-10-31

Reviewed production source at `cd358e6` against the local, unchanged original 2.6
sources. This is a bounded review of five workflows, not complete original-program
or numerical acceptance. No product code changed. Existing approved differences
(D-8/D-13/D-16 and subsequent decisions) take precedence over literal UI parity.

## Findings

### R10 — High: delayed startup recovery can overwrite current work

`app/src/state/usePersistence.ts:13–23` starts an asynchronous IndexedDB read.
Its completion dispatches `loadProject` unconditionally when a saved record exists;
the only guard is component unmount. It does not compare the current project or
file session with the state at the start of recovery. The UI remains editable.

Confirmed with a controlled Chromium probe against the unchanged production build:

1. Set layer 1 thickness to 41; wait until IndexedDB contains that value.
2. Reload, holding only the autosave read's success callback.
3. Edit layer 1 thickness to 123 and commit it; verify the displayed value.
4. Release the stored callback: thickness changes back to 41.

The probe passed by observing the incorrect overwrite. This is **reproduction of
a defect**, not a passing correctness gate. The temporary probe was moved outside
the repository after execution; the steps above describe its controlled timing.
A newer Open/New/example action can also be superseded by the same dispatch by
source inspection; those variants were not executed in this review.

The original explicit load path is synchronous (`Unit1.cpp:4443–4461`) and applies
state only after successful parsing. Browser autosave is the approved D-13/AC-14
addition, so this is a web lifecycle defect, not a claim of identical original
recovery behavior. Explicit web Open/Save have file-session checks, but recovery
bypasses them (`useProjectFileCommands.ts`, `fileActions.ts`).

Recommended repair: apply recovered data only while the initial project/session
is still eligible for recovery. Preserve newer edits/Open/New/example actions.
Ensure completing recovery schedules autosave for the current project even when
recovery is skipped or returns no record: readiness currently changes only a ref,
which cannot itself rerun the save effect (`usePersistence.ts:25–29`). Test delayed
restore with edits and explicit file actions, then reload the preserved result.
The no-record/readiness branch is source-derived and not runtime-reproduced here.

### Existing placement question — compound gamma/phi columns

The optional web angle columns remain a known placement difference. Original
compound headers are fixed at eight (`Unit1.cpp:1791–1799`), with angles editable
through Material Settings (`7517–7518`). The user authorized selection/help fixes,
not removal of these columns. No new numerical defect is claimed for this layout.

## Workflow trace and comparison

| Workflow | Original path | Web path and outcome of this review |
|---|---|---|
| Edit layer/material → calculate → plot/export | `Unit1.cpp:7511+` applies material fields; `3190+` reads state, prepares optical data and scan coordinates, then calculates/draws; slider handlers `3967+`, `4104+` invoke the active view | `MaterialSettingsDialog`/`materialSettings`, reducer, `useCalculation`, `calculateView`, `realCalculation`, `usePlotChart`, diagram export. Draft Cancel does not apply edits; committed edits update the project; current view is recalculated through ComputeService. Request IDs reject obsolete plot results. Mode-specific compound/element preparation precedes solver dispatch. No new confirmed defect in this trace. Existing R1/R3/R4/R5/R8/R9 evidence covers redraw, Hold/zoom, table boundaries and modes. |
| Import tables → choose automatic/manual → explicit database update → calculate/save | `GetdbButtonClick` (`3077+`) reads state, resolves tables, calls Filldb and copies both active-film representations back; `SetOCStrict` (`3150+`) enforces required data for applicable calculations | `OpticalConstantsSection`, `materialLibraryStorage`, `useDatabaseUpdate`, `realDatabaseValues`, `applyDatabaseValues`, `prepareProjectOptics`. Tables are parsed locally and stored separately in IndexedDB under D-13. Exact names select tables; explicit update carries scalars/tensors together and checks source project/table/fit epoch before applying. Automatic preparation operates on calculation state; manual values remain stored. Saved JSON does not embed imported tables—approved storage separation, not a missing serialization claim. No new confirmed defect. |
| Compound material → element profiles → calculate; generated layers → apply → calculate/Undo | `Material2ElementsButtonOkClick` (`7526–7565`) expands compound repetition, replaces element data and selects element 0; `Button13Click` (`4830–4860`) forces slicing in a temporary state and replaces stored compound rows | `MaterialElementsAction`, `materialElements`, `LayerConversionDialog`, `realLayerList`, `layerConversion`, reducer. Previews require explicit application and reject stale sources; Cancel/Stop does not apply generated data. Element conversion retains compound data and removes replaced element fit references. Layer conversion retains element mode/data, remaps affected compound references and supports Undo; single-row exclusion follows D-47. Original Button13 also retains repetition/other settings after replacing rows. Re-expansion of generated layers is therefore a legacy workflow caveat, not a newly established refactoring discrepancy; no physics/settings change is approved by this review. |
| Fit targets/bounds → Start → worker progress → Stop/result → Undo | `FitStartButtonClick` (`3325+`) copies GetState, invokes FitNewDLL and starts its thread; `Button22Click` (`5079+`) sums weighted active-dataset errors | `FitSections`, `useFitRunner`, `WorkerComputeService`, `realFit`, `mergeFitResult`, reducer. Start sends a project/table snapshot; bounds are disabled while running (R7). Worker progress supplies previews; epoch/structural guards discard invalidated results; successful results merge fitted values and explicit dataset updates. Stop uses cooperative completion with worker termination fallback. No new confirmed defect from this lifecycle trace. Ordinary concurrent numeric edits remain the established merge policy. Fit quality/convergence is not established here. |
| Open/import → edit → Save/Save As → reload/recovery | `LoadProgramState`/`SaveProgramState` (`4443–4536`) synchronously load or serialize state; original load clears its filesystem table cache | `useProjectFileCommands`, `fileActions`, import/schema validation, saved-project snapshots, `usePersistence`, `autosave`. Native JSON/import-only .all and per-browser material library are D-8/D-13 differences. Explicit async Save captures its project/handle and guards file sessions (R2). Startup recovery has confirmed R10; normal reload evidence does not cover delayed recovery. |

## Evidence and limits

- One new targeted Chromium probe reproduced R10 (5.6 seconds overall); only the
  IndexedDB read notification was delayed. Production bundle/worker were unchanged.
- Reused previous passing evidence: 565 app tests, lint/build, two mode-switch
  Chromium checks, and the recorded focused persistence/save-session, material,
  plot, conversion and fit/Stop checks. They were not all rerun for this review.
- Checked active source, not commented-out UI experiments. The original source
  tree and private corpus were not modified or published.
- No Wine/native execution comparison, corpus sweep, numerical tolerance change,
  optimizer convergence review, or full arbitrary-Lua acceptance was performed.
- Summary, line fitting and the full scripting/CLI workflow families retain their
  existing separate audits and A5 obligations; they were not newly reviewed end to
  end here. A1–A5 remain open. No whole-application parity claim follows from this
  five-workflow review.

## R10 resolution — 2026-10-31

User authorized the fix after review. `restoreAutosave` now validates the initial
project, file session, filename, saved-project identity and history in the reducer
before applying recovery. This preserves newer edits and file actions, including
an edit followed by Undo. `usePersistence` uses reactive completion state so the
current project is autosaved even when recovery is rejected or no record exists.

Four committed Chromium regressions in `autosaveRecovery.spec.ts` delay the actual
IndexedDB success notification and verify edits/Open/New/empty storage, persistence
of the chosen current project, and successful restoration on the next reload.
All four and seven existing persistence tests pass (11 total). The reducer test
also covers undo and save identity. All 566 app tests pass (seven optional skips),
lint/build and diff checks pass. No numerical or original-source changes; broader
acceptance remains open. The findings above retain the pre-fix review evidence.
