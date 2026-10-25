import type { Project } from './project'

// D-25 defers these physical models. Keep saved targets editable/importable,
// but never optimize them against an unrelated reflectivity objective.
export function assertSupportedFitTargets(project: Project): void {
  for (const { target } of project.fit.parameters) {
    const feature = target === 'betaKramersKronig' || target === 'deltaKramersKronig'
      ? 'Kramers-Kronig' : target === 'electronEscapeDepth' || target === 'electronGain' ? 'TEY' : undefined
    if (feature) throw new Error(`Fit parameter "${target}" requires ${feature}, which is deferred. Remove this parameter from the fit list to fit supported parameters.`)
  }
}
