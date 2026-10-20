import { compareDiagnosticColumns } from './diagnosticComparison'
import { diagnosticCategory, withDiagnosticDeadline } from './diagnosticCategory'
import { parseOpticalTable } from '../../src/import/tables'
import { WorkerComputeService, type WorkerPort } from '../../src/compute/WorkerComputeService'
import type { OpticalTable } from '../../src/import/tables'
import { applyDatabaseValues } from '../../src/model/databaseValues'
import { projectSchema } from '../../src/model/project'
import { mountFitPreview, renderFourierPlot } from './preview'
import { mergeFitResult } from '../../src/model/mergeFitResult'
import { applyRealFitParameters } from '../../src/model/realFitParameters'
import { prepareFitDataset } from '../../src/model/fitDataset'
import { importAllFile } from '../../src/import/allFile'
import precisionFixture from '../fixtures/default.all?raw'
import { createDefaultProject, createLayer } from '../../src/model/defaults'
import { createRealComputeService } from '../../src/compute/realComputeService'
const createSegmentedComputeService = (getTables: () => OpticalTable[] = () => []) => new WorkerComputeService(
  () => new Worker(new URL('./segmentedWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerPort, getTables, true)
const createReferenceComputeService = (samples: readonly number[]) => {
  const lookup = Array.from(samples)
  return new WorkerComputeService(() => {
    const worker = new Worker(new URL('./referenceWorker.ts', import.meta.url), { type: 'module' })
    worker.postMessage({ kind: 'referenceLookup', samples: lookup })
    return worker as unknown as WorkerPort
  }, undefined, true)
}
Object.assign(window, { realServiceHarness: { compareDiagnosticColumns, diagnosticCategory, withDiagnosticDeadline, createReferenceComputeService, parseOpticalTable, createSegmentedComputeService, applyDatabaseValues, projectSchema, renderFourierPlot, mountFitPreview, mergeFitResult, applyRealFitParameters, prepareFitDataset, importAllFile, precisionFixture, createDefaultProject, createLayer, createRealComputeService } })
