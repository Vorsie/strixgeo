import type L from 'leaflet'
import { createLayerComponent, type LayerFactory } from './createLayerComponent'
import type { EventedProps } from './events'

/** Props common to vector (path) layers. `style` aliases Leaflet PathOptions. */
export interface PathProps extends EventedProps {
  style?: L.PathOptions
  /** Render into this named Leaflet pane (a PathOptions field, threaded at construction). */
  pane?: string
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
      // pane is construction-time only on a path; merge it into the style the
      // inner factory uses to CONSTRUCT the Leaflet object. Only when defined —
      // a pane: undefined would clobber Leaflet's default 'overlayPane'.
      const instance = factory.createInstance(
        props.pane !== undefined ? { ...props, style: { ...props.style, pane: props.pane } } : props,
        ctx,
      )
      if (props.style) instance.setStyle(props.style)
      return instance
    },
    updateInstance: (instance, props, prev) => {
      factory.updateInstance?.(instance, props, prev)
      if (props.style !== prev.style && props.style) instance.setStyle(props.style)
    },
  })
}
