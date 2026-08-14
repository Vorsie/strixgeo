/**
 * Bare-``P`` accelerator for the grain-size hover preview.
 *
 * The preview is the kind of thing an engineer flips several times a minute —
 * useful while reading a borehole, noise while dragging a boundary — so it
 * earns a one-key toggle alongside its Display-menu item. ``P`` was verified
 * free: no bare alphabetic key is bound anywhere else in the renderer.
 *
 * Two guards, both load-bearing:
 *
 *   * ``isTypingTarget`` — a ``p`` typed into a name field is text.
 *   * any of ctrl / meta / alt held — Ctrl+P is print, and stealing it would
 *     be a genuinely destructive surprise.
 *
 * The dropdown item's label flips too, but that is invisible unless the menu
 * happens to be open, so the caller is handed the new state to announce.
 */

import { useEffect, useRef } from 'react'

import { isTypingTarget } from '../../../utils/keyboard'
import { getPsdPreviewOn, togglePsdPreviewOn } from '../../../utils/psdPreviewOnStore'

/**
 * Bind the bare-``P`` toggle for as long as the caller is mounted.
 *
 * @param onFlip - Called with the NEW state after each accepted press, so the
 *   caller can surface it (a toast, typically). Re-reads on every render, so a
 *   caller may pass an inline closure without re-binding the listener.
 */
export function usePsdPreviewHotkey(onFlip: (nowOn: boolean) => void): void {
  // Held in a ref so a fresh inline callback per render does not tear down and
  // rebind the document listener on every render.
  const onFlipRef = useRef(onFlip)
  onFlipRef.current = onFlip

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'p' && e.key !== 'P') return
      // Ctrl/Cmd+P is print and Alt+P may be an OS accelerator — ours is the
      // bare key only.
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      togglePsdPreviewOn()
      onFlipRef.current(getPsdPreviewOn())
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
