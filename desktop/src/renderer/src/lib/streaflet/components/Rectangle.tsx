import L from 'leaflet'
import { createPathComponent, type PathProps } from '../core/createPathComponent'

/** Props for {@link Rectangle}; `bounds` is the SW/NE corner pair. */
export interface RectangleProps extends PathProps {
  bounds: L.LatLngBoundsExpression
}

/** Vector rectangle layer from a LatLngBounds (wraps L.rectangle). */
export const Rectangle = createPathComponent<RectangleProps, L.Rectangle>({
  createInstance: (props) => L.rectangle(props.bounds, props.style),
  updateInstance: (rect, props, prev) => {
    if (props.bounds !== prev.bounds) rect.setBounds(props.bounds as L.LatLngBoundsExpression)
  },
})
