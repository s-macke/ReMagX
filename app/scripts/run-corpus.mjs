// Portable strict entry point; intentionally do not print private paths or env values.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const appDirectory = fileURLToPath(new URL('../', import.meta.url))
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'test/corpus.test.ts', '--reporter=dot'], {
  cwd: appDirectory,
  env: { ...process.env, CORPUS_REQUIRED: '1' },
  stdio: 'inherit',
})
if (result.error) process.stderr.write('Could not launch the private corpus test runner.\n')
process.exitCode = result.status ?? 1
