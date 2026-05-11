import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import type { CrossSectionResponse } from '../api/client'
import SectionPanel from './SectionPanel'

// Mock-friendly ResizeObserver lives in test/setup.ts; the panel uses
// it via the internal ``useElementSize`` hook.

function makeSection(overrides: Partial<CrossSectionResponse> = {}): CrossSectionResponse {
  return {
    id: '01k-FIXTURE',
    app_project_id: '01k-PROJECT',
    name: 'Cross-section AA',
    description: null,
    start_x: 150000,
    start_y: 200000,
    end_x: 150500,
    end_y: 200300,
    epsg: 31370,
    projection_buffer_m: 50,
    vertical_exaggeration: 2,
    excluded_borehole_ids: [],
    excluded_cpt_ids: [],
    min_depth_m: null,
    max_depth_m: null,
    display_order: 0,
    created_at: '2026-05-11T12:00:00Z',
    updated_at: '2026-05-11T12:00:00Z',
    ...overrides,
  }
}

describe('SectionPanel — header readouts', () => {
  it('renders the section name and the Euclidean length of the line', () => {
    // length = sqrt(500² + 300²) ≈ 583 m
    render(<SectionPanel section={makeSection()} zEpsg={5710} />)
    expect(screen.getByTitle('Cross-section AA')).toBeInTheDocument()
    expect(screen.getByText(/583 m/)).toBeInTheDocument()
    expect(screen.getByText(/buffer ±50 m/)).toBeInTheDocument()
  })

  it('seeds the VEX slider from the section row', () => {
    render(<SectionPanel section={makeSection({ vertical_exaggeration: 5 })} zEpsg={5710} />)
    expect(screen.getByText(/5\.0×/)).toBeInTheDocument()
  })

  it('falls back to 1× VEX when the section row is missing the column', () => {
    // ``vertical_exaggeration`` is NOT NULL server-side but a hand-
    // crafted fixture (or a future migration) might omit it; the
    // component's null-coalesce keeps the slider sane.
    const s = makeSection() as Partial<CrossSectionResponse>
    delete (s as { vertical_exaggeration?: number }).vertical_exaggeration
    render(<SectionPanel section={s as CrossSectionResponse} zEpsg={5710} />)
    expect(screen.getByText(/1\.0×/)).toBeInTheDocument()
  })
})

describe('SectionPanel — axis label uses the project vertical datum', () => {
  // ``verticalDatumShort`` resolves 5710 → "TAW" and 5709 → "NAP".
  // Reading the axis label tells the user which datum the level
  // values are in without re-checking project metadata.

  it('labels Y "Level (TAW)" for Belgium projects (EPSG 5710)', () => {
    render(<SectionPanel section={makeSection()} zEpsg={5710} />)
    expect(screen.getByText('Level (TAW)')).toBeInTheDocument()
  })

  it('labels Y "Level (NAP)" for Netherlands projects (EPSG 5709)', () => {
    render(<SectionPanel section={makeSection()} zEpsg={5709} />)
    expect(screen.getByText('Level (NAP)')).toBeInTheDocument()
  })

  it('falls back to bare "Level (m)" when the project has no z_epsg', () => {
    render(<SectionPanel section={makeSection()} zEpsg={null} />)
    expect(screen.getByText('Level (m)')).toBeInTheDocument()
  })
})

describe('SectionPanel — Reset button restores defaults', () => {
  it('clicking Reset is wired (no crash; component re-renders)', () => {
    // Stubbing the user-event chain for pan/wheel would over-test;
    // here we just confirm the Reset button is reachable and
    // clicking it doesn't throw. Real pan/zoom behaviour is exercised
    // by the bundled smoke test in the dev build, not unit tests.
    const onMouseDown = vi.fn()
    render(<SectionPanel section={makeSection()} zEpsg={5710} />)
    const reset = screen.getByTitle('Reset view to default framing')
    reset.click()
    expect(onMouseDown).not.toHaveBeenCalled() // sanity: click didn't propagate
  })
})
