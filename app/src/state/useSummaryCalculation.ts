import { useEffect, useRef, useState } from 'react'
import { WorkerComputeService, ComputeCancelled } from '../compute'
import type { OpticalTable } from '../import/tables'
import type { Project } from '../model/project'
import type { SummaryDataset } from '../model/summary'

// Owns a worker for the snapshot captured on mount. Layout changes do not recalculate.
export function useSummaryCalculation(project: Project, tables: OpticalTable[], reportError: (message: string) => void) {
  const [snapshot] = useState(() => ({ project: structuredClone(project), tables: structuredClone(tables) }))
  const [rows, setRows] = useState<SummaryDataset[] | null>(null)
  const [busy, setBusy] = useState(true)
  const service = useRef<WorkerComputeService | null>(null)
  useEffect(() => {
    const worker = new WorkerComputeService()
    service.current = worker
    let current = true
    worker.summary(snapshot.project, undefined, snapshot.tables).then(result => {
      if (current) setRows(result)
    }).catch(error => { if (current) reportError(error instanceof ComputeCancelled ? 'Stopped. Close and reopen Summary to calculate again.' : String(error.message ?? error)) })
      .finally(() => { if (current) setBusy(false) })
    return () => { current = false; service.current = null; worker.dispose() }
  }, [snapshot, reportError])
  return { rows, busy, stop: () => service.current?.stop() }
}
