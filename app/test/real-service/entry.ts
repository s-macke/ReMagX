import { createDefaultProject, createLayer } from '../../src/model/defaults'
import { createRealComputeService } from '../../src/compute/realComputeService'
Object.assign(window, { realServiceHarness: { createDefaultProject, createLayer, createRealComputeService } })
