import { readFile } from 'node:fs/promises'
import { createDefaultProject, createDepthProfileFunction } from '../src/model/defaults'
import { test, expect } from './fixtures'

test('legacy profile bindings distinguish all, air, bulk and none; earlier-profile couplings and save persist', async ({ page }) => {
  const project = createDefaultProject()
  const count = project.sample.layers.length
  project.sample.depthProfileFunctions = [null, 0, count - 1, count].map(boundToLayer => ({ ...createDepthProfileFunction(), boundToLayer }))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined })
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined })
  })
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await (await chooser).setFiles({ name: 'bindings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('tab', { name: 'Sample', exact: true }).click()
  await page.getByRole('button', { name: 'Additional Magnetization Profile', exact: true }).click()
  const section = page.locator('#section-magnetization-profile')
  const binding = section.getByRole('combobox', { name: 'bound to layer', exact: true })
  const coupling = section.getByRole('combobox', { name: 'amplitude coupled to', exact: true })
  await expect(coupling.locator('option')).toHaveText(['none'])
  for (const [index, label] of ['all', 'air', 'bulk', 'none'].entries()) {
    if (index) await section.getByRole('button', { name: 'next function', exact: true }).click()
    await expect(binding.locator('option:checked')).toHaveText(label)
  }
  await expect(coupling.locator('option')).toHaveText(['none', 'M1', 'M2', 'M3'])
  await coupling.selectOption('1')
  await binding.selectOption('0')
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
  await expect(binding.locator('option:checked')).toHaveText('none')
  await page.getByRole('button', { name: 'Add layer above the selected one', exact: true }).click()
  await expect(binding).toHaveValue(String(count + 1))
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save (Ctrl+S)', exact: true }).click()
  const saved = JSON.parse(await readFile((await (await download).path())!, 'utf8'))
  expect(saved.sample.depthProfileFunctions.map((profile: { boundToLayer: number | null }) => profile.boundToLayer)).toEqual([null, 0, count, count + 1])
  expect(saved.sample.depthProfileFunctions[3].amplitudeCoupledTo).toBe(1)
})
