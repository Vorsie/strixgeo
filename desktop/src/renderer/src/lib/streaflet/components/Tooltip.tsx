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
  /** Render the tooltip into this named Leaflet pane (flows through ...options into bindTooltip). */
  pane?: string
}

/**
 * Bind a Leaflet tooltip to the nearest enclosing layer (Marker/Path/group via
 * context's parentLayer). React children render into the tooltip element through
 * a portal, so content updates without a rebind.
 *
 * Leaflet option props (direction/offset/opacity/pane/sticky/permanent/className)
 * are read once at mount; changing them later does not rebind the tooltip — only
 * the portalled children update, not the options — so a changed option requires
 * remounting the component (e.g. via a `key` change).
 *
 * @param props - Tooltip options and React children.
 * @returns A React portal rendering children into the Leaflet tooltip element.
 */
export function Tooltip({ children, ...options }: TooltipProps): ReactPortal {
  const ctx = useStreafletContext()
  // Lazy-init the portal div: allocate it on the first render only, not on every
  // render (a plain `useRef(document.createElement('div'))` evaluates createElement
  // each render and discards all but the first — needless DOM churn).
  const elRef = useRef<HTMLDivElement | null>(null)
  if (elRef.current === null) elRef.current = document.createElement('div')
  const el = elRef.current

  useEffect(() => {
    const layer = ctx.parentLayer
    if (!layer || typeof (layer as L.Marker).bindTooltip !== 'function') return
    ;(layer as L.Marker).bindTooltip(el, options)
    return () => {
      ;(layer as L.Marker).unbindTooltip()
    }
    // reason: `options` is spread fresh each render; binding once per parentLayer
    // is intentional — content updates flow through the portal, not a rebind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.parentLayer])

  return createPortal(children, el)
}
