import type L from 'leaflet'
import { createLayerComponent, type LayerFactory } from './createLayerComponent'
import type { EventedProps } from './events'

/** Overlays reuse the base layer lifecycle; Popup/Tooltip add open/close in their own files. */
export function createOverlayComponent<P extends EventedProps, I extends L.Layer>(
  factory: LayerFactory<P, I>,
) {
  return createLayerComponent<P, I>(factory)
}
