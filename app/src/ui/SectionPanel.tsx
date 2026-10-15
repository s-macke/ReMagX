import { useState, type ReactNode } from 'react'

const STORAGE_KEY = 'remagx.expandedSections'

function loadExpanded(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

function saveExpanded(state: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage unavailable (private mode): expansion state is just not remembered.
  }
}

export interface Section {
  id: string
  title: string
  content: ReactNode
  hidden?: boolean // context-dependent visibility (legacy "active" flag)
}

// The legacy collapsible section stack (BoxFrames): a header bar per section that opens and
// closes it; the stack scrolls. The open/closed state is remembered per browser (D-18).
export function SectionPanel({ sections }: { sections: Section[] }) {
  const [expanded, setExpanded] = useState(loadExpanded)

  const toggle = (id: string) => {
    const next = { ...expanded, [id]: !expanded[id] }
    setExpanded(next)
    saveExpanded(next)
  }

  return (
    <div className="section-panel">
      {sections
        .filter((section) => !section.hidden)
        .map((section) => {
          const open = expanded[section.id] ?? false
          return (
            <div className="section" key={section.id}>
              <button
                type="button"
                className="section__header"
                aria-expanded={open}
                aria-controls={`section-${section.id}`}
                onClick={() => toggle(section.id)}
              >
                {section.title}
              </button>
              {open && (
                <div className="section__body" id={`section-${section.id}`}>
                  {section.content}
                </div>
              )}
            </div>
          )
        })}
    </div>
  )
}
