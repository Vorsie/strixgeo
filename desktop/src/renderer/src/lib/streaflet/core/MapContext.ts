import { createContext, useContext } from 'react'
import type L from 'leaflet'

/** Value carried through the streaflet tree. */
export interface StreafletContextValue {
  /** The root Leaflet map. */
  readonly map: L.Map
  /** Nearest container layers attach to (a Pane/group), else the map itself. */
  readonly layerContainer: L.Map | L.LayerGroup
  /** Nearest enclosing layer (Marker/Path/group) — the bind target for Tooltip/Popup. */
  readonly parentLayer?: L.Layer
}

export const MapContext = createContext<StreafletContextValue | null>(null)

/** Internal: read the context or throw if used outside <MapContainer>. */
export function useStreafletContext(): StreafletContextValue {
  const ctx = useContext(MapContext)
  if (ctx === null) {
    throw new Error('streaflet: component used outside <MapContainer>')
  }
  return ctx
}
