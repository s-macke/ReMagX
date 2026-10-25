# Production capability audit — 2026-10-25

Checklist I4 replaces vague remaining-core/table/fit claims with explicit routes
and follow-ups. This is a source/integration-evidence audit, not final numerical
acceptance. Existing evidence is reused; no private corpus or numerical suite was
rerun for this document. Decisions and acceptance remain in AGENTS.md.

## Worker and numerical core

[worker.ts](../../app/src/compute/worker.ts) starts the real runtime.
[realWorkerRuntime.ts](../../app/src/compute/realWorkerRuntime.ts) supplies the actual
WASM functions, standard double error-function lookup, prepared table sessions,
optimizer and fit-error adapters.
[realEngine.ts](../../app/src/compute/realEngine.ts) dispatches the product requests.

| Request/workflow | Production route | Existing focused evidence | Remaining home |
|---|---|---|---|
| qz/energy, ordinary/two-beam/asymmetry | realCalculation; Parratt/Visnovsky/Zak request and scan preparation; native project_calculation | test-real-service.mjs; test-native-terminal.mjs; test-native-fit-curves.mjs | A2 |
| Angular/energy convolution, qz⁴, polarization correction, averaging | qzEnergyResolution, datasetPostprocessing; native core/project calculation | qzEnergyResolution/parrattResult tests; native terminal comparisons | A2 |
| Adaptive compound layers and conversion | segmentedCalculation, segmentedCompoundStack, realLayerList; native project_segmentation | segmentedCompoundStack/realLayerList tests; e2e segmentation; actual-WASM service checks | S2, A2 |
| Element calculation/conversion/density | elementLayers, refreshElementOptics, realDensityProfiles; native project_elements | realDensityProfiles tests; e2e densityProfiles; native terminal/element-tensor gates | S2, A2 |
| Optical/magnetic profiles | realDepthProfile and segmented preparation | realDepthProfile tests; production workflow evidence in checklist history | S1/S3, A2 |
| Layer/element optical spectra and scattering factors | realSpectrum, compoundSpectrum, elementSpectrum through real service | realSpectrum tests; e2e layerSpectrum/scatteringFactors; original synthetic spectrum evidence | A2 |
| Database updates/dielectric tensors | realDatabaseValues, realTensor; optical refresh and persisted tensor workspaces | realDatabaseValues tests; e2e databaseValues/tensorViews; D-45 actual-worker checks | A2 |
| Lua execution and hooks | executeScript/createProjectScript; native ProjectScriptHook | Lua API audit; test-native-lua.mjs and scripted calculation/fit gates | I3, A5 |
| Fits and chi-squared | realFit/projectDatasetError; native ProjectFitObjective/run_project_fit | realFitParameters/fitRegularization tests; fit-space/parameters/curves/start native gates | I5, A3 |
| Material-to-element editing | materialToElements worker request and pure model conversion | materialElements/multilayer conversion tests and e2e | A5 |

Runtime rejection of an unavailable injected test capability is not proof of a
missing production kernel. The production runtime actually supplies the numerical
callbacks above. Conversely, a `ported` inventory label alone does not prove
runtime or corpus parity.

## Optical table formats

Original `CMaterialConstants::ReadFiles/Getdb/Getff` loads three compound and three
element formats. All six have current parser, storage and preparation routes:

| Format | Data | Web consumption | Native consumption |
|---|---|---|---|
| .db | delta/beta | refreshOpticalConstants / scriptOptics | project_calculation / project_lua |
| .m | magnetic delta/beta | Same, companion lookup | Same |
| .e | 9 complex dielectric components | Same, tensor override | Same |
| .ff | scalar element f1/f2 | refreshElementOptics / scriptFactors | project_elements / project_lua |
| .ffm | magnetic element factors | Same, companion lookup | Same |
| .F | 9 complex scattering components | refreshElementOptics, selected-element assignment | project_elements, selected-element assignment |

Web parser: [tables.ts](../../app/src/import/tables.ts). Native parser/loader:
[optical_tables.cpp](../../engine/src/optical_tables.cpp). Prepared native lookup
is used for production interpolation. Empty/range behavior differs by primary
versus companion and is intentionally preserved. `element.setf` reads companion
cursors but writes scalar factors only; full .F refresh is D-45, not a new setf
meaning. The recent 15-case native/actual-WASM and three-count Chromium checks
cover the corrected assignment independently of neighbors.

Chantler fallback, local-table precedence and approved Uranium extent are connected
(D-37/D-38); this does not add a separate promise to ship a Henke database. There
is no remaining unnamed optical-table format among the six original loaders.
User/project table quality and complete numerical acceptance remain A1/A2.

## Fit-target mapping

The original `CStateHandler.h` enum has IDs 0–27. The order of `fitTargetKinds` in
[project.ts](../../app/src/model/project.ts) matches them; both importers use that
mapping. Web writes are in [fitTargets.ts](../../app/src/model/fitTargets.ts) and
[realFitParameters.ts](../../app/src/model/realFitParameters.ts); native writes are
in [project_fit.cpp](../../engine/src/project_fit.cpp).

| IDs | Current target names | Status |
|---|---|---|
| 0–5 | thickness, delta, beta, roughness, deltaMag, betaMag | Implemented layer mapping |
| 6–8 | angularResolution, intensityScale, qzShift | Implemented dataset/global rules |
| 9–12 | profileDeltaAmplitude, profileBetaAmplitude, profileWidth, profileCenter | Implemented profile mapping |
| 13 | scriptParameter | Implemented; missing original slots deliberately skipped, retained in candidate/Q |
| 14–16 | elementDensity, elementThickness, elementRoughness | Implemented element + slab mapping |
| 17–18 | betaKramersKronig, deltaKramersKronig | D-25 deferred; currently generic unsupported-target rejection |
| 19–22 | elementF1, elementF2, elementF1Mag, elementF2Mag | Implemented element mapping |
| 23–24 | electronEscapeDepth, electronGain | TEY deferred under D-25; capability handling needs I5 |
| 25 | energyShift | Implemented current-dataset mapping |
| 26–27 | magnetizationGamma, magnetizationPhi | Implemented selected compound-layer mapping |

Thus 24 target kinds are in scope and mapped; four belong to deferred physics.
Bounds, fixed dimensions, candidate ordering and Q regularization are implemented
in both routes. Shared active-dataset versus current-dataset distinctions, selected/
completed Simplex reference events and annealing's saved reference have explicit
implementations and existing tests. Mapping tests do not prove fit quality: A3
retains original-project recovery and optimizer acceptance.

**Concrete gap I5:** electronEscapeDepth currently passes candidate mapping and can
be optimized against ordinary reflectivity even though the calculation does not
implement TEY. electronGain and the two Kramers-Kronig targets fail later with a
generic unsupported-target error. Add consistent, early deferred-feature checks
for these four targets in web and native fit entry paths. Preserve imported rows,
original projects and metadata; do not implement the deferred physics or silently
remove parameters. This follows existing D-25 scope, without a new physics choice.

**I5 resolution (2026-10-25):** Implemented early rejection in
[fitCapabilities.ts](../../app/src/model/fitCapabilities.ts), the real worker and
standalone/optimizer entry paths; native CLI and fit-objective construction share
[project_fit.cpp](../../engine/src/project_fit.cpp)'s validator. Model/worker tests
and [the focused native CLI gate](../../app/scripts/test-native-fit-capabilities.mjs)
cover both optimizers, named errors, unchanged input and supported-fit recovery.
The historical finding above is resolved; final fit acceptance remains A3.

## Magnetic-profile composition

`segmentedMagneticProfiles.ts` maps prepared midpoints, stored-layer density weights,
Gaussian/spline inputs and initial magnetic values into the real mixed-profile
kernel. `profileCombination === 'sum'` selects additive application; otherwise it
selects multiplicative/coupled application. Native `project_segmentation.cpp`
performs the corresponding call to remagx_apply_magnetic_profiles. The original
active-source application changes magnetic scalars, not prepared dielectric tensors.
Stored amplitude/width coupling references are metadata; backup copying behavior
must not be revived.

Existing segmentedMagneticProfiles/segmentedCompoundStack tests, core mixed-profile
checks and actual-WASM service tests cover these composition paths. The spline
first usable knot (S1), invalid binding semantics (S3), single-row conversion (S2)
and full additive/multiplicative numerical review (A2) remain explicit. They are
not another missing magnetic-core extraction task.

## Native command boundary

[terminal.cpp](../../engine/src/terminal.cpp) dispatches -refl, -dicrefl, -fit,
-convert and -v. Both .all and versioned JSON load into the maintained project
library. qz commands handle compound/element preparation and all three solvers;
-fit's dataset path includes energy/mixed scans and optional Lua. -convert uses
the corrected D-42 tensor construction. Installation/dependency/licence evidence
exists. Full command and real-project acceptance remains A5/A2/A3/A4.

There is no promised standalone energy-scan CLI flag in D-35; do not turn that into
an invented new feature. -map depends on the already deferred map feature. Fourier
is excluded and removed (D-44/I1), not unfinished native integration. Native Lua
GetError/array-policy gaps remain I3.

## Inventory cross-check and result

Reviewed relevant `review.json` groups: experiment-controls, fit-controls,
segmentation-actions, element-tools, magnetic-fit-controls, magnetic-profile-editor,
magnetic-profile-spline, compound-spectrum-menu, element-scattering-factors,
element-density-profiles, database-update-actions and element-optical-spectrum-menu.
Their ported UI classifications are consistent with the connected routes above;
original-project acceptance still lives separately in AGENTS.md.

I4's audit is complete with one new named follow-up, I5. Existing I3, S1–S8 and
A1–A5 are retained, not duplicated. This closes only the vague capability audit;
it does not certify that all functionality, numerical results or release criteria
are accepted.
