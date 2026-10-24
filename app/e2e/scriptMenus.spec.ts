import type { Page } from '@playwright/test'
import { createDefaultProject } from '../src/model/defaults'
import { test, expect } from './fixtures'

async function openProject(page: Page, blocked = false) {
  const project = createDefaultProject()
  project.scripts.enabled = false
  project.sample.layers[1].thickness = 20
  project.scripts.default = blocked ? 'print("menu-loop-entered"); while true do end' : 'thickness[1] = thickness[1] + 1; print("menu-default")'
  project.scripts.beforeCalculation = 'thickness[1] = thickness[1] + 2; print("menu-before")'
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await (await chooser).setFiles({ name: 'scripts.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
}

async function scriptMenu(page: Page) {
  await page.getByRole('button', { name: 'Tools', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Script', exact: true }).hover()
}

test('both script menu commands execute once, select their tab and preserve undo', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }))
  await page.goto('/')
  await openProject(page)
  for (const [command, tab, marker, thickness] of [
    ['Default', 'Default', 'menu-default', '21'],
    ['Before Calculation', 'BeforeCalculation', 'menu-before', '22'],
  ]) {
    await scriptMenu(page)
    await page.getByRole('menuitem', { name: `Execute Script: ${command}`, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Script Window', exact: true })
    await expect(dialog.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.locator('.script-window__output')).toContainText(marker)
    await expect(dialog.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled()
    await expect(page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })).toHaveValue(thickness)
    await dialog.getByRole('button', { name: 'Close script window' }).click()
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })).toHaveValue('20')
  }
})

test('closing a menu-started blocked script cancels it and permits another execution', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }))
  await page.goto('/')
  await openProject(page, true)
  await scriptMenu(page)
  await page.getByRole('menuitem', { name: 'Execute Script: Default', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Script Window', exact: true })
  await expect(dialog.locator('.script-window__output')).toContainText('menu-loop-entered')
  await expect(dialog.getByRole('button', { name: 'Execute', exact: true })).toBeDisabled()
  await scriptMenu(page)
  await expect(page.getByRole('menuitem', { name: 'Execute Script: Before Calculation', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await dialog.getByRole('button', { name: 'Close script window' }).click()
  await expect(dialog).not.toBeVisible()
  await scriptMenu(page)
  await page.getByRole('menuitem', { name: 'Execute Script: Before Calculation', exact: true }).click()
  await expect(dialog.locator('.script-window__output')).toContainText('Script finished.')
  await expect(page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })).toHaveValue('22')
})
