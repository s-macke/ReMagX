# Pinned standard binary64 error function

Unmodified musl `erf.c` from Emscripten 6.0.12, at
`system/lib/libc/musl/src/math/erf.c`; SHA-256 is recorded in manifest.json.
Its Sun Microsystems permissive copyright/permission notice remains in the file
and is distributed in the public component notices. This is not Numerical Recipes.

Native and WASM builds use the same source and the already pinned binary64 exp.
The compatibility header supplies portable bit access, symbol names and forces
`double_t` to double. No float conversion, output quantization or tolerance change
is introduced. The standard algorithm splits its exponential argument into a high
part and residual to retain accuracy; the residual remains in the expression.
Contraction and fast-math are disabled on both targets. D-41's original lookup
grid/interpolation are unchanged.
