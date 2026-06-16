import L from 'leaflet'
import { createPathComponent, type PathProps } from '../core/createPathComponent'

export interface PolygonProps extends PathProps {
  positions: L.LatLngExpression[] | L.LatLngExpression[][]
}

export const Polygon = createPathComponent<PolygonProps, L.Polygon>({
  createInstance: (props) => L.polygon(props.positions, props.style),
  updateInstance: (poly, props, prev) => {
    if (props.positions !== prev.positions) poly.setLatLngs(props.positions)
  },
})
