/**
 * Right-click context menu for an investigation column on the
 * cross-section.
 *
 * Actions:
 *
 *   * "Focus this test" — enters the section's focus mode, hiding
 *     every other column so the user can edit formation boundaries
 *     on the picked test in isolation.
 *   * "Remove from this section" — adds the column's id to the
 *     section's excluded_{cpt,borehole}_ids list. Reversible
 *     (project-local hide, the test stays in the project + on the
 *     map). Per UX conventions no confirmation dialog; the
 *     "N hidden · restore all" footer is the undo path.
 *
 * The menu is positioned absolutely inside SectionPanel's relative
 * container; coordinates come from the original ``onContextMenu``
 * event's ``clientX/clientY`` translated into container-local
 * coordinates by the caller. Click-outside and Esc both dismiss.
 */

import { useEffect } from 'react'

interface Props {
  /** Container-local coordinates where the menu's top-left corner
   * should land. */
  x: number
  y: number
  /** Display name of the column the user right-clicked — shown as a
   * subtitle so the action is unambiguous when columns sit close
   * together. */
  name: string
  /** Fired when the user picks "Focus this test". */
  onFocus: () => void
  /** Fired when the user picks "Remove from this section". When
   * omitted (test harness, read-only mounts) the menu item is
   * hidden — the action is only meaningful when the parent owns
   * a PATCH path back to the section row. */
  onRemoveFromSection?: () => void
  /** Fired when the user clicks anywhere outside the menu, or
   * presses Esc. */
  onClose: () => void
}

export default function ColumnContextMenu({
  x,
  y,
  name,
  onFocus,
  onRemoveFromSection,
  onClose,
}: Props): JSX.Element {
  useEffect(() => {
    function handleDocClick(): void {
      onClose()
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('click', handleDocClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('click', handleDocClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <div
      className="absolute z-30 min-w-[200px] bg-white border border-gray-300 shadow-md rounded text-sm"
      style={{ left: x, top: y }}
      // Stop our own clicks from bubbling to the document-level
      // dismisser; only clicks elsewhere should close the menu.
      onClick={e => e.stopPropagation()}
      role="menu"
      aria-label={`Actions for ${name}`}
    >
      <div className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-100">
        {name}
      </div>
      <button
        type="button"
        className="block w-full text-left px-3 py-2 hover:bg-gray-100"
        onClick={() => {
          onFocus()
          onClose()
        }}
        role="menuitem"
      >
        Focus this test
      </button>
      {onRemoveFromSection && (
        <button
          type="button"
          className="block w-full text-left px-3 py-2 hover:bg-red-50 text-red-700 border-t border-gray-100"
          onClick={() => {
            onRemoveFromSection()
            onClose()
          }}
          role="menuitem"
        >
          Remove from this section
        </button>
      )}
    </div>
  )
}
