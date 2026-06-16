import L from 'leaflet'
import { createControlComponent, type ControlProps } from '../../core/createControlComponent'

/** Props for {@link ScaleControl}. */
export interface ScaleControlProps extends ControlProps {
  metric?: boolean
  imperial?: boolean
}

/** Scale bar control (wraps L.control.scale). */
export const ScaleControl = createControlComponent<ScaleControlProps, L.Control.Scale>({
  // Only pass options that are explicitly provided; passing `position: undefined`
  // clobbers Leaflet's prototype default and crashes Control.addTo on
  // `undefined.indexOf`. Same conditional-spread convention as TileLayer.
  createInstance: (props) =>
    L.control.scale({
      ...(props.position !== undefined ? { position: props.position } : {}),
      ...(props.metric !== undefined ? { metric: props.metric } : {}),
      ...(props.imperial !== undefined ? { imperial: props.imperial } : {}),
    }),
})
