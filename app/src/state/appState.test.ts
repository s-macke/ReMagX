import { describe, expect, it } from 'vitest'
import { importAllFile } from '../import/allFile'
import defaultAll from '../../test/fixtures/default.all?raw'
import { initialState, reducer } from './appState'

describe('app state reducer', () => {
  it('loads a project with its import report and selects the first layer', () => {
    const { project, report } = importAllFile(defaultAll, 'default.all')
    const state = reducer({ ...initialState(), selectedLayer: 7 }, { type: 'loadProject', project, fileName: 'default.json', report })
    expect(state.project).toBe(project)
    expect(state.importReport).toBe(report)
    expect(state.selectedLayer).toBe(1)
  })

  it('adds and removes layers at the selection', () => {
    let state = reducer(initialState(), { type: 'selectLayer', index: 3 })
    state = reducer(state, { type: 'insertLayer' })
    expect(state.project.sample.layers).toHaveLength(15)
    expect(state.selectedLayer).toBe(4)
    state = reducer(state, { type: 'removeLayer' })
    expect(state.project.sample.layers).toHaveLength(14)
  })

  it('keeps the view settings separate from the project', () => {
    const before = initialState()
    const state = reducer(before, { type: 'setDisplayMode', displayMode: 'asymmetry' })
    expect(state.displayMode).toBe('asymmetry')
    expect(state.project).toBe(before.project)
  })
})

describe('undo and redo', () => {
  it('undoes and redoes project changes', () => {
    let state = reducer(initialState(), { type: 'updateLayer', index: 2, patch: { thickness: 55 } })
    state = reducer(state, { type: 'updateLayer', index: 2, patch: { thickness: 50 } })
    state = reducer(state, { type: 'undo' })
    expect(state.project.sample.layers[2].thickness).toBe(55)
    state = reducer(state, { type: 'undo' })
    expect(state.project.sample.layers[2].thickness).toBe(60)
    state = reducer(state, { type: 'redo' })
    expect(state.project.sample.layers[2].thickness).toBe(55)
  })

  it('merges quick edits with the same coalesce key into one step', () => {
    let state = initialState()
    for (const name of ['C', 'Cu', 'CuO']) {
      state = reducer(state, { type: 'updateLayer', index: 2, patch: { opticalTable: name }, coalesce: 'table:2' })
    }
    expect(state.history.past).toHaveLength(1)
    state = reducer(state, { type: 'undo' })
    expect(state.project.sample.layers[2].opticalTable).toBe('Cu')
  })

  it('clears the redo stack on a new edit and the history on load', () => {
    let state = reducer(initialState(), { type: 'updateLayer', index: 2, patch: { thickness: 55 } })
    state = reducer(state, { type: 'undo' })
    state = reducer(state, { type: 'updateLayer', index: 3, patch: { thickness: 11 } })
    expect(state.history.future).toHaveLength(0)
    state = reducer(state, { type: 'loadProject', project: state.project, fileName: 'x.json' })
    expect(state.history.past).toHaveLength(0)
  })

  it('does not record view changes', () => {
    const state = reducer(initialState(), { type: 'setDisplayMode', displayMode: 'asymmetry' })
    expect(state.history.past).toHaveLength(0)
  })
})

describe('pausing automatic calculation after Stop', () => {
  it('keeps the project and history, and stays paused through late fit status updates', () => {
    const state = initialState()
    const stopped = reducer(state, { type: 'setCalculationPaused', paused: true })
    expect(stopped.project).toBe(state.project)
    expect(stopped.history).toBe(state.history)
    const settled = reducer(stopped, { type: 'setFitStatus', fitStatus: { running: false, parameters: null, values: null, message: 'Stopped.' } })
    expect(settled.calculationPaused).toBe(true)
    expect(settled.project).toBe(state.project)
  })

  it('resumes on an edit or an explicit scan, including the already selected scan', () => {
    const stopped = reducer(initialState(), { type: 'setCalculationPaused', paused: true })
    expect(reducer(stopped, { type: 'updateLayer', index: 1, patch: { thickness: 123 } }).calculationPaused).toBe(false)
    expect(reducer(stopped, { type: 'setScanKind', scanKind: stopped.scanKind }).calculationPaused).toBe(false)
    expect(reducer(stopped, { type: 'setPlotView', plotView: 'opticalProfile' }).calculationPaused).toBe(false)
    expect(reducer(stopped, { type: 'setDisplayMode', displayMode: 'dichroic' }).calculationPaused).toBe(false)
  })
})
