const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
Object.assign(window, {
  luaResult: new Promise((resolve, reject) => {
    worker.onmessage = event => { resolve(event.data); worker.terminate() }
    worker.onerror = event => { reject(new Error(event.message)); worker.terminate() }
  }),
})
