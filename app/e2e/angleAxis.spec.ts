import { readFile } from 'node:fs/promises'
import { test, expect } from './fixtures'
import { createDefaultProject } from '../src/model/defaults'
import { angleFromQz } from '../src/model/plotCoordinates'

test('theta changes plot and exported coordinates, while energy scans retain their axis', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Experiment', exact: true }).click()
  await page.getByRole('button', { name: 'X-Axis', exact: true }).click()
  await page.getByRole('radio', { name: 'theta [°]', exact: true }).check()
  await expect(page.getByLabel('Plot axis: angle', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'File', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Save diagram data', exact: true }).click()
  const text = await readFile((await (await download).path())!, 'utf8')
  expect(text).toContain('# theta (degrees)')
  const first = text.split('\n').find(line => line && !line.startsWith('#'))!
  const defaults = createDefaultProject()
  expect(Number(first.split('\t')[0])).toBeCloseTo(angleFromQz(defaults.experiment.qzScan.qzMin, defaults.experiment.energy), 12)
  await page.getByRole('radio', { name: 'qz', exact: true }).check()
  await expect(page.getByLabel('Plot axis: qz', { exact: true })).toBeVisible()
  await page.getByRole('radio', { name: 'theta [°]', exact: true }).check()
  await page.getByRole('button', { name: 'Energy Scan', exact: true }).click()
  await expect(page.getByLabel('Plot axis: energy', { exact: true })).toBeVisible()
})
