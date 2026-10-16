import { readFile } from 'node:fs/promises'
import { test, expect } from './fixtures'
import { createDefaultProject } from '../src/model/defaults'
import type { Dataset } from '../src/model/project'

test('dataset properties edit independently, undo, and survive a JSON save', async ({ page }) => {
  const project = createDefaultProject()
  const dataset: Dataset = { title: 'qz scan', comment: '', sourceFile: 'synthetic.dat', energy: 700, energyShift: 0,
    angularResolution: 0, intensityScale: 1, intensityOffset: 0, qzShift: 0, errorWeight: 1,
    polarization: structuredClone(project.experiment.polarization), active: true, columns: { qz: [0.1, 0.2], reflectivity: [0.1, 0.01] } }
  project.datasets = [dataset, { ...structuredClone(dataset), title: 'energy scan', columns: { ...dataset.columns, energy: [700, 701] } }]
  project.activeDatasetIndex = 0
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined })
    localStorage.setItem('remagx.expandedSections', JSON.stringify({ 'dataset': true }))
  })
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await (await chooser).setFiles({ name: 'datasets.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('tab', { name: 'Sample', exact: true }).click()
  const section = page.getByRole('group', { name: 'Selected dataset', exact: true })
  await expect(section.getByRole('textbox', { name: 'Energy', exact: true })).toHaveValue('700')
  await expect(section.getByRole('textbox', { name: 'Energy shift', exact: true })).toHaveCount(0)
  await section.getByRole('textbox', { name: 'Title', exact: true }).fill('Edited title')
  await section.getByRole('textbox', { name: 'Comment', exact: true }).fill('Saved comment')
  const resolution = section.getByRole('textbox', { name: 'Angular Resolution', exact: true })
  await resolution.fill('-1')
  await resolution.press('Tab')
  await expect(resolution).toHaveValue('0')
  await resolution.fill('0.002')
  await resolution.press('Enter')
  for (const [name, value] of [['Polarization 1 sigma imaginary', '0.25'], ['Polarization 2 pi real', '0.75']]) {
    const input = section.getByRole('textbox', { name, exact: true })
    await input.fill(value)
    await input.press('Enter')
  }
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
  await expect(section.getByRole('textbox', { name: 'Polarization 2 pi real', exact: true })).toHaveValue(String(dataset.polarization.beam2.pi.re))
  await page.getByRole('button', { name: 'Redo (Ctrl+Y)', exact: true }).click()
  await expect(section.getByRole('textbox', { name: 'Polarization 2 pi real', exact: true })).toHaveValue('0.75')
  await page.getByRole('radio', { name: /energy scan/ }).check()
  await expect(section.getByRole('textbox', { name: 'Energy', exact: true })).toHaveCount(0)
  const shift = section.getByRole('textbox', { name: 'Energy shift', exact: true })
  await shift.fill('1.5')
  await shift.press('Enter')
  await expect(section.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('')
  await expect(section.getByLabel('Type', { exact: true })).toHaveText('energy R0')
  await expect(section.getByLabel('File', { exact: true })).toHaveText('synthetic.dat')
  await expect(section.getByLabel('Datapoints', { exact: true })).toHaveText('2')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save (Ctrl+S)', exact: true }).click()
  const saved = JSON.parse(await readFile((await (await downloaded).path())!, 'utf8'))
  dataset.title = 'Edited title'
  dataset.comment = 'Saved comment'
  dataset.angularResolution = 0.002
  dataset.polarization.beam1.sigma.im = 0.25
  dataset.polarization.beam2.pi.re = 0.75
  project.datasets[1].energyShift = 1.5
  project.activeDatasetIndex = 1
  expect(saved).toEqual(project)
})
