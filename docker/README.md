# Optional reproducible build

Local Node/CMake/Emscripten builds remain supported. Docker is a build tool here;
the deliverable is a static site and does not require a container server.

From the repository root, the agreed Compose entry point builds and checks the
same pinned image, then exports a static site to `app/dist`:

```sh
docker compose run --rm build
python3 -m http.server 8000 --directory app/dist
```

On subsequent source changes, use `docker compose run --build --rm build` to rebuild
the image. The export container has no network access and mounts only `app/dist`;
the source/corpus is not mounted. `app/dist/engine.wasm` is a byte-identical alias
of the core at `app/dist/assets/remagx-core.wasm`, retaining AC-1's named artifact.
The runtime uses the module and asset paths supplied by the normal app build.

Alternatively, with Docker Buildx available, export the site and separate native/
WASM artifacts together:

```sh
docker buildx build --platform linux/amd64 \
  --file docker/Dockerfile --output type=local,dest=build/container .
python3 -m http.server 8000 --directory build/container/site
```

To build only committed inputs, instead of current workspace changes, use:

```sh
git archive HEAD | docker buildx build --platform linux/amd64 \
  --file docker/Dockerfile --output type=local,dest=build/container -
```

The `.dockerignore` allowlist excludes the legacy tree, local corpus folders,
credentials, Git metadata, dependencies and previous build output. Do not add
private data to the allowed source directories. No private corpus or original
legacy sources are required or supplied to the container.

The build runs public inventory/reference-gate tests, native CTest, native/WASM
comparisons in Node, app tests, lint and the production build. The existing Pages
workflow independently runs Chromium tests; the container does not install a
browser or claim private-corpus acceptance.

Output:

| Path | Content |
| --- | --- |
| `site/` | Static app including the real WASM engine |
| `native/libremagx_core.so` | Linux library for this container's native toolchain |
| `wasm/` | Real core and JavaScript adapters, separate from the deployed site |
| `toolchain.json` | Exact tool versions reported during the build |
| `LICENSE`, `licenses/` | Distribution licences and third-party source notice |

The official `emscripten/emsdk:6.0.12` multi-platform image is pinned by digest.
That digest fixes g++, libc, CMake and Node along with the SDK; no operating-system
packages are fetched or upgraded during our build. Node is checked as 24.19.0 and
the SDK must match `engine/emscripten.version`. npm dependencies use the committed
lockfile. Only Linux amd64 is currently targeted. This pins build inputs; it does
not claim byte-identical archives or timestamps.

Updating the SDK requires reviewing the new image digest and Node version,
updating the version checks, and passing the optional container workflow and the
normal numerical gates without changing tolerances. The separate
`Optional container build` workflow runs when its build configuration changes,
or manually, and uploads the exported files. It does not deploy or gate Pages.

Docker documents this file-export workflow in
[Export binaries](https://docs.docker.com/build/building/export/).
The upstream image recipe is in the
[emsdk source](https://github.com/emscripten-core/emsdk/blob/35ff8a6d150541276abbc6bae512ca90bcfbe220/docker/Dockerfile).

The sensitive native/WASM matrix math also uses the same pinned source routines,
including exponential evaluation without fused multiply-add contraction. Pinning
only the container image does not eliminate CPU-dependent system-libm dispatch;
the numerical comparisons remain required on the runner CPU.
