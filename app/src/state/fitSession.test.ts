import { mergeFitResult } from '../model/mergeFitResult'
import { expect, it } from 'vitest'
import { createDefaultProject, createDepthProfileFunction } from '../model/defaults'
import { applyFitValues, createFitParameter } from '../model/fitTargets'
import { initialState, reducer, type Action, type FitEvent } from './appState'

function fitting() {
  const state = initialState()
  state.project.fit.parameters = [createFitParameter(state.project, 'thickness', 2, null)]
  return reducer(state, { type: 'beginFit', parameters: state.project.fit.parameters })
}

it('discards late progress, values, errors and pause flags after structural edits, even after undo', () => {
  const start = fitting()
  let state = reducer(start, { type: 'fitEvent', epoch: start.fitEpoch, event: { type: 'setFitStatus', fitStatus: { values: [51], iteration: 2 } } })
  state = reducer(state, { type: 'insertLayer' })
  expect(state.fitStatus.running).toBe(false)
  expect(state.fitStatus.values).toBeNull()
  expect(state.fitInvalidations).toBe(1)
  state = reducer(state, { type: 'undo' })
  const events: FitEvent[] = [
    { type: 'setFitStatus', fitStatus: { values: [99], iteration: 7, message: 'late error' } },
    { type: 'updateProject', update: project => applyFitValues(project, start.project.fit.parameters, [99]) },
    { type: 'setCalculationPaused', paused: true },
    { type: 'appendDebug', lines: ['stale callback'] },
  ]
  for (const event of events) expect(reducer(state, { type: 'fitEvent', epoch: start.fitEpoch, event })).toBe(state)
  expect(state.project.sample.layers[2].thickness).toBe(60)
})

it('keeps ordinary edits and accepts valid fit results as an undoable change', () => {
  const start = fitting()
  let state = reducer(start, { type: 'updateLayer', index: 5, patch: { roughness: 9 } })
  expect(state.fitEpoch).toBe(start.fitEpoch)
  expect(state.fitStatus.running).toBe(true)
  state = reducer(state, { type: 'fitEvent', epoch: start.fitEpoch,
    event: { type: 'updateProject', update: project => applyFitValues(project, start.project.fit.parameters, [57]) } })
  expect(state.project.sample.layers[2].thickness).toBe(57)
  expect(state.project.sample.layers[5].roughness).toBe(9)
  state = reducer(state, { type: 'undo' })
  expect(state.project.sample.layers[2].thickness).toBe(60)
  expect(state.project.sample.layers[5].roughness).toBe(9)
})

it('invalidates profile, element, script and fit-target structure changes and same-sized project loads', () => {
  const actions: Action[] = [
    { type: 'loadProject', project: createDefaultProject(), fileName: 'replacement.json' },
    { type: 'updateProject', update: p => ({ ...p, sample: { ...p.sample, mode: 'element' } }) },
    { type: 'updateProject', update: p => ({ ...p, sample: { ...p.sample, depthProfileFunctions: [createDepthProfileFunction()] } }) },
    { type: 'updateProject', update: p => ({ ...p, scripts: { ...p.scripts, parameters: [1] } }) },
    { type: 'updateProject', update: p => ({ ...p, fit: { ...p.fit, parameters: [{ ...p.fit.parameters[0], index: 3 }] } }) },
  ]
  for (const action of actions) {
    const start = fitting()
    const state = reducer(start, action)
    expect(state.fitEpoch).toBeGreaterThan(start.fitEpoch)
    expect(state.fitStatus.parameters).toBeNull()
    expect(state.fitInvalidations).toBe(1)
  }
})

it('rejects old evaluation and fit callbacks after a newer session starts', () => {
  const first = fitting()
  const second = reducer(first, { type: 'beginFit', parameters: null })
  expect(reducer(second, { type: 'fitEvent', epoch: first.fitEpoch, event: { type: 'setFitStatus', fitStatus: { running: false, evaluating: false, chi2: 999 } } })).toBe(second)
  const loaded = reducer(second, { type: 'loadProject', project: createDefaultProject(), fileName: 'new.json' })
  expect(loaded.fitStatus.evaluating).toBe(false)
  expect(reducer(loaded, { type: 'fitEvent', epoch: second.fitEpoch, event: { type: 'setFitStatus', fitStatus: { chi2: 999 } } })).toBe(loaded)
})

it('invalidates dataset replacement and slab edits but permits dataset metadata edits', () => {
  let start = fitting()
  start.project.datasets = [{ title: 'data', comment: '', sourceFile: '', energy: 800, energyShift: 0,
    angularResolution: 0, intensityScale: 1, intensityOffset: 0, qzShift: 0, errorWeight: 1,
    polarization: start.project.experiment.polarization, active: true, columns: { qz: [0.1], reflectivity: [0.01] } }]
  start.project.activeDatasetIndex = 0
  const metadata = reducer(start, { type: 'updateProject', update: p => ({ ...p, datasets: [{ ...p.datasets[0], comment: 'edited' }] }) })
  expect(metadata.fitEpoch).toBe(start.fitEpoch)
  const replaced = reducer(start, { type: 'updateProject', update: p => ({ ...p, datasets: [{ ...p.datasets[0], columns: { qz: [0.2], reflectivity: [0.03] } }] }) })
  expect(replaced.fitStatus.running).toBe(false)
  start = fitting()
  start.project.sample.mode = 'element'
  start.project.sample.elementProfiles = [{ element: 'Co', f1: 1, f2: 0, f1Mag: 0, f2Mag: 0,
    slabs: Array.from({ length: 3 }, () => ({ thickness: 10, density: 1, roughness: 2 })) }]
  expect(reducer(start, { type: 'insertLayer' }).fitStatus.running).toBe(false)
})


it('merges real dataset fit updates as one undoable change while preserving concurrent metadata', () => {
  const start = fitting()
  start.project.datasets = [0, 1].map(index => ({ title: `data ${index}`, comment: '', sourceFile: '', energy: 640,
    energyShift: 0, qzShift: 0, angularResolution: 0, intensityScale: 1, intensityOffset: 0, errorWeight: 1,
    polarization: start.project.experiment.polarization, active: true, columns: { qz: [.1], reflectivity: [.01] } }))
  start.project.activeDatasetIndex = 0
  start.project.fit.parameters = [createFitParameter(start.project, 'intensityScale', null, null)]
  const edited = reducer(start, { type: 'updateProject', update: project => ({ ...project,
    datasets: project.datasets.map(data => ({ ...data, comment: 'concurrent edit' })) }) })
  const fitted = { project: structuredClone(start.project), values: [2], chi2: 0, iterations: 10, stopped: false,
    datasetUpdates: [{ index: 0, values: { intensityScale: 2 } }, { index: 1, values: { intensityScale: 2 } }] }
  fitted.project.activeDatasetIndex = 1
  const complete = reducer(edited, { type: 'fitEvent', epoch: start.fitEpoch, event: {
    type: 'updateProject', update: current => mergeFitResult(current, start.project, fitted) } })
  expect(complete.project.datasets.map(data => data.intensityScale)).toEqual([2, 2])
  expect(complete.project.activeDatasetIndex).toBe(0)
  expect(complete.fitEpoch).toBe(start.fitEpoch)
  const undone = reducer(complete, { type: 'undo' })
  expect(undone.project.datasets.map(data => data.intensityScale)).toEqual([1, 1])
  expect(undone.project.datasets.every(data => data.comment === 'concurrent edit')).toBe(true)
})

it('clears worker previews on invalidation and ignores previews from old fit sessions', () => {
  let state = fitting()
  state = reducer(state, { type: 'beginFit', parameters: state.project.fit.parameters, workerPreviews: true })
  const epoch = state.fitEpoch
  const preview = { datasetIndex: 0, scan: 'qz' as const, beams: 'monochromatic' as const,
    qz: [.1], reflectivityPlus: [.01], reflectivityMinus: [0], asymmetry: [0] }
  state = reducer(state, { type: 'fitEvent', epoch, event: { type: 'setFitStatus', fitStatus: { datasetPreview: preview } } })
  expect(state.fitStatus.workerPreviews).toBe(true)
  expect(state.fitStatus.datasetPreview).toEqual(preview)
  state = reducer(state, { type: 'insertLayer' })
  expect(state.fitStatus.datasetPreview).toBeUndefined()
  expect(state.fitStatus.workerPreviews).toBe(false)
  expect(reducer(state, { type: 'fitEvent', epoch, event: { type: 'setFitStatus', fitStatus: { datasetPreview: preview } } })).toBe(state)
  const next = reducer(state, { type: 'beginFit', parameters: null })
  expect(next.fitStatus.datasetPreview).toBeUndefined()
  expect(next.fitStatus.workerPreviews).toBe(false)
})


it.each(['addOpticalTables', 'clearOpticalTables', 'restoreOpticalTables'] as const)('invalidates fit and chi2 callbacks on %s without project undo', type => {
  for (const evaluating of [false, true]) {
    const start = evaluating ? reducer(fitting(), { type: 'beginFit', parameters: null }) : fitting()
    const action: Action = type === 'clearOpticalTables' ? { type } : type === 'restoreOpticalTables'
      ? { type, tables: [], error: null } : { type, tables: [] }
    const next = reducer(start, action)
    expect(next.fitInvalidations).toBe(start.fitInvalidations + 1)
    expect(next.fitStatus.running).toBe(false)
    expect(next.fitStatus.evaluating).toBe(false)
    expect(next.project).toBe(start.project)
    expect(next.history).toBe(start.history)
    expect(reducer(next, { type: 'fitEvent', epoch: start.fitEpoch,
      event: { type: 'setFitStatus', fitStatus: { chi2: 999 } } })).toBe(next)
  }
})
