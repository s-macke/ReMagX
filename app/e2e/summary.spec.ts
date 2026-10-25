import { createDefaultProject } from '../src/model/defaults'
import type { Dataset } from '../src/model/project'
import { test, expect, loadEnergyTables } from './fixtures'

function fixture() {
  const project = createDefaultProject()
  const dataset: Dataset = { title: 'qz example', comment: '', sourceFile: '', energy: 700, energyShift: 0,
    angularResolution: 0, intensityScale: 1, intensityOffset: 0, qzShift: 0, errorWeight: 2,
    polarization: structuredClone(project.experiment.polarization), active: true,
    columns: { qz: [.02, .04], reflectivity: [.12345678901234566, .01] } }
  project.datasets = [dataset, { ...structuredClone(dataset), title: 'inactive energy', active: false,
    columns: { qz: [.02, .02], energy: [700, 710], asymmetry: [.01, -.01] } },
  { ...structuredClone(dataset), title: 'paired beams', columns: { qz: [.02, .04], reflectivityPlus: [.1, .01], reflectivityMinus: [.09, .012] } }]
  project.activeDatasetIndex = 0
  return project
}

test('real Summary includes all scans, exports the snapshot and changes only layout', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }))
  await page.goto('/')
  await loadEnergyTables(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await (await chooser).setFiles({ name: 'summary.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture())) })
  await page.getByRole('button', { name: 'Tools', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Summary', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Summary', exact: true })
  await expect(dialog.getByRole('status')).toHaveText('3 datasets')
  await expect(dialog.locator('.summary-chart canvas')).toHaveCount(3)
  await expect(dialog.getByText('inactive energy', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Copy All Data', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('All data copied.')
  const before = await page.evaluate(() => navigator.clipboard.readText())
  expect(before).toContain(String(.12345678901234566))
  expect(before).toContain('calculated energy')
  expect(before).toContain('measurement reflectivityMinus')
  await dialog.getByLabel('Show Error', { exact: true }).check()
  await expect(dialog.locator('.summary-error')).toHaveCount(3)
  await dialog.getByLabel('Scale x-axis', { exact: true }).check()
  await dialog.getByLabel('Scale y-axis (qz)', { exact: true }).check()
  await dialog.getByLabel('Chart width', { exact: true }).fill('350')
  await dialog.getByLabel('Chart height', { exact: true }).fill('400')
  await dialog.getByRole('button', { name: 'Update', exact: true }).click()
  await expect(dialog.locator('.summary-chart').first()).toHaveCSS('width', '350px')
  await dialog.getByRole('button', { name: 'Copy All Data', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('All data copied.')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(before)
  await dialog.getByRole('button', { name: 'Copy All Graphic', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('All graphics copied.', { timeout: 15000 })
  expect(await dialog.locator('.summary-grid').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  const imageHeight = await page.evaluate(async () => {
    const item = (await navigator.clipboard.read()).find(item => item.types.includes('image/png'))!
    const image = await createImageBitmap(await item.getType('image/png'))
    const height = image.height; image.close(); return height
  })
  const oneChartHeight = await dialog.locator('canvas').first().evaluate(canvas => (canvas as HTMLCanvasElement).height)
  expect(imageHeight).toBeGreaterThan(2 * oneChartHeight)
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Denied') } })
  await dialog.getByRole('button', { name: 'Copy All Data', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Allow clipboard access')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true })).toBeDisabled()
})

test('Summary reports unsupported datasets and cancels a blocked worker with recovery', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }))
  let block = false
  await page.route('**/assets/worker-*.js', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: `${await response.text()}\n const summaryHandler = self.onmessage; self.onmessage = event => { if (${block} && event.data.kind === 'summary') { while (true) {} } summaryHandler(event); };` })
  })
  await page.goto('/')
  const project = fixture()
  project.datasets = [{ ...project.datasets[0], active: false, columns: { qz: [.02], electronYield: [1] } }]
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await (await chooser).setFiles({ name: 'unsupported.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  const open = async () => {
    await page.getByRole('button', { name: 'Tools', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Summary', exact: true }).click()
  }
  const dialog = page.getByRole('dialog', { name: 'Summary', exact: true })
  await open()
  await expect(dialog.getByRole('status')).toContainText('Dataset 1: TEY')
  await expect(dialog.getByRole('button', { name: 'Copy All Data', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  block = true
  await open()
  await dialog.getByRole('button', { name: 'Stop Summary', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Stopped.', { timeout: 1000 })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  block = false
  await open()
  await expect(dialog.getByRole('status')).toContainText('Dataset 1: TEY')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true })).toBeDisabled()
})
