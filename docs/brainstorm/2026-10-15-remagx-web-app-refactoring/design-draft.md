# Design draft (for review), reMagX web app

| Area | Proposal |
|---|---|
| Data flow | Project model (TS types + schema validation) → compute Web Worker → Lua scripts → engine.wasm. Results and per-iteration fit progress stream back. Cancel via stop flag; terminate the worker as a fallback. |
| Lua | wasmoon inside the worker, legacy global names (`par`, `energy`, `thickness`, ...). The "before calculation" script runs before every model evaluation (every fit iteration). |
| Storage | Autosave to IndexedDB. Open/save files directly in Chrome/Edge (File System Access API); upload/download in Firefox/Safari. Imported .db/.m/.ff go into a per-browser material library; the periodic table ships as a static asset. |
| Plots | uPlot (fast, log axes, thousands of points). |
| Errors | Legacy error codes (qz > 90°, missing .db, script errors) → clear UI messages; Lua errors with line numbers; .all import report listing ignored/unsupported keys (incl. precision overridden to double). |
| Testing | Native C++ build + golden data = regression gate. The same golden tests run against the WASM build in Node (both builds must give the same numbers). A few Playwright end-to-end tests. |
| Build | Docker: a pinned image with Emscripten + g++ + Node builds engine (native & WASM), app and golden tools; `docker compose run build` / `test`. CI uses the same image. |
| VCS | git repository; legacy `old/` tree and release zips kept out of the main history (archive or Git LFS). |
| Repo layout | `engine/` (C++, native + Emscripten), `app/` (React + Vite), `tools/golden/`, `docker/`, `docs/`. |
