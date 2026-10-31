import { readFile } from 'node:fs/promises'
import { test, expect } from './fixtures'
import { createDefaultProject } from '../src/model/defaults'

for (const mode of ['compound', 'element'] as const) {
  test(`${mode} editors hide unavailable boundary cells without changing stored values`, async ({ page }) => {
    const project = createDefaultProject()
    project.sample.mode = mode
    project.sample.layers[0].thickness = 17
    project.sample.layers.at(-1)!.thickness = 19
    project.sample.layers.at(-1)!.roughness = 7
    project.calculation.magnetization.mode = 'add'
    project.sample.elementProfiles = [{ element: 'Co', f1: 2, f2: 1, f1Mag: 0, f2Mag: 0,
      slabs: [{ thickness: 17, density: 1, roughness: 2 }, { thickness: 10, density: 2, roughness: 3 }, { thickness: 19, density: 0, roughness: 7 }] }]
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showOpenFilePicker', { value: undefined })
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined })
    })
    await page.goto('/')
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
    await (await chooser).setFiles({ name: 'boundaries.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
    if (mode === 'compound') {
      await expect(page.getByRole('textbox', { name: 'σ of layer air', exact: true })).toHaveCount(0)
      await expect(page.getByRole('textbox', { name: 'σ of layer bulk', exact: true })).toHaveValue(String(project.sample.layers[0].roughness))
      await expect(page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })).toHaveValue('10')
      await expect(page.getByRole('columnheader', { name: 'mag γ', exact: true })).toHaveAttribute('title', 'Magnetization direction: azimuth γ in degrees')
      await expect(page.getByRole('columnheader', { name: 'mag φ', exact: true })).toHaveAttribute('title', 'Magnetization direction: polar angle φ in degrees')
    } else {
      await expect(page.getByRole('textbox', { name: 'roughness of slab 2', exact: true })).toHaveCount(0)
      await expect(page.getByRole('textbox', { name: 'thickness of slab 1', exact: true })).toHaveValue('10')
      await page.getByRole('button', { name: 'Element Mode', exact: true }).click()
      for (const name of ['slab 0 thickness', 'slab 2 thickness', 'slab 2 roughness']) await expect(page.getByRole('textbox', { name, exact: true })).toHaveCount(0)
      await expect(page.getByRole('textbox', { name: 'slab 1 thickness', exact: true })).toHaveValue('10')
      await expect(page.getByRole('textbox', { name: 'slab 0 roughness', exact: true })).toHaveValue('2')
    }
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save (Ctrl+S)', exact: true }).click()
    const saved = await download
    expect(JSON.parse(await readFile((await saved.path())!, 'utf8'))).toEqual(project)
  })
}
