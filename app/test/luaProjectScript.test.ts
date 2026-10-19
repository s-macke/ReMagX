import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { createLuaRuntime } from '../src/compute/lua/runtime'
import { createProjectScript } from '../src/compute/lua/beforeCalculation'
import { createDefaultProject } from '../src/model/defaults'
import type { RealCalculationEngine } from '../src/model/realCalculation'
import type { Project } from '../src/model/project'

const runtime = createLuaRuntime(fileURLToPath(new URL('../node_modules/wasmoon/dist/glue.wasm', import.meta.url)))
const engine: RealCalculationEngine = {
  calculate: vi.fn(), lookup: vi.fn(), energyScan: vi.fn(), zakQz: vi.fn(), zakEnergy: vi.fn(),
  matrixQz: vi.fn(), matrixEnergy: vi.fn(),
  dielectricTensor: () => ({ values: new Float64Array(18), anisotropic: false }),
}
const state = (project: Project) => ({ layers: project.sample.layers,
  dielectricTensors: project.sample.layers.map(() => null), cursors: new Map() })

it.each(['Default', 'BeforeCalculation'] as const)('executes selected %s bindings with automatic scripts disabled', async name => {
  const project = createDefaultProject()
  project.scripts.enabled = false
  const key = name === 'Default' ? 'default' : 'beforeCalculation'
  project.scripts[key === 'default' ? 'beforeCalculation' : 'default'] = 'error("wrong tab")'
  project.scripts[key] = 'calls = (calls or 0) + 1; thickness[1] = 42; energy = 750; exx_r[1] = 3; print(calls)'
  const before = JSON.stringify(project), messages: string[] = []
  const session = await runtime.createSession()
  try {
    const execute = createProjectScript(name, session, engine, [], text => messages.push(text))
    const result = execute(project, state(project))
    expect(result.project.sample.layers[1].thickness).toBe(42)
    expect(result.project.experiment.energy).toBe(750)
    expect(result.project.scripts).toEqual(project.scripts)
    expect(result.opticalState.dielectricState![1]!.values[0]).toBe(3)
    expect(messages).toEqual(['1'])
    expect(JSON.stringify(project)).toBe(before)
    // Only the selected program is locked for this session.
    const next = structuredClone(result.project)
    next.scripts[key === 'default' ? 'beforeCalculation' : 'default'] = ''
    execute(next, result.opticalState)
    expect(messages).toEqual(['1', '2'])
    next.scripts[key] = ''
    expect(() => execute(next, result.opticalState)).toThrow(`${name} source changed`)
    expect(() => session.getGlobal('calls')).toThrow('closed')
  } finally { session.close() }
})

it.each([
  ['syntax', 'thickness[1] = 42\nprint("unreachable")\nlocal =', 'Default:3', []],
  ['runtime', 'thickness[1] = 42\nprint("before error")\nerror("failed")', 'Default:3', ['before error']],
] as const)('leaves project and prepared state unchanged after a Default %s error', async (_kind, source, diagnostic, output) => {
  const project = createDefaultProject(); project.scripts.default = source
  const opticalState = state(project), before = JSON.stringify(project), opticalBefore = structuredClone(opticalState)
  const session = await runtime.createSession(), messages: string[] = []
  const execute = createProjectScript('Default', session, engine, [], text => messages.push(text))
  expect(() => execute(project, opticalState)).toThrow(diagnostic)
  expect(JSON.stringify(project)).toBe(before)
  expect(opticalState).toEqual(opticalBefore)
  expect(messages).toEqual(output)
  expect(() => session.getGlobal('energy')).toThrow('closed')
  const fresh = await runtime.createSession()
  try {
    project.scripts.default = 'thickness[1] = 17'
    expect(createProjectScript('Default', fresh, engine, [])(project, state(project)).project.sample.layers[1].thickness).toBe(17)
  } finally { fresh.close() }
})
