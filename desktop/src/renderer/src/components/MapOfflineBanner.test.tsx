// L9 — the 2D map goes grey offline with no notice, while the 3D viewer already
// shows an "offline" banner. This gives the map the same signal so the engineer
// knows the blank tiles are a network issue, not a broken map.
//
// The banner lives in its own Leaflet-free module so it is testable without
// mounting the map (Leaflet needs a real DOM). MapView renders it from
// ``useOnlineStatus()``.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MapOfflineBanner } from './MapOfflineBanner'

describe('MapOfflineBanner', () => {
  it('renders nothing while online', () => {
    const { container } = render(<MapOfflineBanner online={true} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('map-offline-banner')).not.toBeInTheDocument()
  })

  it('shows a status banner when offline', () => {
    render(<MapOfflineBanner online={false} />)
    const banner = screen.getByTestId('map-offline-banner')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveAttribute('role', 'status')
    // Carries some copy (the translated offline message).
    expect(banner.textContent?.trim().length ?? 0).toBeGreaterThan(0)
  })
})
