# Legacy UI inventory

This implements the settings/handler completeness gate from D-16, D-17.1 and AC-12.
It needs Python 3.10+ and no packages or Wine. Run from the repository root:

```sh
tools/inventory/check
python3 -m unittest discover -s tools/inventory -p 'test_*.py'
python3 tools/inventory/inventory.py report
```

The Pages workflow runs the tests and gate before building/deploying. A clean checkout
uses the committed metadata and needs neither the private legacy tree nor research data.

## Sources and extraction

`inventory.json` contains 676 entries extracted from 36 text DFM forms and the immediate
C++ sources and headers in `old/reMagX3/client/` and `guidll/` (116 source files total). It records:

- Every DFM component, its stable object path, class, selected settings/captions and event bindings.
- Every uncommented `Items->Add(...)` call, including runtime expressions and popup-menu handlers.
- Runtime `->On… = …` event assignments, including temporary handler removal.
- Relative source paths, line numbers and SHA-256 hashes for detecting changed source files.

The source directories are deliberately non-recursive: historical copies, build folders,
release bundles, numerical implementations and research projects are outside this UI inventory.
`client/Unit1backup2.cpp` is explicitly excluded as a historical backup. The snapshot contains
UI metadata only, not legacy implementation bodies, images or project data. Legacy identifiers
are retained for traceability as permitted by D-34.

The parser supports nested object/inherited/inline DFM components, wrapped property strings,
string lists, collection/blob properties (skipped unless selected), UTF-8 and Windows-1252.
It ignores C++ comments while preserving strings and parses balanced Add arguments. It does
not preprocess C++ conditionals or execute runtime expressions: conditional calls remain
candidates for review. This is a source inventory, not a proof of every handler's semantics
or runtime reachability. Shared/custom widget internals outside the selected syntax need
inspection when their corresponding feature is ported.

## Review meaning

`review.json` groups **explicit entry IDs** with status, rationale and repository references.
There are no wildcard rules or default classifications. Every ID must appear exactly once.
A snapshot digest also forces review when properties or handlers change without changing IDs.

- **ported**: the described UI behavior has an implementation reference. D-39 production
  uses the real WASM worker; this label still does not certify full numerical parity or
  complete engine acceptance. Current reasons distinguish implemented paths from pending review.
- **dropped**: the rationale cites an existing decision or the agreed Dropped checklist.
- **deferred**: incomplete work, with a phase of `ui`, `engine`, `later`, or `decision`.
  UI and engine entries remain MVP obligations; they are not silently moved out of scope.
  Decision entries need clarification before implementation, not before inventorying them.

Mixed components are conservatively deferred if part of their UI behavior is missing.
For example, the layer grid and context menus exist, but the legacy coupl. column still
needs a scope decision.
The source-level count includes labels and containers; it is not a feature-completion percentage.
AC-12 passing means everything is accounted for, not that the MVP is finished.

## Updating with the private sources

```sh
# Check that the committed snapshot still matches the available source tree.
tools/inventory/check --legacy-root old/reMagX3

# After a deliberate source change, regenerate metadata (never classifications).
python3 tools/inventory/inventory.py generate --legacy-root old/reMagX3
```

Review the diff. Classify added IDs, remove stale IDs and reconsider affected controls/handlers.
After reviewing all changes, set `inventoryDigest` in `review.json` to the digest printed by
`generate`, then run the checks again. Generation never updates the review automatically.

The gate fails for unclassified or duplicate IDs, stale classifications, invalid statuses,
missing reasons/references, missing deferred phases, changed unreviewed snapshots and, when
`--legacy-root` is supplied, source drift. An explicitly requested missing source tree fails;
ordinary CI intentionally validates the committed snapshot rather than pretending to rescan it.

When implementing an inventoried feature, update its group membership/references and AGENTS.md
in the same commit. Existing source IDs must not be marked ported just because a placeholder
or stored project field exists.

## Findings from the initial review (2026-10-16)

- Dataset property editing is partial: title/comment, angular resolution and the two beam
  polarizations are handled in legacy `DataListEditorValidate` but absent from the web editor.
- Profile binding has an `all` choice in legacy runtime construction that the web selector lacks.
- Plot properties include axis tick steps as well as the already listed ranges and styling.
- Summary has sizing, refresh, clipboard, axis-scaling and error actions. Its const-qz-from-energy
  conversion needs scope clarification before implementation.
- Hidden experimental buttons are recorded for a scope decision rather than silently dropped.
- Fit initial-value transfer is already implemented by “Values → table” and “Table → values”.
- Stop and worker lifecycle remain incomplete; the 2-second fallback is not AC-10 compliance.

These findings are reconciled into AGENTS.md. The full per-entry mapping is in `review.json`;
`report` prints a compact group summary.

Worker lifecycle recovery was completed after the initial review; `review.json` now marks
that group ported. Cancellation controls and the 250 ms fit fallback were then completed,
and real blocked-worker tests verify the 1-second threshold. Browser progress, responsiveness
and cancellation timing verification remain outstanding under AC-10.
