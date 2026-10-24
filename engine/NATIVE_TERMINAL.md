# Native terminal integration

`remagx-terminal` is a native C++ executable linked to the same numerical core as
WebAssembly. It does not use Node, the browser, private original sources, or the
original optimizer. Command integration is partial; the D-35 checklist item remains
open.

```sh
cmake -S engine -B build/engine -DCMAKE_BUILD_TYPE=Release
cmake --build build/engine --target remagx_terminal --parallel 2
build/engine/remagx-terminal -v
build/engine/remagx-terminal -refl project.json
build/engine/remagx-terminal -dicrefl project.json
```

Input is a validated version-1 JSON project saved by the web app. The supported
calculation path currently requires compound mode, manual optical constants,
Nevot–Croce roughness and no nonempty enabled BeforeCalculation script. Parratt, Matrix and Zak support both complex beams,
analyzers, magnetic/tetragonal settings and exact/fast angular convolution.
Manual preparation rebuilds dielectric tensors from scalar values, as the web
engine does; stored automatic tensor overrides are ignored in manual mode.
Density is not multiplied into already supplied compound optical constants.

Enabled multilayer patterns expand before solver packing, including nested
repetitions, zero repetitions and explicit duplicate substrate/ambient references.
The implicit substrate and ambient are retained. Defined original character
handling is preserved (ignored characters can join digits; a top-level `)` or NUL
terminates parsing). The web parser's safe-integer, depth-128 and 100,000-layer
limits apply; malformed/out-of-range/oversized patterns fail without partial
output. Each repeated row copies all optical values, roughness and local magnetic
directions before Matrix tensor construction.

The terminal preserves the original command's coordinate convention:

- Generated grids have `points` entries from zero through `qzMax`, inclusive;
  `qzMin` is ignored. The web UI uses its separate existing grid convention.
- Dataset grids retain order, duplicates and negative coordinates. The terminal
  adds the saved `qzShift` once, including shifts smaller than 1e-10, matching the
  original terminal's direct addition. No data column or saved project is changed.
- `-refl` prints `qz R`; `-dicrefl` prints `qz Rp Rm`. Output uses the classic locale
  and 17 significant digits, sufficient to recover each double without reducing
  it to measurement precision. There are no headers or progress messages on stdout.

The integrated postprocessing applies qz^4, the pure-pi correction, then the
original moving average. Monochromatic Fourier processing follows these steps
through the existing core transform; its first output column contains depth in
Angstrom and the row count is halved. Dichroic Fourier remains explicitly
unavailable pending the recorded column-semantics decision.

Polarization correction follows the original terminal's **dataset** metadata,
not the solver's experiment settings. A generated grid has the original default
first sigma beam, second pi beam and 10 eV dataset energy. A measured grid uses
the selected dataset's beams and energy (or its per-point energy column). The
terminal adds qzShift but does not apply the saved energyShift to that column.
These conventions can yield surprising corrections; they are preserved rather
than silently replaced with the web UI's preparation behavior. The actual solver
still uses the experiment energy and beams.

Monochromatic energy broadening above 1e-6 eV still rejects; the original dichroic
qz route does not use that energy broadening setting.

Automatic tables, element/segmented preparation, Lua,
legacy `.all` import, energy scans, `-fit` fitted-project output, filesystem
transactions and `-convert` remain to be integrated. `-map` follows the separately
agreed map implementation. Unsupported commands/settings report an error; they
never run a simplified calculation while silently ignoring active preparation.
The original terminal's broken `.db`/`.m` → `.e` conversion is a separate pending
decision and is not implemented here.

An invalid invocation returns exit code 2. Input/calculation failures return 1
and report a bounded diagnostic to stderr, without scientific output. The entire
curve and its text representation are prepared before stdout is written. An OS
output failure can still interrupt that final write; this is not transactional
filesystem output. Valid calculations and `-v`/`--help` return 0. Original input
files are opened read-only.

Validation uses public synthetic projects only:

```sh
node app/scripts/test-native-terminal.mjs build/engine/remagx-terminal build/wasm
```

124 cases compare 1,978 output values with actual WASM through the production web
preparation at unchanged D-23 tolerance. They cover all three solvers, both modes,
complex beams, analyzers, both angular convolution paths, tetragonal/nonmagnetic
settings, qz^4, polarization correction with independent dataset/solver metadata,
monochromatic Fourier, averaging, shifted/unsorted/repeated coordinates and eight
multilayer patterns across all solvers and both output modes. Dedicated native
parser tests cover limits, empty groups, nested patterns, ignored characters,
embedded NUL and recovery. Further
checks cover explicit unsupported operations, malformed schema, invalid qz,
numerical overflow, missing input, input preservation and successful recovery.
The existing tetragonal/magnetization-off singularity at zero incidence is checked
against the WASM numerical-error status; it is not hidden by shifting coordinates
or substituting a result. Native/web schema and bit-exact serialization checks
remain separate. These checks establish the implemented integration, not full
original-terminal or full-corpus acceptance.
