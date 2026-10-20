import { startRealWorker } from '../../src/compute/realWorkerRuntime'

// Controlled analytical lookup for integration tests only.
startRealWorker(Array(1001).fill(0))
