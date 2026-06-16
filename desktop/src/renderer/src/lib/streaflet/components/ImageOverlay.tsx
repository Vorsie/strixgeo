import L from 'leaflet'
import { createTileComponent } from '../core/createTileComponent'
import type { EventedProps } from '../core/events'

/** Props for {@link ImageOverlay}; a georeferenced image pinned to `bounds`. */
export interface ImageOverlayProps extends EventedProps {
  url: string
  bounds: L.LatLngBoundsExpression
  opacity?: number
  zIndex?: number
}

/** Georeferenced raster image overlay (wraps L.imageOverlay). */
export const ImageOverlay = createTileComponent<ImageOverlayProps, L.ImageOverlay>({
  createInstance: (props) =>
    L.imageOverlay(props.url, props.bounds, { opacity: props.opacity, zIndex: props.zIndex }),
  updateInstance: (img, props, prev) => {
    if (props.url !== prev.url) img.setUrl(props.url)
    // L.imageOverlay.setBounds wants a concrete LatLngBounds, so normalise the
    // expression first; cast to the literal overload because LatLngBoundsExpression
    // also admits an already-built LatLngBounds which latLngBounds() handles too.
    if (props.bounds !== prev.bounds) img.setBounds(L.latLngBounds(props.bounds as L.LatLngBoundsLiteral))
    if (props.opacity !== undefined && props.opacity !== prev.opacity) img.setOpacity(props.opacity)
  },
})
