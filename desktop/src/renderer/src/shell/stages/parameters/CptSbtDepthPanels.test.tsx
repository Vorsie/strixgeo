// The per-CPT depth panels honour the two rulings that created them.
//
// DP1 — A depth series reads TALL: the panel stack is taller than it is wide,
//        and it grows with the hole. The owner's complaint about the old inline
//        chart was that it was "all horizontal and squished"; a panel that
//        squeezes 30 m into one viewport height is the same defect again.
//
// DP2 — BOTH classifiers are drawn, side by side. Showing one alone hides the
//        disagreement, and the disagreement is the point.
//
// DP3 — A depth point neither classifier could evaluate is left BLANK, not
//        given a colour: an unclassifiable point is an absence, and painting it
//        reads as a soil.
//
// DP4 — Zone 2 (organic / peat — the zone the extended Lengkeek &
//        Brinkgreve boundary feeds) is visibly distinct from every other zone.
//
// DP5 — A gap in a curve breaks the line instead of being bridged: connecting
//        across a void would draw a measurement nobody took.
//
// DP6 — Consecutive samples of the SAME zone are drawn as ONE rect. A DOV CPT
//        at 2 cm sampling is ~1500 points per strip and adjacent samples nearly
//        always share a zone, so per-sample rects are thousands of redundant
//        nodes in a pane that re-renders while the engineer types.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { CptPlotResponse, CptSbtProfileResponse } from '../../../api/client'
import CptSbtDepthPanels from './CptSbtDepthPanels'
import { buildPath, chooseGridStep, depthToY, zoneRuns } from './depthPanelGeometry'

afterEach(cleanup)

function makePlot(depths: number[]): CptPlotResponse {
  return {
    cpt_id: 'cpt-1',
    depths_m: depths,
    qc_mpa: depths.map((_, i) => 2 + i),
    fs_mpa: depths.map(() => 0.05),
    u2_mpa: null,
    rf_pct: depths.map(() => 1.2),
    qt_mpa: null,
    q_total_mpa: null,
    ic: depths.map(() => 2.1),
    rf_source: null,
  }
}

function makeProfile(
  depths: number[],
  normalised: (number | null)[],
  nonNormalised: (number | null)[],
): CptSbtProfileResponse {
  return {
    cpt_id: 'cpt-1',
    depths_m: depths,
    ic: depths.map(() => 2.1),
    zone_normalised: normalised,
    i_sbt: depths.map(() => 2.2),
    zone_non_normalised: nonNormalised,
    gwt_m: 1.5,
    gwt_source: 'engineer',
  }
}

describe('CptSbtDepthPanels', () => {
  it('DP1 — the panel stack grows with depth and stays taller than an inspector is wide', () => {
    const depths = Array.from({ length: 150 }, (_, i) => (i + 1) * 0.2) // 30 m
    render(<CptSbtDepthPanels plot={makePlot(depths)} profile={null} />)

    const qc = screen.getByTestId('cpt-panel-qc')
    const height = Number(qc.getAttribute('height'))
    // 30 m at the module's px-per-metre — far past the 420 px inspector width,
    // which is what "tall" means here.
    expect(height).toBeGreaterThan(700)
  })

  it('DP1b — a shallow hole is floored so it is not a postage stamp', () => {
    render(<CptSbtDepthPanels plot={makePlot([0.2, 0.4, 0.6])} profile={null} />)

    expect(Number(screen.getByTestId('cpt-panel-qc').getAttribute('height'))).toBeGreaterThanOrEqual(
      400,
    )
  })

  it('DP2 — draws both the normalised and the non-normalised strip', () => {
    const depths = [1, 2, 3]
    render(
      <CptSbtDepthPanels
        plot={makePlot(depths)}
        profile={makeProfile(depths, [6, 3, 2], [6, 3, 2])}
      />,
    )

    expect(screen.getByTestId('cpt-strip-normalised')).toBeInTheDocument()
    expect(screen.getByTestId('cpt-strip-non-normalised')).toBeInTheDocument()
    // …on the SAME depth scale as the curves.
    const stripH = screen.getByTestId('cpt-strip-normalised').getAttribute('height')
    expect(screen.getByTestId('cpt-panel-qc').getAttribute('height')).toBe(stripH)
    expect(screen.getByTestId('cpt-panel-ic').getAttribute('height')).toBe(stripH)
  })

  it('DP2b — the two strips can disagree, and both answers are shown', () => {
    const depths = [1, 2]
    render(
      <CptSbtDepthPanels
        plot={makePlot(depths)}
        profile={makeProfile(depths, [2, 2], [3, 3])}
      />,
    )

    const normFills = fillsOf('cpt-strip-normalised')
    const nonNormFills = fillsOf('cpt-strip-non-normalised')
    expect(normFills[0]).not.toBe(nonNormFills[0])
  })

  it('DP3 — an unclassifiable depth point is left blank, not coloured', () => {
    const depths = [1, 2, 3]
    render(
      <CptSbtDepthPanels
        plot={makePlot(depths)}
        profile={makeProfile(depths, [6, null, 6], [6, null, 6])}
      />,
    )

    // Two rects for three points — the null one drew nothing at all.
    expect(fillsOf('cpt-strip-normalised')).toHaveLength(2)
  })

  it('DP4 — the organic / peat zone is visually distinct from every other zone', () => {
    const depths = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    const allZones = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    render(
      <CptSbtDepthPanels
        plot={makePlot(depths)}
        profile={makeProfile(depths, allZones, allZones)}
      />,
    )

    const fills = fillsOf('cpt-strip-normalised')
    expect(new Set(fills).size).toBe(allZones.length)
    // The peat zone is the SECOND rect; it must not share a fill with either
    // neighbour (that is what "visibly distinct" means when they abut).
    expect(fills[1]).not.toBe(fills[0])
    expect(fills[1]).not.toBe(fills[2])
  })

  it('states which water table the normalised strip was derived under', () => {
    const depths = [1, 2]
    render(
      <CptSbtDepthPanels plot={makePlot(depths)} profile={makeProfile(depths, [5, 5], [5, 5])} />,
    )

    // Data Integrity Rule 1 — the derived strip carries its own provenance,
    // not just the editable line elsewhere in the pane.
    const note = screen.getByTestId('cpt-sbt-derivation-note').textContent ?? ''
    expect(note).toContain('1.50 m')
    expect(note).toContain('engineer')
  })

  it('renders the curve panels even before the profile arrives', () => {
    render(<CptSbtDepthPanels plot={makePlot([1, 2, 3])} profile={null} />)

    expect(screen.getByTestId('cpt-panel-qc')).toBeInTheDocument()
    expect(screen.getByTestId('cpt-panel-fs-rf')).toBeInTheDocument()
    expect(fillsOf('cpt-strip-normalised')).toHaveLength(0)
  })
})

describe('CptSbtDepthPanels — pure helpers', () => {
  it('DP5 — a gap breaks the line instead of bridging it', () => {
    const d = buildPath([1, 2, 3], [5, null, 5], 10, 3, 300)
    // Two move-tos = two subpaths = the pen lifted over the gap.
    expect(d.match(/M/g)).toHaveLength(2)
    expect(d).not.toContain('L')
  })

  it('draws a continuous series as one subpath', () => {
    const d = buildPath([1, 2, 3], [5, 6, 7], 10, 3, 300)
    expect(d.match(/M/g)).toHaveLength(1)
    expect(d.match(/L/g)).toHaveLength(2)
  })

  it('puts the ground surface at the top and the deepest point at the bottom', () => {
    expect(depthToY(0, 20, 560)).toBe(0)
    expect(depthToY(20, 20, 560)).toBe(560)
    expect(depthToY(10, 20, 560)).toBe(280)
  })

  it('keeps the gridline count readable at every depth', () => {
    for (const maxDepth of [3, 12, 40, 120, 400]) {
      const step = chooseGridStep(maxDepth)
      expect(maxDepth / step).toBeLessThanOrEqual(15)
    }
  })

  it('DP6 — a run of one zone becomes one interval, spanning the whole run', () => {
    const runs = zoneRuns([1, 2, 3, 4], [5, 5, 5, 5])

    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ topM: 1, zone: 5 })
    // The deepest sample owns the same increment as its predecessor, so the
    // strip reaches the bottom of the hole instead of stopping a row short.
    expect(runs[0].baseM).toBe(5)
  })

  it('DP6b — a zone change starts a new interval at the contact', () => {
    const runs = zoneRuns([1, 2, 3, 4], [5, 5, 3, 3])

    expect(runs.map(r => r.zone)).toEqual([5, 3])
    expect(runs[0].baseM).toBe(3)
    expect(runs[1].topM).toBe(3)
  })

  it('DP6c — an unclassifiable point breaks the run instead of being absorbed', () => {
    const runs = zoneRuns([1, 2, 3], [5, null, 5])

    expect(runs).toHaveLength(2)
    expect(runs[0].baseM).toBe(2)
    expect(runs[1].topM).toBe(3)
  })

  it('DP6d — no profile yet means no intervals at all', () => {
    expect(zoneRuns([1, 2, 3], null)).toEqual([])
  })
})

/** Fill colours of the rects inside one strip, in depth order. */
function fillsOf(testid: string): string[] {
  return [...screen.getByTestId(testid).querySelectorAll('rect')].map(
    r => r.getAttribute('fill') ?? '',
  )
}
