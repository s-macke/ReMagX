// Production compute entry: real double-precision WASM, with no mock fallback.
import { startRealWorker } from './realWorkerRuntime'

startRealWorker(undefined, import.meta.env.REMAGX_CORE_VERSION)
