# Layer-table coupling column — 2026-10-25

This is the source trace for checklist S7, not an approved scope exclusion.
Recommendation: exclude the inactive `coupl.` column while retaining Lua layer
coupling and existing magnetic-profile bindings. No runtime behavior is changed.

## Original 2.6 evidence

Paths below refer to the private, unchanged `old/reMagX3/` source tree. No original
source or private project data is included in this document.

| Source location | Finding |
|---|---|
| `client/Unit1.dfm:11591`, `:11601` | The layer grid has eight columns, indices 0–7. |
| `client/Unit1.cpp:6295`, `:6313` | Startup still assigns a `coupl.` heading and -1 initial values at column index 8, outside those eight columns. This alone does not establish an operational feature. |
| `client/Unit1.cpp:1689`, `:1791` | Active element/compound table rendering sets eight columns (the element expression also contains a six-column alternative). Neither renders a ninth coupling column. |
| `client/Unit1.cpp:1564–1610` | Active compound input reads thickness, table name, optical constants and roughness, but no coupling value. The apparent column-8 cleanup at 1582 is inside a block comment. |
| `client/Unit1.cpp:4716–4747` | The only `s.coupling` assignment is inside an entirely commented-out old reader. It is not compiled. |
| `shared/schicht.h:105` | The current layer class has no coupling member. |
| `shared/CStateHandler.cpp` | Coupling keys refer to magnetic-profile metadata/global mode; there is no layer-column coupling key. |

These findings establish the absence of an active column-to-layer-to-calculation
path in the inspected source. They do not prove what a much older binary might
have done, and do not define a new numerical coupling rule.

## Separate features that remain supported

The original script generator, `client/Unit1.cpp:6381` (`ComboBox1Change`, option 3),
creates assignments between layer 1 and layer 2 for thickness, optical constants
and roughness. This is a Lua template, independent of the unused table column.
The web implementation remains in
[scriptSnippets.ts](../../app/src/model/scriptSnippets.ts), `layerCoupling`.
Scripts can express other relationships using the established Lua arrays.

Magnetic-profile layer bindings, the global additive/multiplicative mode and
stored per-profile amplitude/width references are also separate. Their existing
implementation and S1/S3 acceptance questions are unaffected by S7. In particular,
this recommendation does not restore obsolete profile-copying behavior.

## Decision and completion boundary

Asked the user to choose exclusion of the inactive column (recommended), or a
new active coupling control whose semantics would first need to be specified.
No answer is inferred. S7 remains unchecked and the inventory's layer-table group
remains deferred pending the answer.

If exclusion is approved, record it in the decision journal/spec and reconcile
the inventory group with the already implemented layer-table interactions. No
new project field, import mapping, numerical coupling or UI control is needed.
A request for an active control instead requires a defined relationship, affected
parameters and interaction with Lua/fitting before implementation.
