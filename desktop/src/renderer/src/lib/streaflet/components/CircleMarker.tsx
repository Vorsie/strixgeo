import L from 'leaflet'
import { createPathComponent, type PathProps } from '../core/createPathComponent'

/** Props for {@link CircleMarker}; a fixed-pixel-radius circle at `center`. */
export interface CircleMarkerProps extends PathProps {
  center: L.LatLngExpression
  radius?: number
}

/** Vector circle marker with a pixel radius (wraps L.circleMarker). */
export const CircleMarker = createPathComponent<CircleMarkerProps, L.CircleMarker>({
  createInstance: (props) =>
    L.circleMarker(props.center, { ...props.style, radius: props.radius }),
  updateInstance: (cm, props, prev) => {
    if (props.center !== prev.center) cm.setLatLng(props.center)
    if (props.radius !== undefined && props.radius !== prev.radius) cm.setRadius(props.radius)
  },
})
