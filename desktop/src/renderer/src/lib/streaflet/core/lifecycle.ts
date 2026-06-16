import { useEffect } from 'react'
import type { ForwardedRef } from 'react'
import type L from 'leaflet'

/** Add a layer to its container on mount, remove on unmount, re-parent on change. */
export function useLayerLifecycle(
  layer: L.Layer | null,
  container: L.Map | L.LayerGroup,
): void {
  useEffect(() => {
    if (layer === null) return
    container.addLayer(layer)
    return () => {
      container.removeLayer(layer)
    }
  }, [layer, container])
}

/** Point a forwarded ref at the Leaflet instance (or null after unmount). */
export function useImperativeInstance<T>(ref: ForwardedRef<T>, instance: T | null): void {
  useEffect(() => {
    if (typeof ref === 'function') ref(instance)
    else if (ref) ref.current = instance
    return () => {
      if (typeof ref === 'function') ref(null)
      else if (ref) ref.current = null
    }
  }, [ref, instance])
}
