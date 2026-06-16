import L from 'leaflet'
import { useEffect, useRef, type ReactNode, type ReactPortal } from 'react'
import { createPortal } from 'react-dom'
import { useStreafletContext } from '../core/MapContext'

/** Props for {@link Popup}; binds to the nearest enclosing layer, or opens at `position`. */
export interface PopupProps {
  children?: ReactNode
  position?: L.LatLngExpression
  maxWidth?: number
  minWidth?: number
  autoPan?: boolean
  closeButton?: boolean
  className?: string
}

/**
 * Bind a Leaflet popup to the nearest enclosing layer (via context's parentLayer),
 * or, if there is no parent layer, open it standalone at `position` on the map.
 * React children render into the popup element through a portal.
 *
 * Leaflet option props (position/maxWidth/minWidth/autoPan/closeButton/className)
 * are read once at mount; changing them later does not rebind the popup — only
 * the portalled children update, not the options — so a changed option requires
 * remounting the component (e.g. via a `key` change).
 *
 * @param props - Popup options, optional standalone `position`, and React children.
 * @returns A React portal rendering children into the Leaflet popup element.
 */
export function Popup({ children, position, ...options }: PopupProps): ReactPortal {
  const ctx = useStreafletContext()
  // Lazy-init the portal div: allocate it on the first render only, not on every
  // render (a plain `useRef(document.createElement('div'))` evaluates createElement
  // each render and discards all but the first — needless DOM churn).
  const elRef = useRef<HTMLDivElement | null>(null)
  if (elRef.current === null) elRef.current = document.createElement('div')
  const el = elRef.current

  useEffect(() => {
    const layer = ctx.parentLayer
    if (layer && typeof (layer as L.Marker).bindPopup === 'function') {
      ;(layer as L.Marker).bindPopup(el, options)
      return () => {
        ;(layer as L.Marker).unbindPopup()
      }
    }
    const popup = L.popup(options).setContent(el)
    if (position) popup.setLatLng(position).openOn(ctx.map)
    return () => {
      ctx.map.closePopup(popup)
    }
    // reason: bind once per parentLayer; React children update through the portal,
    // not a rebind. position/options are read at mount (Leaflet popup option
    // changes need a remount, matching the no-rebind contract).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.parentLayer])

  return createPortal(children, el)
}
