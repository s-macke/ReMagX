import { test, expect } from './fixtures'
import { createDefaultProject } from '../src/model/defaults'

declare global {
  interface Window {
    delayedSave: { pending: boolean; release: () => void; writes: Record<string, string> }
  }
}

for (const saveAs of [false, true]) for (const change of ['edit', 'new', 'open'] as const) {
  test(`delayed ${saveAs ? 'Save As' : 'Save'} preserves ${change === 'edit' ? 'newer unsaved edits' : `a subsequent ${change} project`}`, async ({ page }) => {
    await page.addInitScript(project => {
      const state: Window['delayedSave'] = window.delayedSave = { pending: false, release: () => {}, writes: {} as Record<string, string> }
      let opens = 0
      const handle = (name: string) => ({
        name, kind: 'file', getFile: async () => new File([JSON.stringify(project)], name),
        createWritable: async () => {
          let text = ''
          return {
            write: async (value: string) => { text = value },
            close: async () => {
              state.pending = true
              await new Promise<void>(resolve => { state.release = resolve })
              state.writes[name] = text
              state.pending = false
            },
          }
        },
      }) as unknown as FileSystemFileHandle
      window.showOpenFilePicker = async () => [handle(opens++ ? 'other.json' : 'original.json')]
      window.showSaveFilePicker = async options => handle(options?.suggestedName ?? 'untitled.json')
    }, createDefaultProject())
    await page.goto('/')
    await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
    await expect(page.locator('.menu-bar__file')).toHaveText('original.json')
    const thickness = page.getByRole('textbox', { name: 'thickness of layer 1', exact: true })
    await thickness.fill('20'); await thickness.press('Enter')
    if (saveAs) {
      await page.getByRole('button', { name: 'File', exact: true }).click()
      await page.getByRole('menuitem', { name: /Save As/ }).click()
    } else await page.getByRole('button', { name: 'Save (Ctrl+S)', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.delayedSave.pending)).toBe(true)
    if (change === 'edit') { await thickness.fill('30'); await thickness.press('Enter') }
    else if (change === 'new') await page.getByRole('button', { name: 'New project', exact: true }).click()
    else await page.getByRole('button', { name: 'Open… (Ctrl+O)', exact: true }).click()
    const name = change === 'edit' ? 'original.json • unsaved' : change === 'new' ? 'untitled.json' : 'other.json'
    await expect(page.locator('.menu-bar__file')).toHaveText(name)
    await page.evaluate(() => window.delayedSave.release())
    await expect.poll(() => page.evaluate(() => window.delayedSave.pending)).toBe(false)
    expect(await page.evaluate(() => JSON.parse(window.delayedSave.writes['original.json']).sample.layers[1].thickness)).toBe(20)
    await expect(page.locator('.menu-bar__file')).toHaveText(name)
    await expect(thickness).toHaveValue(change === 'edit' ? '30' : '10')
    await page.getByRole('button', { name: 'Save (Ctrl+S)', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.delayedSave.pending)).toBe(true)
    await page.evaluate(() => window.delayedSave.release())
    const savedName = name.replace(' • unsaved', '')
    await expect(page.locator('.menu-bar__file')).toHaveText(savedName)
    await expect.poll(() => page.evaluate(name => window.delayedSave.writes[name] !== undefined, savedName)).toBe(true)
    expect(await page.evaluate(name => JSON.parse(window.delayedSave.writes[name]).sample.layers[1].thickness, savedName)).toBe(change === 'edit' ? 30 : 10)
  })
}
