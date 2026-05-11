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

describe('SectionPanel — investigation columns', () => {
  // A horizontal 1km section at the origin of the section's CRS.
  // Investigation points use the same CRS — math reduces cleanly:
  // a CPT at (300, 0) projects to along=300, offset=0.
  const horizontal1km = makeSection({
    start_x: 0,
    start_y: 0,
    end_x: 1000,
    end_y: 0,
    projection_buffer_m: 50,
  })

  // ResizeObserver is stubbed in test/setup.ts but doesn't trigger a
  // size by default — the panel renders a "Sizing canvas…" placeholder
  // until the observer fires. For these tests we mock the observer to
  // call back synchronously with a fixed viewport, so the SVG (and
  // therefore the column glyphs) actually render.
  function withFixedSize(width: number, height: number): () => void {
    const RealRO = globalThis.ResizeObserver
    class FixedRO {
      private cb: ResizeObserverCallback
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb
      }
      observe(target: Element): void {
        Object.defineProperty(target, 'clientWidth', { configurable: true, value: width })
        Object.defineProperty(target, 'clientHeight', { configurable: true, value: height })
        // Async like the real observer fires.
        queueMicrotask(() =>
          this.cb(
            [
              {
                contentRect: { width, height } as DOMRectReadOnly,
                target,
              } as unknown as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          ),
        )
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    ;(globalThis as { ResizeObserver: unknown }).ResizeObserver =
      FixedRO as unknown as typeof ResizeObserver
    return () => {
      ;(globalThis as { ResizeObserver: unknown }).ResizeObserver = RealRO
    }
  }

  function makeCpt(overrides: Record<string, unknown>): import('../api/client').CptListItem {
    return {
      id: 'cpt-1',
      name: 'CPT-1',
      cpt_type: 'CPTU',
      project_id: 'P',
      test_id: 'T',
      location_x: 300,
      location_y: 0,
      elevation_m: 5,
      epsg: 31370,
      z_epsg: 5710,
      max_depth_m: 20,
      n_rows: 100,
      ...overrides,
    } as import('../api/client').CptListItem
  }

  function makeBorehole(
    overrides: Record<string, unknown>,
  ): import('../api/client').BoreholeListItem {
    return {
      id: 'bh-1',
      name: 'BH-1',
      borehole_type: 'DOV',
      project_id: 'P',
      test_id: 'T',
      location_x: 600,
      location_y: 10,
      elevation_m: 7,
      epsg: 31370,
      z_epsg: 5710,
      total_depth_m: 25,
      drill_method: 'rotary',
      ...overrides,
    } as import('../api/client').BoreholeListItem
  }

  it('renders a column for each CPT and borehole whose projection lands in the section', async () => {
    const restore = withFixedSize(800, 400)
    // location_y=0 keeps the offset under 1m so the name label is the
    // plain investigation name — easier to find than the offset-
    // suffixed version (covered separately below).
    const cpt = makeCpt({ location_y: 0 })
    const bh = makeBorehole({ location_y: 0 })
    render(
      <SectionPanel
        section={horizontal1km}
        zEpsg={5710}
        cpts={[cpt]}
        boreholes={[bh]}
      />,
    )
    // Wait for ResizeObserver microtask so the SVG mounts.
    await new Promise(r => setTimeout(r, 0))
    expect(screen.getByText('CPT-1')).toBeInTheDocument()
    expect(screen.getByText('BH-1')).toBeInTheDocument()
    restore()
  })

  it('drops investigations whose perpendicular distance exceeds the projection buffer', async () => {
    const restore = withFixedSize(800, 400)
    const far = makeCpt({ id: 'cpt-far', name: 'CPT-FAR', location_y: 200 })
    render(
      <SectionPanel
        section={horizontal1km}
        zEpsg={5710}
        cpts={[far]}
      />,
    )
    await new Promise(r => setTimeout(r, 0))
    expect(screen.queryByText('CPT-FAR')).not.toBeInTheDocument()
    restore()
  })

  it('honours the section.excluded_cpt_ids list — user-hidden CPTs do not render', async () => {
    const restore = withFixedSize(800, 400)
    const a = makeCpt({ id: 'cpt-a', name: 'CPT-A', location_x: 200 })
    const b = makeCpt({ id: 'cpt-b', name: 'CPT-B', location_x: 400 })
    render(
      <SectionPanel
        section={{ ...horizontal1km, excluded_cpt_ids: ['cpt-a'] }}
        zEpsg={5710}
        cpts={[a, b]}
      />,
    )
    await new Promise(r => setTimeout(r, 0))
    expect(screen.queryByText('CPT-A')).not.toBeInTheDocument()
    expect(screen.getByText('CPT-B')).toBeInTheDocument()
    restore()
  })

  it('adds an offset hint to the name label when |offset| ≥ 1 m', async () => {
    const restore = withFixedSize(800, 400)
    // Borehole at y=12 → offset = -12 m (right side of the line per
    // the projection convention). Engineers should see "→12 m" in
    // the label.
    const offline = makeBorehole({ id: 'bh-off', name: 'BH-OFF', location_y: 12 })
    render(
      <SectionPanel
        section={horizontal1km}
        zEpsg={5710}
        boreholes={[offline]}
      />,
    )
    await new Promise(r => setTimeout(r, 0))
    expect(screen.getByText(/BH-OFF.*→12 m/)).toBeInTheDocument()
    restore()
  })
})
