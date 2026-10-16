import { createDefaultProject } from '../src/model/defaults'
import { test, expect } from './fixtures'

for (const mode of ['compound', 'element'] as const) test(`database action updates the whole ${mode} stack and supports undo`, async ({ page }) => {
  const project = createDefaultProject()
  project.sample.mode = mode
  project.experiment.energy = 750
  project.sample.layers = project.sample.layers.slice(0, 4)
  project.sample.layers.forEach((layer, index) => { layer.opticalTable = index === 3 ? 'vacuum' : 'Co'; layer.delta = 99; layer.beta = 99 })
  project.sample.elementProfiles = ['Co', 'Ni'].map(element => ({ element, f1: 99, f2: 99, f1Mag: 99, f2Mag: 99,
    slabs: [{ thickness: 0, density: 0.1, roughness: 0 }, { thickness: 20, density: 0.1, roughness: 0 }, { thickness: 0, density: 0, roughness: 0 }] }))
  await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }))
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await (await chooser).setFiles({ name: 'database.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('tab', { name: 'Sample', exact: true }).click()
  await page.getByRole('button', { name: 'Optical Constants Database', exact: true }).click()
  const files = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Load tables…', exact: true }).click()
  await (await files).setFiles((mode === 'compound' ? ['Co.db'] : ['Co.ff', 'Ni.ff']).map(name => ({ name, mimeType: 'text/plain', buffer: Buffer.from('700 1 2\n800 3 4') })))
  const cell = page.getByRole('textbox', { name: mode === 'compound' ? 'thickness of layer 1' : 'f1 of Co', exact: true })
  await cell.focus()
  await cell.press('Shift+F10')
  await page.getByRole('menuitem', { name: mode === 'compound' ? 'Get optical constants from database' : 'Get f1/f2 from database', exact: true }).click()
  const report = page.getByRole('dialog', { name: 'Database update', exact: true })
  await expect(report).toContainText(`Updated ${mode === 'compound' ? 3 : 2}`)
  await expect(report).toContainText('magnetic values set to zero')
  if (mode === 'compound') await expect(report).toContainText('vacuum: no db table; values kept')
  await report.getByRole('button', { name: 'Close', exact: true }).click()
  if (mode === 'compound') {
    for (const name of ['δ of layer bulk', 'δ of layer 1', 'δ of layer 2']) await expect(page.getByRole('textbox', { name, exact: true })).toHaveValue('2')
    await expect(page.getByRole('textbox', { name: 'δ of layer air', exact: true })).toHaveValue('99')
  } else {
    await expect(cell).toHaveValue('2')
    await page.getByRole('button', { name: 'Next element', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'f1 of Ni', exact: true })).toHaveValue('2')
    await expect(page.getByRole('textbox', { name: 'f1m of Ni', exact: true })).toHaveValue('0')
  }
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
  await expect(page.getByRole('textbox', { name: mode === 'compound' ? 'δ of layer 1' : 'f1 of Ni', exact: true })).toHaveValue('99')
})
