# Hidden-control scope review — 2026-10-25

Checklist S6 covers all ten IDs in inventory group `hidden-tools-decision`:
eight controls and two runtime event assignments. The user explicitly excluded
all eight items on 2026-10-27 (D-57). All ten inventory records are now dropped;
no product runtime behavior or original source is changed by this scope record.

Source locations refer to the unchanged private `old/reMagX3/` tree. The table
contains metadata and behavior summaries, not original implementation code or
research data. Numbered items provide stable choices for the scope decision.

| Item | Inventory control (source and component path) | Active source evidence | Approved release handling (D-57) |
|---|---|---|---|
| H1 | `client/AdaptiveLayerSegmentationForm.dfm::Frame6/GroupBox4/Button23` | Hidden button, runtime wiring at `client/Unit1.cpp:359`; `Button23Click:5109` obtains state only. Its density-plot experiment is commented out. | Exclude this test button; keep normal segmentation/profile workflows. |
| H2 | `client/MeasurementParamsFrame.dfm::Frame17/Edit1` | Hidden, disabled numeric field. `Unit1.cpp:1964` reads it into norder; `:4317` displays it. Default is zero (`shared/CStateHandler.h:311`). The energy wrapper can mix ordinary and doubled-energy reflectivity using this coefficient (`shared/RechenHilfe.h:1235`, called by `server/dllbinding.c:223–235`). | Exclude the additional harmonic-contamination setting from this release; retain standard energy scans and resolution. The active behavior is explicitly excluded by D-57. |
| H3 | `client/Unit1.dfm::Form1/Button1` | Hidden button; `Unit1.cpp:6827` mutates particular element/slab indices, repeatedly calculates two curves and saves a GIF to a fixed filename. Requires a specific stack shape; not a generic export dialog. Other speculative code below the active routine is commented out/unreachable. | Exclude the hard-coded experiment; retain normal plot image/data export. |
| H4 | `client/Unit1.dfm::Form1/ButtonTest` | Hidden button; `ButtonTestClick:7068` has no active statements after comments are removed. The old sensitivity experiment is inactive. | Exclude the inactive button. |
| H5 | `client/Unit1.dfm::Form1/ButtonAnalyze` | Hidden button; `ButtonAnalyzeClick:7145` calculates/draws a qz curve, applies qz⁴ to interior samples, finds adjacent local extrema, and logs 2π divided by successive extrema spacing. The file-writing block follows an unconditional return and is unreachable. | Exclude this experimental fringe-spacing thickness estimate. It is not the separate Select Area / Fit Lorentzian+Step workflow (S4). |
| H6 | `client/MagnetizationDirectionFrame.dfm::Frame11/Mag/CheckBox1` | Hidden and disabled Fit checkbox; wired at `Unit1.cpp:351`. `OnMagFitCheckBoxClick:7628` has only commented-out code. | Exclude this inactive global-fit checkbox; retain implemented per-layer direction fitting. |
| H7 | `client/MzFrame.dfm::Frame8/CheckBox11` | Hidden and disabled generic Fit checkbox; no DFM event or active runtime reference found. Separate amplitude/width/center fit controls are active and already implemented. | Exclude this unused checkbox, preserving the individual profile fit controls. |
| H8 | `guidll/MaterialsForm.dfm::MaterialForm/GroupBox1/Button1` | Hidden “Fill Dielectic Tensor” button with no event binding. `MaterialsForm.cpp` populates the displayed tensor but has no handler for this button. | Exclude this unbound button; retain real tensor preparation, database refresh and tensor display. |

The remaining two inventory IDs are not independent features:

- `client/Unit1.cpp::event:abc5ab747d010ff7:1` wires H1.
- `client/Unit1.cpp::event:da8c2ba785fe8675:1` wires H6.

## Important boundaries

H2 has active higher-order energy-scan physics despite its disabled UI. The qz
wrapper's corresponding harmonic mixture is commented out, while its ordinary
energy-resolution integration remains active. Therefore H2 must not be described
as unused merely because a search in the GUI finds a disabled field. No norder
persistence key was found in the active state loader/writer; the field and its
experimental use are separate from the supported imported resolution settings.

H3 and H5 have active code even though their buttons are hidden. Porting them
would require user-facing design and validation; hiding them in the original is
not authority to infer exclusion. H6 also must not be interpreted as a requirement
to fit a nonexistent shared layer index: implemented per-layer magnetization
parameters and current profile fit targets remain independent.

## Accepted decision — 2026-10-27

The user explicitly chose exclusion for H1, H2, H3, H4, H5, H6, H7 and H8.
D-57 records all eight choices and the associated H1/H6 wiring records. All ten
IDs are classified as dropped in the inventory and S6 is checked. The active
H2/H3/H5 behavior is excluded by approval, not misclassified as unused code.
The supported workflows identified in the table remain included.

This is a documentation/inventory-only change: no numerical or browser suite
was repeated, and the prior passing app/lint/build evidence is reused. Inventory
and diff checks verify the disposition. Final numerical/workflow acceptance
A1–A5 remains open.
