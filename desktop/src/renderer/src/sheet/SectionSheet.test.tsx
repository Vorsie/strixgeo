import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { nadClassColor, nadCompactLabel } from '../utils/nadClasses'
import { SectionSheet } from './SectionSheet'
import type { SheetPayload } from './sheetPayload'

function payload(): SheetPayload {
  return {
    language: 'nl',
    section: { id: 's1', name: 'CS1', epsg: 31370, lengthM: 400, startX: 0, startY: 0, endX: 400, endY: 0, viewState: null },
    columns: [
      { investigationId: 'c1', kind: 'cpt', name: 'GEO-16/095-S6', code: 'S6', projectKey: 'GEO-16/095', colourIndex: 0, alongM: 0, collarElevationM: 5, totalDepthM: 20, cptType: 'CPTU', plot: null, detail: null },
      { investigationId: 'c2', kind: 'cpt', name: 'GEO-16/095-S5', code: 'S5', projectKey: 'GEO-16/095', colourIndex: 0, alongM: 400, collarElevationM: 4, totalDepthM: 18, cptType: 'CPTU', plot: null, detail: null },
    ],
    regions: [
      { formation_id: 'f-sand', body_id: 'b1', gap_index: 0, polygon: [[0, 5], [1, 4], [1, -3], [0, -2]] },
      { formation_id: 'f-clay', body_id: 'b2', gap_index: 0, polygon: [[0, -2], [1, -3], [1, -15], [0, -15]] },
    ],
    units: [
      { formationId: 'f-sand', name: 'ZAND · Quartair', colour: '#e8c26a', displayOrder: 1 },
      { formationId: 'f-clay', name: 'KLEI · Quartair', colour: '#9db7c9', displayOrder: 2 },
    ],
    levelMaxM: 5.5, levelMinM: -15.5,
    map: { basemapId: 'osm', points: [], legend: [{ projectKey: 'GEO-16/095', colourIndex: 0, codes: ['S6', 'S5'] }] },
    settings: {
      fill: 'litho', scaleMode: 'fit', hScale: null, vScale: null, vex: 5, spacing: 1,
      fields: [{ label: 'Project', value: 'Kaai 1712' }, { label: 'Profiel', value: 'CS1' }, { label: 'Opdrachtgever', value: '' }, { label: 'Datum · Auteur', value: '2026-09-02' }],
    },
  }
}

describe('SectionSheet — the printed sheet is the on-screen partition', () => {
  it('draws one path per region, in unit colour, with no white column mask', () => {
    render(<SectionSheet payload={payload()} map={<div data-testid="map-slot" />} />)
    const paths = screen.getAllByTestId('sheet-region')
    expect(paths).toHaveLength(2)
    expect(paths[0]).toHaveAttribute('fill', '#e8c26a')
    expect(screen.queryAllByTestId('sheet-column-mask')).toHaveLength(0)
  })
  it('labels the ends A and A′ and the columns by short code', () => {
    render(<SectionSheet payload={payload()} map={<div />} />)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('A′')).toBeInTheDocument()
    expect(screen.getByText('S6')).toBeInTheDocument()
  })
  it('renders the four fields, the scale line and the unit legend', () => {
    render(<SectionSheet payload={payload()} map={<div />} />)
    expect(screen.getByText('Kaai 1712')).toBeInTheDocument()
    expect(screen.getByText('Opdrachtgever')).toBeInTheDocument()
    expect(screen.getByTestId('sheet-scale-line').textContent).toMatch(/H 1:\d+/)
    // The unit name appears both inside its region fill and in the legend
    // (both are spec requirements); assert the legend copy specifically.
    const legend = screen.getByTestId('sheet-unit-legend')
    expect(within(legend).getByText('KLEI · Quartair')).toBeInTheDocument()
  })
  it('sizes the page to the computed paper: a short profile floors at A3, fit mode is A3 high', () => {
    // A short profile still gets a full A3 width (spec "Paper"); fit mode is A3
    // high. (The plan's 400 m payload was narrowed here — at vex 5 that profile
    // is ~1092 mm wide, so it could not exercise the 420 mm floor the assertion
    // is about.)
    const p = payload()
    p.columns[1] = { ...p.columns[1], alongM: 40 }
    render(<SectionSheet payload={p} map={<div />} />)
    const page = screen.getByTestId('sheet-page')
    expect(page.style.width).toBe('420mm')
    expect(page.style.height).toBe('297mm')
  })
})

// A geotech-axis sheet subdivides each litho unit into NAD packing classes, so
// on paper it must colour a region by its packing class (the density ramp the
// section canvas uses), never by the litho formation colour the geotech row
// inherited from its source litho unit. The unit ``colour`` field carries that
// inherited litho colour — the field the old code painted with — so pinning the
// packing colour proves the region is NOT drawn in its formation colour.
function geotechPayload(): SheetPayload {
  const base = payload()
  return {
    ...base,
    regions: [
      { formation_id: 'g-sand-md-a', body_id: 'b1', gap_index: 0, polygon: [[0, 5], [1, 4], [1, -2], [0, -1]] },
      { formation_id: 'g-sand-md-b', body_id: 'b2', gap_index: 0, polygon: [[0, -1], [1, -2], [1, -8], [0, -8]] },
      { formation_id: 'g-clay-ff', body_id: 'b3', gap_index: 0, polygon: [[0, -8], [1, -8], [1, -15], [0, -15]] },
    ],
    // Two SILT/SAND litho parents both subdivide into ZAND·MD (NAD 6): distinct
    // formations, one packing class. ``colour`` here is the inherited litho hue.
    units: [
      { formationId: 'g-sand-md-a', name: 'ZAND (geotech)', colour: '#e8c26a', displayOrder: 1, nadClass: 6, colorOverride: null },
      { formationId: 'g-sand-md-b', name: 'ZAND (geotech)', colour: '#e8c26a', displayOrder: 2, nadClass: 6, colorOverride: null },
      { formationId: 'g-clay-ff', name: 'KLEI (geotech)', colour: '#9db7c9', displayOrder: 3, nadClass: 23, colorOverride: null },
    ],
    settings: { ...base.settings, fill: 'geotech' },
  }
}

describe('SectionSheet — the geotech sheet colours by NAD packing class', () => {
  it('a geotech-axis sheet colours a region by its packing class, not its formation', () => {
    render(<SectionSheet payload={geotechPayload()} map={<div />} />)
    const fills = screen.getAllByTestId('sheet-region').map(p => p.getAttribute('fill'))
    expect(fills).toContain(nadClassColor(6)) // ZAND·MD packing colour
    expect(fills).toContain(nadClassColor(23)) // KLEI·FF packing colour
    // never the inherited litho formation colour
    expect(fills).not.toContain('#e8c26a')
  })

  it('the legend lists each packing class present once', () => {
    render(<SectionSheet payload={geotechPayload()} map={<div />} />)
    const legend = screen.getByTestId('sheet-unit-legend')
    // NAD 6 is drawn by two distinct formations; the legend states it ONCE
    // (payload language is 'nl' → the compact NL label 'ZAND·MD').
    expect(within(legend).getAllByText(nadCompactLabel(6, 'nl'))).toHaveLength(1)
    expect(within(legend).getAllByText(nadCompactLabel(23, 'nl'))).toHaveLength(1)
  })

  it('a litho-axis sheet is unchanged: regions in formation colour, legend by formation name', () => {
    render(<SectionSheet payload={payload()} map={<div />} />)
    const fills = screen.getAllByTestId('sheet-region').map(p => p.getAttribute('fill'))
    expect(fills[0]).toBe('#e8c26a') // the litho formation colour, verbatim
    const legend = screen.getByTestId('sheet-unit-legend')
    expect(within(legend).getByText('KLEI · Quartair')).toBeInTheDocument()
  })
})
