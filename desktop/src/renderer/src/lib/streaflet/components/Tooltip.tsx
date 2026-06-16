import L from 'leaflet'
import { useEffect, useRef, type ReactNode, type ReactPortal } from 'react'
import { createPortal } from 'react-dom'
import { useStreafletContext } from '../core/MapContext'

/** Props for {@link Tooltip}; binds to the nearest enclosing layer. */
export interface TooltipProps {
  children?: ReactNode
  permanent?: boolean
  direction?: L.Direction
  offset?: L.PointExpression
  sticky?: boolean
  opacity?: number
  className?: string
}

/**
 * Bind a Leaflet tooltip to the nearest enclosing layer (Marker/Path/group via
 * context's parentLayer). React children render into the tooltip element through
 * a portal, so content updates without a rebind.
 *
 * @param props - Tooltip options and React children.
 * @returns A React portal rendering children into the Leaflet tooltip element.
 */
export function Tooltip({ children, ...options }: TooltipProps): ReactPortal {
  const ctx = useStreafletContext()
  const elRef = useRef<HTMLDivElement>(document.createElement('div'))

  useEffect(() => {
    const layer = ctx.parentLayer
    if (!layer || typeof (layer as L.Marker).bindTooltip !== 'function') return
    ;(layer as L.Marker).bindTooltip(elRef.current, options)
    return () => {
      ;(layer as L.Marker).unbindTooltip()
    }
    // reason: `options` is spread fresh each render; binding once per parentLayer
    // is intentional — content updates flow through the portal, not a rebind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.parentLayer])

  return createPortal(children, elRef.current)
}
