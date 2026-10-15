import { StreamLanguage } from '@codemirror/language'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { basicSetup, EditorView } from 'codemirror'
import { useEffect, useRef } from 'react'

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', backgroundColor: 'var(--panel)', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' },
  '.cm-gutters': { backgroundColor: 'var(--panel-alt)', color: 'var(--text-muted)', borderRight: '1px solid var(--border)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--accent-soft)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
})

interface LuaEditorProps {
  value: string
  onChange: (value: string) => void
  onCursorLine?: (line: number) => void
  label: string
}

// CodeMirror 6 editor with Lua highlighting. The document is replaced only when `value` changes
// from outside (e.g. undo, loading a project), so typing keeps the cursor.
export function LuaEditor({ value, onChange, onCursorLine, label }: LuaEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const callbacks = useRef({ onChange, onCursorLine })
  useEffect(() => {
    callbacks.current = { onChange, onCursorLine }
  })

  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      doc: value,
      parent: hostRef.current,
      extensions: [
        basicSetup,
        StreamLanguage.define(lua),
        theme,
        EditorView.contentAttributes.of({ 'aria-label': label }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(update.state.doc.toString())
          if (update.selectionSet || update.docChanged) {
            callbacks.current.onCursorLine?.(update.state.doc.lineAt(update.state.selection.main.head).number)
          }
        }),
      ],
    })
    viewRef.current = view
    return () => view.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor is created once; value updates are handled below
  }, [label])

  useEffect(() => {
    const view = viewRef.current
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    }
  }, [value])

  return <div className="lua-editor" ref={hostRef} />
}
