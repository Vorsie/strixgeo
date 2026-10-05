// Owner finding 2026-10-05: the legend showed a flask while the map marker
// showed a triangle. The legend now draws the SAME path function as the map
// marker and the borelog sample marker, at its own size.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LabFlaskIcon } from './LabFlaskIcon'
import { LAB_FLASK_HALO_WIDTH, labFlaskPathD } from './mapMarkerStyle'

describe('lab-test flask: one drawing for marker, borelog and legend', () => {
  it('the legend icon draws the same path function at its own size', () => {
    render(<LabFlaskIcon height={12} data-testid="legend-flask" />)
    const svg = screen.getByTestId('legend-flask')
    const path = svg.querySelector('path[data-glyph="lab-flask"]')
    const d = labFlaskPathD(LAB_FLASK_HALO_WIDTH / 2, LAB_FLASK_HALO_WIDTH / 2, 12)
    expect(path?.getAttribute('d')).toBe(d)
  })

  it('the legend icon carries the same light halo as the map marker (dark legend)', () => {
    render(<LabFlaskIcon height={12} data-testid="legend-flask" />)
    const halo = screen.getByTestId('legend-flask').querySelector('path[data-glyph="lab-flask-halo"]')
    expect(halo?.getAttribute('d')).toBe(labFlaskPathD(LAB_FLASK_HALO_WIDTH / 2, LAB_FLASK_HALO_WIDTH / 2, 12))
  })

})
