import L from 'leaflet'
import { createLayerComponent } from '../core/createLayerComponent'
import type { EventedProps } from '../core/events'

/** Props for {@link LayerGroup}; a container whose children attach to the group. */
export type LayerGroupProps = EventedProps

/** Groups child layers so they can be added/removed/toggled together (wraps L.layerGroup). */
export const LayerGroup = createLayerComponent<LayerGroupProps, L.LayerGroup>({
  createInstance: () => L.layerGroup(),
})
