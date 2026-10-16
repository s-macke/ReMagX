import { useCallback, useState } from 'react'
import { LayerSpectrumActions, LayerSpectrumMenu, type LayerMenuPosition } from './LayerSpectrumMenu'
import { canRemoveSlab, updateElement, updateSlab } from '../model/elements'
import { isAmbient, isSubstrate } from '../model/layers'
import type { Layer } from '../model/project'
import { useDatabaseUpdate } from '../state/useDatabaseUpdate'
import { useAppState, useDispatch } from '../state/context'
import { FittableNumberCell } from './FittableNumberCell'
import { NumberCell } from './NumberCell'

type NumericField = 'delta' | 'beta' | 'roughness' | 'deltaMag' | 'betaMag'

interface Column {
  field: NumericField
  header: string
  title: string
  min?: number
}

const opticalColumns: Column[] = [
  { field: 'delta', header: 'δ', title: 'Optical constant delta (n = 1 − δ + iβ)' },
  { field: 'beta', header: 'β', title: 'Optical constant beta' },
  { field: 'roughness', header: 'σ', title: 'Roughness of the interface on top of the layer in Å', min: 0 },
  { field: 'deltaMag', header: 'δm', title: 'Magnetic delta' },
  { field: 'betaMag', header: 'βm', title: 'Magnetic beta' },
]

function rowLabel(index: number, count: number): string {
  if (index === count - 1) return 'air'
  if (index === 0) return 'bulk'
  return String(index)
}

// The layer stack, shown top-down like the legacy program: "air" (ambient) first, "bulk"
// (substrate) last, numbered layers in between. In element mode it shows the slabs of the
// selected element instead (legacy SchichtEingabe in element mode).
export function LayerTable({ onProperties }: { onProperties: (index: number) => void }) {
  const { project } = useAppState()
  const dispatch = useDispatch()
  return <div className="layer-stack__table" onFocusCapture={event => {
    if (!(event.target instanceof HTMLInputElement) || !event.target.classList.contains('number-cell')) dispatch({ type: 'clearValueCell' })
  }} onPointerDownCapture={event => {
    if (!(event.target as HTMLElement).closest('input.number-cell')) dispatch({ type: 'clearValueCell' })
  }}>{project.sample.mode === 'element' ? <ElementLayerTable /> : <CompoundLayerTable onProperties={onProperties} />}</div>
}

function CompoundLayerTable({ onProperties }: { onProperties: (index: number) => void }) {
  const { project, selectedLayer } = useAppState()
  const dispatch = useDispatch()
  const layers = project.sample.layers
  const rows = layers.map((layer, index) => ({ layer, index })).reverse()
  const [menu, setMenu] = useState<LayerMenuPosition | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const showMagnetization = project.calculation.magnetization.mode !== 'none'

  const update = (index: number, patch: Partial<Layer>) => dispatch({ type: 'updateLayer', index, patch })
  const label = (index: number) => rowLabel(index, layers.length)

  return (
    <div className="layer-table" role="region" aria-label="Layer stack">
      <table>
        <thead>
          <tr>
            <th scope="col">layers</th>
            <th scope="col" title="Layer thickness in Å">
              thickness / Å
            </th>
            <th scope="col" title="Optical-constant table (legacy .db file)">
              db
            </th>
            <th scope="col" title="Chemical formula or material name">
              material
            </th>
            <th scope="col" title="Mass density in g/cm³">
              density
            </th>
            {opticalColumns.map((c) => (
              <th scope="col" key={c.field} title={c.title}>
                {c.header}
              </th>
            ))}
            {showMagnetization && (
              <>
                <th scope="col" title="Magnetization direction: polar angle γ in degrees">
                  mag γ
                </th>
                <th scope="col" title="Magnetization direction: azimuth φ in degrees">
                  mag φ
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ layer, index }) => {
            const outer = isAmbient(project, index) || isSubstrate(index)
            return (
              <tr
                key={index}
                className={index === selectedLayer ? 'is-selected' : undefined}
                onContextMenu={event => {
                  if (event.defaultPrevented) return
                  event.preventDefault()
                  setMenu({ index, left: event.clientX, top: event.clientY, anchor: event.target as HTMLElement })
                }}
                onKeyDown={event => {
                  if (event.defaultPrevented) return
                  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    event.preventDefault()
                    const anchor = event.target as HTMLElement
                    const bounds = anchor.getBoundingClientRect()
                    setMenu({ index, left: bounds.left, top: bounds.bottom, anchor })
                  }
                }}
                onFocusCapture={() => dispatch({ type: 'selectLayer', index })}
                onClick={() => dispatch({ type: 'selectLayer', index })}
              >
                <th scope="row">{label(index)}</th>
                <td>
                  {outer ? (
                    <span className="layer-table__none">--</span>
                  ) : (
                    <FittableNumberCell extraActions={<LayerSpectrumActions index={index} onProperties={onProperties} />} sliderTarget={{ kind: 'layer', field: 'thickness', index }} fitTarget={{ target: 'thickness', index, elementIndex: null }} label={`thickness of layer ${index}`} value={layer.thickness} min={0} onCommit={(thickness) => update(index, { thickness })} />
                  )}
                </td>
                <td>
                  <input
                    className="text-cell"
                    aria-label={`optical table of layer ${label(index)}`}
                    value={layer.opticalTable}
                    onChange={(event) => dispatch({ type: 'updateLayer', index, patch: { opticalTable: event.target.value }, coalesce: `table:${index}` })}
                  />
                </td>
                <td>
                  <input
                    className="text-cell"
                    aria-label={`material of layer ${label(index)}`}
                    value={layer.material}
                    onChange={(event) => dispatch({ type: 'updateLayer', index, patch: { material: event.target.value }, coalesce: `material:${index}` })}
                  />
                </td>
                <td>
                  <NumberCell sliderTarget={{ kind: 'layer', field: 'density', index }} label={`density of layer ${label(index)}`} value={layer.density} min={0} onCommit={(density) => update(index, { density })} />
                </td>
                {opticalColumns.map((c) => (
                  <td key={c.field}>
                    <FittableNumberCell extraActions={<LayerSpectrumActions index={index} onProperties={onProperties} />} sliderTarget={{ kind: 'layer', field: c.field, index }} fitTarget={{ target: c.field, index, elementIndex: null }} label={`${c.header} of layer ${label(index)}`} value={layer[c.field]} min={c.min} onCommit={(value) => update(index, { [c.field]: value })} />
                  </td>
                ))}
                {showMagnetization && (
                  <>
                    <td>
                      <NumberCell
                        sliderTarget={{ kind: 'layer', field: 'gamma', index }}
                        label={`magnetization gamma of layer ${label(index)}`}
                        value={layer.magnetization.gamma}
                        onCommit={(gamma) => update(index, { magnetization: { ...layer.magnetization, gamma } })}
                      />
                    </td>
                    <td>
                      <NumberCell
                        sliderTarget={{ kind: 'layer', field: 'phi', index }}
                        label={`magnetization phi of layer ${label(index)}`}
                        value={layer.magnetization.phi}
                        onCommit={(phi) => update(index, { magnetization: { ...layer.magnetization, phi } })}
                      />
                    </td>
                  </>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {menu && <LayerSpectrumMenu position={menu} close={closeMenu} onProperties={onProperties} />}
    </div>
  )
}

function ElementLayerTable() {
  const updateDatabase = useDatabaseUpdate()
  const { databaseUpdate } = useAppState()
  const databaseAction = <button type="button" role="menuitem" disabled={databaseUpdate.busy} onClick={updateDatabase}>Get f1/f2 from database</button>
  const { project, selectedLayer, selectedElement } = useAppState()
  const dispatch = useDispatch()
  const elements = project.sample.elementProfiles
  const current = Math.min(selectedElement, Math.max(0, elements.length - 1))
  const element = elements[current]
  const update = (fn: (p: typeof project) => typeof project) => dispatch({ type: 'updateProject', update: fn })

  if (!element) {
    return (
      <div className="layer-table layer-table--empty" role="region" aria-label="Element layers">
        <p className="note">Element mode: this project defines no elements.</p>
      </div>
    )
  }
  const slabs = element.slabs
  const rows = slabs.map((slab, index) => ({ slab, index })).reverse()
  const fields = [
    ['f1', 'f1'],
    ['f2', 'f2'],
    ['f1Mag', 'f1m'],
    ['f2Mag', 'f2m'],
  ] as const

  return (
    <div className="layer-table" role="region" aria-label={`Layers of element ${element.element}`}>
      <div className="element-bar">
        <button type="button" aria-label="previous element" disabled={current === 0} onClick={() => dispatch({ type: 'selectElement', index: current - 1 })}>
          &lt;&lt;
        </button>
        <strong className="element-bar__name">{element.element || '--'}</strong>
        <button type="button" aria-label="next element" disabled={current === elements.length - 1} onClick={() => dispatch({ type: 'selectElement', index: current + 1 })}>
          &gt;&gt;
        </button>
        <span className="element-bar__count">
          element {current + 1} / {elements.length}
        </span>
        {fields.map(([field, label]) => (
          <label key={field} className="element-bar__field">
            {label}
            <FittableNumberCell extraActions={databaseAction} sliderTarget={{ kind: 'element', index: current, field }} fitTarget={{ target: ({ f1: 'elementF1', f2: 'elementF2', f1Mag: 'elementF1Mag', f2Mag: 'elementF2Mag' } as const)[field], index: null, elementIndex: current }} label={`${label} of ${element.element}`} value={element[field]} onCommit={(v) => update((p) => updateElement(p, current, { [field]: v }))} />
          </label>
        ))}
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">layers</th>
            <th scope="col">thickness / Å</th>
            <th scope="col" title="Density of the element in this slab">
              density [mol/cm³]
            </th>
            <th scope="col" title="Roughness of the interface on top of the slab in Å">
              σ
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ slab, index }) => {
            const outer = !canRemoveSlab(project, current, index)
            return (
              <tr key={index} className={index === selectedLayer ? 'is-selected' : undefined} onFocusCapture={() => dispatch({ type: 'selectLayer', index })} onClick={() => dispatch({ type: 'selectLayer', index })}>
                <th scope="row">{rowLabel(index, slabs.length)}</th>
                <td>
                  {outer ? (
                    <span className="layer-table__none">--</span>
                  ) : (
                    <FittableNumberCell extraActions={databaseAction} sliderTarget={{ kind: 'slab', field: 'thickness', index, element: current }} fitTarget={{ target: 'elementThickness', index, elementIndex: current }} label={`thickness of slab ${index}`} value={slab.thickness} min={0} onCommit={(thickness) => update((p) => updateSlab(p, current, index, { thickness }))} />
                  )}
                </td>
                <td>
                  <FittableNumberCell extraActions={databaseAction} sliderTarget={{ kind: 'slab', field: 'density', index, element: current }} fitTarget={{ target: 'elementDensity', index, elementIndex: current }} label={`density of slab ${index}`} value={slab.density} min={0} onCommit={(density) => update((p) => updateSlab(p, current, index, { density }))} />
                </td>
                <td>
                  <FittableNumberCell extraActions={databaseAction} sliderTarget={{ kind: 'slab', field: 'roughness', index, element: current }} fitTarget={{ target: 'elementRoughness', index, elementIndex: current }} label={`roughness of slab ${index}`} value={slab.roughness} min={0} onCommit={(roughness) => update((p) => updateSlab(p, current, index, { roughness }))} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
