import { type Locator, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { createDefaultProject } from '../src/model/defaults'
import { calcReflectivity } from '../src/compute/mockPhysics'

declare global {
  interface Window {
    blockedKind?: string
    workerBlocked: boolean
    terminations: number
    results: number
    iterations: number[]
    elapsed: Promise<number>
  }
}

// Synthetic mock data checks UI behavior only, never legacy numerical parity.
function projectFile() {
  const project = createDefaultProject()
  project.sample.layers = [project.sample.layers[0], { ...project.sample.layers[1], thickness: 50 }, project.sample.layers.at(-1)!]
  project.experiment.qzScan = { ...project.experiment.qzScan, qzMin: 0.02, qzMax: 0.4, points: 3000 }
  const truth = calcReflectivity(project)
  project.datasets = [{ title: 'Synthetic browser test', comment: '', sourceFile: '', energy: project.experiment.energy,
    energyShift: 0, angularResolution: 0, intensityScale: 1, intensityOffset: 0, qzShift: 0, errorWeight: 1,
    polarization: project.experiment.polarization, active: true, columns: { qz: truth.qz, reflectivity: truth.reflectivity } }]
  project.activeDatasetIndex = 0
  project.sample.layers[1].thickness = 46
  project.fit.algorithm = 'simplex'
  project.fit.annealing = { temperature: 1, temperatureStep: 0 }
  project.fit.parameters = [{ target: 'thickness', index: 1, elementIndex: null, value: 46, step: 2, lowerBound: 30, upperBound: 70 },
    { target: 'roughness', index: 1, elementIndex: null, value: 5, step: 1, lowerBound: 0, upperBound: 15 },
    { target: 'delta', index: 1, elementIndex: null, value: project.sample.layers[1].delta, step: 0.0001, lowerBound: -0.01, upperBound: 0.01 }]
  return { name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined })
    localStorage.setItem('remagx.expandedSections', JSON.stringify({ 'fit-start-stop': true }))
    window.workerBlocked = false
    window.terminations = 0
    window.results = 0
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener('message', event => { if (event.data.browserTestBlocked) window.workerBlocked = true; if (event.data.type === 'result') window.results++ })
      }
      postMessage(message: { kind?: string }) {
        super.postMessage({ ...message, browserTestBlock: message.kind === window.blockedKind })
      }
      terminate() { window.terminations++; super.terminate() }
    }
  })
  // Inject only into the test-served worker. The infinite loop cannot process Stop messages.
  await page.route('**/assets/worker-*.js', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: `${await response.text()}
      const originalHandler = self.onmessage;
      self.onmessage = event => {
        if (event.data.browserTestBlock) {
          self.postMessage({browserTestBlocked: true});
          while (true) {}
        }
        return originalHandler(event);
      };` })
  })
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
  await (await chooser).setFiles(projectFile())
  await page.getByRole('tab', { name: 'Fit', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
  await expect(page.locator('.mode-panel__stop')).toBeDisabled()
})

// Time from the browser's click event to the resulting DOM state, excluding driver latency.
async function timedClick(page: Page, button: Locator, settledSelector: string) {
  await button.evaluate((element, selector) => {
    window.elapsed = new Promise(resolve => {
      element.addEventListener('click', () => {
        const start = performance.now()
        const observer = new MutationObserver(() => {
          if (document.querySelector(selector)) { observer.disconnect(); resolve(performance.now() - start) }
        })
        observer.observe(document.body, { attributes: true, childList: true, subtree: true, characterData: true })
      }, { once: true, capture: true })
    })
  }, settledSelector)
  await button.click()
  return page.evaluate(() => window.elapsed)
}

async function stop(page: Page) {
  const elapsed = await timedClick(page, page.locator('.mode-panel__stop'), '.mode-panel__stop:disabled')
  expect(elapsed).toBeLessThan(1000)
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
  await expect(page.locator('#section-fit-start-stop')).toContainText('Stopped')
}

test('fit advances twice and tabs respond within 200 ms; Stop settles within 1 s', async ({ page }) => {
  await page.evaluate(() => {
    window.iterations = [0]
    new MutationObserver(() => {
      const value = Number(document.querySelector('.fit-status dd')?.textContent)
      if (Number.isFinite(value) && value > window.iterations.at(-1)!) window.iterations.push(value)
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await page.waitForFunction(() => window.iterations.length >= 3)
  const elapsed = await timedClick(page, page.getByRole('tab', { name: 'Experiment', exact: true }), '#tab-experiment[aria-selected="true"]')
  expect(elapsed).toBeLessThan(200)
  await page.getByRole('tab', { name: 'Fit', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
  await stop(page)
})

for (const kind of ['fit', 'reflectivity', 'chi2']) {
  test(`Stop terminates an unresponsive ${kind} worker within 1 s and calculation recovers`, async ({ page }) => {
    await page.evaluate(kind => { window.blockedKind = kind }, kind)
    await page.getByRole('button', { name: kind === 'fit' ? 'Start' : kind === 'chi2' ? 'χ²' : 'Reflectivity', exact: true }).click()
    await page.waitForFunction(() => window.workerBlocked)
    const elapsed = await timedClick(page, page.locator('.mode-panel__stop'), '.mode-panel__stop:disabled')
    expect(elapsed).toBeLessThan(1000)
    expect(await page.evaluate(() => window.terminations)).toBe(1)
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
    if (kind !== 'reflectivity') await expect(page.locator('#section-fit-start-stop')).toContainText('Stopped')
    const results = await page.evaluate(() => { window.blockedKind = undefined; return window.results })
    await page.getByRole('button', { name: 'Reflectivity', exact: true }).click()
    await page.waitForFunction(previous => window.results > previous, results)
    await expect(page.locator('.mode-panel__stop')).toBeDisabled()
  })
}
