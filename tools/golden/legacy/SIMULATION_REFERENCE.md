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

This stage calls original LoadState, optional Getdblist/Filldb, the generated qz grid,
and CalcReflectivity<double>, including original preparation and postprocessing. It does
not reconstruct every GUI GetState/SetOCStrict path, measured-point grids, energy scans,
dichroic entry points, or fit workflows. Original non-Borland Lua callbacks retain their
terminal stub behavior. The system FFTW library is not pinned; Fourier results have not
been validated. Original segmentation helpers remain private reference dependencies,
not cleaned double-only production implementations. No original optimizer implementation,
private source, binary, lookup table or research curve is committed.

Tests establish a finite default curve, a zero-contrast curve, an independent pure-sigma
Fresnel interface comparison at D-23, suppressed missing-file diagnostics, and absence of
optimizer linkage. These do not establish corpus-wide simulation goldens, a cleaned public
native rebuild, WASM whole-project parity, or Wine cross-validation. Those checklist items
remain open.
