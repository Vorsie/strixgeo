/**
 * Bare-``P`` accelerator for the lab-sample markers.
 *
 * The owner's ask (dogfeed 2026-08-14): the hotkey turns the MARKERS off when
 * they are in the way — useful while reading a borehole, noise while dragging
 * a boundary — so the markers earn the one-key toggle alongside their
 * Display-menu item. The grain-size hover preview keeps its menu toggle only.
 * ``P`` was verified free: no bare alphabetic key is bound anywhere else in
 * the renderer.
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
import { getSampleMarkersOn, toggleSampleMarkersOn } from '../../../utils/sampleMarkersOnStore'

/**
 * Bind the bare-``P`` toggle for as long as the caller is mounted.
 *
 * @param onFlip - Called with the NEW state after each accepted press, so the
 *   caller can surface it (a toast, typically). Re-reads on every render, so a
 *   caller may pass an inline closure without re-binding the listener.
 */
export function useSampleMarkersHotkey(onFlip: (nowOn: boolean) => void): void {
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
      toggleSampleMarkersOn()
      onFlipRef.current(getSampleMarkersOn())
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
