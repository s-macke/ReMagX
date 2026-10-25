# Plot-area and line-fit scope review — 2026-10-25

This source review supports checklist S4. Scope remains undecided. References to
original code are locations in the private unchanged `old/reMagX3/` tree, not
published original implementation code.

## The three chart menu commands

`client/Chart1.cpp:290–292` creates Select Area, Clear Selected Area and Fit
Lorentzian+Step in selected area. These are operational commands, not hidden
experimental buttons from S6.

Selection toggles a mode (`OnMarkArea:498`). A left drag in that mode marks an
x interval; ordinary left dragging uses rectangle zoom instead (`ChartMouseDown:144`,
`ChartMouseMove:60`, `ChartMouseUp:179`). Release orders the endpoints and discards
a zero-width interval. The chart paints a full-height hatched band using linear
or logarithmic x coordinates (`:911`). Clear Selected Area resets the count.
This selection is chart display state, not the project's qz/energy fit window.
The existing web zoom and fit-window controls do not implement these commands.

The line fit (`OnFitLorentzian:1238`) selects inclusive x samples from chart series
index 1, regardless of what that series represents. It is not always measured
reflectivity: other views put optical beta, tensor values or a second beam in
that slot. The implementation fits a Lorentzian plus a constant background and
smooth tanh step using six parameters: peak area, width, center, background,
step height and step steepness. Its objective is an unweighted sum of squared
residuals in the plotted values, not the project's multi-dataset error metric.

The original seeds the center from the selected maximum, uses fixed initial width
and steepness, restricts the center to a narrow interval around that maximum,
and calls its original Simplex repeatedly. It draws the fitted line in series 2
and copies six reported parameters plus real/imaginary line-shape expressions to
the clipboard. It does not create layer fit targets or update layer parameters.
The clipboard uses `activevars`, while the drawn curve uses `vars`; do not assume
the two optimizer snapshots are equivalent without checking if this is ported.

A port must use the maintained clean-room optimizer through ComputeService, not
copy the original optimizer (D-12/D-32). Empty selections, zero width, negative
background bounds, cancellation and a consistent final result require explicit
handling: the original checks whether the entire series is empty, but can still
read `y.last()` when the selected interval contains no samples. Merely adding a
menu command would not complete the feature.

## Four unrelated multi-chart event records

The initial inventory group incorrectly described the following assignments as
linked chart-area interaction:

- `client/Chart1.cpp::event:a5cf93c3305a047f:1`
- `client/Chart1.cpp::event:158f588639a63a8f:1`
- `client/Chart1.cpp::event:02712c6b7660c6d8:1`
- `client/Chart1.cpp::event:4386716aee1f7b18:1`

They wire the four `TMultiChart` mouse-down handlers at lines 1015–1018. The bodies
at 1110–1145 only switch `activeChart`, remove the previous border, highlight the
selected chart and redraw. They do not select an x interval or fit anything.
Search of the current client/guidll C++ sources and headers found the class
implementation/declaration but no instantiation; this is source evidence of no
located caller, not a user-approved exclusion.

These four IDs now have their own `multichart-activation-decision` group, retaining
deferred/decision status. The three menu IDs remain `plot-area-decision`:

- `client/Chart1.cpp::item:dd8adcda0dd7dce5:1`
- `client/Chart1.cpp::item:c02a07f1e65563c0:1`
- `client/Chart1.cpp::item:50ecd49ed4da6b45:1`

No ID is dropped or marked ported by this correction. Multi-chart activation is
not established by the Summary window either; that separate scope is S5.

## Decision boundary

Asked whether to exclude the three additional plot commands for this release
(recommended), keep area selection only, or implement both area selection and
the line fit. Ordinary layer fitting, plot navigation and exports remain in scope
under every choice. No response is assumed. The four separate multi-chart
activation records also remain a scope decision; approving exclusion of the
three menu commands alone does not decide those records.

On approval, update spec, decision journal, checklist and relevant inventory IDs
together. An implementation needs focused selection/linear-log/empty-data and
worker-fit/cancellation/result checks. An exclusion needs only a documented scope
record. S4 remains unchecked until its included records are explicitly resolved.
