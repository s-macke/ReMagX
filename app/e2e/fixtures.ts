import { test as base, expect, type Page } from '@playwright/test'

// Static files are the only allowed network dependency, including worker requests.
export const test = base.extend({
  context: async ({ context }, runTest) => {
    const unexpected: string[] = []
    await context.route('**/*', async route => {
      if (new URL(route.request().url()).origin === 'http://127.0.0.1:4173') await route.continue()
      else { unexpected.push(route.request().url()); await route.abort() }
    })
    await runTest(context)
    expect(unexpected, 'The app must not request external services').toEqual([])
  },
})
export { expect }

// Public synthetic tables required by the original standalone energy-scan path.
export async function loadEnergyTables(page: Page) {
  await page.getByRole('tab', { name: 'Sample', exact: true }).click()
  const section = page.getByRole('button', { name: 'Optical Constants Database', exact: true })
  if (await section.getAttribute('aria-expanded') !== 'true') await section.click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Load tables…', exact: true }).click()
  await (await chooser).setFiles(['Cu', 'Co', 'vacuum'].map(name => ({
    name: `${name}.db`, mimeType: 'text/plain',
    buffer: Buffer.from(name === 'vacuum' ? '600 0 0\n1000 0 0' : '600 .001 .0001\n1000 .001 .0001'),
  })))
}
