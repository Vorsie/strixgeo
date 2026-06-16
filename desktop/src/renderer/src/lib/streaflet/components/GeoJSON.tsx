import L from 'leaflet'
import type { GeoJsonObject } from 'geojson'
import { createLayerComponent } from '../core/createLayerComponent'
import type { EventedProps } from '../core/events'

/** Props for {@link GeoJSON}; renders a GeoJSON object as vector layers. */
export interface GeoJSONProps extends EventedProps {
  data: GeoJsonObject
  style?: L.PathOptions
  onEachFeature?: L.GeoJSONOptions['onEachFeature']
  pointToLayer?: L.GeoJSONOptions['pointToLayer']
}

/** Renders a GeoJSON FeatureCollection/feature as Leaflet vector layers (wraps L.geoJSON). */
export const GeoJSON = createLayerComponent<GeoJSONProps, L.GeoJSON>({
  createInstance: (props) =>
    L.geoJSON(props.data, {
      style: props.style ? () => props.style as L.PathOptions : undefined,
      onEachFeature: props.onEachFeature,
      pointToLayer: props.pointToLayer,
    }),
  updateInstance: (gj, props, prev) => {
    if (props.data !== prev.data) {
      gj.clearLayers()
      gj.addData(props.data)
    }
  },
})
