// Keyboard shortcuts for toolbar dropdown verbs (owner ask 2026-08-31: "can we
// add like keyboard shortcuts to the dropdown in the top bar (like between
// parentheses at the back)").
//
// The DISPLAY half lives in ``ToolbarPrimitives`` (a ``ToolbarDropdownItem``
// with ``shortcut`` renders "(4)" after its label); this hook is the DISPATCH
// half: while the toolbar is mounted, pressing the bare key fires the item's
// ``onClick`` — the menu does not need to be open, which is the whole point of
// a shortcut.
//
// Guards, in order:
//  * a modifier (Ctrl/Alt/Meta) means it is somebody else's chord — skip.
//    Shift is tolerated so a future '?' style shortcut stays possible.
//  * typing surfaces (<input>/<textarea>/<select>/contentEditable) swallow
//    everything, the same rule every other global key in this app follows
//    (docs/ux.md "All shortcuts skip when...").
//  * a DISABLED item does not fire — the shortcut obeys exactly the gate the
//    menu row shows, so a key press can never do what a click could not.
//
// The items are read through a ref, so the one listener survives re-renders of
// toolbars whose item arrays are rebuilt every pass (they all are — the
// builders are pure functions called in render).

import { useEffect, useRef } from 'react'

import type { ToolbarDropdownItem } from './ToolbarPrimitives'

/** Is the event travelling through a surface that owns plain typing? */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
  )
}

/**
 * Fire dropdown items' ``onClick`` from their declared ``shortcut`` keys.
 *
 * @param items Every dropdown item in scope this render — pass the toolbar's
 *   full fold-row set; only items carrying ``shortcut`` participate. Later
 *   items never shadow earlier ones: the first enabled match wins, and two
 *   items declaring the same key is a wiring mistake this hook surfaces by
 *   construction (the earlier one always fires).
 */
export function useToolbarShortcuts(items: readonly ToolbarDropdownItem[]): void {
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (isTypingTarget(e.target)) return
      const item = itemsRef.current.find((i) => i.shortcut === e.key && !i.disabled)
      if (!item) return
      e.preventDefault()
      item.onClick()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
