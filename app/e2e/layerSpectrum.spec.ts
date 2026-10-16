import { test, expect } from './fixtures'

test('layer context spectra use loaded table samples, keep the project and report missing data', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  const cell = page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })
  await cell.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Show δ and β spectrum', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Load Co.db')
  await page.getByRole('tab', { name: 'Sample', exact: true }).click()
  await page.getByRole('button', { name: 'Optical Constants Database', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Load tables…', exact: true }).click()
  await (await chooser).setFiles([
    { name: 'Co.db', mimeType: 'text/plain', buffer: Buffer.from('700 0.1 0.03\n800 0.2 0.04\n900 0.3 0.05\n') },
    { name: 'Co.m', mimeType: 'text/plain', buffer: Buffer.from('710 -0.01 0\n810 0.02 -0.03\n910 0.04 0.01\n') },
  ])
  await expect(page.getByLabel('Plot axis: energy', { exact: true })).toBeVisible()
  await expect(page.locator('.plot-panel__legend')).toContainText('δ')
  const copy = async () => {
    const exportMenu = page.locator('.plot-panel__export')
    if (await exportMenu.getAttribute('open') === null) await exportMenu.locator('summary').click()
    await page.getByRole('button', { name: 'Copy data to clipboard', exact: true }).click()
    await expect(page.locator('.plot-panel__export-message')).toHaveText('Diagram data copied.')
    return page.evaluate(() => navigator.clipboard.readText())
  }
  expect(await copy()).toContain('700\t0.1\t700\t0.03')
  const table = page.getByRole('textbox', { name: 'optical table of layer 1', exact: true })
  await table.focus()
  await table.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Show δm and βm spectrum', exact: true }).click()
  await expect(page.locator('.plot-panel__legend')).toContainText('δm')
  expect(await copy()).toContain('710\t-0.01\t710\t0')
  await expect(cell).toHaveValue('10')
  await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Delete optical constants cache', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Load Co.m')
  await table.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Show δ and β spectrum', exact: true }).press('Escape')
  await expect(page.getByRole('menu', { name: 'Layer spectra', exact: true })).toHaveCount(0)
  await expect(table).toBeFocused()
  await page.getByRole('button', { name: 'Reflectivity', exact: true }).click()
  await expect(page.getByLabel('Plot axis: qz', { exact: true })).toBeVisible()
})
