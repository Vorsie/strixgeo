/**
 * Bare-``L`` accelerator for the litho fill.
 *
 * The owner's ask (dogfeed 2026-08-15): *"a hide litho fill hotkey would be
 * nice too, toggling quite often when doing step 1"* — reading a packing
 * subdivision against the lithology it came from means flipping that fill every
 * few seconds, and walking the Display menu each time is the friction. ``L`` is
 * the litho fill's one-key toggle, exactly as ``P`` is the sample markers'.
 *
 * The key is AXIS-AWARE because "the litho fill" is a different store per axis:
 *
 *   * geotechnical    → ``lithoFillOnGeotechStore`` ("Show litho fill" — swaps
 *     the partition's source model in for the NAD packing fill);
 *   * lithostratigraphic → ``bandFillStore`` (the "Fill bands" toggle that
 *     gates the litho fill on its own axis, mutual-exclusion side effect and
 *     all — the hotkey is the menu item, not a second path);
 *   * geological      → nothing. There is no litho fill on the geology axis, so
 *     a press there must not silently move a toggle the engineer cannot see.
 *
 * Two guards, both load-bearing and both lifted verbatim from the ``P`` hotkey:
 *
 *   * ``isTypingTarget`` — an ``l`` typed into a name field is text.
 *   * any of ctrl / meta / alt held — Ctrl+L is the browser's address bar, and
 *     stealing it would be a genuinely destructive surprise.
 *
 * The Display-menu item's label flips too, but that is invisible unless the
 * menu happens to be open, so the caller is handed the new state to announce.
 */

import { useEffect, useRef } from 'react'

import type { SectionModelAxis } from '../../../hooks/useSections'
import { isTypingTarget } from '../../../utils/keyboard'
import { getBandFillVisible, toggleBandFill } from '../../../utils/bandFillStore'
import {
  getLithoFillOnGeotech,
  toggleLithoFillOnGeotech,
} from '../../../utils/lithoFillOnGeotechStore'

/**
 * Bind the bare-``L`` litho-fill toggle for as long as the caller is mounted.
 *
 * @param axisMode - Which model axis the section view is on. Read at PRESS
 *   time (via a ref), so an axis switch re-targets the key without a remount.
 * @param onFlip - Called with the NEW state after each accepted press, so the
 *   caller can surface it (a toast, typically). Never called on the geological
 *   axis, where the key is a no-op. Re-reads on every render, so a caller may
 *   pass an inline closure without re-binding the listener.
 */
export function useLithoFillHotkey(
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
      if (e.key !== 'l' && e.key !== 'L') return
      // Ctrl/Cmd+L focuses the address bar and Alt+L may be an OS accelerator —
      // ours is the bare key only.
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      const axis = axisRef.current
      if (axis === 'geotechnical') {
        toggleLithoFillOnGeotech()
        onFlipRef.current(getLithoFillOnGeotech())
        return
      }
      if (axis === 'lithostratigraphic') {
        toggleBandFill()
        onFlipRef.current(getBandFillVisible())
        return
      }
      // Geological axis: no litho fill exists here, so the key does nothing —
      // and says nothing, rather than toasting about an invisible toggle.
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
