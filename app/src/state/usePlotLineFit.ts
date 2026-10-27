import { useEffect, useRef, useState } from 'react'
import { WorkerComputeService, ComputeCancelled } from '../compute'
import type { LineFitRequest, LineFitResult } from '../model/lorentzianStep'

// A separate service isolates this chart-only operation from project fits/calculations.
// Selection/source changes revoke the result and terminate any outstanding request.
export function usePlotLineFit(input: LineFitRequest | null) {
  const [state, setState] = useState<{ input: LineFitRequest | null; result: LineFitResult | null; busy: boolean; message: string }>({ input: null, result: null, busy: false, message: '' })
  const session = useRef<{ worker: WorkerComputeService | null; generation: number }>({ worker: null, generation: 0 })
  useEffect(() => {
    const lifetime: typeof session.current = { worker: null, generation: 0 }
    session.current = lifetime
    return () => { lifetime.generation++; lifetime.worker?.dispose(); lifetime.worker = null }
  }, [input])
  const start = async () => {
    if (!input) return
    const lifetime = session.current, token = ++lifetime.generation
    lifetime.worker?.dispose()
    const worker = new WorkerComputeService()
    lifetime.worker = worker
    setState({ input, result: null, busy: true, message: 'Fitting Lorentzian+Step…' })
    try {
      const result = await worker.fitLine(input)
      if (lifetime.generation === token) setState({ input, result, busy: false,
        message: `Line fit: ${result.termination}; squared error ${result.squaredError}.` })
    } catch (error) {
      if (lifetime.generation === token) setState({ input, result: null, busy: false,
        message: error instanceof ComputeCancelled ? 'Line fit stopped.' : (error as Error).message })
    } finally {
      worker.dispose()
      if (lifetime.worker === worker) lifetime.worker = null
    }
  }
  return { ...(state.input === input ? state : { result: null, busy: false, message: '' }), start, stop: () => session.current.worker?.stop() }
}
