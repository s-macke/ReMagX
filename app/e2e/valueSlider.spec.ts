import { createDefaultProject } from '../src/model/defaults'
import { test, expect } from './fixtures'

test('value slider selects numeric cells, uses a fixed reference and clears unsafe selections', async ({ page }) => {
  await page.goto('/')
  const slider = page.getByRole('slider', { name: 'Selected cell value', exact: true })
  const thickness = page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })
  await expect(slider).toBeDisabled()
  await thickness.click()
  await expect(slider).toHaveValue('250')
  await slider.press('End')
  await expect(thickness).toHaveValue('40')
  await slider.press('Home')
  await expect(thickness).toHaveValue('0')
  await slider.press('End')
  await expect(thickness).toHaveValue('40')
  await thickness.fill('15')
  await thickness.press('Enter')
  await expect(slider).toHaveValue('250')
  await slider.press('End')
  await expect(thickness).toHaveValue('60')
  await page.getByRole('textbox', { name: 'optical table of layer 1', exact: true }).click()
  await expect(slider).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'σ of layer air', exact: true })).toHaveCount(0)
  await page.getByRole('rowheader', { name: 'air', exact: true }).click()
  await expect(slider).toBeDisabled()
  await thickness.click()
  await page.getByRole('button', { name: 'Add layer above the selected one', exact: true }).click()
  await expect(slider).toBeDisabled()
  await page.screenshot({ path: '/tmp/remagx-value-slider.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(slider).toBeVisible()
  expect((await page.getByRole('region', { name: 'Layer stack', exact: true }).boundingBox())!.height).toBeGreaterThan(100)
  await page.screenshot({ path: '/tmp/remagx-value-slider-mobile.png' })
})

test('profile, spline and script values use the shared slider and clear on panel unmount', async ({ page }) => {
  await page.goto('/')
  const slider = page.getByRole('slider', { name: 'Selected cell value', exact: true })
  await page.getByRole('tab', { name: 'Sample', exact: true }).click()
  await page.getByRole('button', { name: 'Additional Magnetization Profile', exact: true }).click()
  const section = page.locator('#section-magnetization-profile')
  await section.getByRole('button', { name: 'Add', exact: true }).click()
  const amplitude = section.getByRole('textbox', { name: 'δ amplitude', exact: true })
  await amplitude.fill('2')
  await amplitude.press('Enter')
  await slider.press('End')
  await expect(amplitude).toHaveValue('8')
  await section.getByRole('combobox', { name: 'amplitude coupled to', exact: true }).focus()
  await expect(slider).toBeDisabled()
  await section.getByRole('button', { name: 'Build spline', exact: true }).click()
  await expect(slider).toBeDisabled()
  const point = section.getByRole('textbox', { name: 'y2', exact: true })
  await point.click()
  await slider.press('End')
  await expect(point).toHaveValue('4')
  await page.getByRole('tab', { name: 'Fit', exact: true }).click()
  await expect(slider).toBeDisabled()
  await page.getByRole('button', { name: 'Additional Fit Parameters', exact: true }).click()
  await page.getByRole('button', { name: 'Add script parameter', exact: true }).click()
  const parameter = page.getByRole('textbox', { name: 'script parameter 0', exact: true })
  await parameter.fill('-2')
  await parameter.press('Enter')
  await slider.press('End')
  await expect(parameter).toHaveValue('-8')
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
  await expect(parameter).toHaveValue('-2')
  await expect(slider).toBeDisabled()
})

test('dragging recalculates before release and one undo restores the starting value', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    const tracker = window as unknown as { sliderCalculations: number; sliderResults: number }
    tracker.sliderCalculations = 0
    tracker.sliderResults = 0
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener('message', event => { if (event.data.type === 'result') tracker.sliderResults++ })
      }
      postMessage(message: { kind?: string }) {
        if (message.kind === 'reflectivity') tracker.sliderCalculations++
        super.postMessage(message)
      }
    }
  })
  await page.goto('/')
  const thickness = page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })
  await thickness.click()
  const slider = page.getByRole('slider', { name: 'Selected cell value', exact: true })
  const box = (await slider.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2)
  await page.mouse.down()
  await page.evaluate(() => {
    const tracker = window as unknown as { sliderCalculations: number; sliderResults: number }
    tracker.sliderCalculations = 0
    tracker.sliderResults = 0
  })
  for (let step = 0; step < 12; step++) {
    await page.mouse.move(box.x + box.width * (0.3 + step * 0.04), box.y + box.height / 2)
    await page.waitForTimeout(45) // Deliberately keep moving faster than the normal typing debounce.
  }
  expect(await page.evaluate(() => (window as unknown as { sliderCalculations: number }).sliderCalculations)).toBeGreaterThan(1)
  expect(await page.evaluate(() => (window as unknown as { sliderResults: number }).sliderResults)).toBeGreaterThan(1)
  await page.mouse.up()
  await expect(thickness).not.toHaveValue('10')
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click()
  await expect(thickness).toHaveValue('10')
})

test('element slab and scattering-factor selections remain isolated when switching elements', async ({ page }) => {
  const project = createDefaultProject()
  project.sample.mode = 'element'
  project.sample.elementProfiles = ['Co', 'Ni'].map(element => ({ element, f1: 2, f2: 3, f1Mag: 0, f2Mag: 0,
    slabs: Array.from({ length: 3 }, () => ({ thickness: 10, density: 2, roughness: 1 })) }))
  await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }))
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await (await chooser).setFiles({ name: 'elements.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  const slider = page.getByRole('slider', { name: 'Selected cell value', exact: true })
  const density = page.getByRole('textbox', { name: 'density of slab 1', exact: true })
  await density.click()
  await slider.press('End')
  await expect(density).toHaveValue('8')
  const factor = page.getByRole('textbox', { name: 'f1 of Co', exact: true })
  await factor.click()
  await slider.press('End')
  await expect(factor).toHaveValue('8')
  await page.getByRole('button', { name: 'Next element', exact: true }).click()
  await expect(slider).toBeDisabled()
  await expect(density).toHaveValue('2')
  await expect(page.getByRole('textbox', { name: 'f1 of Ni', exact: true })).toHaveValue('2')
})

test('thickness slider repaints the calculated curve without resetting the visible range', async ({ page }) => {
  await page.goto('/')
  const panel = page.getByRole('region', { name: 'Plot', exact: true })
  const canvas = panel.locator('canvas')
  await expect(canvas).toHaveCount(1)
  await panel.getByRole('button', { name: 'Properties', exact: true }).click()
  const properties = page.getByRole('dialog', { name: 'Plot Properties', exact: true })
  await properties.getByLabel('X min', { exact: true }).fill('0.02')
  await properties.getByLabel('X max', { exact: true }).fill('0.2')
  await properties.getByLabel('Y min', { exact: true }).fill('0.00000001')
  await properties.getByLabel('Y max', { exact: true }).fill('1')
  await properties.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(properties).toHaveCount(0)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const before = await canvas.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())
  await page.getByRole('textbox', { name: 'thickness of layer 1', exact: true }).click()
  await page.getByRole('slider', { name: 'Selected cell value', exact: true }).press('End')
  await expect(page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })).toHaveValue('40')
  await expect.poll(() => canvas.evaluate((canvas, previous) => (canvas as HTMLCanvasElement).toDataURL() !== previous, before)).toBe(true)
  await panel.getByRole('button', { name: 'Properties', exact: true }).click()
  await expect(properties.getByLabel('X min', { exact: true })).toHaveValue('0.02')
  await expect(properties.getByLabel('X max', { exact: true })).toHaveValue('0.2')
  await expect(properties.getByLabel('Y min', { exact: true })).toHaveValue('1e-8')
  await expect(properties.getByLabel('Y max', { exact: true })).toHaveValue('1')
})
