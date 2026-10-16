// Minimal Chrome DevTools Protocol client for checking the built app in headless Chrome,
// until the Playwright suite exists. Node 22+ (global fetch and WebSocket).
//
//   node cdp.mjs eval <port> "<js expression or async IIFE>"
//   node cdp.mjs shot <port> <out.png> <width> <height> ["<js to run first>"] [delayMs]
//
// Start Chrome first, e.g. with ./start.sh (serves app/dist on :8765, debugging on :9333).

const [command, port, ...args] = process.argv.slice(2)
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve) => ws.addEventListener('open', resolve))

let nextId = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  pending.get(message.id)?.(message)
  pending.delete(message.id)
})
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 500))
  return response.result?.result?.value
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (command === 'eval') {
  console.log(await evaluate(args[0]))
} else if (command === 'shot') {
  const [out, width, height, script = '', delay = '2000'] = args
  await send('Emulation.setDeviceMetricsOverride', { width: Number(width), height: Number(height), deviceScaleFactor: 1, mobile: false })
  await send('Page.reload')
  await sleep(1500)
  if (script) await evaluate(script)
  await sleep(Number(delay))
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
  console.log('status bar:', await evaluate('document.querySelector(".status-bar")?.innerText'))
} else {
  console.error('usage: node cdp.mjs eval|shot <port> ...')
  process.exitCode = 1
}
ws.close()
