# Workflow acceptance evidence — 2026-10-25

This is the A5 coverage record for implemented workflows. It distinguishes
passing automated cases from outstanding user/original-project acceptance. It
does not close I3, S1–S8 or the numerical acceptance requirements A1–A4.

## Verified runs and inputs

- [Pages run 40177396886](https://github.com/s-macke/ReMagX/actions/runs/40177396886),
  commit 6304a58: all native/WASM, project/fit, app, actual-worker, responsiveness
  and Chromium UI steps passed; Pages deployment succeeded. The live index and
  its referenced JS/CSS assets were subsequently reachable. This run includes I5
  and the FMA portability correction.
- [Optional container run 40178826026](https://github.com/s-macke/ReMagX/actions/runs/40178826026),
  commit 0246045: pinned build, export checks, actual Compose invocation and byte
  comparisons passed. The container artifact was uploaded. Later documentation
  commits do not expand these runs' coverage.

No new numerical or browser sweep was run to write this record. The public gates
use synthetic/public fixtures. They do not supply private-corpus CI access,
missing original outputs, or a user's review of real measurements.

## Requirement-to-evidence map

| Requirement/workflow | Maintained evidence and what it proves | Boundary still to respect |
|---|---|---|
| AC-1 optional reproducible static build | [Compose](../../compose.yaml), [container workflow](../../.github/workflows/container.yml) and successful container run: nonempty index/core, named engine.wasm alias, equality with runtime/Buildx assets. | Linux amd64 and the pinned toolchain; Docker remains optional. |
| AC-3 saved precision normalization | [allFile tests](../../app/src/import/allFile.test.ts) compare precision=3 and precision=1 imported project objects and require the override report. The real core uses the double-only source gate. | This is identical prepared input, not a separate paired original numerical run; broader physics evidence is A2. |
| AC-4 import/report | Same tests exercise LF/CRLF, invalid UTF-8/Latin-1 bytes, unknown-key counts and schema-compatible imported state. The strict private corpus runner is separate. | Public tests alone do not prove current all-private-project acceptance or S8 CI access. |
| AC-7 legacy scripts | [Lua API audit](lua-api-audit-2026-10-25.md), native/Wasmoon comparisons and actual Chromium worker gates cover the registered surface and bounded hooks/state cases. | GetError and fractional argument policy remain I3; complete original script/golden acceptance remains A1/A2/A5. |
| AC-7a unavailable/excluded APIs | [luaFunctions tests](../../app/test/luaFunctions.test.ts) and [Chromium Lua gate](../../app/scripts/test-lua-runtime.mjs) assert named/source-line diagnostics, including KramersKronigRange. D-43 governs CalculateReflectivity exclusion. | Do not restore excluded/deferred physics to satisfy an old script silently. |
| AC-7b optimizer import fallback | allFile tests assert fitalgorithm=1 becomes Simplex with a Levenberg-Marquardt warning. | This does not prove fit-quality acceptance, which is A3. |
| AC-8 script failures preserve data | [luaProjectScript tests](../../app/test/luaProjectScript.test.ts) verify line-3 compilation/runtime errors and identical serialized input/project state; [runtime tests](../../app/test/luaRuntime.test.ts) cover failed-session disposal. [Script-menu UI tests](../../app/e2e/scriptMenus.spec.ts) exercise execution, undo and blocked-script recovery. | Representative original user scripts and standard-library compatibility remain to be reviewed. |
| Error UI / D-14 | [calculationErrors UI tests](../../app/e2e/calculationErrors.spec.ts) cover six error groups, full details, project/undo preservation and recovery. A separate case provokes an actual WASM numerical failure. | The six-group presentation test injects worker-protocol errors; it does not provoke every original engine failure condition. |
| AC-10 responsiveness/Stop | [responsiveness UI tests](../../app/e2e/responsiveness.spec.ts) assert two iteration advances, tab response under 200 ms and Stop under 1 s; blocked workers cover termination/session invalidation. The real-engine responsiveness CI step also passed. | Timing bounds concern these measured fixtures, not every future large project. |
| AC-11 sections | [persistence UI tests](../../app/e2e/persistence.spec.ts) toggle current sections, check algorithm-dependent visibility and expansion persistence after reload. | Unimplemented scope choices are not established by existing-section coverage. |
| AC-12 inventory | [inventory checker](../../tools/inventory/check) accounts for every extracted ID and disposition. | Deferred decision/UI entries remain requirements; inventory success is not runtime parity. |
| AC-13 static local execution | [Playwright config](../../app/playwright.config.ts) serves dist using Python's static HTTP server. Every current spec imports [the shared fixture](../../app/e2e/fixtures.ts), which allows only the local origin and aborts/reports other network requests, including worker fetches. | This is locally served browser execution, not a promise that file:// URLs or arbitrary browser extensions work. |
| Actual WASM/no fallback | [realEngine UI tests](../../app/e2e/realEngine.spec.ts) check the local binary signature/versioned request, actual engine label, explicit missing-binary failure and reload recovery. Script-menu tests execute real Lua under the same network restriction. | Core load success alone does not establish numerical acceptance. |
| AC-14 autosave | Persistence UI tests edit a layer, reload and check IndexedDB restoration. | User recovery from damaged/private files remains part of final example review. |
| AC-15 import/save paths | Persistence UI tests disable picker APIs to exercise actual upload/download and JSON round trip; they also provide real OPFS handles for Open/Save/Save As and assert saved contents. | Native picker dialogs are injected at the dialog boundary because headless Chromium cannot operate them; manual desktop-picker review is not claimed. |
| Tables/datasets/exports | [material library](../../app/e2e/materialLibrary.spec.ts), [datasets](../../app/e2e/datasets.spec.ts) and [plot exports](../../app/e2e/plotExport.spec.ts) cover persisted tables, imports, replacement/clear/error behavior and data/image export. | They do not validate arbitrary private optical data or unresolved Summary/plot additions. |
| D-35 native CLI | [terminal gate](../../app/scripts/test-native-terminal.mjs), [fit-start gate](../../app/scripts/test-native-fit-start.mjs) and [native Lua gate](../../app/scripts/test-native-lua.mjs), plus [conversion](../../engine/tests/test_terminal_conversion.py) and [relocated-install checks](../../engine/tests/test_terminal_install.py), cover maintained commands and scripted/non-scripted paths. | Use their public cases as bounded evidence for -refl/-dicrefl/-fit/-convert/-v and .all/JSON; no -map promise before maps exist, no original optimizer trajectory claim. |

## Remaining A5 work

Review selected real projects/scripts and normal desktop file dialogs with the
user after the functional scope decisions. Record the selected inputs privately,
expected workflows, actual result and any failure; no private data belongs in
public logs or artifacts. Complete any specifically exposed integration gap
rather than repeating already passing suites without a changed input or reason.

Resolve the I3 API decisions and S scope choices, then add focused evidence for
any implemented paths. Retain explicit exclusions and unavailable cases. The
Summary, plot extras, spline endpoint and profile-binding decisions cannot be
closed by this table. A5 stays unchecked until its user-example review and all
applicable resulting workflow checks are complete.
