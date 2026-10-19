# Private original simulation reference

Build with `python3 tools/golden/legacy/build_simulation_reference.py` and verify with
`LEGACY_ROOT=old/reMagX3 python3 -m unittest discover -s tools/golden/legacy -p test_simulation_reference.py`.
The build requires GCC/G++, the system FFTW3 development library, and the private legacy tree.
It compiles bundled Lua 5.1.4 from source; no system Lua library or old object files are used.
The 99-file private include/source closure is hash checked before compilation.
`-fpermissive` accepts the original invalid unused Visnovsky default constructor without
editing its source. Compiler diagnostics are captured and withheld from public output.

The executable takes one `.all` path and emits a JSON array of `[qz, R]` pairs with
17 significant digits. Append `--asymmetry` to call the original two-beam routine and
emit `[qz, Rplus, Rminus, asymmetry]` rows instead. The project selects normalized
asymmetry or the beam difference. Both CLI modes initialize calculated columns as GUI
Button3Click does, including when coordinates come from a measured dataset.
Add `--energy` for energy scans; the first output column then contains energy rather
than qz. Combine with `--asymmetry` for both beams and asymmetry. `--angle` selects the
GUI fixed-angle energy option, which is not persisted in the legacy `.all` format;
otherwise generated energy scans use fixed qz. Measured energy/qz columns retain their
order and receive the legacy shifts once. Energy scans always perform strict initial
table refresh, including with automatic constants disabled. Generated energy grids use
the table-range intersection and minimum-inclusive repeated addition; invalid or
nonadvancing grids fail instead of hanging.
Run in the directory containing any required material tables;
use an absolute project path when changing directories. Outputs from research projects
remain private. Standard legacy diagnostics are suppressed and the adapter buffers the
whole finite curve before publishing it. The caller must impose a timeout, particularly
for projects containing scripts. Original Lua retains filesystem/OS access: this is a
local reference tool for trusted projects, not a sandbox or a web runtime.

This stage calls original LoadState, optional Getdblist/Filldb, generated or selected-dataset qz coordinates,
and CalcReflectivity<double>/CalcAsymmetrie<double>, or the serial
CalcEScanEnergyResolution<double>/CalcDicEScan<double> entry points, including original
preparation and postprocessing. It does not reconstruct every GUI GetState/SetOCStrict
path, GUI parallel scheduling or fit workflows. Original non-Borland Lua callbacks retain their
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
Another 24 generated-grid cases compare both beam intensities and both asymmetry
definitions across all three algorithms and zero/nonzero exact/fast angular resolution.
Logarithmic diagnostics describe the first beam; every output column is checked by D-23.
Energy coverage adds 36 generated-grid cases and nine measured-grid cases with synthetic
public db/m tables. These cover table-range intersection, per-energy refresh, fixed qz/angle,
energy convolution, both beams/asymmetry definitions, shifted unordered/duplicate measured
coordinates and all three algorithms. Logarithmic diagnostics still describe the first beam.
It does not cover magnetic profiles, scripted scans, GUI parallel scheduling or private
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

The two-beam extension on 2026-10-19 compares 78 cases/43,440 values. Coordinates
and both beam intensities pass D-23, but 196 derived Visnovsky asymmetry values fail
in eight cases; Parratt and Zak pass. Reports include per-column mismatch counts and
the first differing value/reference. The small beam differences are amplified relative
to the derived difference/asymmetry; their arithmetic origin remains under investigation.
The diagnostic correctly reports `acceptancePassed=false` and exits nonzero with
`--require-parity`. The earlier 24-case resolution does not establish asymmetry acceptance.

The derived-asymmetry discrepancy was subsequently resolved on 2026-10-19. Identical
original-loaded tensors first isolated it to WASM arithmetic: native matched all 300
points while WASM failed 32. Matching complex division, sine/cosine reconstruction,
and the pinned native hypot/complex sqrt/log path restores all 78 project variants
(43,440 values) at unchanged D-23. Node and Chromium also check 2,400 derived
asymmetry values independently of their 18,144 passing beam-intensity comparisons.
No quartic branches, Newton steps or tolerance were changed. Full corpus acceptance
remains open.

The energy-scan extension adds 45 public synthetic-table cases. All 123 combined
qz/energy project variants pass unchanged D-23 across 44,610 values. Ten native adapter
checks cover generated table-range intersection, fixed-angle and two-beam output,
measured energy shifts and invalid/nonadvancing grid handling alongside the earlier
qz checks. GUI parallel scheduling and general scripted/private-corpus scans remain open.


The reference now calls the original `erffinit()` before loading a project, matching
GUI, DLL and terminal startup. Without it, segmentation and element-density paths
indexed an uninitialized private lookup table. Public synthetic fixtures cover both
paths; all 11 native adapter tests pass. The original lookup implementation and its
Numerical Recipes dependencies remain confined to the private reference build.

A local 99-project qz execution diagnostic on 2026-10-19 improved from 66 finite
curves and 27 segmentation faults to 93 finite curves with no crashes. Five projects
failed strict table preparation and one exceeded the per-project 10-second limit.
Runs used a disposable copy of the private tree; no private curves were committed.
This checks execution availability, not numerical accuracy or corpus golden acceptance.
The 123 public-project Chromium cases still pass D-23 across 44,610 values.


A follow-up with a 120-second per-project limit completed 94/99 projects with
72,291 finite points and no crashes or timeouts. The previous 10-second timeout
therefore does not establish a calculation failure. The five remaining projects
fail strict table loading: four use element mode without local `.ff` inputs and
omit `usechantlerdatabase`, whose original constructor default is zero; the fifth
uses compound mode without its referenced local `.db` inputs. `ReadElement`
only falls back to built-in Chantler data when that flag is enabled. The adapter
does not enable it or substitute tables from another directory. Complete corpus
references need those input gaps resolved, alongside the remaining preparation
and numerical validation work. No private project names or curves are published.


An initial private Chromium diagnostic imports all 99 unchanged projects and the
optical tables beside each project, then calls real ComputeService qz reflectivity.
The 62 completed curves match the original native reference across 46,600 points
(93,200 coordinate/intensity values) at unchanged D-23, without length mismatches.
First failures for the remaining projects comprise 15 element refresh/preparation,
15 adaptive segmentation, one magnetic profile, four script index errors, one
missing-table input, and one algorithm deferred by D-25. These are first observed
failures; resolving one can expose another. Native reference calls used a disposable
private-tree copy. Private inputs, curves and detailed error messages stay uncommitted.
This diagnostic establishes neither all-project parity nor energy, asymmetry, Lua
or fit acceptance, and it is not connected to CI.


Reference output is now rejected with status 10 when a host-level Lua compilation
or protected execution call fails. The original simulation may otherwise continue
and return a finite curve after reporting a script error. Linker wrappers observe
those statuses without editing the private Lua/legacy implementation; diagnostics
and partial curves remain suppressed. Errors handled inside a running script with
`pcall` or `loadstring` do not trigger rejection. Disabled scripts remain disabled.

The four private `par` index failures above correspond to scripts accessing entries
in projects with no stored script parameters. The original loader also creates an
empty parameter array for these inputs; the web error is not evidence of an import
loss. Earlier finite-reference execution counts did not detect ignored script
errors and must not be interpreted as counts of valid golden curves.


A private adaptive-segmentation diagnostic compares the original lookup with
standard `erf` samples on the identical lookup grid, preserving original lookup
interpolation and the rest of the adaptive calculation. All 15 segmented corpus
projects complete in both variants with matching output lengths. Fourteen exceed
D-23, totaling 17,752 mismatches among 19,586 reflectivity points. Maximum absolute
intensity difference is about 6.67095e-6; maximum log10 difference for positive
pairs is 0.860779 decades. Three projects exceed 0.001 decades and seven exceed
1e-6 decades. These differences are not evidence supporting a rounding-only
tolerance exception. No production replacement or tolerance change is adopted.

The diagnostic uses the hash-verified original source closure, with a temporary
compiler wrapper substituting a translation unit that includes the original
LayerSegmentation.cpp and overrides its initialized lookup samples using
`std::erf`. A linker wrapper intercepts startup initialization. The candidate is
an explicitly modified private diagnostic, not an original golden reference.
Both variants run in a disposable corpus copy. No private source, lookup data or
curves are committed. This measures combined adaptive-path impact; it does not
isolate changes in slice selection from optical values.


The public diagnostic now includes 12 additional mode-2 qz variants with nonzero
Gaussian amplitudes and segmentation disabled. Original CalcMagProfile returns
before profile application in this configuration; Matrix/Zak preparation now
preserves that behavior alongside Parratt. All 135 combined project variants and
51,810 coordinate/intensity values pass D-23. This verifies the disabled-segmentation
branch, not adaptive slicing or actual magnetic-profile application.
