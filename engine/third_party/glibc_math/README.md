# Reference-compatible scalar math

The unmodified upstream files in this directory come from the GNU C Library,
revision `04e750e75b73957cf1c791535a3f4319534a52fc`:
https://github.com/bminor/glibc/tree/04e750e75b73957cf1c791535a3f4319534a52fc

Files originate in `sysdeps/ieee754/dbl-64/`, except `s_csqrt_template.c`,
`s_clog_template.c` and `mul_split.h` in `math/`, and `COPYING.LIB` at the root.

They retain their upstream copyright notices and identifiers. They are licensed under
LGPL-2.1-or-later (see COPYING.LIB), compatible with this project's GPL-3.0 distribution.
These are public mathematical library sources, not legacy ReMagX or Numerical Recipes
code. The `manifest.json` records every upstream file's SHA-256 digest. CMake verifies
these digests before configuring the WASM build; a native CI test also checks them and
the copy of the licence distributed with the web application.

The Visnovsky quartic can produce nearly coincident roots. Differences of one ULP in
atan2, sin/cos, asin, hypot or complex primitives between native glibc and Emscripten's
math library can then exceed D-23 in full reflectivity and asymmetry curves. The WASM
matrix path uses these pinned implementations to match the native reference's scalar
arithmetic, without changing polynomial branches, Newton passes, eigenvector normalization
or tolerances. The upstream complex sqrt/log templates are instantiated only for double
in the build shims. Native builds retain their C runtime complex primitives.

Matrix division shares the quartic helper's native ratio-scaled arithmetic. WASM complex
exponentials use pinned sine/cosine for finite magnitudes and retain runtime exceptional
handling. This does not improve or replace the original quartic algorithm and does not
claim that all future project/platform discrepancies are resolved.

`compat/` supplies build integration only: distinct symbol names, WASM's little-endian
layout, no glibc symbol aliases, and adaptations for floating-point environment helpers.
WASM always uses round-to-nearest and exposes no floating-point exception flags; native
standalone diagnostics must also run in the default nearest mode. Source arithmetic and
coefficient tables are unchanged. Unused acos/large-angle sections are removed by
the final linker where possible. The library is linked only in WASM; native calculations
continue to use their installed libm. No global math symbols are replaced.

All arithmetic uses C double. The upstream compensation macros also operate on doubles;
there are no alternative precision types. The precision gate scans source, headers and
tables here as well as the maintained engine code. Compile without fast-math or contraction.
The shims are project-maintained code; upstream files must be updated together with the
revision, hashes, licence review and numerical regression evidence.
