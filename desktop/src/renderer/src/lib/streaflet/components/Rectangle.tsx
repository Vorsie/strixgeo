import L from 'leaflet'
import { createPathComponent, type PathProps } from '../core/createPathComponent'

export interface RectangleProps extends PathProps {
  bounds: L.LatLngBoundsExpression
}

export const Rectangle = createPathComponent<RectangleProps, L.Rectangle>({
  createInstance: (props) => L.rectangle(props.bounds, props.style),
  updateInstance: (rect, props, prev) => {
    if (props.bounds !== prev.bounds) rect.setBounds(props.bounds as L.LatLngBoundsExpression)
  },
})
