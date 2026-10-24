# Native rebuild integration

This directory contains import-boundary code for joining the maintained native
engine to the private legacy project/objective implementation. It is not yet a
standalone terminal or a distributable legacy rebuild.

## Optimizer metadata boundary

`legacy_optimizer_state.cpp` supplies only the `CChiSquareFit` constructor needed
by the unchanged `CMultiFit` objective. It initializes parameter metadata and the
saved regularization reference. It supplies **no search methods**. Legacy member
names appear here solely because this is an ABI import boundary (D-34).

Compile this file **instead of** `shared/CChiSquareFit.cpp`, never alongside it.
Use the maintained `remagx/optimizer.h` C API for optimization, supplying the
objective, bounds mapping, reference lifecycle and saved seed explicitly.
The original terminal still calls its old search methods and cannot simply be
relinked with this constructor: its orchestration must be replaced separately.

The native metadata check requires GCC/G++ and the unchanged private source tree:

```sh
python3 tools/rebuild/check_optimizer_state.py --legacy-root old/reMagX3
```

It hashes the four private declaration/random-generator dependencies before
compilation, builds in a disposable directory, and verifies:

- saved values/identifiers and source parameters are preserved;
- initial step metadata matches the existing web preparation;
- raw initial Q references retain out-of-bound saved values until evaluation;
- empty parameter lists and independent candidate/reference storage work;
- no original optimizer search methods appear in the linked executable.

No Numerical Recipes implementation is copied into this directory, compiled by
this check or committed. Existing private original-reference tools may still
compile such code for comparison; they remain private and are not public rebuilds.

## Local integration evidence (2026-10-24)

A private clean-optimizer study adapter was relinked with the replacement
constructor, unchanged `CFit.cpp`/`CError.cpp`, and the maintained native optimizer
library. Its source list excluded `CChiSquareFit.cpp`; `nm -C` confirmed that the
old Simplex, annealing, LM and trial-method symbols were absent.

A disposable copy of the **public** `app/test/fixtures/Tut2.all` enabled its dataset,
disabled automatic optics/scripts, and selected layer-1 thickness starting at 150,
bounded by 50 and 250. Both versions used the same clean-room classical simplex;
only the constructor supplying legacy metadata differed. They returned identical
31 iterations, 68 evaluations, objective `0.24354908614176804` and thickness
`147.84833857789636`. The first attempt correctly rejected the fixture's default
inactive dataset; it was explicitly activated for the successful integration run.
No original source or saved project was changed.

This comparison isolates constructor replacement, **not** original optimizer
quality or complete legacy compatibility. The committed probe maintains metadata
coverage; the full-project integration above used a private study adapter. A
maintained project driver, regularization lifecycle, annealing integration,
versioned JSON I/O and remaining terminal options are still required. Legacy
physics dependencies need their separate source/licence/precision review before
any rebuild binary can be called distributable. D-35 and D-32 remain open.
