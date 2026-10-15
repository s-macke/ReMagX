# ReMagX (web)

Browser-local rewrite of ReMagX, a program for simulating and fitting (resonant magnetic) X-ray
reflectivity of thin-film multilayers. The UI is React + TypeScript; numerics will run as
WebAssembly compiled from the C++ core, in double precision.

Status: early development. The UI is being built first against a mocked compute interface.

## Development

```sh
cd app
npm ci
npm run dev     # local dev server
npm test        # unit tests
npm run build   # static site in app/dist
```

Every push to `main` builds `app/` and publishes it to GitHub Pages
(`.github/workflows/pages.yml`).

## Documentation

- `docs/analysis/legacy-reMagX3-analysis.md`: analysis of the legacy ReMagX 2.6 code
- `docs/brainstorm/2026-10-15-remagx-web-app-refactoring/spec.md`: design spec
- `docs/brainstorm/2026-10-15-remagx-web-app-refactoring/decisions.md`: decision journal

## License

GPL-3.0, see `LICENSE`.
