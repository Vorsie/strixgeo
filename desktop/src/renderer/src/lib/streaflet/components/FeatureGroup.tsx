import L from 'leaflet'
import { createLayerComponent } from '../core/createLayerComponent'
import type { EventedProps } from '../core/events'

/** Props for {@link FeatureGroup}; an evented LayerGroup that bubbles child events. */
export type FeatureGroupProps = EventedProps

/** A LayerGroup that fires events for its child layers (wraps L.featureGroup). */
export const FeatureGroup = createLayerComponent<FeatureGroupProps, L.FeatureGroup>({
  createInstance: () => L.featureGroup(),
})
