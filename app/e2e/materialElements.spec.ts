import { createDefaultProject, createLayer } from '../src/model/defaults'
import { test, expect } from './fixtures'

for (const { existing, multilayer } of [{ existing: false, multilayer: false }, { existing: true, multilayer: false }, { existing: true, multilayer: true }]) test(`Material to Elements previews and replaces ${existing ? 'existing' : 'empty'} element data${multilayer ? ' with repeated layers' : ''} with undo`, async ({ page }) => {
  const project = createDefaultProject()
  project.sample.mode = 'element'
  project.sample.multilayer = { enabled: multilayer, pattern: '3*(1)' }
  project.sample.layers = [createLayer({ material: 'Si', density: 2.3, roughness: 2 }), createLayer({ material: 'Fe2O3', density: 5, thickness: 20, roughness: 3 }), createLayer()]
  project.sample.elementProfiles = existing ? [{ element: 'Ni', f1: 77, f2: 2, f1Mag: 0, f2Mag: 0, slabs: project.sample.layers.map(layer => ({ thickness: layer.thickness, roughness: layer.roughness, density: 0.1 })) }] : []
  await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }))
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await (await chooser).setFiles({ name: 'materials.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('tab', { name: 'Sample', exact: true }).click()
  const section = page.getByRole('button', { name: 'Element Mode', exact: true })
  if (await section.getAttribute('aria-expanded') !== 'true') await section.click()
  const open = page.getByRole('button', { name: 'Material to Elements', exact: true })
  await open.click()
  const dialog = page.getByRole('dialog', { name: 'Material to Elements', exact: true })
  await expect(dialog).toContainText('3 element(s): Si, Fe, O')
  await expect(dialog).toContainText(`Layer ${multilayer ? 4 : 2}: empty formula or zero density`)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true })).toBeDisabled()
  await open.click()
  await dialog.getByRole('button', { name: 'Replace element data', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'f1 of Si', exact: true })).toHaveValue('0')
  await page.getByRole('button', { name: 'Next element', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'f1 of Fe', exact: true })).toHaveValue('0')
  await expect(page.getByRole('textbox', { name: 'thickness of slab 1', exact: true })).toHaveValue('20')
  expect(Number(await page.getByRole('textbox', { name: 'density of slab 1', exact: true }).inputValue())).toBeGreaterThan(0)
  if (multilayer) {
    await expect(page.getByRole('textbox', { name: 'thickness of slab 3', exact: true })).toHaveValue('20')
    await expect(page.getByRole('textbox', { name: 'density of slab 4', exact: true })).toHaveValue('0')
  }
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
  if (existing) await expect(page.getByRole('textbox', { name: 'f1 of Ni', exact: true })).toHaveValue('77')
  else await expect(page.getByText('No elements defined in this project.', { exact: true })).toBeVisible()
})
