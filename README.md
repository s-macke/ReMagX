# ReMagX (web)

Browser-local rewrite of ReMagX, a program for simulating and fitting (resonant magnetic) X-ray
reflectivity of thin-film multilayers. The UI is React + TypeScript; numerics run as
WebAssembly compiled from the C++ core, in double precision.

**Try it:** https://s-macke.github.io/ReMagX/ (built automatically from `main`)

> **Engine preview:** calculations use the real C++ core compiled to WebAssembly,
> entirely in the browser. Full original-project validation is still in progress.
> Adaptive segmentation, depth profiles and element calculations use a full-double
> standard error-function lookup; legacy single-precision rounding is not reproduced.
> Unsupported operations report errors; there is no mock fallback.

Project website of the original ReMagX: https://remagx.org/

## Development

Build the core with the Emscripten version pinned in `engine/emscripten.version`
(and its environment activated):

```sh
emcmake cmake -S engine -B build/wasm -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF
cmake --build build/wasm --parallel 2
cd app
npm ci
npm run dev     # local dev server
npm test        # unit tests
npm run build   # static site in app/dist
```

`npm run build` packages the core from `build/wasm`; missing assets fail the build.
Set `WASM_DIRECTORY` to use a different core build directory. The dev server uses
the same local assets.

Every push to `main` builds `app/` and publishes it to GitHub Pages
(`.github/workflows/pages.yml`).

An [optional Docker build](docker/README.md) pins the native/WASM toolchain and
exports the static site plus engine artifacts. Local builds do not require Docker.

## Documentation

- `AGENTS.md`: rules for contributors and agents, and the checklist of done and open work
- `engine/NATIVE_PROJECT.md`: native JSON document support and its remaining validation boundaries

- `docs/analysis/legacy-reMagX3-analysis.md`: analysis of the legacy ReMagX 2.6 code
- `docs/brainstorm/2026-10-15-remagx-web-app-refactoring/spec.md`: design spec
- `docs/brainstorm/2026-10-15-remagx-web-app-refactoring/decisions.md`: decision journal

## License

GPL-3.0, see `LICENSE`.

The native `remagx-terminal` now supports JSON projects with manual compound
constants for `-refl`/`-dicrefl` through Parratt, Matrix and Zak. See
[build instructions and current integration limits](engine/NATIVE_TERMINAL.md).
Full terminal command/project support remains in the checklist.
