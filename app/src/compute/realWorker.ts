import { startRealWorker } from './realWorkerRuntime'

// The deployed app still uses the mock; this real entry has no default lookup.
startRealWorker()
