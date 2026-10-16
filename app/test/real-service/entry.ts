import { importAllFile } from '../../src/import/allFile'
import precisionFixture from '../fixtures/default.all?raw'
import { createDefaultProject, createLayer } from '../../src/model/defaults'
import { createRealComputeService } from '../../src/compute/realComputeService'
Object.assign(window, { realServiceHarness: { importAllFile, precisionFixture, createDefaultProject, createLayer, createRealComputeService } })
