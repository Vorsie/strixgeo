import L from 'leaflet'
import { createOverlayComponent } from '../core/createOverlayComponent'
import type { EventedProps } from '../core/events'

/** Props for {@link Marker}; a point marker at `position`. */
export interface MarkerProps extends EventedProps {
  position: L.LatLngExpression
  icon?: L.Icon | L.DivIcon
  draggable?: boolean
  zIndexOffset?: number
  opacity?: number
}

/** Point marker (wraps L.marker). */
export const Marker = createOverlayComponent<MarkerProps, L.Marker>({
  createInstance: (props) =>
    L.marker(props.position, {
      // Only pass icon when explicitly provided; omitting lets Leaflet keep its
      // built-in Icon.Default, which avoids a crash in jsdom where passing
      // icon: undefined overwrites the default and _initIcon reads undefined.createIcon().
      ...(props.icon !== undefined ? { icon: props.icon } : {}),
      draggable: props.draggable,
      zIndexOffset: props.zIndexOffset,
      opacity: props.opacity,
    }),
  updateInstance: (marker, props, prev) => {
    if (props.position !== prev.position) marker.setLatLng(props.position)
    if (props.icon && props.icon !== prev.icon) marker.setIcon(props.icon)
    if (props.opacity !== undefined && props.opacity !== prev.opacity) marker.setOpacity(props.opacity)
    if (props.zIndexOffset !== undefined && props.zIndexOffset !== prev.zIndexOffset)
      marker.setZIndexOffset(props.zIndexOffset)
  },
})
