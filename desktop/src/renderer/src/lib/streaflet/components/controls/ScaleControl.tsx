import L from 'leaflet'
import { createControlComponent, type ControlProps } from '../../core/createControlComponent'

/** Props for {@link ScaleControl}. */
export interface ScaleControlProps extends ControlProps {
  metric?: boolean
  imperial?: boolean
}

/** Scale bar control (wraps L.control.scale). */
export const ScaleControl = createControlComponent<ScaleControlProps, L.Control.Scale>({
  createInstance: (props) =>
    L.control.scale({ position: props.position, metric: props.metric, imperial: props.imperial }),
})
