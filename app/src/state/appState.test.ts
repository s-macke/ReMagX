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
