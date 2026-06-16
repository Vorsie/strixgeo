import L from 'leaflet'
import { createControlComponent, type ControlProps } from '../../core/createControlComponent'

/** Props for {@link ZoomControl}. */
export type ZoomControlProps = ControlProps

/** Zoom in/out buttons control (wraps L.control.zoom). */
export const ZoomControl = createControlComponent<ZoomControlProps, L.Control.Zoom>({
  // Only pass position when explicitly provided; passing `position: undefined`
  // clobbers Leaflet's prototype default ('topleft') because L.setOptions does
  // a plain `for..in` copy, and Control.addTo then crashes on `undefined.indexOf`.
  // Same convention as TileLayer's conditional-spread for default-bearing options.
  createInstance: (props) =>
    L.control.zoom({ ...(props.position !== undefined ? { position: props.position } : {}) }),
})
