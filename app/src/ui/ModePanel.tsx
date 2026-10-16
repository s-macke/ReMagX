import type { DisplayMode } from '../state/appState'
import { useAppState, useDispatch } from '../state/context'

// The legacy 2.6 mode list (Unit1.dfm RadioGroup1).
const modes: { value: DisplayMode; label: string; disabled?: boolean }[] = [
  { value: 'monochromatic', label: 'Monochromatic' },
  { value: 'dichroic', label: 'Dichroic' },
  { value: 'asymmetry', label: 'Asymmetry' },
]

// Bottom-right panel of the legacy window: what to show and which scan to calculate.
export function ModePanel() {
  const { displayMode, scanKind, plotView } = useAppState()
  const dispatch = useDispatch()
  return (
    <section className="mode-panel" aria-label="Mode">
      <fieldset>
        <legend>Mode</legend>
        <div className="mode-panel__options">
          {modes.map((m) => (
            <label key={m.value} className={m.disabled ? 'is-disabled' : undefined} title={m.disabled ? 'Not available yet' : undefined}>
              <input
                type="radio"
                name="display-mode"
                value={m.value}
                checked={displayMode === m.value}
                disabled={m.disabled}
                onChange={() => dispatch({ type: 'setDisplayMode', displayMode: m.value })}
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mode-panel__scans">
        <button
          type="button"
          aria-pressed={plotView === 'scan' && scanKind === 'reflectivity'}
          onClick={() => dispatch({ type: 'setScanKind', scanKind: 'reflectivity' })}
        >
          Reflectivity
        </button>
        <button
          type="button"
          aria-pressed={plotView === 'scan' && scanKind === 'energyScan'}
          onClick={() => dispatch({ type: 'setScanKind', scanKind: 'energyScan' })}
        >
          Energy Scan
        </button>
      </div>
    </section>
  )
}
