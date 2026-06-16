import { useStreafletContext } from '../core/MapContext'
import type L from 'leaflet'

/** Access the parent <MapContainer>'s Leaflet map. Throws if used outside one. */
export function useMap(): L.Map {
  return useStreafletContext().map
}
