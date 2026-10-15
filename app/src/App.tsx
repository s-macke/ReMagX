import { useEffect, useState } from 'react'
import { WorkerComputeService } from './compute'
import { createDefaultProject } from './model/defaults'

export default function App() {
  // Temporary check that the compute worker runs; replaced by the real UI in step 5.
  const [status, setStatus] = useState('Computing the default project in the compute worker…')
  useEffect(() => {
    const service = new WorkerComputeService()
    service
      .calcReflectivity(createDefaultProject())
      .then((curve) => setStatus(`Compute worker OK: ${curve.qz.length} points, R(qz=${curve.qz[1].toFixed(4)}) = ${curve.reflectivity[1].toExponential(4)}`))
      .catch((error: Error) => setStatus(`Compute worker failed: ${error.message}`))
    return () => service.dispose()
  }, [])

  return (
    <main className="placeholder">
      <h1>ReMagX</h1>
      <p>Web version under construction. Resonant magnetic X-ray reflectivity, in the browser.</p>
      <p>Mock only: the calculations are a simplified stand-in, not the real ReMagX engine.</p>
      <p>{status}</p>
    </main>
  )
}
