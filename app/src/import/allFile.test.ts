import { describe, expect, it } from 'vitest'
import defaultAll from '../../test/fixtures/default.all?raw'
import tut1 from '../../test/fixtures/Tut1.all?raw'
import tut2 from '../../test/fixtures/Tut2.all?raw'
import tut3 from '../../test/fixtures/Tut3.all?raw'
import { ImportError, importAllFile, parseAssignments } from './allFile'

describe('parseAssignments (legacy tokenizing)', () => {
  it('removes blanks, skips comments and lines without "="', () => {
    const parsed = parseAssignments('# comment\n layer_d = 6 0 # note\nnot an assignment\r\nqzmax=0.6\r\n')
    expect(parsed.map((a) => [a.key, a.value])).toEqual([
      ['layer_d', '60'],
      ['qzmax', '0.6'],
    ])
  })

  it('keeps script text but cuts it at "#", like the legacy loader', () => {
    const [line] = parseAssignments('scriptline =   x = #t + 1\n')
    expect(line.text).toBe('  x = ')
    expect(line.hadComment).toBe(true)
  })
})

describe('importAllFile', () => {
  it('uses the original local segmentation default when the file omits the model', () => {
    expect(importAllFile('numberofpoints = 2\n').project.calculation.segmentation.scope).toBe('local')
  })

  it('imports the legacy default project (CRLF)', () => {
    expect(defaultAll).toContain('\r\n')
    const { project, report } = importAllFile(defaultAll, 'default.all')
    expect(project.sample.layers).toHaveLength(14)
    expect(project.sample.layers[0]).toMatchObject({ opticalTable: 'Cu', delta: 0.00165, roughness: 5 })
    expect(project.sample.layers[13].opticalTable).toBe('vacuum')
    expect(project.experiment.energy).toBe(777.198)
    expect(project.experiment.qzScan).toMatchObject({ qzMax: 0.6, points: 300 })
    expect(project.experiment.polarization.beam1.pi.im).toBeCloseTo(0.707107, 6)
    expect(project.sample.depthProfileFunctions).toHaveLength(1)
    expect(project.datasets).toHaveLength(0)
    expect(project.activeDatasetIndex).toBeNull()
    expect(report.messages.some((m) => m.text.includes('precision'))).toBe(true)
  })

  it('maps segmentation model IDs to the actual legacy UI and calculation order', () => {
    expect(importAllFile(defaultAll).project.calculation.segmentation.scope).toBe('global')
    for (const content of [tut1, tut2, tut3]) {
      expect(importAllFile(content).project.calculation.segmentation.scope).toBe('local')
    }
    for (const [model, scope] of [[1, 'global'], [2, 'local']] as const) {
      const result = importAllFile(`segmentationmodel = ${model}\n`)
      expect(result.project.calculation.segmentation.scope).toBe(scope)
      expect(result.report.messages.some(message => message.text.includes('segmentation model'))).toBe(false)
    }
  })

  it('reports unrepresented segmentation models and retains explicit fallback behavior', () => {
    const old = importAllFile('segmentationmodel = 0\n')
    expect(old.project.calculation.segmentation.scope).toBe('global')
    expect(old.report.messages.some(message => message.text.includes('model 0') && message.text.includes('interface-product'))).toBe(true)
    const unknown = importAllFile('segmentationmodel = 17\n')
    expect(unknown.project.calculation.segmentation.scope).toBe('local')
    expect(unknown.report.messages.some(message => message.text.includes('model 17'))).toBe(true)
    expect(importAllFile('segmentationmodel = invalid\n').project.calculation.segmentation.scope).toBe('local')
  })

  it('imports the tutorial projects with their measurement data', () => {
    for (const [name, content] of [['Tut1.all', tut1], ['Tut2.all', tut2], ['Tut3.all', tut3]] as const) {
      const { project } = importAllFile(content, name)
      for (const dataset of project.datasets) {
        expect(dataset.columns.qz.length).toBeGreaterThan(0)
        if (dataset.columns.reflectivity) expect(dataset.columns.reflectivity).toHaveLength(dataset.columns.qz.length)
      }
    }
    expect(importAllFile(tut2).project.datasets.length).toBeGreaterThan(0)
  })

  it('accepts LF line endings and invalid UTF-8 bytes', () => {
    const lf = defaultAll.replaceAll('\r\n', '\n')
    expect(importAllFile(lf).project.sample.layers).toHaveLength(14)
    const bytes = new TextEncoder().encode(lf.replace('# Complete Status', '# Kömplete Status'))
    const latin1 = bytes.map((b) => (b === 0xc3 ? 0xf6 : b)) // turn the UTF-8 "ö" into a stray Latin-1 byte
    expect(importAllFile(latin1).project.sample.layers).toHaveLength(14)
  })

  it('reports unknown keys', () => {
    const { report } = importAllFile(defaultAll + 'foo_bar = 1\nfoo_bar = 2\n')
    expect(report.ignoredKeys).toContainEqual(expect.objectContaining({ key: 'foo_bar', count: 2 }))
  })

  it('computes in double whatever precision was saved', () => {
    const extended = importAllFile(defaultAll.replace('precision = 1', 'precision = 3'))
    const double = importAllFile(defaultAll)
    expect(extended.project).toEqual(double.project)
    expect(extended.report.messages.find((m) => m.text.includes('precision = 3'))).toBeDefined()
  })

  it('switches Levenberg-Marquardt projects to Simplex and says so', () => {
    const { project, report } = importAllFile(defaultAll.replace('fitalgorithm = 0', 'fitalgorithm = 1'))
    expect(project.fit.algorithm).toBe('simplex')
    expect(report.messages.some((m) => m.level === 'warning' && m.text.includes('Levenberg-Marquardt'))).toBe(true)
  })

  it('maps legacy fit variables to named targets with the legacy first step', () => {
    const text = `${defaultAll}
fitvariableversion = 1
 fit_variable = 1
  fit_id = 3
  fit_additional_id = 2
  fit_element_id = -1
  fit_value = 4
  fit_lower_boundary = 0
  fit_upper_boundary = 10
`
    const { project } = importAllFile(text)
    expect(project.fit.parameters).toEqual([
      { target: 'roughness', index: 2, elementIndex: null, value: 4, step: 0.2, lowerBound: 0, upperBound: 10 },
    ])
  })

  it('maps the legacy active dataset index past the placeholder dataset', () => {
    const text = `fileversion = 1
energy = 900
layerversion = 3
 layer = 0
 layer = 1
measurementdataversion = 2
datasetnumber = 1
 datasettitle = first scan
 dataset_qz = 0.1
 dataset_R0 = 0.5
datasetnumber = 2
 datasettitle = empty
activedatasetindex = 1
`
    const { project, report } = importAllFile(text)
    expect(project.datasets.map((d) => d.title)).toEqual(['first scan'])
    expect(project.activeDatasetIndex).toBe(0)
    expect(report.messages.some((m) => m.text.includes('"empty" has no data points'))).toBe(true)
  })

  it('rejects unsupported legacy format versions with a clear error', () => {
    expect(() => importAllFile('fileversion = 2\n')).toThrow(ImportError)
    expect(() => importAllFile('layerversion = 1\n')).toThrow(/Layer format version 1/)
  })
})


it('reports retained unterminated assignments that the original loader ignores', () => {
  const prefix = 'fileversion = 1\nenergy = 640\n'
  const { project, report } = importAllFile(prefix + 'energy = 700')
  expect(project.experiment.energy).toBe(700)
  expect(report.messages).toContainEqual(expect.objectContaining({ level: 'warning', line: 3,
    text: expect.stringContaining('no terminating newline') }))
  for (const suffix of ['energy = 700\n', '# energy = 700', '']) {
    expect(importAllFile(prefix + suffix).report.messages.some(message => message.text.includes('no terminating newline'))).toBe(false)
  }
})

it('reports object prototype names as unknown legacy keys', () => {
  const { report } = importAllFile('__proto__=1\nconstructor=2\ntoString=3\n__proto__=4\n')
  expect(report.ignoredKeys).toEqual([
    { key: '__proto__', count: 2, firstLine: 1 },
    { key: 'constructor', count: 1, firstLine: 2 },
    { key: 'toString', count: 1, firstLine: 3 },
  ])
})
