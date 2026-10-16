import { mergeFitResult } from '../../src/model/mergeFitResult'
import { applyRealFitParameters } from '../../src/model/realFitParameters'
import { prepareFitDataset } from '../../src/model/fitDataset'
import { importAllFile } from '../../src/import/allFile'
import precisionFixture from '../fixtures/default.all?raw'
import { createDefaultProject, createLayer } from '../../src/model/defaults'
import { createRealComputeService } from '../../src/compute/realComputeService'
Object.assign(window, { realServiceHarness: { mergeFitResult, applyRealFitParameters, prepareFitDataset, importAllFile, precisionFixture, createDefaultProject, createLayer, createRealComputeService } })
