import L from 'leaflet'
import { createTileComponent } from '../core/createTileComponent'
import type { EventedProps } from '../core/events'

export interface WMSTileLayerProps extends EventedProps {
  url: string
  layers: string
  format?: string
  transparent?: boolean
  version?: string
  attribution?: string
  opacity?: number
  zIndex?: number
}

/** OGC WMS tile layer (wraps L.tileLayer.wms). */
export const WMSTileLayer = createTileComponent<WMSTileLayerProps, L.TileLayer.WMS>({
  createInstance: (props) =>
    L.tileLayer.wms(props.url, {
      layers: props.layers,
      format: props.format ?? 'image/png',
      transparent: props.transparent,
      version: props.version,
      attribution: props.attribution,
      opacity: props.opacity,
      zIndex: props.zIndex,
    }),
  updateInstance: (layer, props, prev) => {
    if (props.opacity !== undefined && props.opacity !== prev.opacity) layer.setOpacity(props.opacity)
    if (props.layers !== prev.layers) layer.setParams({ layers: props.layers })
  },
})
