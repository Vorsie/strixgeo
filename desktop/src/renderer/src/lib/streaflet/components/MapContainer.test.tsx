import { describe, it, expect } from 'vitest'
import { createRef, StrictMode } from 'react'
import { render } from '@testing-library/react'
import type L from 'leaflet'
import { MapContainer } from './MapContainer'
import { TileLayer } from './TileLayer'

describe('MapContainer', () => {
  it('renders a leaflet container div', () => {
    const { container, unmount } = render(
      <MapContainer center={[51, 4]} zoom={10} style={{ width: 400, height: 400 }}>
        <TileLayer url="https://x/{z}/{x}/{y}.png" />
      </MapContainer>,
    )
    expect(container.querySelector('.leaflet-container')).not.toBeNull()
    unmount()
  })

  it('creates exactly one live map under StrictMode double-mount', () => {
    const { container, unmount } = render(
      <StrictMode>
        <MapContainer center={[51, 4]} zoom={10} style={{ width: 400, height: 400 }}>
          <TileLayer url="https://x/{z}/{x}/{y}.png" />
        </MapContainer>
      </StrictMode>,
    )
    // exactly one initialised leaflet container in the tree
    expect(container.querySelectorAll('.leaflet-container').length).toBe(1)
    unmount()
  })

  it('forwards preferCanvas to the leaflet map (M7a — canvas markers)', () => {
    const ref = createRef<L.Map>()
    const { unmount } = render(
      <MapContainer ref={ref} center={[51, 4]} zoom={10} preferCanvas style={{ width: 400, height: 400 }}>
        <TileLayer url="https://x/{z}/{x}/{y}.png" />
      </MapContainer>,
    )
    expect(ref.current?.options.preferCanvas).toBe(true)
    unmount()
  })

  it('defaults preferCanvas off when the prop is omitted', () => {
    const ref = createRef<L.Map>()
    const { unmount } = render(
      <MapContainer ref={ref} center={[51, 4]} zoom={10} style={{ width: 400, height: 400 }}>
        <TileLayer url="https://x/{z}/{x}/{y}.png" />
      </MapContainer>,
    )
    expect(ref.current?.options.preferCanvas ?? false).toBe(false)
    unmount()
  })
})
