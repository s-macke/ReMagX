import { createDefaultProject } from '../src/model/defaults'
import { test, expect } from './fixtures'

test('scattering factors follow the selected element, export table values and report missing data', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const project = createDefaultProject()
  project.sample.mode = 'element'
  project.sample.elementProfiles = ['Co', 'Ni'].map(element => ({ element, f1: 1, f2: 2, f1Mag: 0, f2Mag: 0,
    slabs: [{ thickness: 0, density: 0.1, roughness: 3 }, { thickness: 20, density: 0.15, roughness: 3 }, { thickness: 0, density: 0, roughness: 0 }] }))
  await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }))
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await (await chooser).setFiles({ name: 'elements.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('tab', { name: 'Sample', exact: true }).click()
  const header = page.getByRole('button', { name: 'Element Mode', exact: true })
  if (await header.getAttribute('aria-expanded') !== 'true') await header.click()
  await page.getByRole('button', { name: 'Show Scattering Factors f1/f2', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Load Co.ff')
  await page.getByRole('button', { name: 'Optical Constants Database', exact: true }).click()
  const tables = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Load tables…', exact: true }).click()
  await (await tables).setFiles([
    { name: 'Co.ff', mimeType: 'text/plain', buffer: Buffer.from('0 99 99\n700 -2 0\n800 3 4') },
    { name: 'Ni.ff', mimeType: 'text/plain', buffer: Buffer.from('710 5 7\n810 6 8') },
  ])
  await expect(page.getByLabel('Plot axis: energy', { exact: true })).toBeVisible()
  const copy = async () => {
    const menu = page.locator('.plot-panel__export')
    if (await menu.getAttribute('open') === null) await menu.locator('summary').click()
    await page.getByRole('button', { name: 'Copy data to clipboard', exact: true }).click()
    await expect(page.locator('.plot-panel__export-message')).toHaveText('Diagram data copied.')
    return page.evaluate(() => navigator.clipboard.readText())
  }
  expect(await copy()).toContain('700\t-2\t700\t0')
  expect(await copy()).not.toContain('99')
  await page.getByRole('button', { name: 'Next element', exact: true }).click()
  await expect.poll(copy).toContain('710\t5\t710\t7')
  await expect(page.getByRole('textbox', { name: 'f1 of Ni', exact: true })).toHaveValue('1')
  await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Delete optical constants cache', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Load Ni.ff')
})
