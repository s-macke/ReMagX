import { readFile } from 'node:fs/promises'
import { test, expect } from './fixtures'

test('plot clipboard and picture exports contain data and real images; denied access reports an error', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await page.getByRole('button', { name: 'Hold', exact: true }).click()
  await page.locator('.plot-panel__export > summary').click()
  await page.getByRole('button', { name: 'Copy data to clipboard', exact: true }).click()
  await expect(page.locator('.plot-panel__export-message')).toHaveText('Diagram data copied.')
  const text = await page.evaluate(() => navigator.clipboard.readText())
  const rows = text.trim().split(/\r?\n/).map(line => line.split('\t').map(Number))
  expect(rows.length).toBeGreaterThan(2)
  expect(rows.every(row => row.length === 4 && row.every(Number.isFinite) && row[0] === row[2] && row[1] === row[3])).toBe(true)
  await page.getByRole('button', { name: 'Copy graphic to clipboard', exact: true }).click()
  // Chromium may defer canvas encoding beyond the default 5 s assertion window.
  // Keep checking actual clipboard completion and image contents below.
  await expect(page.locator('.plot-panel__export-message')).toHaveText('Graphic copied.', { timeout: 15000 })
  const imageSize = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    const image = await createImageBitmap(await item.getType('image/png'))
    const result = { width: image.width, height: image.height }
    image.close()
    return result
  })
  const canvasSize = await page.locator('.uplot canvas').evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, height: canvas.height }))
  expect(imageSize.width).toBe(canvasSize.width)
  expect(imageSize.height).toBeGreaterThan(canvasSize.height) // legend below the axes
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save Picture', exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('remagx-plot.jpg')
  const bytes = await readFile((await file.path())!)
  expect([...bytes.subarray(0, 3)]).toEqual([255, 216, 255])
  expect(bytes.length).toBeGreaterThan(1000)
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new DOMException('Permission denied', 'NotAllowedError') } })
  await page.getByRole('button', { name: 'Copy data to clipboard', exact: true }).click()
  await expect(page.locator('.plot-panel__export-message')).toContainText('Export failed: Permission denied')
  await expect(page.locator('.uplot canvas')).toBeVisible()
})
