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
  createInstance: (props) =>
    L.control.attribution({ position: props.position, prefix: props.prefix }),
})
