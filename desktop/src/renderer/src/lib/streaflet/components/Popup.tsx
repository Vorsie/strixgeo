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
 * @param props - Popup options, optional standalone `position`, and React children.
 * @returns A React portal rendering children into the Leaflet popup element.
 */
export function Popup({ children, position, ...options }: PopupProps): ReactPortal {
  const ctx = useStreafletContext()
  const elRef = useRef<HTMLDivElement>(document.createElement('div'))

  useEffect(() => {
    const layer = ctx.parentLayer
    if (layer && typeof (layer as L.Marker).bindPopup === 'function') {
      ;(layer as L.Marker).bindPopup(elRef.current, options)
      return () => {
        ;(layer as L.Marker).unbindPopup()
      }
    }
    const popup = L.popup(options).setContent(elRef.current)
    if (position) popup.setLatLng(position).openOn(ctx.map)
    return () => {
      ctx.map.closePopup(popup)
    }
    // reason: bind once per parentLayer; React children update through the portal,
    // not a rebind. position/options are read at mount (Leaflet popup option
    // changes need a remount, matching the no-rebind contract).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.parentLayer])

  return createPortal(children, elRef.current)
}
