import { test, expect } from './fixtures'

test('tensor groups export the correct components and Material Settings shows read-only complex values', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  const cell = page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })
  const choose = async (name: string) => {
    await cell.click({ button: 'right' })
    await page.getByRole('menuitem', { name, exact: true }).click()
  }
  await choose('Show diagonal part of dielectric tensor')
  await expect(page.getByRole('status')).toContainText('Load Co.e or .db')
  await page.getByRole('tab', { name: 'Sample', exact: true }).click()
  await page.getByRole('button', { name: 'Optical Constants Database', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Load tables…', exact: true }).click()
  const row = (energy: number, offset: number) => `${energy} ${Array.from({ length: 18 }, (_, index) => index + offset).join(' ')}`
  await (await chooser).setFiles([{ name: 'Co.e', mimeType: 'text/plain', buffer: Buffer.from(`${row(700, 0)}\n${row(800, 2)}`) },
    { name: 'Co.db', mimeType: 'text/plain', buffer: Buffer.from('700 .001 .0001\n800 .001 .0001') }])
  await expect(page.getByLabel('Plot axis: energy', { exact: true })).toBeVisible()
  const copy = async () => {
    const menu = page.locator('.plot-panel__export')
    if (await menu.getAttribute('open') === null) await menu.locator('summary').click()
    await page.getByRole('button', { name: 'Copy data to clipboard', exact: true }).click()
    await expect(page.locator('.plot-panel__export-message')).toHaveText('Diagram data copied.')
    return page.evaluate(() => navigator.clipboard.readText())
  }
  expect(await page.locator('.plot-panel__swatch').evaluateAll(swatches => new Set(swatches.map(swatch => getComputedStyle(swatch).backgroundColor)).size)).toBe(6)
  expect(await copy()).toContain('700\t1\t700\t1\t700\t-7\t700\t9\t700\t-15\t700\t17')
  await choose('Show top off diagonal part of dielectric tensor')
  await expect(page.locator('.plot-panel__legend')).toContainText('Re ε_xy')
  expect(await copy()).toContain('700\t2\t700\t3\t700\t4\t700\t5\t700\t10\t700\t11')
  await choose('Show bottom off diagonal part of dielectric tensor')
  await expect(page.locator('.plot-panel__legend')).toContainText('Re ε_yx')
  expect(await copy()).toContain('700\t6\t700\t7\t700\t12\t700\t13\t700\t14\t700\t15')
  // Material Settings uses tables only when automatic optical updates are enabled.
  await page.getByRole('radio', { name: 'automatic (ignore manual setting)', exact: true }).check()
  await choose('Properties')
  const dialog = page.getByRole('dialog', { name: 'Material Settings', exact: true })
  await expect(dialog.getByRole('textbox', { name: 'ε_zz imaginary', exact: true })).toHaveAttribute('readonly', '')
  await expect(dialog).toContainText('imported .e table')
  await expect(dialog.locator('.tensor-preview input')).toHaveCount(18)
  expect(await dialog.locator('.tensor-preview input').evaluateAll(inputs => inputs.every(input => {
    const field = input.getBoundingClientRect(), cell = input.closest('td')!.getBoundingClientRect()
    return field.left >= cell.left && field.right <= cell.right
  }))).toBe(true)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true })).toBeDisabled()
  await expect(cell).toHaveValue('10')
})
