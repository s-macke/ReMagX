# Native project documents

The `remagx_project` C++17 library provides an immutable document boundary for
version-1 `remagx-project` JSON. It has no dependency on the private original tree,
Node or the WASM runtime. It is a component for the pending native CLI, not a
completed terminal or a full native replacement of the web project model.

```sh
cmake -S engine -B build/engine -DCMAKE_BUILD_TYPE=Release
cmake --build build/engine --target project_document_tests --parallel 2
ctest --test-dir build/engine -R '^(project_document|double_precision_gate)$' --output-on-failure
# After app dependencies are installed; validation tooling only, not a runtime dependency:
node app/scripts/test-native-project.mjs build/engine/project_document_tests
```

`remagx/project_document.hpp` exposes parsing, serialization, JSON-pointer numeric
reads and immutable numeric replacement. A replacement requires an existing
numeric target; it cannot silently create keys or grow arrays. Failed parsing or
editing leaves the original document unchanged. The class handles JSON text;
filesystem transactions belong to the future CLI/file layer.

The parser checks the project format/version, top-level field types and active
index representation. **Nested domain/schema validation and calculation
capability checks remain to be implemented natively.** A valid document envelope
alone must never be treated as permission to calculate a project. Unknown members
are retained, including metadata the current engine does not interpret. Duplicate
keys are rejected instead of silently discarding an earlier value. Nesting beyond
256 levels, unescaped NUL, malformed JSON and overflowing numbers fail explicitly;
error messages do not quote input strings or scripts.

All numeric tokens become doubles, matching browser `Number` storage. The parser
preserves integer `-0`, escaped strings and the full range of finite doubles.
Serialization uses a representation that parses back to the same double, without
rounding values to a fixed number of decimal places. Tests compare double bits for
negative zero, subnormals, very small/large values and adjacent representable
numbers; native numeric edits retain unrelated fields and source isolation.

The native parser is the unmodified, hash-pinned MIT-licensed nlohmann/json 3.12.0
single header (see `third_party/nlohmann_json/README.md`). It is built only for
native targets; browser model and WASM numerical assets do not include it.

The cross-language check round-trips the default project and four public legacy
fixtures after import through the existing web model. It verifies every field,
extra metadata and double values, then validates the result with the actual web
schema. It runs in Pages CI after native tests and app dependency installation.
It does not use the private corpus or establish native full-schema/solver parity.
