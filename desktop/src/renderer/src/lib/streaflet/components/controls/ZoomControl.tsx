import L from 'leaflet'
import { createControlComponent, type ControlProps } from '../../core/createControlComponent'

/** Props for {@link ZoomControl}. */
export type ZoomControlProps = ControlProps

/** Zoom in/out buttons control (wraps L.control.zoom). */
export const ZoomControl = createControlComponent<ZoomControlProps, L.Control.Zoom>({
  createInstance: (props) => L.control.zoom({ position: props.position }),
})
