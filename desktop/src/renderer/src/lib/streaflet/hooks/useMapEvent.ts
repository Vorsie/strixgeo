import type L from 'leaflet'
import { useMapEvents } from './useMapEvents'

/** Subscribe to a single map event for the component's lifetime. Returns the map. */
export function useMapEvent(
  type: keyof L.LeafletEventHandlerFnMap | string,
  handler: L.LeafletEventHandlerFn,
): L.Map {
  return useMapEvents({ [type]: handler } as L.LeafletEventHandlerFnMap)
}
