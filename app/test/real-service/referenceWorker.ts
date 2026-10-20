import { startRealWorker } from '../../src/compute/realWorkerRuntime'

// Private comparison bootstrap only; samples stay in worker memory. Requests
// queued after this first message use the unchanged production protocol.
self.onmessage = (event: MessageEvent<{ kind: string; samples: number[] }>) => {
  if (event.data.kind !== 'referenceLookup') throw new Error('Missing reference lookup bootstrap.')
  startRealWorker(event.data.samples)
}
