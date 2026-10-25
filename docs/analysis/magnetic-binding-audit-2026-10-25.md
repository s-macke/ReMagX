# Magnetic-profile binding trace — 2026-10-25

Checklist S3 concerns an ambiguous binding sentinel, not the separate spline
endpoint decision S1. The correction below is approved by D-51 under D-29.
Original sources remain private and unchanged.

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
and [native implementation](../../engine/src/project_segmentation.cpp) previously
retained the generated-count skip with a density-index range check. The second
example could therefore still compute: range checking alone did not implement
the UI meaning of none. D-51 replaces that sentinel test in both routes.

## Approved correction and verification scope

D-51 identifies none by N before expansion/subdivision and rejects unknown active
bindings explicitly, including accidental equality with G. Web preparation now
receives N explicitly from the project; native preparation uses its stored table
count. Both skip zero-amplitude profiles before binding evaluation. All, air,
bulk and other valid bindings retain their existing density mapping, including
its interaction with repetition. No profile/imported values are rewritten.

[Focused model tests](../../app/src/model/segmentedMagneticProfiles.test.ts) cover
N=3 with generated count 4 and expanded count 5: none skips even where the old
formula produced a valid density index, and an unknown binding equal to the
generated count rejects. Existing reverse mapping, additive/multiplicative inputs,
zero amplitudes and unchanged inputs remain checked. The actual Chromium worker
covers none with/without expansion in both combination modes. Native/actual-WASM
terminal checks compare no-profile and none-profile results, then require an error
for an unknown binding equal to the generated slice count and preserve the input
file. These are bounded synthetic checks, not full original-project acceptance.

The old generated-count skip is intentionally no longer an expected result.
Original numerical comparisons must distinguish this approved correction from
unexplained mismatches. Global profile accuracy and original-project review remain
A2; this does not restore obsolete amplitude/width copying or change tensor state.
