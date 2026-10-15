// "Code Generator" of the legacy script window: Lua snippets built from the current project
// (client/Unit1.cpp, ComboBox1Change). Layer loops skip the ambient medium, as in legacy.

import type { Project } from './project'

export type SnippetKind = 'deltaBetaRatio' | 'magneticRatio' | 'layerCoupling' | 'roughnessBoundaryCheck'

export const snippetLabels: Record<SnippetKind, string> = {
  deltaBetaRatio: 'delta / beta ratio',
  magneticRatio: 'deltam / betam ratio',
  layerCoupling: 'coupling of layers',
  roughnessBoundaryCheck: 'sigma boundary check',
}

export function generateSnippet(kind: SnippetKind, project: Project): string[] {
  const layers = project.sample.layers.slice(0, -1)
  switch (kind) {
    case 'deltaBetaRatio':
      return layers.flatMap((layer, i) =>
        layer.delta === 0 ? [] : [`beta[${i}] = ${(layer.beta / layer.delta).toFixed(10)} * delta[${i}]`],
      )
    case 'magneticRatio':
      return layers.flatMap((layer, i) =>
        layer.deltaMag === 0 ? [] : [`betam[${i}] = ${(layer.betaMag / layer.deltaMag).toFixed(10)} * deltam[${i}]`],
      )
    case 'layerCoupling':
      return ['thickness[1] = thickness[2]', 'delta[1] = delta[2]', 'beta[1] = beta[2]', 'deltam[1] = deltam[2]', 'betam[1] = betam[2]', 'sigma[1] = sigma[2]']
    case 'roughnessBoundaryCheck':
      return [`for i = 0, ${project.sample.layers.length - 1}, 1 do`, '    if (sigma[i] > thickness[i]) then sigma[i] = thickness[i] end', 'end']
  }
}
