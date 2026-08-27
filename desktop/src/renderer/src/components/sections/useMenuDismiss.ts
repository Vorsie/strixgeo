// Auto-dismiss a ``position: fixed`` context menu on wheel-zoom or Esc.
//
// Born as an inline effect in ContactsLayer (debt #151 dogfeed refinement
// 2026-05-27 — "sometimes i get this random add new suggestion here box when
// zooming or so"): a fixed-position menu detaches from the section content
// the moment the user zooms and reads as a random floating box. The partition
// fill's region menu copied it; the model-fill menu (owner ruling S6,
// 2026-08-27) would have been the third copy — extracted instead.

import { useEffect } from 'react'

/**
 * Dismiss the menu on any wheel event or Escape while it is open.
 *
 * Parameters
 * ----------
 * open
 *     Whether the menu is currently showing — the effect is inert otherwise.
 * dismiss
 *     Closes the menu. Read on every event, so a fresh closure is fine.
 */
export function useMenuDismissOnZoomOrEsc(open: boolean, dismiss: () => void): void {
  useEffect(() => {
    if (!open) return
    const onWheel = (): void => dismiss()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismiss()
    }
    document.addEventListener('wheel', onWheel, { capture: true })
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('wheel', onWheel, { capture: true })
      document.removeEventListener('keydown', onKey)
    }
    // reason: ``dismiss`` is a state setter wrapper whose identity is not
    // load-bearing — re-subscribing on ``open`` alone keeps the listeners
    // scoped to the menu's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}
