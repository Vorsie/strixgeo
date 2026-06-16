import L from 'leaflet'
import { createControlComponent, type ControlProps } from '../../core/createControlComponent'

/** Props for {@link AttributionControl}. */
export interface AttributionControlProps extends ControlProps {
  prefix?: string | false
}

/** Attribution credits control (wraps L.control.attribution). */
export const AttributionControl = createControlComponent<
  AttributionControlProps,
  L.Control.Attribution
>({
  // Only pass options that are explicitly provided; passing `position: undefined`
  // clobbers Leaflet's prototype default and crashes Control.addTo on
  // `undefined.indexOf`. Same conditional-spread convention as TileLayer.
  createInstance: (props) =>
    L.control.attribution({
      ...(props.position !== undefined ? { position: props.position } : {}),
      ...(props.prefix !== undefined ? { prefix: props.prefix } : {}),
    }),
})
