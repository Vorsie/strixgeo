import L from 'leaflet'
import { createPathComponent, type PathProps } from '../core/createPathComponent'

/** Props for {@link Circle}; a metre-radius circle at `center`. */
export interface CircleProps extends PathProps {
  center: L.LatLngExpression
  radius: number
}

/** Vector circle with a radius in metres (wraps L.circle). */
export const Circle = createPathComponent<CircleProps, L.Circle>({
  createInstance: (props) => L.circle(props.center, { ...props.style, radius: props.radius }),
  updateInstance: (c, props, prev) => {
    if (props.center !== prev.center) c.setLatLng(props.center)
    if (props.radius !== prev.radius) c.setRadius(props.radius)
  },
})
