# Magnetic-profile binding trace — 2026-10-25

Checklist S3 concerns an ambiguous binding sentinel, not the separate spline
endpoint decision S1. The proposed correction below requires D-29 approval.
Original sources remain private and unchanged; no numerical deviation is applied
by this audit.

## Three different layer counts

Let N be the stored compound table's row count, O the expanded stack's row count
before adaptive subdivision, and G the generated stack's row count. Without
multilayer repetition O = N; after subdivision G often differs from both.

The original GUI (`old/reMagX3/client/Unit1.cpp:1378–1400`, `:1475`) offers all,
air, numbered layers, bulk and none. It stores the selected position minus one:
all = -1, air = 0, bulk = N - 1, none = N. The project model represents all as
null. The current
[UI option model](../../app/src/model/magneticProfiles.ts) preserves this encoding.
`shared/CStateHandler.cpp:230`, `:956` saves/loads the integer as
`gauss_bindtolayer`; this is not a direct index into the stored layer array.

The original `shared/RechenHilfe.h:515` (`CalcMagProfile`) copies the original
stack and subdivides it. For each generated midpoint it then:

1. Skips zero-amplitude profiles.
2. Skips a binding equal to **G**, calling it none.
3. Uses unit weight for all; otherwise samples density at index **O - binding - 1**
   in the pre-subdivision stack.

`GetDensity` at line 475 accesses the requested row and, except at index zero,
its predecessor without checking the range. Comparing with G cannot validate an
index into a different stack of length O.

## Consequences

These examples follow directly from the index expressions; they are not newly
claimed numerical reference outputs.

| N | O | G | Stored binding | Original effect |
|---|---|---|---|---|
| 3 | 3 | 4 | 3 (none) | Not skipped; density index -1 is outside the array. |
| 3 | 5 | 8 | 3 (none) | Not skipped; density index 1 is valid but activates an unintended binding. |
| 3 | 3 | 4 | 4 (unknown to GUI) | Skipped because it happens to equal G. |
| 3 | 3 | 4 | 0 (air) | Density index 2; defined reverse mapping. |
| 3 | 3 | 4 | null/all | Unit weights; no layer lookup. |

The maintained [web implementation](../../app/src/model/segmentedMagneticProfiles.ts)
and [native implementation](../../engine/src/project_segmentation.cpp) currently
retain the generated-count skip, but reject an out-of-range density index instead
of accessing invalid memory. The second example can therefore still compute:
range checking alone does not implement the UI meaning of none.

Existing [focused tests](../../app/src/model/segmentedMagneticProfiles.test.ts)
prove reverse mapping, midpoint/weight layout, zero-amplitude/generated-count
skips, explicit out-of-range rejection and unchanged input. They deliberately
encode the current behavior; they are not evidence that the none mismatch is
correct or accepted.

## Proposed decision and bounded implementation

Asked the user whether to make none always disable the profile, identify it by N
before expansion/subdivision, and reject unknown active bindings explicitly.
Valid stored bindings keep the established density mapping; this proposal does
not redesign how valid bindings interact with multilayer repetition. Zero-amplitude
profiles remain inactive, and project/imported values are preserved rather than
silently clamped or rewritten. The alternative is to retain current behavior and
its explicit range errors for now. No answer is inferred.

On approval, pass the stored count explicitly into web profile preparation and
use the stored count already available natively. Replace the generated-count
sentinel comparison in both routes. Cover none with/without expansion, unknown
bindings including accidental equality with G, valid air/bulk/all mappings,
zero-amplitude skips and project preservation. Check native/web agreement using
public synthetic cases, without a broad corpus rerun. Keep S3 unchecked until the
chosen behavior is implemented and verified. Global additive/multiplicative
accuracy remains A2; this does not restore obsolete amplitude/width copying or
change solver/tensor behavior.
