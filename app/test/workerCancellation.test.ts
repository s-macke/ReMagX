import { once } from 'node:events'
import { Worker as NodeWorker } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import { ComputeCancelled } from '../src/compute/ComputeService'
import { WorkerComputeService, type WorkerPort } from '../src/compute/WorkerComputeService'
import { createDefaultProject } from '../src/model/defaults'

// Node-only integration tests stay outside the browser TypeScript compilation.
describe('blocked worker cancellation', () => {
  it.each(['fit', 'reflectivity'] as const)('terminates a genuinely blocked %s worker within one second', async (kind) => {
    // A real worker thread blocked in an evaluation cannot read its Stop message.
    // This exercises termination and elapsed wall time without depending on browser binaries.
    const thread = new NodeWorker(`
      const { parentPort } = require('node:worker_threads');
      parentPort.on('message', () => {
        parentPort.postMessage('evaluating');
        while (true) {}
      });
    `, { eval: true })
    let began: () => void = () => {}
    const evaluating = new Promise<void>((resolve) => { began = resolve })
    thread.once('message', began)
    const port: WorkerPort = {
      onmessage: null, onerror: null, onmessageerror: null,
      postMessage: (message) => thread.postMessage(message),
      terminate: () => { void thread.terminate() },
    }
    const service = new WorkerComputeService(() => port)
    try {
      const result = kind === 'fit' ? service.startFit(createDefaultProject(), () => {}) : service.calcReflectivity(createDefaultProject())
      const failure = expect(result).rejects.toBeInstanceOf(ComputeCancelled)
      await evaluating
      const start = performance.now()
      const exited = once(thread, 'exit', { signal: AbortSignal.timeout(1000) })
      service.stop()
      await failure
      await exited
      expect(performance.now() - start).toBeLessThan(1000)
    } finally {
      service.dispose()
      await thread.terminate()
    }
  })
})
