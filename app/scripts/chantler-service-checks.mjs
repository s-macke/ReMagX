// Public actual-WASM composition checks. Explicit tables use the separately
// verified original stored data; synthetic fits are not original-optimizer goldens.
export async function checkChantlerService(page, asset) {
  const result = await page.evaluate(async asset => {
    const { createDefaultProject, createLayer, createRealComputeService, createSegmentedComputeService } = window.realServiceHarness
    const service = createRealComputeService(), segmented = createSegmentedComputeService()
    const same = (actual, expected) => {
      if (actual.length !== expected.length || actual.some((value, index) => !Number.isFinite(value) ||
        !Number.isFinite(expected[index]) || Math.abs(value - expected[index]) > 1e-15 + 1e-10 * Math.abs(expected[index])))
        throw new Error('Chantler composition mismatch')
    }
    const table = (atomicNumber, name) => {
      const { rows } = asset.elements[atomicNumber - 1]
      return { name, kind: 'ff', energy: rows.map(row => row[0]),
        columns: [rows.map(row => row[1]), rows.map(row => row[2])], warnings: [] }
    }
    const project = createDefaultProject()
    project.sample.mode = 'element'
    project.sample.layers = [createLayer(), createLayer({ thickness: 20 }), createLayer()]
    project.sample.elementProfiles = [{ element: 'Fe', f1: 7, f2: 8, f1Mag: 0, f2Mag: 0,
      slabs: [{ thickness: 0, roughness: 0, density: .08 }, { thickness: 20, roughness: 0, density: .05 },
        { thickness: 0, roughness: 0, density: 0 }] }]
    project.calculation.useChantlerDatabase = true
    project.calculation.automaticOpticalConstants = true
    project.experiment.qzScan = { ...project.experiment.qzScan, points: 60, qzMin: .015, qzMax: .2 }
    project.experiment.energyScan = { ...project.experiment.energyScan, energyMin: 770, energyMax: 780 }
    const imported = [table(26, 'Fe')]
    const explicit = structuredClone(project); explicit.calculation.useChantlerDatabase = false
    const snapshot = JSON.stringify(project), tableSnapshot = JSON.stringify(imported)
    let curves = 0, fits = 0
    try {
      for (const [number, name] of [[26, 'Fe'], [92, 'U']]) {
        const selected = structuredClone(project); selected.sample.elementProfiles[0].element = name
        const selectedExplicit = structuredClone(selected); selectedExplicit.calculation.useChantlerDatabase = false
        const actual = await service.scatteringFactors(selected, { elementIndex: 0, tables: [] })
        const expected = await service.scatteringFactors(selectedExplicit, { elementIndex: 0, tables: [table(number, name)] })
        same(actual.energy, expected.energy); same(actual.first, expected.first); same(actual.second, expected.second)
        if (name === 'U' && actual.energy.length !== 277) throw new Error('Wrong approved Uranium endpoint')
      }
      const disabled = await service.scatteringFactors(explicit, { elementIndex: 0, tables: [] }).then(() => '', error => error.message)
      if (!disabled.includes('Load Fe.ff')) throw new Error('Disabled fallback was silently enabled')
      const local = { name: 'Fe', kind: 'ff', energy: [700, 800], columns: [[12, 13], [1, 2]], warnings: [] }
      const override = await service.scatteringFactors(project, { elementIndex: 0, tables: [local] })
      same(override.energy, local.energy); same(override.first, local.columns[0]); same(override.second, local.columns[1])
      const magnetic = { name: 'Fe', kind: 'ffm', energy: [700, 800], columns: [[.01, .01], [.02, .02]], warnings: [] }
      const refreshed = await service.databaseValues(project, [magnetic])
      same([refreshed.updates[0].firstMag, refreshed.updates[0].secondMag], [.01, .02])
      const scripted = structuredClone(project); scripted.scripts.default = 'Fe:setf(777); f1[0] = f1[0] + 0.25'
      const scriptExplicit = structuredClone(scripted); scriptExplicit.calculation.useChantlerDatabase = false
      const scriptResult = await service.executeScript(scripted, 'Default', undefined, [])
      const scriptExpected = await service.executeScript(scriptExplicit, 'Default', undefined, imported)
      same([scriptResult.project.sample.elementProfiles[0].f1, scriptResult.project.sample.elementProfiles[0].f2],
        [scriptExpected.project.sample.elementProfiles[0].f1, scriptExpected.project.sample.elementProfiles[0].f2])
      for (const algorithm of ['parratt', 'matrix', 'zak']) {
        const current = structuredClone(project); current.calculation.algorithm = algorithm
        const referenceProject = structuredClone(current); referenceProject.calculation.useChantlerDatabase = false
        for (const method of ['calcReflectivity', 'calcAsymmetry', 'calcEnergyScan', 'calcEnergyAsymmetry']) {
          const actual = await segmented[method](current, undefined, [])
          const expected = await segmented[method](referenceProject, undefined, imported)
          for (const key of ['qz', 'energy', 'reflectivity', 'reflectivityPlus', 'reflectivityMinus', 'asymmetry'])
            if (expected[key]) same(actual[key], expected[key])
          curves++
        }
        const reference = await segmented.calcReflectivity(referenceProject, undefined, imported)
        for (const optimizer of ['simplex', 'simplex-annealing']) {
          const fit = structuredClone(current)
          fit.datasets = [{ title: 'Chantler synthetic recovery', comment: '', sourceFile: '', energy: fit.experiment.energy,
            energyShift: 0, qzShift: 0, angularResolution: 0, intensityScale: 1, intensityOffset: 0, active: true,
            errorWeight: 1, polarization: fit.experiment.polarization,
            columns: { qz: reference.qz, reflectivity: reference.reflectivity } }]
          fit.activeDatasetIndex = 0; fit.fit.algorithm = optimizer; fit.fit.occamQ = 0; fit.fit.errorFunction = 'lin-chi2'
          fit.sample.elementProfiles[0].slabs[1].density = .04
          fit.fit.parameters = [{ target: 'elementDensity', index: 1, elementIndex: 0,
            value: .04, step: 0, lowerBound: .02, upperBound: .08 }]
          const before = JSON.stringify(fit)
          const initial = await segmented.calcChi2(fit, undefined, [])
          const result = await segmented.startFit(fit, () => {}, undefined, [])
          if (initial <= 1e-8 || Math.abs(result.values[0] - .05) > 1e-8 || result.chi2 > 1e-14 || result.chi2 >= initial)
            throw new Error(`Chantler density recovery failed: ${algorithm}/${optimizer}`)
          same([await segmented.calcChi2(result.project, undefined, [])], [result.chi2])
          if (JSON.stringify(fit) !== before) throw new Error('Chantler fit mutated input')
          fits++
        }
      }
      if (JSON.stringify(project) !== snapshot || JSON.stringify(imported) !== tableSnapshot) throw new Error('Chantler request mutated input')
      return { curves, fits }
    } finally { service.dispose(); segmented.dispose() }
  }, asset)
  if (result.curves !== 12 || result.fits !== 6) throw new Error('Incomplete Chantler service coverage')
  console.log('Chantler ComputeService: local precedence, flag, magnetic data, Lua, approved Uranium, 12 qz/energy beam comparisons and six density recoveries passed.')
}
