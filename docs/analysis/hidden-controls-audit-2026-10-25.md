# Hidden-control scope review — 2026-10-25

Checklist S6 covers all ten IDs in inventory group `hidden-tools-decision`:
eight controls and two runtime event assignments. This is an item-by-item source
review, not approval to remove or implement any of them. No classifications or
runtime behavior change in this audit.

Source locations refer to the unchanged private `old/reMagX3/` tree. The table
contains metadata and behavior summaries, not original implementation code or
research data. Numbered items provide stable choices for the scope decision.

| Item | Inventory control (source and component path) | Active source evidence | Proposed release handling |
|---|---|---|---|
| H1 | `client/AdaptiveLayerSegmentationForm.dfm::Frame6/GroupBox4/Button23` | Hidden button, runtime wiring at `client/Unit1.cpp:359`; `Button23Click:5109` obtains state only. Its density-plot experiment is commented out. | Exclude this test button; keep normal segmentation/profile workflows. |
| H2 | `client/MeasurementParamsFrame.dfm::Frame17/Edit1` | Hidden, disabled numeric field. `Unit1.cpp:1964` reads it into norder; `:4317` displays it. Default is zero (`shared/CStateHandler.h:311`). The energy wrapper can mix ordinary and doubled-energy reflectivity using this coefficient (`shared/RechenHilfe.h:1235`, called by `server/dllbinding.c:223–235`). | Exclude the additional harmonic-contamination setting from this release; retain standard energy scans and resolution. This requires a real scope decision, not a no-op classification. |
| H3 | `client/Unit1.dfm::Form1/Button1` | Hidden button; `Unit1.cpp:6827` mutates particular element/slab indices, repeatedly calculates two curves and saves a GIF to a fixed filename. Requires a specific stack shape; not a generic export dialog. Other speculative code below the active routine is commented out/unreachable. | Exclude the hard-coded experiment; retain normal plot image/data export. |
| H4 | `client/Unit1.dfm::Form1/ButtonTest` | Hidden button; `ButtonTestClick:7068` has no active statements after comments are removed. The old sensitivity experiment is inactive. | Exclude the inactive button. |
| H5 | `client/Unit1.dfm::Form1/ButtonAnalyze` | Hidden button; `ButtonAnalyzeClick:7145` calculates/draws a qz curve, applies qz⁴ to interior samples, finds adjacent local extrema, and logs 2π divided by successive extrema spacing. The file-writing block follows an unconditional return and is unreachable. | Exclude this experimental fringe-spacing thickness estimate unless explicitly requested. It is not the separate Select Area / Fit Lorentzian+Step workflow (S4). |
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

Recommendation: exclude all eight controls and the two associated event records
from this release, keeping the supported workflows identified above. If the user
wants H2 or H5, define and implement those as explicit features; if H3 is wanted,
first replace its hard-coded experiment with an agreed general workflow. The
choice remains pending and S6 stays unchecked.

After approval, append the decision, update spec/checklist and inventory together,
and verify that all ten IDs receive the approved disposition. No numerical test
run is needed for a pure exclusion record; an implemented feature requires its
own focused checks. Existing final numerical/workflow acceptance remains open.
