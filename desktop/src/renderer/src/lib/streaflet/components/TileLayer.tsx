import L from 'leaflet'
import { createTileComponent } from '../core/createTileComponent'
import type { EventedProps } from '../core/events'

export interface TileLayerProps extends EventedProps {
  url: string
  attribution?: string
  opacity?: number
  zIndex?: number
  maxZoom?: number
  minZoom?: number
  subdomains?: string | string[]
  /** Render into this named Leaflet pane (threaded conditionally at construction). */
  pane?: string
  /** Only request tiles inside this extent: ``[[south, west], [north, east]]`` in degrees. */
  bounds?: readonly [[number, number], [number, number]]
}

/** Raster XYZ tile layer (wraps L.tileLayer). */
export const TileLayer = createTileComponent<TileLayerProps, L.TileLayer>({
  createInstance: (props) =>
    L.tileLayer(props.url, {
      attribution: props.attribution,
      opacity: props.opacity,
      zIndex: props.zIndex,
      maxZoom: props.maxZoom,
      minZoom: props.minZoom,
      // Only pass subdomains when explicitly provided; omitting lets Leaflet
      // keep its built-in default ('abc'), which avoids a crash in jsdom where
      // _getSubdomain reads .length on the value before any tile is requested.
      ...(props.subdomains !== undefined ? { subdomains: props.subdomains } : {}),
      // Only pass pane when explicitly provided; omitting lets Leaflet keep its
      // default 'tilePane' rather than clobbering it with undefined.
      ...(props.pane !== undefined ? { pane: props.pane } : {}),
      // Only pass bounds when the provider declares an extent; omitting keeps
      // Leaflet's worldwide default rather than clobbering it with undefined.
      ...(props.bounds !== undefined
        ? { bounds: L.latLngBounds(props.bounds[0], props.bounds[1]) }
        : {}),
    }),
  updateInstance: (layer, props, prev) => {
    if (props.url !== prev.url) layer.setUrl(props.url)
    if (props.opacity !== undefined && props.opacity !== prev.opacity) layer.setOpacity(props.opacity)
    if (props.zIndex !== undefined && props.zIndex !== prev.zIndex) layer.setZIndex(props.zIndex)
  },
})
