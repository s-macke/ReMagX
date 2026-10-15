import { isAmbient, isSubstrate } from '../model/layers'
import type { Layer } from '../model/project'
import { useAppState, useDispatch } from '../state/context'
import { NumberCell } from './NumberCell'

type NumericField = 'thickness' | 'delta' | 'beta' | 'roughness' | 'deltaMag' | 'betaMag'

const columns: { field: NumericField; header: string; title: string; min?: number }[] = [
  { field: 'thickness', header: 'thickness / Å', title: 'Layer thickness in Å', min: 0 },
  { field: 'delta', header: 'δ', title: 'Optical constant delta (n = 1 − δ + iβ)' },
  { field: 'beta', header: 'β', title: 'Optical constant beta' },
  { field: 'roughness', header: 'σ', title: 'Roughness of the interface on top of the layer in Å', min: 0 },
  { field: 'deltaMag', header: 'δm', title: 'Magnetic delta' },
  { field: 'betaMag', header: 'βm', title: 'Magnetic beta' },
]

// The layer stack, shown top-down like the legacy program: "air" (ambient) first, "bulk"
// (substrate) last, numbered layers in between.
export function LayerTable() {
  const { project, selectedLayer } = useAppState()
  const dispatch = useDispatch()
  const layers = project.sample.layers
  const rows = layers.map((layer, index) => ({ layer, index })).reverse()

  const rowLabel = (index: number) =>
    isAmbient(project, index) ? 'air' : isSubstrate(index) ? 'bulk' : String(index)

  const update = (index: number, patch: Partial<Layer>) => dispatch({ type: 'updateLayer', index, patch })

  return (
    <div className="layer-table" role="region" aria-label="Layer stack">
      <table>
        <thead>
          <tr>
            <th scope="col">layers</th>
            <th scope="col" title={columns[0].title}>
              {columns[0].header}
            </th>
            <th scope="col" title="Optical-constant table (legacy .db file)">
              db
            </th>
            {columns.slice(1).map((c) => (
              <th scope="col" key={c.field} title={c.title}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ layer, index }) => {
            const outer = isAmbient(project, index) || isSubstrate(index)
            return (
              <tr
                key={index}
                className={index === selectedLayer ? 'is-selected' : undefined}
                onFocusCapture={() => dispatch({ type: 'selectLayer', index })}
                onClick={() => dispatch({ type: 'selectLayer', index })}
              >
                <th scope="row">{rowLabel(index)}</th>
                <td>
                  {outer ? (
                    <span className="layer-table__none">--</span>
                  ) : (
                    <NumberCell
                      label={`thickness of layer ${index}`}
                      value={layer.thickness}
                      min={0}
                      onCommit={(thickness) => update(index, { thickness })}
                    />
                  )}
                </td>
                <td>
                  <input
                    className="text-cell"
                    aria-label={`optical table of layer ${rowLabel(index)}`}
                    value={layer.opticalTable}
                    onChange={(event) => dispatch({ type: 'updateLayer', index, patch: { opticalTable: event.target.value }, coalesce: `table:${index}` })}
                  />
                </td>
                {columns.slice(1).map((c) => (
                  <td key={c.field}>
                    <NumberCell
                      label={`${c.header} of layer ${rowLabel(index)}`}
                      value={layer[c.field]}
                      min={c.min}
                      onCommit={(value) => update(index, { [c.field]: value })}
                    />
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
