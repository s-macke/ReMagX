// Compute Web Worker entry point. Today it hosts the TypeScript mock engine; later the
// WebAssembly engine is loaded here behind the same message protocol.

import { createRequestHandler } from './mockEngine'
import type { WorkerRequest } from './protocol'

const handle = createRequestHandler((response) => self.postMessage(response))

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void handle(event.data)
}
