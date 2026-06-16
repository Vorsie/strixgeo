import L from 'leaflet'
import { createPathComponent, type PathProps } from '../core/createPathComponent'

export interface PolylineProps extends PathProps {
  positions: L.LatLngExpression[]
}

export const Polyline = createPathComponent<PolylineProps, L.Polyline>({
  createInstance: (props) => L.polyline(props.positions, props.style),
  updateInstance: (line, props, prev) => {
    if (props.positions !== prev.positions) line.setLatLngs(props.positions)
  },
})
