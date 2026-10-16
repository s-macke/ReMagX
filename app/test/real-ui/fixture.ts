import { createDefaultProject, createLayer } from '../../src/model/defaults'
import { createRealComputeService } from '../../src/compute/realComputeService'

export async function createRealUiFixture() {
  const project = createDefaultProject()
  project.sample.layers = [createLayer({ delta: .01, beta: .002 }),
    ...Array.from({ length: 100 }, (_, index) => createLayer({ thickness: index % 2 ? 20 : 35,
      delta: index % 2 ? .004 : .006, beta: .001, roughness: 1 })), createLayer()]
  project.experiment.qzScan = { ...project.experiment.qzScan, qzMin: .02, qzMax: .25, points: 10000 }
  const service = createRealComputeService()
  try {
    const truth = await service.calcReflectivity(project)
    project.datasets = [{ title: 'Synthetic native UI timing fixture', comment: '', sourceFile: '',
      energy: project.experiment.energy, energyShift: 0, qzShift: 0, angularResolution: 0,
      intensityScale: 1, intensityOffset: 0, active: true, errorWeight: 1,
      polarization: project.experiment.polarization, columns: { qz: truth.qz, reflectivity: truth.reflectivity } }]
  } finally { service.dispose() }
  project.activeDatasetIndex = 0
  project.sample.layers[1].thickness = 30
  project.fit.algorithm = 'simplex'; project.fit.occamQ = 0
  project.fit.parameters = [
    { target: 'thickness', index: 1, elementIndex: null, value: 30, step: 0, lowerBound: 20, upperBound: 50 },
    { target: 'roughness', index: 1, elementIndex: null, value: 2, step: 0, lowerBound: 0, upperBound: 5 },
    { target: 'delta', index: 1, elementIndex: null, value: .005, step: 0, lowerBound: .003, upperBound: .008 },
  ]
  return project
}
