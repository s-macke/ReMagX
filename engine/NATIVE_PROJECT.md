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
node app/scripts/export-project-schema.mjs --check
node app/scripts/test-native-project.mjs build/engine/project_document_tests
```

`remagx/project_document.hpp` exposes parsing, serialization, JSON-pointer numeric
reads and immutable numeric replacement. A replacement requires an existing
numeric target; it cannot silently create keys or grow arrays. Failed parsing or
editing leaves the original document unchanged. The class handles JSON text;
filesystem transactions belong to the future CLI/file layer.

The parser checks the complete exported version-1 web schema, including nested
field types, choices, numeric bounds, integer constraints, tensor lengths, minimum
layer count and equal lengths of known dataset columns. Immutable edits undergo
the same validation. **Calculation capability and runtime checks remain separate
work.** Schema validity alone does not establish that a solver supports a project.
Unknown members
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
It also compares acceptance of 2,311 synthetic field/boundary mutations against
the actual web validator, including optional fields, nullable indices, all enum
choices, safe integers, array lengths and unknown dataset columns. It does not use
the private corpus or establish native solver parity.

The committed `schema/project-v1.schema.json` is generated from
`app/src/model/project.ts`; CMake embeds it without requiring Node. After changing
the web schema or defaults, run `node app/scripts/export-project-schema.mjs` and
review both generated files. CI checks freshness. The exporter rejects unsupported
schema keywords and unmapped custom refinements; the native interpreter also
rejects unknown schema keywords. Dataset column-length equality is the one
explicit custom extension. The interpreter supports only this exported subset,
not arbitrary third-party JSON Schema documents. Unknown project fields remain
preserved, while the web validator accepts and strips them.
