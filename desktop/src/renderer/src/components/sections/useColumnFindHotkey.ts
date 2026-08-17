/**
 * Ctrl/Cmd+F accelerator for the section column-find bar.
 *
 * Owner, 2026-08-17: *"on crosssections i want a ctrl+f feature so i can go
 * easily to a column header like s8 or so for example"*.
 *
 * Ctrl+F was verified free before binding: the bare-``F`` geotech-fill toggle
 * explicitly leaves every modified F alone (its GK5 pin), and nothing else in
 * the renderer claims it. ``preventDefault`` because Chromium would otherwise
 * offer its own dead find-in-page affordance on some platforms.
 *
 * Guards, mirroring the house hotkey pattern (`useSampleMarkersHotkey`):
 *
 *   * ``isTypingTarget`` — Ctrl+F inside a name field means "find in what I'm
 *     typing", which this bar is not; stay out of the way.
 *   * ``alt`` held — an OS accelerator, not ours.
 */

import { useEffect, useRef } from 'react'

import { isTypingTarget } from '../../utils/keyboard'

/**
 * Bind Ctrl/Cmd+F to open the find bar for as long as the caller is mounted.
 *
 * @param onOpen - Called on each accepted press. Re-read on every render, so a
 *   caller may pass an inline closure without re-binding the listener.
 */
export function useColumnFindHotkey(onOpen: () => void): void {
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'f' && e.key !== 'F') return
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      onOpenRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
