import type L from 'leaflet'
import { createLayerComponent, type LayerFactory } from './createLayerComponent'
import type { EventedProps } from './events'

/** Props common to vector (path) layers. `style` aliases Leaflet PathOptions. */
export interface PathProps extends EventedProps {
  style?: L.PathOptions
}

/**
 * Path factory: wraps createLayerComponent and applies `style` via setStyle on
 * create + update, so every vector layer gets consistent styling for free.
 */
export function createPathComponent<P extends PathProps, I extends L.Path>(
  factory: LayerFactory<P, I>,
) {
  return createLayerComponent<P, I>({
    createInstance: (props, ctx) => {
      const instance = factory.createInstance(props, ctx)
      if (props.style) instance.setStyle(props.style)
      return instance
    },
    updateInstance: (instance, props, prev) => {
      factory.updateInstance?.(instance, props, prev)
      if (props.style !== prev.style && props.style) instance.setStyle(props.style)
    },
  })
}
