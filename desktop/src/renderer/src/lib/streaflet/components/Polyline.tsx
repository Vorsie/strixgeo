import L from 'leaflet'
import { createPathComponent, type PathProps } from '../core/createPathComponent'

/** Props for {@link Polyline}; `positions` is the ordered vertex list. */
export interface PolylineProps extends PathProps {
  positions: L.LatLngExpression[]
}

/** Vector polyline layer (wraps L.polyline). */
export const Polyline = createPathComponent<PolylineProps, L.Polyline>({
  createInstance: (props) => L.polyline(props.positions, props.style),
  updateInstance: (line, props, prev) => {
    if (props.positions !== prev.positions) line.setLatLngs(props.positions)
  },
})
