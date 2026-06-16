import { useEffect, useRef } from 'react'
import type L from 'leaflet'

/**
 * Map of first-class React event-prop names → Leaflet event names. Add a row
 * here to promote a new Leaflet event to a typed prop across all components.
 */
export const LEAFLET_EVENTS = {
  onClick: 'click',
  onDblClick: 'dblclick',
  onMouseDown: 'mousedown',
  onMouseUp: 'mouseup',
  onMouseOver: 'mouseover',
  onMouseOut: 'mouseout',
  onMouseMove: 'mousemove',
  onContextMenu: 'contextmenu',
  onDragStart: 'dragstart',
  onDrag: 'drag',
  onDragEnd: 'dragend',
  onMove: 'move',
  onMoveStart: 'movestart',
  onMoveEnd: 'moveend',
  onZoom: 'zoom',
  onZoomStart: 'zoomstart',
  onZoomEnd: 'zoomend',
  onAdd: 'add',
  onRemove: 'remove',
  onPopupOpen: 'popupopen',
  onPopupClose: 'popupclose',
  onTooltipOpen: 'tooltipopen',
  onTooltipClose: 'tooltipclose',
} as const

export type LeafletEventPropName = keyof typeof LEAFLET_EVENTS

/** Props every interactive streaflet component accepts. */
export type EventedProps = {
  [K in LeafletEventPropName]?: L.LeafletEventHandlerFn
} & {
  /** Escape hatch: bind any Leaflet event not promoted to a typed prop. */
  on?: Partial<Record<string, L.LeafletEventHandlerFn>>
}

/** Flatten direct event props + `on` into one {leafletEvent: handler} record. */
function resolveHandlers(props: EventedProps): Record<string, L.LeafletEventHandlerFn> {
  const out: Record<string, L.LeafletEventHandlerFn> = {}
  for (const [propName, leafletName] of Object.entries(LEAFLET_EVENTS)) {
    const handler = props[propName as LeafletEventPropName]
    if (handler) out[leafletName] = handler
  }
  if (props.on) {
    for (const [name, handler] of Object.entries(props.on)) {
      if (handler) out[name] = handler
    }
  }
  return out
}

/**
 * Keep a Leaflet object's event bindings in sync with React props. Diffs the
 * resolved handler set against the previous render and only `off`/`on`s what
 * changed, so handlers never stack and nothing leaks on unmount.
 */
export function useEventHandlers(target: L.Evented | null, props: EventedProps): void {
  const boundRef = useRef<Record<string, L.LeafletEventHandlerFn>>({})

  useEffect(() => {
    if (target === null) return
    const next = resolveHandlers(props)
    const prev = boundRef.current

    for (const [name, handler] of Object.entries(prev)) {
      if (next[name] !== handler) target.off(name, handler)
    }
    for (const [name, handler] of Object.entries(next)) {
      if (prev[name] !== handler) target.on(name, handler)
    }
    boundRef.current = next

    return () => {
      for (const [name, handler] of Object.entries(boundRef.current)) {
        target.off(name, handler)
      }
      boundRef.current = {}
    }
  })
}
