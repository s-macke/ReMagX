import { expect, it } from 'vitest'
import { initialState, reducer } from './appState'
import { createDefaultProject } from '../model/defaults'

it('restores only the untouched startup project', () => {
  const source = initialState()
  const project = createDefaultProject()
  project.sample.layers[1].thickness = 41
  const action = { type: 'restoreAutosave' as const, source, project, fileName: 'recovered.json' }
  const restored = reducer(source, action)
  expect(restored.project).toBe(project)
  expect(restored.fileName).toBe('recovered.json')
  expect(restored.savedProject).not.toBe(project)
  const edited = reducer(source, { type: 'updateLayer', index: 1, patch: { thickness: 123 } })
  const undone = reducer(edited, { type: 'undo' })
  const loaded = reducer(source, { type: 'loadProject', project: source.project, fileName: source.fileName })
  const saved = reducer(source, { type: 'markSaved', project: source.project, fileName: 'chosen.json', session: source.fileSession })
  for (const current of [edited, undone, loaded, saved]) expect(reducer(current, action)).toBe(current)
})
