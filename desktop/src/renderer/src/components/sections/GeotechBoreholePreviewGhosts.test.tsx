// Render tests for GeotechBoreholePreviewGhosts.
//
// The rule under test, in the owner's words (dogfeed 2026-08-04): "correlation
// bands aren't plotted over boreholes so it is impossible to see how
// divide-all-boreholes will act — what gets what packing — before you click the
// button." So:
//
// GP1 — a borehole with planned bands and nothing committed shows those bands
// GP2 — the ghosts vanish for a column the moment its committed bands exist
// GP3 — a ghost is visibly NOT committed: dashed outline + hatch overlay
// GP4 — CPT columns are never ghosted (only boreholes are undivided)
// GP5 — nothing at all renders when the preview is empty (loading / idle)
// GP6 — a borehole with no elevation is skipped rather than drawn at y=0
// GP7 — a ghost sits on the POST-NUDGE column X, never on the true projected X
// GP8 — two nudged columns each get their own ghosts (no swap)
// GP9 — a low-confidence band reads weaker than a CPT-interpolated one
// GP10 — the provenance tooltip is reachable, not killed by pointerEvents
// GP11 — an unrecognised provenance token is quoted, never described
// GP12 — a sub-pixel band is drawn at a floor height, never dropped
// GP13 — a band outside the depth window is counted, not silently swallowed
// GP14 — the hatch pattern ids are per-instance, not document-global
// GP15 — while the committed layers are unknown, the ghosts on screen hold
// GP16 — the overlay publishes what it actually drew, for the toolbar legend
// GA1..GA4 — ghost-ACCEPT: right-click one column commits that column alone

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import GeotechBoreholePreviewGhosts from './GeotechBoreholePreviewGhosts'
import {
  boreholeColumn,
  committedBand,
  cptColumn,
  levelToScreen,
  previewColumn,
} from './geotechPreviewTestFixtures'
import {
  getGeotechPreviewRender,
  resetGeotechPreviewRender,
} from '../../utils/geotechPreviewRenderStore'

afterEach(cleanup)
beforeEach(resetGeotechPreviewRender)

const GEOMETRY = {
  levelToScreen,
  plotTop: 0,
  plotBottom: 400,
  // The committed geotech rows are LOADED in every case except GP15, which is
  // about the mid-refetch window where they are not.
  geotechLayersLoaded: true,
}

describe('GeotechBoreholePreviewGhosts', () => {
  it('GP1 — draws the planned bands of an undivided borehole', () => {
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[
            previewColumn('bh-1', [
              { top: 0, base: 4, nad: 6 },
              { top: 4, base: 8, nad: 8 },
            ]),
          ]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    expect(screen.getByTestId('geotech-borehole-preview-ghosts')).toBeInTheDocument()
    expect(screen.getByTestId('geotech-preview-band-bh-1-0')).toBeInTheDocument()
    expect(screen.getByTestId('geotech-preview-band-bh-1-4')).toBeInTheDocument()
    // Placed on the column: x0 = nudgedX - width/2 = 50 - 10.
    expect(screen.getByTestId('geotech-preview-band-bh-1-0')).toHaveAttribute('x', '40')
    // Depth 0 m at elevation 5 → y = 100 - 5 = 95; 4 m of band = 4 px.
    expect(screen.getByTestId('geotech-preview-band-bh-1-0')).toHaveAttribute('y', '95')
    expect(screen.getByTestId('geotech-preview-band-bh-1-0')).toHaveAttribute('height', '4')
  })

  it('GP2 — a committed column never double-draws a SOLID band over the real one', () => {
    // The invariant this has always protected (module docstring): the preview
    // never double-draws over the real thing. Post-#269 a committed column shows
    // a re-divide DIFF, but that diff must be outline-only — no solid fill, no
    // hatch — so the committed band is never overpainted.
    const { container } = render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[previewColumn('bh-1', [{ top: 0, base: 4, nad: 6 }])]}
          // The divide has run for this borehole: the real rows own the column.
          geotechLayers={[committedBand('bh-1')]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    // No SOLID first-divide ghost and no hatch painted over the committed band.
    expect(screen.queryByTestId('geotech-preview-band-bh-1-0')).toBeNull()
    expect(
      container.querySelector('rect[data-testid^="geotech-preview-hatch-bh-1"]'),
    ).toBeNull()
  })

  // -------------------------------------------------------------------------
  // #269 — the re-divide diff.
  //
  // "Divide boreholes" is an idempotent-but-destructive rebuild: pressing it a
  // second time re-plans an ALREADY-divided model (backend gate DB7) and
  // rewrites every borehole band. Until now the preview dropped a column the
  // moment it carried committed bands, so the re-divide was as blind as it was
  // before the feature existed. The owner's ask (debt #269): on a re-divide,
  // "wants to know what will change". The chosen render (debt entry's leading
  // option): draw the new proposed divide as an OUTLINE-ONLY diff OVER the
  // committed band — no solid fill, no hatch — so the committed band shows
  // through and the new boundaries read as a diff, never as a solid overpaint.
  // -------------------------------------------------------------------------

  it('RD1 — a committed column shows the re-divide as an outline-only diff, not nothing', () => {
    const { container } = render(
      <svg>
        <GeotechBoreholePreviewGhosts
          // The re-divide plan DIFFERS from the committed 0–4 band: two bands now.
          previewColumns={[
            previewColumn('bh-1', [
              { top: 0, base: 3, nad: 6 },
              { top: 3, base: 7, nad: 8 },
            ]),
          ]}
          geotechLayers={[committedBand('bh-1')]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    // The axis is NOT blank on a re-divide any more.
    expect(screen.getByTestId('geotech-borehole-preview-ghosts')).toBeInTheDocument()
    // It draws the NEW proposed boundaries as an outline-only diff…
    const diff = screen.getByTestId('geotech-rediv-band-bh-1-0')
    expect(diff).toBeInTheDocument()
    expect(diff).toHaveAttribute('fill', 'none')
    expect(diff).toHaveAttribute('stroke-dasharray', '4 2')
    // …and never a SOLID first-divide ghost or a hatch painted over the real band.
    expect(screen.queryByTestId('geotech-preview-band-bh-1-0')).toBeNull()
    expect(container.querySelector('rect[data-testid^="geotech-preview-hatch-bh-1"]')).toBeNull()
  })

  it('RD2 — the re-divide diff is informational: right-click offers no accept menu', () => {
    // Re-dividing ONE already-divided column is a commit path the owner has not
    // ruled on; the diff answers "what would change", it does not offer to
    // re-commit. So the read-only diff carries no per-column accept gesture.
    const onAcceptColumn = vi.fn()
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[previewColumn('bh-1', [{ top: 0, base: 3, nad: 6 }])]}
          geotechLayers={[committedBand('bh-1')]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          onAcceptColumn={onAcceptColumn}
          {...GEOMETRY}
        />
      </svg>,
    )
    fireEvent.contextMenu(screen.getByTestId('geotech-preview-column-bh-1'))
    expect(screen.queryByTestId('geotech-preview-column-menu')).toBeNull()
    expect(onAcceptColumn).not.toHaveBeenCalled()
  })

  it('RD3 — the outline diff does not light the "hatched = preview" legend (guard)', () => {
    // The published summary drives the toolbar's "Hatched = preview" legend. A
    // re-divide diff is an OUTLINE, not a hatch, so it must not be counted — the
    // legend would otherwise explain hatching that is not on screen (the exact
    // dishonesty geotechPreviewRenderStore was built to avoid). Guard, not a
    // red-first pin: the summary is {0,0,0} on the old drop-it behaviour too.
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[
            previewColumn('bh-1', [
              { top: 0, base: 3, nad: 6 },
              { top: 3, base: 7, nad: 8 },
            ]),
          ]}
          geotechLayers={[committedBand('bh-1')]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    expect(getGeotechPreviewRender()).toEqual({
      columnCount: 0,
      bandCount: 0,
      clampedBandCount: 0,
    })
  })

  it('GP3 — a ghost reads as not-yet-committed: dashed outline plus hatching', () => {
    const { container } = render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[previewColumn('bh-1', [{ top: 0, base: 4, nad: 6 }])]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    const band = screen.getByTestId('geotech-preview-band-bh-1-0')
    expect(band).toHaveAttribute('stroke-dasharray', '4 2')
    // The hatch overlay is what distinguishes a preview from a committed band
    // on both axes; a solid fill alone would be indistinguishable.
    const hatch = container.querySelector('rect[data-testid^="geotech-preview-hatch-"]')
    expect(hatch).not.toBeNull()
    const fillRef = hatch?.getAttribute('fill') ?? ''
    expect(fillRef).toMatch(/^url\(#.+\)$/)
    const patternId = fillRef.slice(5, -1)
    expect(container.querySelector(`pattern[id="${patternId}"]`)).not.toBeNull()
  })

  it('GP4 — never ghosts a CPT column', () => {
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          // A malformed payload naming a CPT must not produce bands: only
          // boreholes are left undivided by Subdivide.
          previewColumns={[previewColumn('cpt-1', [{ top: 0, base: 4, nad: 6 }])]}
          geotechLayers={[]}
          placedColumns={[cptColumn('cpt-1', 50)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    expect(screen.queryByTestId('geotech-borehole-preview-ghosts')).not.toBeInTheDocument()
  })

  it('GP5 — renders nothing while the preview is empty', () => {
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    expect(screen.queryByTestId('geotech-borehole-preview-ghosts')).not.toBeInTheDocument()
  })

  it('GP6 — skips a borehole with no collar elevation rather than drawing it at zero', () => {
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[previewColumn('bh-1', [{ top: 0, base: 4, nad: 6 }])]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50, null)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    expect(screen.queryByTestId('geotech-borehole-preview-ghosts')).not.toBeInTheDocument()
  })

  it('GP7 — draws on the column where it is SHOWN, not where it projects to', () => {
    // Column spacing warps the layout: the borehole projects to along=50 but is
    // drawn at x=120. A ghost computed from the projected distance floats off
    // its own borehole — the failure the owner has caught twice on this
    // codebase. Every value here is distinct so no coincidence can pass this.
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[previewColumn('bh-1', [{ top: 0, base: 4, nad: 6 }])]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50, 5, 120)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    // nudgedX 120 - width/2 = 110. Reading trueX or proj.along would give 40.
    expect(screen.getByTestId('geotech-preview-band-bh-1-0')).toHaveAttribute('x', '110')
  })

  it('GP8 — two nudged columns keep their own ghosts instead of swapping', () => {
    // The nudges cross the columns' drawing order relative to their projected
    // order (bh-a projects nearer but is drawn further right), so any code that
    // pairs preview payloads to columns positionally rather than by id lands
    // each borehole's bands on the other one.
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[
            previewColumn('bh-a', [{ top: 0, base: 4, nad: 6 }]),
            previewColumn('bh-b', [{ top: 0, base: 4, nad: 8 }]),
          ]}
          geotechLayers={[]}
          placedColumns={[
            boreholeColumn('bh-a', 30, 5, 200),
            boreholeColumn('bh-b', 80, 5, 60),
          ]}
          {...GEOMETRY}
        />
      </svg>,
    )
    expect(screen.getByTestId('geotech-preview-band-bh-a-0')).toHaveAttribute('x', '190')
    expect(screen.getByTestId('geotech-preview-band-bh-b-0')).toHaveAttribute('x', '50')
  })

  it('GP9 — a conservative fallback does not read like CPT evidence', () => {
    // The whole point of the overlay is "what packing does this borehole get".
    // A lithology-floor guess and a class a neighbouring CPT actually resolved
    // must not carry the same visual weight, and the difference has to survive
    // without hovering (the tooltip is a second channel, not the only one).
    const { container } = render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[
            previewColumn('bh-1', [
              { top: 0, base: 4, nad: 6, source: 'cpt_interpolated', confidence: 'high' },
              { top: 4, base: 8, nad: 8, source: 'absolute_min', confidence: 'low' },
            ]),
          ]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    const strong = screen.getByTestId('geotech-preview-band-bh-1-0')
    const weak = screen.getByTestId('geotech-preview-band-bh-1-4')
    // Weaker evidence → lighter fill.
    const strongOpacity = Number(strong.getAttribute('fill-opacity'))
    const weakOpacity = Number(weak.getAttribute('fill-opacity'))
    expect(weakOpacity).toBeLessThan(strongOpacity)
    // …and a denser hatch, so the two tiers differ in texture as well as weight.
    const hatches = container.querySelectorAll('rect[data-testid^="geotech-preview-hatch-"]')
    expect(hatches).toHaveLength(2)
    const strongPattern = hatches[0].getAttribute('fill')
    const weakPattern = hatches[1].getAttribute('fill')
    expect(strongPattern).not.toEqual(weakPattern)
  })

  it('GP10 — the provenance is readable on hover, not swallowed by pointerEvents', () => {
    // A `<title>` under a `pointer-events: none` ancestor never shows, which
    // silently removed the only channel naming the evidence behind a class.
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[
            previewColumn('bh-1', [
              { top: 0, base: 4, nad: 6, source: 'body_min', confidence: 'low' },
            ]),
          ]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    const band = screen.getByTestId('geotech-preview-band-bh-1-0')
    expect(band.querySelector('title')?.textContent).toContain('weakest class seen in this body')
    // The band itself must be hit-testable, and no ancestor may disable it.
    expect(band.getAttribute('pointer-events')).not.toBe('none')
    for (let node = band.parentElement; node !== null; node = node.parentElement) {
      expect(node.getAttribute('pointer-events')).not.toBe('none')
    }
  })

  it('GP11 — an unknown provenance token is quoted, never given invented prose', () => {
    // Falling through to "lithology floor (no CPT evidence in this body)" for
    // any token this build does not know would state something about the
    // evidence that may simply be false.
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[
            previewColumn('bh-1', [
              { top: 0, base: 4, nad: 6, source: 'lab_measured', confidence: 'high' },
            ]),
          ]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    const title = screen.getByTestId('geotech-preview-band-bh-1-0').querySelector('title')
    expect(title?.textContent).toContain('lab_measured')
    expect(title?.textContent).not.toContain('lithology floor')
    expect(title?.textContent).not.toContain('no CPT evidence')
  })

  it('GP12 — a band thinner than a pixel is drawn at a floor, not dropped', () => {
    // A band the commit WILL write must never render as absence: "nothing is
    // planned at this depth" is the one claim this overlay may not make.
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[previewColumn('bh-1', [{ top: 0, base: 0.2, nad: 6 }])]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    const band = screen.getByTestId('geotech-preview-band-bh-1-0')
    expect(Number(band.getAttribute('height'))).toBeGreaterThanOrEqual(1)
    expect(getGeotechPreviewRender().bandCount).toBe(1)
    expect(getGeotechPreviewRender().clampedBandCount).toBe(0)
  })

  it('GP13 — a band outside the depth window is counted rather than swallowed', () => {
    // The collar sits at y=95 and 1 m = 1 px, so plotBottom=150 cuts the window
    // at 55 m depth: the 60–70 m band lies wholly below it and cannot be drawn
    // — but the engineer is told it exists.
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[
            previewColumn('bh-1', [
              { top: 0, base: 4, nad: 6 },
              { top: 60, base: 70, nad: 8 },
            ]),
          ]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          levelToScreen={levelToScreen}
          plotTop={0}
          plotBottom={150}
          geotechLayersLoaded
        />
      </svg>,
    )
    expect(screen.getByTestId('geotech-preview-band-bh-1-0')).toBeInTheDocument()
    expect(screen.queryByTestId('geotech-preview-band-bh-1-60')).not.toBeInTheDocument()
    expect(getGeotechPreviewRender().clampedBandCount).toBe(1)
  })

  it('GP14 — two mounted overlays do not share one document-global pattern id', () => {
    // A split viewport or an offscreen PDF render mounts a second section
    // surface; a shared SVG-wide id makes one overlay repaint the other.
    const { container } = render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[previewColumn('bh-1', [{ top: 0, base: 4, nad: 6 }])]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          {...GEOMETRY}
        />
        <GeotechBoreholePreviewGhosts
          previewColumns={[previewColumn('bh-2', [{ top: 0, base: 4, nad: 8 }])]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-2', 90)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    const ids = [...container.querySelectorAll('pattern')].map(p => p.getAttribute('id'))
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('GP15 — a divided column holds its re-divide diff through a mid-refetch, never flips to a solid ghost', () => {
    // useGeologicalModel clears geotechLayers to [] before every refetch. Read
    // literally, an empty array says "no borehole is divided", which would flip a
    // committed column's outline diff back to a SOLID first-divide ghost painted
    // over its committed band. The last KNOWN answer holds until a real one
    // arrives, so the column stays an outline diff throughout.
    const props = {
      // The re-divide plan differs from the committed 0–4 band.
      previewColumns: [previewColumn('bh-1', [{ top: 0, base: 3, nad: 6 }])],
      placedColumns: [boreholeColumn('bh-1', 50)],
      ...GEOMETRY,
    }
    const { rerender } = render(
      <svg>
        <GeotechBoreholePreviewGhosts {...props} geotechLayers={[committedBand('bh-1')]} />
      </svg>,
    )
    // Divided: an outline diff, never a solid first-divide ghost.
    expect(screen.getByTestId('geotech-rediv-band-bh-1-0')).toBeInTheDocument()
    expect(screen.queryByTestId('geotech-preview-band-bh-1-0')).toBeNull()
    // Mid-refetch: the array is empty and its contents are NOT known.
    rerender(
      <svg>
        <GeotechBoreholePreviewGhosts {...props} geotechLayers={[]} geotechLayersLoaded={false} />
      </svg>,
    )
    // It must NOT flip to a solid ghost over the committed band.
    expect(screen.queryByTestId('geotech-preview-band-bh-1-0')).toBeNull()
    expect(screen.getByTestId('geotech-rediv-band-bh-1-0')).toBeInTheDocument()
  })

  it('GP16 — publishes what it drew so the legend can be gated on it', () => {
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[
            previewColumn('bh-1', [
              { top: 0, base: 4, nad: 6 },
              { top: 4, base: 8, nad: 8 },
            ]),
            previewColumn('bh-2', [{ top: 0, base: 3, nad: 6 }]),
          ]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50), boreholeColumn('bh-2', 90)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    expect(getGeotechPreviewRender()).toEqual({
      columnCount: 2,
      bandCount: 3,
      clampedBandCount: 0,
    })
  })
})

describe('GeotechBoreholePreviewGhosts — donor provenance (owner ask 2026-08-04)', () => {
  it('GP16 — an interpolated band names BOTH flanking CPTs, their distances and the section', () => {
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[
            previewColumn('bh-1', [
              {
                top: 0,
                base: 4,
                nad: 6,
                mode: 'flank_interpolated',
                section: 'Cross-section 1',
                donors: [
                  { name: 'GEO-10/170-S6', side: 'left', along: 5, map: 5 },
                  { name: 'GEO-23/125-S13', side: 'right', along: 90, map: 90 },
                ],
              },
            ]),
          ]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    const title = screen.getByTestId('geotech-preview-band-bh-1-0').querySelector('title')
    expect(title?.textContent).toContain('GEO-10/170-S6')
    expect(title?.textContent).toContain('GEO-23/125-S13')
    expect(title?.textContent).toContain('5 m left')
    expect(title?.textContent).toContain('90 m right')
    expect(title?.textContent).toContain('Cross-section 1')
  })

  it('GP17 — a single-donor band says which ONE test spoke, never "the surrounding CPTs"', () => {
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[
            previewColumn('bh-1', [
              {
                top: 0,
                base: 4,
                nad: 6,
                mode: 'single_donor',
                section: 'Tie-section 11',
                donors: [{ name: 'GEO-23/125-S6', side: 'right', along: 624, map: 624 }],
              },
            ]),
          ]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    const title = screen.getByTestId('geotech-preview-band-bh-1-0').querySelector('title')
    expect(title?.textContent).toContain('GEO-23/125-S6')
    expect(title?.textContent).toContain('624 m right')
    expect(title?.textContent).toContain('Tie-section 11')
    expect(title?.textContent).not.toContain('surrounding CPTs')
  })

  it('GP18 — the map-distance fallback is honest that no section neighbour existed', () => {
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[
            previewColumn('bh-1', [
              {
                top: 0,
                base: 4,
                nad: 6,
                mode: 'nearest_fallback',
                donors: [{ name: 'GEO-10/170-S2', side: 'nearest', map: 256 }],
              },
            ]),
          ]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    const title = screen.getByTestId('geotech-preview-band-bh-1-0').querySelector('title')
    expect(title?.textContent).toContain('GEO-10/170-S2')
    expect(title?.textContent).toContain('256 m')
    expect(title?.textContent).toContain('no section neighbour')
    expect(title?.textContent).not.toContain('surrounding CPTs')
  })

  it('GP19 — a band without the new fields keeps the legacy source prose (old backend)', () => {
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[previewColumn('bh-1', [{ top: 0, base: 4, nad: 6 }])]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    const title = screen.getByTestId('geotech-preview-band-bh-1-0').querySelector('title')
    expect(title?.textContent).toContain('interpolated from the surrounding CPTs')
  })

  // -------------------------------------------------------------------------
  // Ghost-ACCEPT — "these ghosts are right, divide THIS borehole"
  //
  // Step 4 divides every borehole at once, which is the wrong granularity the
  // moment one column's ghosts look wrong and the rest look right. The subset
  // commit runs the same planner over the same column, so what is committed is
  // what was ghosted.
  // -------------------------------------------------------------------------

  it('GA1 — right-clicking a ghosted borehole offers to divide THAT borehole', () => {
    const onAcceptColumn = vi.fn()
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[
            previewColumn('bh-1', [
              { top: 0, base: 4, nad: 6 },
              { top: 4, base: 8, nad: 8 },
            ]),
          ]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          onAcceptColumn={onAcceptColumn}
          {...GEOMETRY}
        />
      </svg>,
    )
    fireEvent.contextMenu(screen.getByTestId('geotech-preview-column-bh-1'))
    const menu = screen.getByTestId('geotech-preview-column-menu')
    // The menu names the column and how much it is about to commit — two
    // borehole columns can sit a few pixels apart at normal spacing.
    expect(menu.textContent).toContain('bh-1')
    expect(menu.textContent).toContain('2 planned bands')
    fireEvent.click(screen.getByTestId('geotech-preview-accept-column'))
    expect(onAcceptColumn).toHaveBeenCalledWith('bh-1')
  })

  it('GA2 — the gesture commits ONE column, never its neighbour', () => {
    const onAcceptColumn = vi.fn()
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[
            previewColumn('bh-1', [{ top: 0, base: 4, nad: 6 }]),
            previewColumn('bh-2', [{ top: 0, base: 4, nad: 8 }]),
          ]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50), boreholeColumn('bh-2', 150)]}
          onAcceptColumn={onAcceptColumn}
          {...GEOMETRY}
        />
      </svg>,
    )
    fireEvent.contextMenu(screen.getByTestId('geotech-preview-column-bh-2'))
    fireEvent.click(screen.getByTestId('geotech-preview-accept-column'))
    expect(onAcceptColumn).toHaveBeenCalledTimes(1)
    expect(onAcceptColumn).toHaveBeenCalledWith('bh-2')
  })

  it('GA3 — without a handler the ghosts stay the read-only overlay they were', () => {
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[previewColumn('bh-1', [{ top: 0, base: 4, nad: 6 }])]}
          geotechLayers={[]}
          placedColumns={[boreholeColumn('bh-1', 50)]}
          {...GEOMETRY}
        />
      </svg>,
    )
    fireEvent.contextMenu(screen.getByTestId('geotech-preview-column-bh-1'))
    expect(screen.queryByTestId('geotech-preview-column-menu')).toBeNull()
  })

  it('GA4 — a divided column shows a read-only re-divide diff; the accept gesture stays on the undivided one', () => {
    // Post-#269 a committed column is no longer blank — it shows an outline
    // re-divide diff — but that diff is READ-ONLY: re-committing one already-
    // divided column is undesigned, so no accept menu is offered. The undivided
    // neighbour keeps its per-column accept gesture unchanged.
    const onAcceptColumn = vi.fn()
    render(
      <svg>
        <GeotechBoreholePreviewGhosts
          previewColumns={[
            previewColumn('bh-1', [{ top: 0, base: 3, nad: 6 }]),
            previewColumn('bh-2', [{ top: 0, base: 4, nad: 8 }]),
          ]}
          geotechLayers={[committedBand('bh-1')]}
          placedColumns={[boreholeColumn('bh-1', 50), boreholeColumn('bh-2', 150)]}
          onAcceptColumn={onAcceptColumn}
          {...GEOMETRY}
        />
      </svg>,
    )
    // bh-1 is divided: it renders a diff column but offers no accept menu.
    expect(screen.getByTestId('geotech-preview-column-bh-1')).toBeInTheDocument()
    fireEvent.contextMenu(screen.getByTestId('geotech-preview-column-bh-1'))
    expect(screen.queryByTestId('geotech-preview-column-menu')).toBeNull()
    // The undivided borehole keeps its ghosts and its gesture.
    fireEvent.contextMenu(screen.getByTestId('geotech-preview-column-bh-2'))
    fireEvent.click(screen.getByTestId('geotech-preview-accept-column'))
    expect(onAcceptColumn).toHaveBeenCalledWith('bh-2')
  })
})
