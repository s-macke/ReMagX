import { test, expect } from './fixtures'

test('area selection uses x coordinates on linear/log axes without zooming or changing the project', async ({ page }) => {
  await page.goto('/')
  const select = page.getByRole('button', { name: 'Select Area', exact: true })
  const status = page.getByLabel('Selected plot area', { exact: true })
  const properties = page.getByRole('dialog', { name: 'Plot Properties', exact: true })
  for (const logarithmic of [false, true]) {
    await page.getByRole('button', { name: 'Properties', exact: true }).click()
    await properties.getByLabel('X min', { exact: true }).fill('0.01')
    await properties.getByLabel('X max', { exact: true }).fill('1')
    await properties.getByLabel('X logscale', { exact: true }).setChecked(logarithmic)
    await properties.getByRole('button', { name: 'Apply', exact: true }).click()
    if (await select.getAttribute('aria-pressed') !== 'true') await select.click()
    const box = (await page.locator('.plot-panel .u-over').boundingBox())!
    await page.mouse.move(box.x + box.width * .75, box.y + box.height * .4)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * .25, box.y + box.height * .6, { steps: 5 })
    await page.mouse.up()
    const values = (await status.textContent())!.match(/Selected x: (.+) to (.+)/)!
    const expected = logarithmic ? [Math.pow(10, -1.5), Math.pow(10, -.5)] : [.2575, .7525]
    expect(Number(values[1])).toBeCloseTo(expected[0], 2)
    expect(Number(values[2])).toBeCloseTo(expected[1], 2)
    await page.getByRole('button', { name: 'Properties', exact: true }).click()
    await expect(properties.getByLabel('X min', { exact: true })).toHaveValue('0.01')
    await expect(properties.getByLabel('X max', { exact: true })).toHaveValue('1')
    await properties.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Clear Selected Area', exact: true }).click()
    await expect(status).toHaveText('No selected area')
    await page.mouse.click(box.x + box.width * .5, box.y + box.height * .5)
    await expect(status).toHaveText('No selected area')
  }
  await select.click()
  await expect(select).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true })).toBeDisabled()
})
