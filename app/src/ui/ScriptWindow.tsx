import { useState } from 'react'
import { generateSnippet, snippetLabels, type SnippetKind } from '../model/scriptSnippets'
import { useAppState } from '../state/context'
import { useEditProject } from '../state/useEditProject'
import { LuaEditor } from './LuaEditor'

type ScriptTab = 'default' | 'beforeCalculation'

// Legacy "Script Window" (client/Unit4): Lua scripts with a code generator and an Execute button.
// A floating, non-modal window so the layer table and plot stay usable next to it.
export function ScriptWindow({ onClose }: { onClose: () => void }) {
  const { project } = useAppState()
  const edit = useEditProject()
  const [tab, setTab] = useState<ScriptTab>('beforeCalculation')
  const [line, setLine] = useState(1)
  const [output, setOutput] = useState<string[]>([])

  const code = tab === 'default' ? project.scripts.default : project.scripts.beforeCalculation
  const setCode = (text: string) =>
    edit((p) => {
      if (tab === 'default') p.scripts.default = text
      else p.scripts.beforeCalculation = text
    }, `script:${tab}`)

  const insertSnippet = (kind: SnippetKind) => {
    const lines = generateSnippet(kind, project)
    if (lines.length === 0) {
      setOutput((o) => [...o, `Code generator: nothing to generate for “${snippetLabels[kind]}”.`])
      return
    }
    setCode(`${code}${code === '' || code.endsWith('\n') ? '' : '\n'}${lines.join('\n')}\n`)
  }

  const execute = () =>
    setOutput((o) => [
      ...o,
      `Execute (${tab === 'default' ? 'Default' : 'BeforeCalculation'}): script execution comes with the Lua engine and is not available in the mock yet.`,
    ])

  return (
    <section className="script-window" role="dialog" aria-label="Script Window">
      <header className="script-window__title">
        <span>Script Window</span>
        <button type="button" className="icon-button" aria-label="Close script window" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="tabs" role="tablist">
        {(
          [
            ['default', 'Default'],
            ['beforeCalculation', 'BeforeCalculation'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" className="tabs__tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="script-window__editor">
        <LuaEditor key={tab} label={`${tab} script`} value={code} onChange={setCode} onCursorLine={setLine} />
      </div>
      <div className="script-window__bar">
        <span className="script-window__line">line {line}</span>
        <label>
          Code Generator{' '}
          <select
            className="select"
            value=""
            onChange={(e) => {
              if (e.target.value) insertSnippet(e.target.value as SnippetKind)
            }}
          >
            <option value="">do nothing</option>
            {Object.entries(snippetLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="primary" onClick={execute}>
          Execute
        </button>
      </div>
      <pre className="script-window__output" aria-live="polite">
        {output.length ? output.join('\n') : 'Script output appears here.'}
      </pre>
    </section>
  )
}
