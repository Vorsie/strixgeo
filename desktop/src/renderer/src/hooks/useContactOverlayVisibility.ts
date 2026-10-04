/**
 * Per-user on/off switches for the Data-stage contact overlays.
 *
 * Owner 2026-10-04: "on the data stage make it so that i can turn off
 * lithological boundaries and stratigraphic boundaries". The detail pane
 * (CptChart / BoreholeLog) draws a faded line for every geology contact
 * and every litho contact on the selected test; with hundreds of litho
 * layers the chart becomes unreadable. Two independent switches, both ON
 * by default (the behaviour before the switches existed).
 *
 * Persisted to ``localStorage`` under a GLOBAL key: a reading preference
 * of the engineer, not project data, so it never enters the bundle
 * (same rule as ``useHiddenBoreholeLogTracks``). Storage errors are
 * swallowed by ``usePersistedJSON``; the switches keep working in memory.
 */

import { useCallback } from 'react'

import {
  DEFAULT_CONTACT_OVERLAY_VISIBILITY,
  type ContactOverlay,
  type ContactOverlayVisibility,
} from '../utils/contactOverlays'
import { usePersistedJSON } from './usePersistedJSON'

/** Global (not project-scoped) localStorage key for the two switches. */
export const CONTACT_OVERLAY_VISIBILITY_KEY = 'groundmodel.detail.contact_overlays'

/**
 * Parse raw JSON from localStorage into a validated visibility object.
 *
 * Non-object input falls back to the default (both on). A field that is
 * missing or not a boolean defaults to on, so a corrupt entry can never
 * hide boundaries the user did not switch off.
 *
 * @param raw Parsed JSON value from localStorage.
 * @returns   A complete ``ContactOverlayVisibility``.
 */
export function parseContactOverlayVisibility(raw: unknown): ContactOverlayVisibility {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_CONTACT_OVERLAY_VISIBILITY }
  }
  const record = raw as Record<string, unknown>
  return {
    geology: typeof record.geology === 'boolean' ? record.geology : true,
    litho: typeof record.litho === 'boolean' ? record.litho : true,
  }
}

/** Return value of ``useContactOverlayVisibility``. */
export interface ContactOverlayVisibilityControls {
  /** Current per-source switches. */
  visibility: ContactOverlayVisibility
  /** Flip one source on or off. Fires immediately (reversible action). */
  toggle: (source: ContactOverlay['source']) => void
}

/**
 * React hook: the two localStorage-backed contact-overlay switches.
 *
 * @returns The current visibility and a stable ``toggle(source)``.
 */
export function useContactOverlayVisibility(): ContactOverlayVisibilityControls {
  const [visibility, setVisibility] = usePersistedJSON<ContactOverlayVisibility>(
    CONTACT_OVERLAY_VISIBILITY_KEY,
    DEFAULT_CONTACT_OVERLAY_VISIBILITY,
    parseContactOverlayVisibility,
  )
  const toggle = useCallback(
    (source: ContactOverlay['source']): void => {
      setVisibility(prev => ({ ...prev, [source]: !prev[source] }))
    },
    [setVisibility],
  )
  return { visibility, toggle }
}
