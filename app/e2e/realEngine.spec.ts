import { test, expect } from './fixtures'

test('production worker loads the local WASM core', async ({ page }) => {
  const binary = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/assets/remagx-core.wasm'))
  await page.goto('/')
  const response = await binary
  expect(response.ok()).toBe(true)
  expect(new URL(response.url()).searchParams.get('v')).toMatch(/^[a-f0-9]{64}$/)
  expect(Array.from((await response.body()).subarray(0, 4))).toEqual([0, 97, 115, 109])
  await expect(page.locator('.status-bar__engine')).toHaveText('ReMagX WASM · double precision')
  await expect(page.getByLabel('Plot axis: qz', { exact: true })).toBeVisible()
  await expect(page.locator('.status-bar__error')).toHaveCount(0)
})

test('missing WASM reports an error without mock fallback and recovers after reload', async ({ page }) => {
  await page.route('**/remagx-core.wasm*', route => route.abort())
  await page.goto('/')
  await expect(page.locator('.status-bar__error')).not.toBeEmpty()
  await page.getByRole('button', { name: 'Error details', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Calculation error', exact: true })).toBeVisible()
  await page.unroute('**/remagx-core.wasm*')
  await page.reload()
  await expect(page.getByLabel('Plot axis: qz', { exact: true })).toBeVisible()
  await expect(page.locator('.status-bar__error')).toHaveCount(0)
})
