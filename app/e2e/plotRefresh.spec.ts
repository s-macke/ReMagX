import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

async function copyData(page: Page) {
  const menu = page.locator('.plot-panel__export')
  if (await menu.getAttribute('open') === null) await menu.locator('summary').click()
  await page.getByRole('button', { name: 'Copy data to clipboard', exact: true }).click()
  return (await page.evaluate(() => navigator.clipboard.readText())).trim().split('\n').map(row => row.split('\t').map(Number))
}
async function properties(page: Page) {
  await page.getByRole('button', { name: 'Properties', exact: true }).click()
  return page.getByRole('dialog', { name: 'Plot Properties', exact: true })
}
async function ranges(page: Page) {
  const dialog = await properties(page)
  const values = await Promise.all(['X min', 'X max', 'Y min', 'Y max'].map(name => dialog.getByLabel(name, { exact: true }).inputValue()))
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  return values
}
const settle = (page: Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

test('changed sample counts draw the same curve as a fresh plot at the retained ranges', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  const dialog = await properties(page)
  await dialog.getByLabel('X min', { exact: true }).fill('0.05')
  await dialog.getByLabel('X max', { exact: true }).fill('0.2')
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  const originalRanges = await ranges(page)
  await page.getByRole('tab', { name: 'Experiment', exact: true }).click()
  await page.getByRole('button', { name: 'X-Axis', exact: true }).click()
  for (const count of [20, 200, 30]) {
    const points = page.locator('#section-x-axis').getByRole('textbox', { name: 'number of points', exact: true })
    await points.fill(String(count)); await points.press('Enter')
    await expect.poll(async () => (await copyData(page)).length).toBe(count)
    await settle(page)
    const canvas = page.locator('.uplot canvas')
    const updated = await canvas.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())
    expect(await ranges(page)).toEqual(originalRanges)
    const settings = await properties(page)
    await settings.getByRole('button', { name: 'Apply', exact: true }).click()
    await settle(page)
    expect(await canvas.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL()) === updated).toBe(true)
  }
})

test('Hold retains both beams and manual zoom through edits and Clear', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await page.getByRole('radio', { name: 'Dichroic', exact: true }).check()
  await expect.poll(async () => (await copyData(page))[0].length).toBe(4)
  const original = await copyData(page)
  const overlay = page.locator('.u-over'), bounds = (await overlay.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.wheel(0, -100); await settle(page)
  await page.mouse.move(0, 0)
  const zoom = await ranges(page)
  await page.getByRole('button', { name: 'Hold', exact: true }).click()
  expect(await ranges(page)).toEqual(zoom)
  await expect.poll(async () => (await copyData(page))[0].length).toBe(8)
  const thickness = page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })
  await thickness.fill('40'); await thickness.press('Enter')
  await expect.poll(async () => JSON.stringify((await copyData(page)).map(row => row.slice(0, 4)))).not.toBe(JSON.stringify(original))
  expect((await copyData(page)).map(row => row.slice(4))).toEqual(original)
  expect(await ranges(page)).toEqual(zoom)
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  expect(await ranges(page)).toEqual(zoom)
  expect((await copyData(page))[0].length).toBe(4)
})
