import { useEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onSelect?: () => void
  disabled?: boolean
  checked?: boolean
  items?: MenuEntry[] // submenu (opens to the right on hover or focus)
}

export type MenuEntry = MenuItem | 'separator'

export interface Menu {
  label: string
  items: MenuEntry[]
}

function MenuList({ items, onClose, submenu }: { items: MenuEntry[]; onClose: () => void; submenu?: boolean }) {
  return (
    <ul className={submenu ? 'menu__list menu__list--sub' : 'menu__list'} role="menu">
      {items.map((item, k) =>
        item === 'separator' ? (
          <li key={`sep-${k}`} className="menu__separator" role="separator" />
        ) : item.items ? (
          <li key={item.label} role="none" className="menu__parent">
            <button type="button" role="menuitem" aria-haspopup="menu" className="menu__item" disabled={item.disabled}>
              <span className="menu__check" />
              {item.label}
              <span className="menu__arrow" aria-hidden="true">
                ▸
              </span>
            </button>
            {!item.disabled && <MenuList items={item.items} onClose={onClose} submenu />}
          </li>
        ) : (
          <li key={item.label} role="none">
            <button
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={item.checked}
              disabled={item.disabled}
              className="menu__item"
              onClick={() => {
                onClose()
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
  )
}

// Classic drop-down menu bar as in legacy 2.6 (File, Edit, Mode, Layer, Tools, Preferences, Help).
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
          {open === i && <MenuList items={menu.items} onClose={() => setOpen(null)} />}
        </div>
      ))}
      <span className="menu-bar__file" title={title}>
        {title}
      </span>
    </nav>
  )
}
