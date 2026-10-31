import { createDefaultProject } from '../src/model/defaults'
import { test, expect } from './fixtures'

for (const mode of ['compound', 'element'] as const) {
  test(`switching from ${mode} to a smaller stack keeps Add layer usable and shows mode-specific help`, async ({ page }) => {
    const project = createDefaultProject()
    project.sample.mode = mode
    project.sample.layers = project.sample.layers.slice(0, mode === 'compound' ? 6 : 3)
    project.sample.elementProfiles = [{ element: 'Co', f1: 2, f2: 1, f1Mag: 0, f2Mag: 0,
      slabs: Array.from({ length: mode === 'element' ? 6 : 3 }, () => ({ thickness: 10, density: 1, roughness: 0 })) }]
    project.calculation.roughnessModel = 'nevot-croce'
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showOpenFilePicker', { value: undefined })
      localStorage.setItem('remagx.expandedSections', JSON.stringify({ segmentation: true }))
    })
    await page.goto('/')
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
    await (await chooser).setFiles({ name: 'modes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
    await page.getByRole('textbox', { name: `thickness of ${mode === 'compound' ? 'layer' : 'slab'} 4`, exact: true }).click()
    const target = mode === 'compound' ? 'element' : 'compound'
    await page.getByRole('button', { name: `Switch to ${target} mode`, exact: true }).click()
    const table = page.getByRole('region', { name: target === 'compound' ? 'Layer stack' : 'Layers of element Co', exact: true })
    await expect(table.locator('tbody tr.is-selected')).toHaveCount(1)
    await expect(table.locator('tbody tr')).toHaveCount(3)
    await page.getByRole('button', { name: 'Add layer above the selected one', exact: true }).click()
    await expect(table.locator('tbody tr')).toHaveCount(4)
    await page.getByRole('tab', { name: 'Sample', exact: true }).click()
    const section = page.locator('#section-segmentation')
    await expect(section).toContainText(target === 'element' ? 'Element sampling always uses minimal layer thickness' : 'Used when the roughness approximation is set to layer segmentation')
  })
}
