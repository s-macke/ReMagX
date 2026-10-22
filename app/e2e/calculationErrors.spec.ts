import { test, expect } from './fixtures'
import { calculationErrorMessage, OpticalDatabaseError, MultilayerError, scriptFailure } from '../src/model/calculationErrors'

declare global {
  interface Window { injectedCalculationError?: string; successfulCalculations: number }
}

// UI contract only: failures enter through the production worker protocol.
// Actual numerical/Lua error generation is tested by test-real-service.mjs.
test('calculation errors retain full details, preserve the project and recover without reopening stale dialogs', async ({ page }) => {
  await page.addInitScript(() => {
    window.successfulCalculations = 0
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener('message', event => { if (event.data.type === 'result') window.successfulCalculations++ })
      }
      postMessage(message: { kind?: string }) {
        super.postMessage({ ...message, uiError: message.kind === 'reflectivity' ? window.injectedCalculationError : undefined })
      }
    }
  })
  await page.route('**/assets/worker-*.js', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: `${await response.text()}
      const handler = self.onmessage;
      self.onmessage = event => {
        if (event.data.uiError) {
          self.postMessage({ id: event.data.id, type: 'error', message: event.data.uiError });
          return;
        }
        handler(event);
      };` })
  })
  await page.goto('/')
  await page.waitForFunction(() => window.successfulCalculations > 0)
  const thickness = page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })
  const initialThickness = await thickness.inputValue()
  const calculate = page.getByRole('button', { name: 'Reflectivity', exact: true })
  const details = page.getByRole('button', { name: 'Error details', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Calculation error', exact: true })
  const messages = [
    calculationErrorMessage({ status: 4 }),
    calculationErrorMessage(new OpticalDatabaseError('Layer 1: missing optical table test.db.')),
    calculationErrorMessage(scriptFailure('compilation', new Error('BeforeCalculation:2: syntax error'))),
    calculationErrorMessage(scriptFailure('execution', new Error('Default:3: invalid argument\nstack traceback:\n' + 'x'.repeat(2000) + '\n<img data-error-injection src=x>'))),
    calculationErrorMessage(new MultilayerError('Multilayer repetition is missing its closing parenthesis.')),
    calculationErrorMessage(undefined),
  ]
  for (const message of messages) {
    await page.evaluate(value => { window.injectedCalculationError = value }, message)
    await calculate.click()
    await expect(details).toBeVisible()
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('.status-bar__error')).toHaveText(message.split('\n')[0])
    await details.click()
    await expect(dialog.locator('pre')).toHaveText(message)
    await expect(dialog.locator('img')).toHaveCount(0)
    await expect(thickness).toHaveValue(initialThickness)
    await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    const previous = await page.evaluate(() => { window.injectedCalculationError = undefined; return window.successfulCalculations })
    await calculate.click()
    await page.waitForFunction(count => window.successfulCalculations > count, previous)
    await expect(details).not.toBeVisible()
    await expect(page.locator('.status-bar__error')).toHaveCount(0)
  }
  // Repeating the same error after recovery must require another explicit open.
  await page.setViewportSize({ width: 800, height: 700 })
  await page.evaluate(value => { window.injectedCalculationError = value }, messages[3])
  await calculate.click()
  await expect(details).toBeVisible()
  await expect(dialog).not.toBeVisible()
  await details.click()
  await expect(dialog.locator('pre')).toHaveText(messages[3])
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).not.toBeVisible()
})
