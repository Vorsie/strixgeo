import { useState, type ReactNode, type ReactElement } from 'react'
import { MapContext, useStreafletContext } from '../core/MapContext'

export interface PaneProps {
  name: string
  /** CSS z-index applied to the created pane element. */
  zIndex?: number
  children?: ReactNode
}

/**
 * Create (once) a named Leaflet map pane and render children into the same map
 * context. Child layers opt into the pane by passing `pane={name}` in their
 * Leaflet options (Marker/Path components forward a `pane` prop — see those).
 *
 * @param props - Pane name, optional z-index, and child elements.
 * @returns A MapContext provider wrapping the children.
 */
export function Pane({ name, zIndex, children }: PaneProps): ReactElement {
  const ctx = useStreafletContext()
  // useState initializer runs once on mount; creates the pane if it doesn't
  // already exist, then applies the optional z-index override.
  useState(() => {
    const pane = ctx.map.getPane(name) ?? ctx.map.createPane(name)
    if (zIndex !== undefined) pane.style.zIndex = String(zIndex)
    return pane
  })
  // Layers still attach to the map; the pane is selected per-layer via `pane`.
  return <MapContext.Provider value={ctx}>{children}</MapContext.Provider>
}
