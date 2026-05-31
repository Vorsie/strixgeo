// Behaviour tests for CptDataColumn (shared-band model).
//
// CptDataColumn renders ONE horizontal band per CPT (the column
// axis is the centerline; qc plots right, Rf plots mirrored left,
// fs / u2 / q_total overlay with their own scales). These tests pin
// the highest-value contracts:
//
//   * Single TrackBackground per CPT (was two before the shared-band
//     refactor — one per slot).
//   * qc gridlines on the RIGHT of axis; Rf gridlines on the LEFT
//     (mirrored). Default scale 40 MPa: 10 MPa interior + 40 MPa
//     at the right edge.
//   * Per-CPT value labels render only when showLabels=true.
//   * Background and gridlines are bounded to the CPT's data extent,
//     not the full plot height.
//   * Graceful degrade on missing data + early-return when no channel
//     is applicable to this cone.

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { CptPlotResponse } from '../../api/client'
import CptDataColumn from './CptDataColumn'
import {
  DEFAULT_CPT_CHANNELS,
  cptBandHalfWidth,
  type CptChannels,
} from './cptChannels'

const halfWidth = cptBandHalfWidth(5)
// Flipped transform mimicking the real section panel — higher level
// renders at smaller screen Y, deeper points (lower level) render
// further down. With surface=10 m and a 5 m CPT, the data band lives
// at screen Y ∈ [90, 95].
const flipped = (level: number): number => 100 - level

function makePlot(overrides: Partial<CptPlotResponse> = {}): CptPlotResponse {
  return {
    cpt_id: 'cpt-1',
    depths_m: [0, 1, 2, 3, 4, 5],
    qc_mpa: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
    fs_mpa: null,
    u2_mpa: null,
    rf_pct: [1.0, 1.2, 1.4, 1.6, 1.8, 2.0],
    qt_mpa: null,
    q_total_mpa: null,
    ic: null,
    rf_source: null,
    ...overrides,
  }
}

function renderColumn(
  overrides: Partial<React.ComponentProps<typeof CptDataColumn>> = {},
) {
  const defaults: React.ComponentProps<typeof CptDataColumn> = {
    plot: makePlot(),
    cptType: 'CPTU',
    channels: { ...DEFAULT_CPT_CHANNELS },
    halfWidth,
    screenX: 100,
    surfaceElevationM: 10,
    plotTop: 0,
    plotBottom: 200,
    levelToScreen: flipped,
    showLabels: true,
  }
  return render(
    <svg>
      <CptDataColumn {...defaults} {...overrides} />
    </svg>,
  )
}

describe('CptDataColumn — single shared band', () => {
  it('renders exactly one background rect per CPT, centered on the column axis', () => {
    // Pre-refactor the slot model put one rect per channel; the
    // shared band collapses them into a single rect spanning
    // [screenX - halfWidth, screenX + halfWidth].
    const { container } = renderColumn({ cptType: 'CPTU' })
    const rects = container.querySelectorAll('rect[fill="#ffffff"]')
    expect(rects.length).toBe(1)
    expect(rects[0].getAttribute('x')).toBe(`${100 - halfWidth}`)
    expect(rects[0].getAttribute('width')).toBe(`${2 * halfWidth}`)
  })

  it('renders nothing when no applicable channel is enabled', () => {
    const allOff: CptChannels = {
      qc: false,
      rf: false,
      fs: false,
      u2: false,
      qTotal: false,
    }
    const { container } = renderColumn({ channels: allOff })
    expect(container.querySelectorAll('rect[fill="#ffffff"]').length).toBe(0)
  })

  it('drops u2 on a CPTE cone (pore-pressure is CPTU-only) and renders nothing when u2 is the only channel', () => {
    const onlyU2: CptChannels = {
      qc: false,
      rf: false,
      fs: false,
      u2: true,
      qTotal: false,
    }
    const { container } = renderColumn({ cptType: 'CPTE', channels: onlyU2 })
    expect(container.querySelectorAll('rect[fill="#ffffff"]').length).toBe(0)
  })
})

describe('CptDataColumn — qc/Rf mirror layout', () => {
  it('places qc gridlines RIGHT of the column axis', () => {
    const { container } = renderColumn({
      cptType: 'CPTU',
      channels: { qc: true, rf: false, fs: false, u2: false, qTotal: false },
    })
    const dashed = Array.from(container.querySelectorAll('line[stroke-dasharray="2 2"]'))
    expect(dashed.length).toBe(3) // qc 2 + qc 10 + qc scale (= 40 MPa default)
    for (const line of dashed) {
      expect(Number(line.getAttribute('x1'))).toBeGreaterThan(100)
    }
  })

  it('places Rf gridlines LEFT of the column axis (mirrored)', () => {
    const { container } = renderColumn({
      cptType: 'CPTU',
      channels: { qc: false, rf: true, fs: false, u2: false, qTotal: false },
    })
    const dashed = Array.from(container.querySelectorAll('line[stroke-dasharray="2 2"]'))
    expect(dashed.length).toBe(2) // rf 2 % + rf 4 %
    for (const line of dashed) {
      expect(Number(line.getAttribute('x1'))).toBeLessThan(100)
    }
  })

  it('renders qc + rf together with their gridlines on opposite sides of the axis', () => {
    const { container } = renderColumn({
      cptType: 'CPTU',
      channels: { qc: true, rf: true, fs: false, u2: false, qTotal: false },
    })
    const dashed = Array.from(container.querySelectorAll('line[stroke-dasharray="2 2"]'))
    expect(dashed.length).toBe(5) // 3 qc (2/10/scale) + 2 rf (2%/4%)
    const leftCount = dashed.filter(l => Number(l.getAttribute('x1')) < 100).length
    const rightCount = dashed.filter(l => Number(l.getAttribute('x1')) > 100).length
    expect(leftCount).toBe(2)
    expect(rightCount).toBe(3)
  })
})

describe('CptDataColumn — per-CPT gridline value labels', () => {
  it('renders qc "10"/"40 MPa" + rf "2%"/"4%" at the default scale when showLabels is true', () => {
    const { container } = renderColumn({
      cptType: 'CPTU',
      channels: { qc: true, rf: true, fs: false, u2: false, qTotal: false },
      showLabels: true,
    })
    const texts = Array.from(container.querySelectorAll('text')).map(t => t.textContent)
    expect(texts).toContain('10')
    expect(texts).toContain('40 MPa')
    expect(texts).toContain('2%')
    expect(texts).toContain('4%')
  })

  it('renders the extended scale label when qcFullScaleMpa is bumped (e.g. 100 MPa)', () => {
    const { container } = renderColumn({
      cptType: 'CPTU',
      channels: { qc: true, rf: false, fs: false, u2: false, qTotal: false },
      showLabels: true,
      qcFullScaleMpa: 100,
    })
    const texts = Array.from(container.querySelectorAll('text')).map(t => t.textContent)
    expect(texts).toContain('10') // interior reference stays
    expect(texts).toContain('100 MPa') // right-edge label tracks the scale
  })

  it('suppresses every label when showLabels is false (collision avoidance)', () => {
    const { container } = renderColumn({
      cptType: 'CPTU',
      channels: { qc: true, rf: true, fs: false, u2: false, qTotal: false },
      showLabels: false,
    })
    const texts = Array.from(container.querySelectorAll('text')).map(t => t.textContent)
    expect(texts).not.toContain('10')
    expect(texts).not.toContain('40 MPa')
    expect(texts).not.toContain('2%')
    expect(texts).not.toContain('4%')
  })
})

describe('CptDataColumn — bounded background + gridlines', () => {
  it('bounds the white track background to the CPT vertical extent', () => {
    // surface=10 m + bottom depth 5 m + flipped levelToScreen
    // (Y = 100 - level) → band sits at Y ∈ [90, 95]. Must NOT span
    // the full plot height (plotTop=0, plotBottom=200).
    const { container } = renderColumn({
      cptType: 'CPTU',
      channels: { qc: true, rf: false, fs: false, u2: false, qTotal: false },
    })
    const rect = container.querySelector('rect[fill="#ffffff"]')
    expect(rect?.getAttribute('y')).toBe('90')
    expect(rect?.getAttribute('height')).toBe('5')
  })

  it('bounds the dashed gridlines to the same data extent', () => {
    const { container } = renderColumn({
      cptType: 'CPTU',
      channels: { qc: true, rf: false, fs: false, u2: false, qTotal: false },
    })
    const dashed = container.querySelectorAll('line[stroke-dasharray="2 2"]')
    for (const line of dashed) {
      expect(line.getAttribute('y1')).toBe('90')
      expect(line.getAttribute('y2')).toBe('95')
    }
  })
})

describe('CptDataColumn — graceful degrade', () => {
  it('renders qc curves even when rf_pct is null on the plot response', () => {
    const { container } = renderColumn({
      channels: {
        qc: true,
        rf: false,
        fs: false,
        u2: false,
        qTotal: false,
      },
      plot: makePlot({ rf_pct: null }),
    })
    expect(container.querySelectorAll('rect[fill="#ffffff"]').length).toBe(1)
  })

  it('does not crash when the depth-series arrays are empty', () => {
    const { container } = renderColumn({
      plot: makePlot({ depths_m: [], qc_mpa: [], rf_pct: [] }),
    })
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
