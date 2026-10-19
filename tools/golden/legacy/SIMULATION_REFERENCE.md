# Private original simulation reference

Build with `python3 tools/golden/legacy/build_simulation_reference.py` and verify with
`LEGACY_ROOT=old/reMagX3 python3 -m unittest discover -s tools/golden/legacy -p test_simulation_reference.py`.
The build requires GCC/G++, the system FFTW3 development library, and the private legacy tree.
It compiles bundled Lua 5.1.4 from source; no system Lua library or old object files are used.
The 99-file private include/source closure is hash checked before compilation.
`-fpermissive` accepts the original invalid unused Visnovsky default constructor without
editing its source. Compiler diagnostics are captured and withheld from public output.

The executable takes one `.all` path and emits a JSON array of `[qz, R]` pairs with
17 significant digits. Run in the directory containing any required material tables;
use an absolute project path when changing directories. Outputs from research projects
remain private. Standard legacy diagnostics are suppressed and the adapter buffers the
whole finite curve before publishing it. The caller must impose a timeout, particularly
for projects containing scripts. Original Lua retains filesystem/OS access: this is a
local reference tool for trusted projects, not a sandbox or a web runtime.

This stage calls original LoadState, optional Getdblist/Filldb, generated or selected-dataset qz coordinates,
and CalcReflectivity<double>, including original preparation and postprocessing. It does
not reconstruct every GUI GetState/SetOCStrict path, energy scans,
dichroic entry points, or fit workflows. Original non-Borland Lua callbacks retain their
terminal stub behavior. The system FFTW library is not pinned; Fourier results have not
been validated. Original segmentation helpers remain private reference dependencies,
not cleaned double-only production implementations. No original optimizer implementation,
private source, binary, lookup table or research curve is committed.

Tests establish a finite default curve, a zero-contrast curve, an independent pure-sigma
Fresnel interface comparison at D-23, suppressed missing-file diagnostics, and absence of
optimizer linkage. Measured-grid checks cover dataset selection, original order, duplicate
coordinates, the strict shift threshold and invalid/empty selections. Coordinates are checked
exactly; duplicate intensities use D-23 because original fast convolution can differ by rounding.
The adapter follows GUI Button3Click: adapt the selected dataset once, then apply experiment
energy/polarization. It does not reproduce the terminal executable’s second shift.
These do not establish corpus-wide simulation goldens, a cleaned public
native rebuild, WASM whole-project parity, or Wine cross-validation. Those checklist items
remain open.

## Whole-project Chromium diagnostic

Run `node app/scripts/diagnose-project-reference.mjs` from the repository root after
building the real WASM engine and installing Chromium. `LEGACY_ROOT` selects the original
source tree; `WASM_DIRECTORY` selects the directory containing `remagx-core.mjs` and `.wasm`.
The tool rebuilds the hash-gated original reference, generates only public-default-fixture
variants, imports each through the web importer, and calculates through the actual
ComputeService, worker and WASM in Chromium. It checks input immutability and compares
both coordinates and reflectivity with unchanged D-23. Its 24 generated-grid cases cover Parratt,
Visnovsky and Zak, magnetic off/on, zero/nonzero angular resolution and exact/fast modes.
Thirty additional measured-grid cases cover all three algorithms, exact/fast resolution,
selected datasets, unordered/duplicate coordinates and five shifts around the threshold.
It does not cover magnetic profiles, automatic tables, scripts, energy scans or private
corpus acceptance.

The JSON result explicitly reports `acceptancePassed`, mismatch counts per case, first
mismatch indices, absolute-error maxima, log10 error for positive pairs and zero/nonpositive
counts. A completed diagnostic exits successfully even when numerical acceptance is false;
use `--require-parity` to require a zero-mismatch exit status. Build/runtime errors always
fail. This is a diagnostic, not a replacement for the acceptance gate or a tolerance exception.

On 2026-10-19 the 14,400 compared values contained 196 D-23 mismatches, all in four
magnetic Visnovsky cases. The other 20 cases passed. Maximum log10 error was about
6.12215e-6. In a separate local isolation probe, identical original-loaded tensors matched
all 300 zero-resolution points in cleaned native C++, while Node/WASM failed 18 points,
matching Chromium. Thus this case's discrepancy lies in native/WASM numerics, not importer
preparation. Platform complex square-root rounding differences were observed at the mode
level; they are not yet proven to explain every mismatch. No numerical implementation or
tolerance change is included in this diagnostic step. Full matrix project acceptance remains
open despite earlier prepared-stack component comparisons.

The observed discrepancy above was resolved later on 2026-10-19: pinned glibc scalar
atan2/cos/asin in the WASM matrix path and C complex square-root/logarithm primitives
restore all 24 project variants at unchanged D-23. The quartic solver is unchanged.
The expanded native/WASM tests include 4,800 intensities from the public magnetic stack
and both beam modes. See `engine/third_party/glibc_math/README.md` for provenance and
scope. This closes the observed regression, not full corpus or general engine acceptance.
