import L from 'leaflet'
import { createPathComponent, type PathProps } from '../core/createPathComponent'

/** Props for {@link Polygon}; `positions` accepts a ring or array of rings (holes). */
export interface PolygonProps extends PathProps {
  positions: L.LatLngExpression[] | L.LatLngExpression[][]
}

/** Vector polygon layer, supports holes (wraps L.polygon). */
export const Polygon = createPathComponent<PolygonProps, L.Polygon>({
  createInstance: (props) => L.polygon(props.positions, props.style),
  updateInstance: (poly, props, prev) => {
    if (props.positions !== prev.positions) poly.setLatLngs(props.positions)
  },
})
