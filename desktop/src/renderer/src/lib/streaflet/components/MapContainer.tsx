import L from 'leaflet'
import { forwardRef, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { MapContext } from '../core/MapContext'
import { useImperativeInstance } from '../core/lifecycle'

/** Props for {@link MapContainer}; initial view + map options. */
export interface MapContainerProps {
  center?: L.LatLngExpression
  zoom?: number
  bounds?: L.LatLngBoundsExpression
  minZoom?: number
  maxZoom?: number
  zoomControl?: boolean
  attributionControl?: boolean
  /**
   * Render vector paths (``CircleMarker`` &c.) on a shared ``Canvas`` instead of
   * one SVG element each. A construction-time Leaflet option — at high marker
   * density (thousands of CPTs) canvas keeps panning smooth where per-marker SVG
   * DOM does not. Default ``false`` (Leaflet's own default).
   */
  preferCanvas?: boolean
  style?: CSSProperties
  className?: string
  children?: ReactNode
  whenReady?: (map: L.Map) => void
}

/** Root component: creates the L.Map once, provides context, renders children when ready. */
export const MapContainer = forwardRef<L.Map, MapContainerProps>(function MapContainer(props, ref) {
  const divRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<L.Map | null>(null)

  useEffect(() => {
    if (divRef.current === null) return
    const created = L.map(divRef.current, {
      center: props.center ?? [0, 0],
      zoom: props.zoom ?? 1,
      minZoom: props.minZoom,
      maxZoom: props.maxZoom,
      zoomControl: props.zoomControl ?? true,
      attributionControl: props.attributionControl ?? true,
      preferCanvas: props.preferCanvas ?? false,
    })
    if (props.bounds) created.fitBounds(props.bounds)
    setMap(created)
    // Fire whenReady on Leaflet's own ready event (matches L.Map.whenReady
    // semantics) — fires synchronously when a center/zoom is set, else after
    // the initial view settles, so the map is genuinely ready for the callback.
    if (props.whenReady) created.whenReady(() => props.whenReady?.(created))
    return () => {
      // Unmount can land mid-gesture, e.g. a wheel over the map just before
      // the stage switches away (walker findings 10/11, 19/20). Leaflet
      // debounces scroll-wheel zoom behind a setTimeout (wheelDebounceTime,
      // 40 ms), and map.remove() tears down the panes WITHOUT clearing that
      // timer, so the deferred _performZoom then runs against a removed map:
      // getPosition(undefined _mapPane) throws "Cannot read properties of
      // undefined (reading '_leaflet_pos')". Stop running animations and
      // cancel the pending wheel zoom so unmount is deterministic.
      created.stop()
      const wheelZoom = created.scrollWheelZoom as unknown as {
        _timer?: ReturnType<typeof setTimeout>
      }
      if (wheelZoom?._timer !== undefined) {
        clearTimeout(wheelZoom._timer)
        wheelZoom._timer = undefined
      }
      created.remove()
      setMap(null)
    }
    // reason: create the map once on mount from the initial view props; live
    // view changes go through useMap()/imperative calls in consumers, matching
    // Leaflet semantics.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeInstance(ref, map)

  return (
    <div ref={divRef} style={props.style} className={props.className}>
      {map !== null && (
        <MapContext.Provider value={{ map, layerContainer: map }}>
          {props.children}
        </MapContext.Provider>
      )}
    </div>
  )
})
