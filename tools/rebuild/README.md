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
coverage; the full-project integration above used a private study adapter. The next section records the maintained project driver and Q/annealing
integration added after this probe. Versioned JSON I/O and remaining terminal
options are still required. Legacy
physics dependencies need their separate source/licence/precision review before
any rebuild binary can be called distributable. D-35 and D-32 remain open.

## Maintained private fit integration driver

```sh
python3 tools/rebuild/build_fit_driver.py --legacy-root old/reMagX3 --output build/fit-integration/driver
python3 tools/rebuild/check_fit_driver.py build/fit-integration/driver
python3 -m unittest discover -s tools/rebuild -p 'test_*.py'
```

The builder verifies the full 104-file private source closure before and after
compilation, excludes `CChiSquareFit.cpp`, and checks the resulting binary for
original optimizer symbols. Output inside the original tree is rejected. The
new clean optimizer is compiled directly from `engine/src/optim/nelder_mead.cpp`;
no dynamic plugin or Node runtime is required. The **original physics** remains a
private reference dependency, including its original lookup behavior. This is
not the distributable full-double engine or the completed terminal.

Invocation, from the directory containing a project's companion tables:

```text
/path/to/driver project.all max-evaluations max-iterations [Q]
```

The optional Q argument supplies regularization explicitly; the original loader
does not persist that field. Ordinary Simplex uses the web engine's adaptive
coefficients and selected/completed reference callbacks. Annealing uses the saved
32-bit seed and original saved parameter vector for Q. Fixed parameters remain in
results but do not add optimizer dimensions. Bounds are applied in evaluation;
completed reference refreshes also clip the retained reference, without replacing
best-ever trial results. Each output retains the reference used by its best trial.

On success stdout contains a 17-significant-digit JSON **fit result**, including
values, error, reference vector, work counts and termination reason. This is not
a versioned JSON **project** and cannot be opened as one. No `.all` output is
written. SIGINT requests cooperative stop between objective calls; a result with
termination 3 is stopped, not converged. Host calculations are not interrupted
mid-call. Missing best results, Lua/numerical failures and invalid requests exit
nonzero without a result. Original diagnostic output is suppressed because it
can expose private paths and script text.

Exit codes: 2 invocation, 3 output setup, 4 input loading, 5 unsupported optimizer
or Kramers–Kronig target, 6 parameters/data/budget, 7 tables, 8 constructor script,
9 stop before fixed-parameter evaluation, 10 optimization/no-best-result,
11 result output, 12 other validation/execution exception. Work limits are
positive integers up to 1,000,000; simplex storage is capped at 10,000 dimensions.
The driver accepts original `.all` input only; JSON project loading/export,
remaining CLI commands and full original-project acceptance remain open.

The maintained check uses the public tutorial with explicit fit metadata. It
covers deterministic ordinary/annealing replays, zero-temperature agreement,
Q reference refresh versus fixed annealing references, fixed parameters, budgets,
invalid bounds/settings, inactive data, Lua failure and recovery. It verifies
that the input file stays unchanged and failures publish no partial result.
It does not establish optimizer trajectory equivalence, corpus fit quality or
parity of the approved production error-function replacement.
