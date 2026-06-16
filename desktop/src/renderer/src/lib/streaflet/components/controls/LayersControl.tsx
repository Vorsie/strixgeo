import L from 'leaflet'
import { createControlComponent, type ControlProps } from '../../core/createControlComponent'

/** Props for {@link LayersControl}; base layers + overlays as {name: L.Layer} records. */
export interface LayersControlProps extends ControlProps {
  baseLayers?: Record<string, L.Layer>
  overlays?: Record<string, L.Layer>
  collapsed?: boolean
}

/** Layer switcher control (wraps L.control.layers). */
export const LayersControl = createControlComponent<LayersControlProps, L.Control.Layers>({
  // Only pass options that are explicitly provided; passing `position: undefined`
  // clobbers Leaflet's prototype default and crashes Control.addTo on
  // `undefined.indexOf`. Same conditional-spread convention as TileLayer.
  createInstance: (props) =>
    L.control.layers(props.baseLayers, props.overlays, {
      ...(props.position !== undefined ? { position: props.position } : {}),
      ...(props.collapsed !== undefined ? { collapsed: props.collapsed } : {}),
    }),
})
