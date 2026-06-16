import { render, type RenderResult } from '@testing-library/react'
import { useEffect, useState, type ReactNode, type ReactElement } from 'react'
import L from 'leaflet'
import { MapContext } from '../core/MapContext'

/**
 * Render streaflet children inside a real Leaflet map mounted in jsdom. Returns
 * the map plus the RTL result. The map div is given a fixed size so Leaflet's
 * layout math does not divide by zero under jsdom.
 *
 * @param children - React subtree to render inside the map context.
 * @returns The Leaflet map instance plus the RTL RenderResult.
 */
export function renderInMap(children: ReactNode): { map: L.Map } & RenderResult {
  let map!: L.Map
  function Harness(): ReactElement | null {
    const [m, setM] = useState<L.Map | null>(null)
    useEffect(() => {
      const div = document.createElement('div')
      Object.assign(div.style, { width: '400px', height: '400px' })
      document.body.appendChild(div)
      const created = L.map(div, { center: [51, 4], zoom: 10 })
      map = created
      setM(created)
      return () => { created.remove() }
    }, [])
    if (m === null) return null
    return <MapContext.Provider value={{ map: m, layerContainer: m }}>{children}</MapContext.Provider>
  }
  const result = render(<Harness />)
  return { map, ...result }
}
