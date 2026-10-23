# The digest pins the SDK, Node, g++, libc and build utilities together.
# This workflow is validated for linux/amd64; other architectures are not claimed.
FROM emscripten/emsdk:6.0.12@sha256:77638e6c215a65f25a704c0c831d5c2463a8c0468a58c6cb82489dbe621dfa05 AS build
WORKDIR /work
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC

COPY app/package.json app/package-lock.json ./app/
RUN npm ci --prefix app --no-audit --no-fund

COPY app ./app
COPY engine ./engine
COPY tools/inventory ./tools/inventory
COPY tools/golden ./tools/golden
COPY docs ./docs
COPY docker ./docker
COPY AGENTS.md LICENSE README.md ./

RUN python3 docker/verify_tools.py \
    && python3 -m unittest discover -s tools/inventory -p 'test_*.py' \
    && tools/inventory/check \
    && python3 -m unittest discover -s tools/golden/legacy -p 'test_*.py'
RUN cmake -S engine -B build/engine -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build/engine --parallel 2 \
    && ctest --test-dir build/engine --output-on-failure
RUN emcmake cmake -S engine -B build/wasm -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF \
    && cmake --build build/wasm --parallel 2 \
    && WASM_MODULE=build/wasm/remagx-core.mjs python3 engine/tests/test_parratt.py build/engine/libremagx_core.so
RUN npm test --prefix app \
    && npm run lint --prefix app \
    && npm run build --prefix app

# Export files, not a web server. The site includes the real WASM engine.
FROM scratch AS artifacts
COPY --from=build /work/app/dist /site/
COPY --from=build /work/build/engine/libremagx_core.so /native/libremagx_core.so
COPY --from=build /work/build/wasm/remagx-core.mjs /wasm/remagx-core.mjs
COPY --from=build /work/build/wasm/remagx-core.wasm /wasm/remagx-core.wasm
COPY --from=build /work/engine/wasm/ /wasm/
COPY --from=build /work/build/toolchain.json /toolchain.json
COPY --from=build /work/LICENSE /LICENSE
COPY --from=build /work/engine/third_party/glibc_math/COPYING.LIB /licenses/glibc-COPYING.LIB
COPY --from=build /work/engine/third_party/glibc_math/README.md /licenses/glibc-source-notice.md
