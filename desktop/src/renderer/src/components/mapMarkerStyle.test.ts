// Marker draw helpers (M7a). The load-bearing pin is "the hover ring still
// works": switching CPT markers to a canvas renderer + one shared tooltip must
// not change how selection/hover paints a marker.

import { describe, expect, it } from 'vitest'

import {
  RADIUS,
  RADIUS_SELECTED,
  boreholeTooltipLines,
  cptTooltipLines,
  markerRingStyle,
  markerTooltipElement,
} from './mapMarkerStyle'

describe('markerRingStyle (M7a — the hover ring)', () => {
  it('S1 — a plain marker is small, neutral, thin', () => {
    expect(markerRingStyle({ selected: false, ringed: false, enlarged: false })).toEqual({
      radius: RADIUS,
      color: '#1f2937',
      weight: 1,
    })
  })

  it('S2 — a hovered/marquee marker gets the blue ring and grows', () => {
    // Inspector-row hover sets ringed + enlarged (hovered drives both).
    expect(markerRingStyle({ selected: false, ringed: true, enlarged: true })).toEqual({
      radius: RADIUS_SELECTED,
      color: '#2563eb',
      weight: 2,
    })
  })

  it('S3 — the primary selection gets the dark-blue ring and grows', () => {
    expect(markerRingStyle({ selected: true, ringed: false, enlarged: true })).toEqual({
      radius: RADIUS_SELECTED,
      color: '#1e3a8a',
      weight: 2,
    })
  })
})

describe('tooltip content builders (M7a)', () => {
  it('T1 — a CPT tooltip is "name" then "type · depth"', () => {
    expect(cptTooltipLines({ name: 'GH-01', type: 'CPTU', depth: 20 })).toEqual({
      title: 'GH-01',
      subtitle: 'CPTU · 20.0 m',
    })
  })

  it('T2 — a missing depth renders an em dash', () => {
    expect(cptTooltipLines({ name: 'GH-02', type: 'CPTE', depth: null }).subtitle).toBe('CPTE · —')
  })

  it('T3 — a borehole tooltip is "name" then "drill method · depth"', () => {
    expect(boreholeTooltipLines({ name: 'B-04', drillMethod: 'kernboring', depth: 12.4 })).toEqual({
      title: 'B-04',
      subtitle: 'kernboring · 12.4 m',
    })
  })

  it('T4 — a name is inserted as text, never parsed as markup (XSS-safe)', () => {
    const el = markerTooltipElement({ title: '<img src=x onerror=alert(1)>', subtitle: 'CPTU · —' })
    // The title lives as text inside <strong>, so no injected <img> is created.
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('strong')?.textContent).toBe('<img src=x onerror=alert(1)>')
  })

  it('T5 — an empty subtitle renders the title alone (pending pins)', () => {
    const el = markerTooltipElement({ title: 'discovering…', subtitle: '' })
    expect(el.querySelector('br')).toBeNull()
    expect(el.textContent).toBe('discovering…')
  })
})
