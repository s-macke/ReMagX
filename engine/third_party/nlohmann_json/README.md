# JSON for Modern C++ 3.12.0

Unmodified single-header distribution of nlohmann/json, copyright 2013–2025
Niels Lohmann, under the MIT license in `LICENSE.MIT`. This permissive license is
compatible with this project's GPL-3.0 distribution; retain its notice.

- GPL compatibility: https://www.gnu.org/licenses/license-list.html#Expat
- Release: https://github.com/nlohmann/json/releases/tag/v3.12.0
- Header: https://raw.githubusercontent.com/nlohmann/json/v3.12.0/single_include/nlohmann/json.hpp
- License: https://raw.githubusercontent.com/nlohmann/json/v3.12.0/LICENSE.MIT
- Header SHA-256 (also published in the release): `aaf127c04cb31c406e5b04a63f1ae89369fccde6d8fa7cdda1ed4f32dfc5de63`
- License SHA-256: `46a65cffd1ea955132d95a8dd921640714a8d6b537d2e4e482d31145ae95b603`

CMake checks both hashes before configuring native project-document support.
There is no build-time network fetch. This dependency is used by the native
`remagx_project` target only; it is not added to the WASM core or browser bundle.

The upstream generic parser supports multiple numeric types. ReMagX instantiates
its floating-point type as `double` (compile-time checked) and converts integer
tokens to double storage, matching browser `Number`. Integer `-0` is routed
through the parser as `-0.0` to preserve its sign. Serialization uses the shortest
representation that reads back to the same double, with no reduced-precision
formatting or intermediate quantization. The maintained precision gate still
checks ReMagX numerical source; it does not reinterpret generic unused types in
the unmodified third-party header as ReMagX calculation types.
