// Map view state — layer-visibility toggles, borehole axis selection,
// viewport bounds tracking, and Leaflet camera persistence.
//
// Grouped here because all of these are visual-filter controls that span
// both MapView and the Sidebar: neither component can own them unilaterally
// since mutations from one must be visible to the other.

import { useCallback, useRef, useState } from 'react'
import type L from 'leaflet'
import type { BoreholeAxis } from '../api/client'

export interface UseMapStateResult {
  /** CPT type labels that are currently hidden (inverted: empty = show all). */
  hiddenCptTypes: Set<string>
  /** Axis the borehole colour legend + filter is grouped by. */
  boreholeAxis: BoreholeAxis
  /** Per-axis hidden-value sets for borehole markers. */
  hiddenBoreholeValues: Record<BoreholeAxis, Set<string>>
  /** Current Leaflet map bounds, or ``null`` before the map has reported. */
  viewportBounds: L.LatLngBounds | null
  /** Stable ref holding the last reported Leaflet camera (center + zoom). */
  mapCameraRef: React.MutableRefObject<{ center: [number, number]; zoom: number } | null>
  /** Toggle a CPT type label on / off. */
  handleToggleCptType: (type: string, visible: boolean) => void
  /** Toggle a borehole value on / off for the current axis. */
  handleToggleBoreholeValue: (value: string, visible: boolean) => void
  /** Switch the grouping axis for borehole colour / filter. */
  setBoreholeAxis: (axis: BoreholeAxis) => void
  /** Called by MapView on every viewport change. */
  handleViewportChange: (bounds: L.LatLngBounds) => void
  /** Called by MapView on every camera (pan / zoom) change. */
  handleMapCameraChange: (center: [number, number], zoom: number) => void
}

/**
 * React hook that owns the map layer-visibility and camera state.
 *
 * Layer visibility is tracked as a HIDDEN set (not a visible set) so
 * an empty set means "show everything" — this avoids the first-render
 * flash that "visible-set + auto-init effect" would cause every time a
 * new marker type appears in the data.
 *
 * The Leaflet camera (center + zoom) is persisted in a ref rather than
 * state so updating it does not trigger a re-render.  MapView reads the
 * ref on mount to restore the previous viewport after the user navigates
 * map → section panel → back.
 *
 * Returns
 * -------
 * UseMapStateResult
 *     All layer-visibility state + camera ref + callbacks.
 */
export function useMapState(): UseMapStateResult {
  // ---------------------------------------------------------------------------
  // Layer visibility
  // ---------------------------------------------------------------------------

  // We track HIDDEN values (not visible ones) so an empty set means
  // "show everything", which avoids the first-render flash that
  // "visible-set + auto-init effect" would cause every time a new type
  // appears in the data.
  const [hiddenCptTypes, setHiddenCptTypes] = useState<Set<string>>(new Set())
  const [boreholeAxis, setBoreholeAxis] = useState<BoreholeAxis>('drill_method')
  const [hiddenBoreholeValues, setHiddenBoreholeValues] = useState<
    Record<BoreholeAxis, Set<string>>
  >({ drill_method: new Set(), borehole_type: new Set() })

  const handleToggleCptType = useCallback((type: string, visible: boolean) => {
    setHiddenCptTypes(prev => {
      const next = new Set(prev)
      if (visible) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  const handleToggleBoreholeValue = useCallback(
    (value: string, visible: boolean) => {
      setHiddenBoreholeValues(prev => {
        const nextAxis = new Set(prev[boreholeAxis])
        if (visible) nextAxis.delete(value)
        else nextAxis.add(value)
        return { ...prev, [boreholeAxis]: nextAxis }
      })
    },
    [boreholeAxis],
  )

  // ---------------------------------------------------------------------------
  // Viewport bounds + Leaflet camera persistence
  // ---------------------------------------------------------------------------

  // ``viewportBounds === null`` (before the map has reported its initial
  // bounds) treats everything as in-viewport so the first render doesn't
  // flash an empty visible section.
  const [viewportBounds, setViewportBounds] = useState<L.LatLngBounds | null>(null)
  const handleViewportChange = useCallback((bounds: L.LatLngBounds) => {
    setViewportBounds(bounds)
  }, [])

  // Persist the Leaflet camera (center + zoom) across MapView remounts.
  // The map remounts whenever the user navigates map → section panel → back;
  // without this ref the viewport resets to the Belgium-default frame, which
  // is jarring after the user already zoomed into a specific site. Held in a
  // ref instead of useState so updating it doesn't trigger a re-render.
  const mapCameraRef = useRef<{ center: [number, number]; zoom: number } | null>(null)
  const handleMapCameraChange = useCallback(
    (center: [number, number], zoom: number) => {
      mapCameraRef.current = { center, zoom }
    },
    [],
  )

  return {
    hiddenCptTypes,
    boreholeAxis,
    hiddenBoreholeValues,
    viewportBounds,
    mapCameraRef,
    handleToggleCptType,
    handleToggleBoreholeValue,
    setBoreholeAxis,
    handleViewportChange,
    handleMapCameraChange,
  }
}
