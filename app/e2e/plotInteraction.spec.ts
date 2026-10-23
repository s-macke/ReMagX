import { test, expect } from './fixtures'

test('wheel zoom and Zoom Out change the visible range; Scale restores it', async ({ page }) => {
  await page.goto('/')
  const overlay = page.locator('.u-over')
  await expect(overlay).toBeVisible()
  const bounds = (await overlay.boundingBox())!
  const readX = async (fraction: number) => {
    await page.mouse.move(bounds.x + bounds.width * fraction, bounds.y + bounds.height / 2)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const text = await page.getByLabel('Cursor coordinates', { exact: true }).textContent()
    return Number(text!.match(/X: (\S+)/)![1])
  }
  const left = await readX(0.25)
  const right = await readX(0.75)
  expect(right).toBeGreaterThan(left)
  await readX(0.5)
  await page.mouse.wheel(0, -100)
  const zoomedLeft = await readX(0.25)
  const zoomedRight = await readX(0.75)
  expect((zoomedRight - zoomedLeft) / (right - left)).toBeCloseTo(0.5, 3)
  await page.getByRole('button', { name: 'Zoom Out', exact: true }).click()
  expect(await readX(0.25)).toBeCloseTo(left, 3)
  await readX(0.5)
  await page.mouse.wheel(0, 100)
  expect((await readX(0.75) - await readX(0.25)) / (right - left)).toBeCloseTo(2, 3)
  await page.getByRole('button', { name: 'Scale', exact: true }).click()
  expect(await readX(0.25)).toBeCloseTo(left, 3)
  await page.mouse.move(0, 0)
  await expect(page.getByLabel('Cursor coordinates', { exact: true })).toHaveText('X: —  Y: —')
})

test('repeated logarithmic wheel zoom out stays responsive and Scale recovers', async ({ page }) => {
  test.setTimeout(20_000)
  await page.goto('/')
  const overlay = page.locator('.u-over')
  await expect(overlay).toBeVisible()
  const bounds = (await overlay.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  const coordinates = page.getByLabel('Cursor coordinates', { exact: true })
  await expect(coordinates).not.toContainText('—')
  const initial = await coordinates.textContent()
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 100)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await coordinates.textContent()).not.toMatch(/NaN|Infinity/)
  }
  await page.getByRole('button', { name: 'Scale', exact: true }).click()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await expect(coordinates).toHaveText(initial!)
})
