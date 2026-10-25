# Summary window scope and conversion — 2026-10-25

Source trace for S5; D-52 approves the regular overview and excludes the extra
interpolation command for now. Original paths refer to private unchanged `old/reMagX3/` files. The source
is not copied into the maintained app.

## Overview behavior

`client/Unit1.cpp:7919` opens Summary from a captured state, with strict automatic
optical preparation when enabled. `guidll/SummaryForm.cpp::BuildCharts` builds one
small chart for each actual dataset, skipping the original reserved dataset zero.
There is no active-fit-dataset filter: inactive datasets are also included.
It calculates each dataset through the original dataset-error path and retains
measured/calculated curves plus the error multiplied by that dataset's weight.
The error is not an experimental uncertainty or an optimizer regularization term.

Chart type follows dataset content: qz reflectivity/asymmetry/two-beam, energy
reflectivity/asymmetry/two-beam, and originally TEY. D-25 still defers TEY; approving
the Summary window would not approve TEY physics. Unsupported data must be
identified explicitly rather than quietly omitted.

The DFM and handler behavior are:

| Controls | Behavior |
|---|---|
| Window, width/height labels and edits | Grid of initially 200 × 200 charts, with configurable dimensions. |
| Update, resize, scrollbar | Reposition/resize existing charts and scroll the grid. Update calls only FormResize; it does **not** recalculate curves. Opening Summary builds a new calculated snapshot. |
| Scale x-axis | Share the x range within qz charts and separately within energy charts. |
| Scale y-axis | Share the y range among qz charts only, including qz asymmetry. Do not infer that energy charts are included. |
| Show Error | Toggle each weighted dataset-error value in its legend. |
| Copy All Data | Export energy and qz followed by available calculated/measured columns (R, A, Rp, Rm, originally TEY), with dataset separators. |
| Copy All Graphic | Compose all small charts into one clipboard image, including charts beyond the visible scroll area. |

These cover the 14 entries in inventory group `summary`, including the main-menu
entry, form and popup container. The regular overview is in scope under D-52; runtime evidence is recorded below.

## Build const-qz from const-energy

The separate inventory group `summary-conversion-decision` contains this one
command. In `Buildconstqzfromconstenergy1Click`, each existing monochromatic energy
scan supplies a target qz using its first measured qz value. For every monochromatic
qz scan whose range covers that target, the original interpolates its measured
reflectivity and adds a point at that scan's fixed energy to series 2 of the energy
chart. It then sorts the points by descending energy and enables points/coordinates.

This is cross-dataset interpolation, **not** an energy-to-qz unit conversion or a
new reflectivity calculation. It updates the chart only: it does not create a
project dataset, overwrite measurements, or update the Summary's stored numerical
export arrays. Consequently the additional curve appears in the graphic but is
not added to Copy All Data. Repeating the command appends again without clearing
series 2, so duplicate points can accumulate.

`shared/CTable.cpp::WithinRange/Get` relies on ordered coordinates, includes exact
endpoints and uses the ordinary table interpolation. Empty energy qz arrays,
unsorted/duplicate source coordinates, repeated invocation and multiple source
scans at the same energy need defined handling before a port. A correction must
be reviewed under D-29; this audit does not silently normalize or merge data.

## Proposed scope and implementation boundary

The user accepted the regular Summary with the extra interpolation command excluded
for now (D-52). No cross-dataset interpolation semantics are introduced.

If Summary is retained, use a read-only project/table snapshot and the existing
real worker preparation/error machinery via ComputeService. The current aggregate
chi-squared request visits only active datasets and returns a total; it cannot by
itself supply this all-dataset overview or per-dataset measured/calculated results.
A focused extension must preserve original per-dataset preparation, cancellation,
clear errors, stale-result handling and project/undo state. Do not substitute a
single current curve or mock plots for the full requested overview.

Keep layout Update separate from recalculation semantics unless a change is
explicitly agreed. Use existing plot/export primitives and full double values;
clipboard denial must remain visible. Focused checks should cover mixed qz/energy
and inactive datasets, layout/scaling, errors, complete exports, cancellation and
unchanged saved project. Final original-example acceptance remains A5.


## Implementation evidence (D-52)

Tools → Summary uses a dedicated WorkerComputeService request and captures project
and tables when opened. The request reuses strict initial optical preparation,
serial per-dataset error evaluation and temporary Lua sessions; only the Summary
request includes inactive datasets and collects measured/calculated arrays plus
each weighted error. Normal chi-squared and fits keep their existing selection.
The renderer uses uPlot with bounded logarithmic ticks. Coordinates remain in
qz/energy, x ranges are shared within each scan type, and y scaling affects qz
charts only. Log charts exclude nonpositive values from their visible bounds;
all numerical values remain in the data export. All-chart PNG includes legends
and selected errors; clipboard denial is visible. Unsupported TEY fails the
request explicitly. No partial snapshot is published on failure or Stop.

Model/service tests cover inactive data, coordinate preparation, weighted errors,
full-precision exports, table forwarding, cancellation and input isolation.
The maintained app/e2e/summary.spec.ts uses the real WASM engine with public
synthetic mixed datasets and tables, plus a deliberately blocked-worker case.
These are bounded functional checks; full original/user-example review remains
A5. No private corpus or original source was changed.
