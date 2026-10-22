import { remapStackFitTargets } from './fitTargets'
import { remapProfileBindings } from './magneticProfiles'
import { layerSchema, type Layer, type Project } from './project'

export function applyLayerConversion(project: Project, layers: Layer[]): { project: Project; notes: string[] } {
  if (!layers.length || layers.some(layer => !layerSchema.safeParse(layer).success)) throw new Error('The engine returned an invalid layer list.')
  if (layers.length === 1) throw new Error('Conversion produced one layer. The project format currently requires separate substrate and ambient layers, so this result cannot be applied. The original project is unchanged.')
  const oldLast = project.sample.layers.length - 1
  const newLast = layers.length - 1
  const mapIndex = (index: number) => index === 0 ? 0 : index === oldLast ? newLast : null
  const parameters = remapStackFitTargets(project.fit.parameters, 'layer', mapIndex)
  const profiles = remapProfileBindings(project, layers.length, mapIndex).map((profile, index) => {
    const binding = project.sample.depthProfileFunctions[index].boundToLayer
    return binding !== null && binding > project.sample.layers.length ? { ...profile, boundToLayer: layers.length } : profile
  })
  const removed = project.fit.parameters.length - parameters.length
  const unbound = profiles.filter((profile, index) => profile.boundToLayer === layers.length && project.sample.depthProfileFunctions[index].boundToLayer !== project.sample.layers.length).length
  const notes = [
    ...(project.sample.mode === 'element' ? ['The stored compound layer list will be replaced. Element profiles, element fit targets and Element Mode are retained. Switch to compound mode to inspect the generated layers.'] : []),
    `${project.sample.layers.length} layers will be replaced by ${layers.length} layers, including substrate and ambient.`,
    `${removed} fit parameter(s) attached to replaced interior or unresolved layers will be removed; substrate/ambient targets will follow their layers.`,
    `${unbound} magnetic profile binding(s) to replaced interior or unresolved layers will become “none”. Profile values and couplings are retained.`,
    'Undo restores the original stack and all references. Scripts and other project settings are retained; check any script references to layer numbers.',
  ]
  return { project: { ...project, sample: { ...project.sample, layers: structuredClone(layers), depthProfileFunctions: profiles }, fit: { ...project.fit, parameters } }, notes }
}
