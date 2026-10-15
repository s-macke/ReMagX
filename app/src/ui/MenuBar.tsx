import { useEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onSelect?: () => void
  disabled?: boolean
  checked?: boolean
}

export interface Menu {
  label: string
  items: (MenuItem | 'separator')[]
}

// Classic drop-down menu bar (File, Mode, Script, Layer, Help).
export function MenuBar({ menus, title }: { menus: Menu[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null)
  const barRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (open === null) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event instanceof MouseEvent && barRef.current?.contains(event.target as Node)) return
      setOpen(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <nav className="menu-bar" ref={barRef} aria-label="Main menu">
      <span className="menu-bar__title">ReMagX</span>
      {menus.map((menu, i) => (
        <div className="menu" key={menu.label}>
          <button
            type="button"
            className="menu__button"
            aria-haspopup="menu"
            aria-expanded={open === i}
            onClick={() => setOpen(open === i ? null : i)}
            onMouseEnter={() => open !== null && setOpen(i)}
          >
            {menu.label}
          </button>
          {open === i && (
            <ul className="menu__list" role="menu">
              {menu.items.map((item, k) =>
                item === 'separator' ? (
                  <li key={`sep-${k}`} className="menu__separator" role="separator" />
                ) : (
                  <li key={item.label} role="none">
                    <button
                      type="button"
                      role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                      aria-checked={item.checked}
                      disabled={item.disabled}
                      className="menu__item"
                      onClick={() => {
                        setOpen(null)
                        item.onSelect?.()
                      }}
                    >
                      <span className="menu__check">{item.checked ? '●' : ''}</span>
                      {item.label}
                    </button>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      ))}
      <span className="menu-bar__file" title={title}>
        {title}
      </span>
    </nav>
  )
}
