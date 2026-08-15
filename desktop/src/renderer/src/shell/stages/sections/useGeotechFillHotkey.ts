/**
 * Bare-``F`` accelerator for the packing (NAD) fill.
 *
 * The owner's ask (dogfeed 2026-08-15), typed while reading his own section:
 * *"Turn the fill on (l this is for litho fill so this wouldn't work)"*. ``L``
 * flips the LITHO fill; the geotech axis's own NAD packing fill — Display →
 * Show / Hide fill, ``geotechFillStore`` — had no key at all, and he flips it
 * just as often to read the correlation ribbons underneath the paint.
 *
 * GEOTECH AXIS ONLY. On the litho and geological axes the press is a no-op and
 * says nothing: there is no packing fill to show there, and the litho fill
 * already has ``L``. A toast about a toggle the engineer cannot see on the axis
 * he is looking at is worse than silence.
 *
 * Two guards, both load-bearing and both lifted verbatim from the ``L`` and
 * ``P`` hotkeys:
 *
 *   * ``isTypingTarget`` — an ``f`` typed into a name field is text.
 *   * any of ctrl / meta / alt held — Ctrl+F is find, and stealing it would be
 *     a genuinely destructive surprise.
 *
 * The Display-menu item's label flips too, but that is invisible unless the
 * menu happens to be open, so the caller is handed the new state to announce.
 */

import { useEffect, useRef } from 'react'

import type { SectionModelAxis } from '../../../hooks/useSections'
import { isTypingTarget } from '../../../utils/keyboard'
import { getGeotechFillVisible, toggleGeotechFill } from '../../../utils/geotechFillStore'

/**
 * Bind the bare-``F`` packing-fill toggle for as long as the caller is mounted.
 *
 * @param axisMode - Which model axis the section view is on. Read at PRESS
 *   time (via a ref), so an axis switch re-targets the key without a remount.
 * @param onFlip - Called with the NEW state after each accepted press, so the
 *   caller can surface it (a toast, typically). Never called off the geotech
 *   axis, where the key is a no-op. Re-reads on every render, so a caller may
 *   pass an inline closure without re-binding the listener.
 */
export function useGeotechFillHotkey(
  axisMode: SectionModelAxis,
  onFlip: (nowOn: boolean) => void,
): void {
  // Both held in refs so a fresh inline callback (or an axis switch) per render
  // does not tear down and rebind the document listener on every render.
  const onFlipRef = useRef(onFlip)
  onFlipRef.current = onFlip
  const axisRef = useRef(axisMode)
  axisRef.current = axisMode

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'f' && e.key !== 'F') return
      // Ctrl/Cmd+F is find and Alt+F may be an OS accelerator — ours is the
      // bare key only.
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      // Litho and geological axes: no packing fill exists there, so the key
      // does nothing — and says nothing, rather than toasting about an
      // invisible toggle.
      if (axisRef.current !== 'geotechnical') return
      toggleGeotechFill()
      onFlipRef.current(getGeotechFillVisible())
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
