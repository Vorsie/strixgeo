import { useEffect } from 'react'
import type L from 'leaflet'
import { useMap } from './useMap'

/** Subscribe to a set of map events for the component's lifetime. Returns the map. */
export function useMapEvents(handlers: L.LeafletEventHandlerFnMap): L.Map {
  const map = useMap()
  useEffect(() => {
    map.on(handlers)
    return () => {
      map.off(handlers)
    }
    // reason: handlers is typically an inline-stable object per render; rebinding
    // every render would thrash — bind once on mount (the conventional Leaflet
    // hook contract; callers pass a stable handler map).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])
  return map
}
