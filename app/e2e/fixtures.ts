import { test as base, expect } from '@playwright/test'

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
