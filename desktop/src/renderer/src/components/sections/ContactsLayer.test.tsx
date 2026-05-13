// Behaviour tests for ContactsLayer — the formation-contact
// polyline overlay on the cross-section.

import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type {
  BoreholeListItem,
  FormationContactResponse,
  GeologicalFormationResponse,
} from '../../api/client'
import type { ProjectedInvestigation } from '../../utils/sectionProjection'
import ContactsLayer from './ContactsLayer'
import type { PlacedColumn } from './utils'

const flipped = (level: number): number => 20 - level

function makeFormation(
  overrides: Partial<GeologicalFormationResponse> = {},
): GeologicalFormationResponse {
  return {
    id: 'f-1',
    app_project_id: 'P',
    name: 'Boom Klei',
    color: '#ff8800',
    code: null,
    display_order: 0,
    regional_ref: null,
    description: null,
    created_at: '2026-05-12T00:00:00Z',
    updated_at: '2026-05-12T00:00:00Z',
    ...overrides,
  }
}

function makeContact(
  overrides: Partial<FormationContactResponse> = {},
): FormationContactResponse {
  return {
    id: 'c-1',
    model_id: 'm-1',
    formation_id: 'f-1',
    borehole_id: 'bh-1',
    cpt_id: null,
    depth_top_m: 3,
    source: 'manual_pick',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    created_at: '2026-05-12T00:00:00Z',
    updated_at: '2026-05-12T00:00:00Z',
    ...overrides,
  }
}

function makeBoreholePlaced(
  id: string,
  nudgedX: number,
  elevation: number | null = 10,
): PlacedColumn {
  const item = {
    id,
    name: id,
    borehole_type: null,
    test_id: id,
    location_x: 0,
    location_y: 0,
    elevation_m: elevation,
    epsg: 31370,
    z_epsg: 5710,
    total_depth_m: 30,
    drill_method: null,
    n_drill_segments: null,
    n_field_log_intervals: null,
  } as BoreholeListItem
  const proj = {
    item,
    along: 0,
    offset: 0,
    side: 'on' as const,
  } as unknown as ProjectedInvestigation<BoreholeListItem>
  return {
    kind: 'borehole',
    proj,
    trueX: nudgedX,
    nudgedX,
    width: 14,
    displaced: false,
  }
}

function renderLayer(
  contacts: FormationContactResponse[],
  formations: GeologicalFormationResponse[],
  placedColumns: PlacedColumn[],
  excludedBoreholeIds?: ReadonlySet<string>,
  extras: {
    onUpdateContactDepth?: (id: string, depth: number) => Promise<void>
    snapDepthsByAnchorId?: ReadonlyMap<string, readonly number[]>
  } = {},
) {
  return render(
    <svg>
      <ContactsLayer
        contacts={contacts}
        formations={formations}
        placedColumns={placedColumns}
        excludedBoreholeIds={excludedBoreholeIds}
        levelToScreen={flipped}
        plotTop={0}
        plotBottom={50}
        onUpdateContactDepth={extras.onUpdateContactDepth}
        snapDepthsByAnchorId={extras.snapDepthsByAnchorId}
      />
    </svg>,
  )
}

describe('ContactsLayer', () => {
  it('renders nothing when there are no contacts', () => {
    const { container } = renderLayer([], [makeFormation()], [makeBoreholePlaced('bh-1', 50)])
    expect(container.querySelector('path')).toBeNull()
    expect(container.querySelector('line')).toBeNull()
  })

  it('emits no circle markers — dots replaced by horizontal top segments', () => {
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
      makeContact({ id: 'c-2', borehole_id: 'bh-2', depth_top_m: 5 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation()],
      [makeBoreholePlaced('bh-1', 50), makeBoreholePlaced('bh-2', 150)],
    )
    // No circles anywhere — the old per-contact dot was the user's
    // specific complaint.
    expect(container.querySelectorAll('circle').length).toBe(0)
  })

  it('renders one cross-column polyline per formation with ≥2 anchors', () => {
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
      makeContact({ id: 'c-2', borehole_id: 'bh-2', depth_top_m: 5 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation()],
      [makeBoreholePlaced('bh-1', 50), makeBoreholePlaced('bh-2', 150)],
    )
    expect(container.querySelectorAll('path').length).toBe(1)
  })

  it('emits a horizontal segment at every contact top', () => {
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
      makeContact({ id: 'c-2', borehole_id: 'bh-2', depth_top_m: 5 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation()],
      [makeBoreholePlaced('bh-1', 50), makeBoreholePlaced('bh-2', 150)],
    )
    // Two contacts → two top segments. Each line has y1 === y2.
    const lines = Array.from(container.querySelectorAll('line'))
    expect(lines.length).toBe(2)
    for (const ln of lines) {
      expect(ln.getAttribute('y1')).toBe(ln.getAttribute('y2'))
    }
  })

  it('renders the formation name once per anchored layer', () => {
    // Two boreholes, each carrying one contact (so each anchor
    // gets one layer that extends to total_depth_m=30). Short
    // formation name so the width-aware truncation budget at the
    // fixture's column width (14 px) still emits the full string.
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
      makeContact({ id: 'c-2', borehole_id: 'bh-2', depth_top_m: 5 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 50), makeBoreholePlaced('bh-2', 150)],
    )
    const texts = Array.from(container.querySelectorAll('text'))
    expect(texts.filter(t => t.textContent === 'X').length).toBe(2)
  })

  it('positions the layer name in the vertical middle of the layer', () => {
    // Single contact at depth 3 on a borehole with
    // total_depth_m=30. Layer spans [3, 30]. With surface=10 and
    // flipped(level)=20-level, segment Y = flipped(10-3) = 13.
    // Bottom level = 10-30 = -20 → Y = 40 (still inside plotBottom
    // = 50, so no clamp). Middle = (13+40)/2 = 26.5.
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
    )
    const texts = Array.from(container.querySelectorAll('text'))
    expect(texts.length).toBe(1)
    expect(Number(texts[0].getAttribute('y'))).toBeCloseTo(26.5, 1)
    expect(texts[0].getAttribute('x')).toBe('100')
    expect(texts[0].getAttribute('text-anchor')).toBe('middle')
  })

  it('uses the next-deeper contact as the floor of the upper layer', () => {
    // Two contacts on the same borehole at depths 2 and 16
    // (total_depth_m=30 from fixture). Both layers stretch ≥
    // LAYER_LABEL_MIN_HEIGHT_PX (=14 px) so both get a middle
    // label. levelToScreen=flipped(level)=20-level → 1 px / m:
    //   upper [2, 16] : top Y=12, bottom Y=26, mid=19
    //   lower [16, 30]: top Y=26, bottom Y=40, mid=33
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 2 }),
      makeContact({ id: 'c-2', borehole_id: 'bh-1', depth_top_m: 16 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
    )
    const texts = Array.from(container.querySelectorAll('text'))
    expect(texts.length).toBe(2)
    const ys = texts.map(t => Number(t.getAttribute('y'))).sort((a, b) => a - b)
    expect(ys[0]).toBeCloseTo(19, 1)
    expect(ys[1]).toBeCloseTo(33, 1)
  })

  it('skips contacts whose anchor borehole has no elevation', () => {
    const contacts = [makeContact({ borehole_id: 'bh-no-z' })]
    const { container } = renderLayer(
      contacts,
      [makeFormation()],
      [makeBoreholePlaced('bh-no-z', 50, null)],
    )
    expect(container.querySelector('path')).toBeNull()
    expect(container.querySelector('line')).toBeNull()
  })

  it('skips contacts anchored at boreholes excluded from the model', () => {
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-keep' }),
      makeContact({ id: 'c-2', borehole_id: 'bh-skip' }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation()],
      [makeBoreholePlaced('bh-keep', 50), makeBoreholePlaced('bh-skip', 150)],
      new Set(['bh-skip']),
    )
    // Only the bh-keep contact contributes a top segment.
    expect(container.querySelectorAll('line').length).toBe(1)
    // No cross-column polyline either — only one vertex remains.
    expect(container.querySelector('path')).toBeNull()
  })

  it('does not emit drag hit-strips when onUpdateContactDepth is absent', () => {
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
    )
    expect(container.querySelectorAll('[data-testid="contact-drag-strip"]').length).toBe(0)
  })

  it('emits one drag hit-strip per contact when onUpdateContactDepth is wired', () => {
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
      makeContact({ id: 'c-2', borehole_id: 'bh-2', depth_top_m: 5 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 50), makeBoreholePlaced('bh-2', 150)],
      undefined,
      { onUpdateContactDepth: vi.fn().mockResolvedValue(undefined) },
    )
    expect(container.querySelectorAll('[data-testid="contact-drag-strip"]').length).toBe(2)
  })

  it('commits the new depth on drag end (mousedown → document mousemove → mouseup)', () => {
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onUpdateContactDepth },
    )
    const strip = container.querySelector('[data-testid="contact-drag-strip"]')!
    // mousedown starts the drag at clientY=0 (jsdom default). With
    // flipped(level) = 20-level: surfaceY=10, pxPerMetre=1. A
    // 5-px-delta mousemove pushes the contact 5 m deeper → new
    // depth = 3 + 5 = 8.
    fireEvent.mouseDown(strip, { clientY: 0, button: 0 })
    act(() => {
      // ``buttons: 1`` simulates the primary button still held —
      // the new e.buttons === 0 cancel guard would otherwise abort
      // the drag mid-move (debt #17 defensive cancel).
      const ev = new MouseEvent('mousemove', { clientY: 5, buttons: 1, bubbles: true })
      document.dispatchEvent(ev)
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    expect(onUpdateContactDepth).toHaveBeenCalledTimes(1)
    expect(onUpdateContactDepth.mock.calls[0][0]).toBe('c-1')
    expect(onUpdateContactDepth.mock.calls[0][1]).toBeCloseTo(8, 5)
  })

  it('does not commit when the drag never moved (zero-delta release)', () => {
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onUpdateContactDepth },
    )
    const strip = container.querySelector('[data-testid="contact-drag-strip"]')!
    fireEvent.mouseDown(strip, { clientY: 0, button: 0 })
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    expect(onUpdateContactDepth).not.toHaveBeenCalled()
  })

  it('snaps the drag depth to a stratigraphy candidate within tolerance', () => {
    // pxPerMetre = 1 (from flipped), SNAP_TOLERANCE_PX = 8.
    // Starting depth = 3 m. A 5-px-delta mousemove → raw depth 8.
    // With candidate at 10 m (5 m away → 5 px), inside tolerance, the
    // drag commits to 10 (the candidate), not 8 (the raw).
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
    ]
    const snapDepthsByAnchorId = new Map<string, readonly number[]>([
      ['bh-1', [10]],
    ])
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onUpdateContactDepth, snapDepthsByAnchorId },
    )
    const strip = container.querySelector('[data-testid="contact-drag-strip"]')!
    fireEvent.mouseDown(strip, { clientY: 0, button: 0 })
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientY: 5, buttons: 1, bubbles: true }),
      )
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    expect(onUpdateContactDepth).toHaveBeenCalledTimes(1)
    expect(onUpdateContactDepth.mock.calls[0][1]).toBeCloseTo(10, 5)
  })

  it('renders no drag hit-strip when the anchor borehole has null elevation (debt #31)', () => {
    // The layer-build pass already skips anchors whose elevation_m
    // is null (the column has no Y to lay out against), so the
    // hit-strip must also be absent — pinning that so a future
    // refactor doesn't surface a draggable line over a column
    // that can't render the segment.
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-no-z', depth_top_m: 3 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-no-z', 100, null)],
      undefined,
      { onUpdateContactDepth },
    )
    expect(
      container.querySelectorAll('[data-testid="contact-drag-strip"]').length,
    ).toBe(0)
  })

  it('clamps committed depth to 0 when the drag goes above the surface (debt #31)', () => {
    // A drag that pushes the cursor far above the contact's start
    // Y would otherwise commit a negative depth (a contact sitting
    // above the surface elevation, geologically meaningless). The
    // Math.max(0, rawDepth) clamp in handleMove floors it to 0;
    // this test pins the boundary.
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onUpdateContactDepth },
    )
    const strip = container.querySelector('[data-testid="contact-drag-strip"]')!
    fireEvent.mouseDown(strip, { clientY: 0, button: 0 })
    // Large negative clientY delta → rawDepth would go to -100, the
    // clamp floors it to 0.
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientY: -100, buttons: 1, bubbles: true }),
      )
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    expect(onUpdateContactDepth).toHaveBeenCalledTimes(1)
    // Surface contact — depth 0 exactly. ``toBeCloseTo(0, 5)`` to
    // tolerate the float arithmetic but pin the boundary value.
    expect(onUpdateContactDepth.mock.calls[0][1]).toBeCloseTo(0, 5)
  })

  it('cancels the drag without committing on window blur (debt #17)', () => {
    // Simulates: user mousedowns → drags partway → switches apps
    // (window blurs) → comes back → mouses up.
    // The drag should be abandoned at the blur moment with no
    // depth committed.
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onUpdateContactDepth },
    )
    const strip = container.querySelector('[data-testid="contact-drag-strip"]')!
    fireEvent.mouseDown(strip, { clientY: 0, button: 0 })
    // Move with button held so the cancel signal under test is
    // unambiguously the blur, not the e.buttons === 0 guard.
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientY: 5, buttons: 1, bubbles: true }),
      )
    })
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    // After blur, the mouseup handler is detached. Even if a
    // mouseup arrives, no commit fires.
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    expect(onUpdateContactDepth).not.toHaveBeenCalled()
  })

  it('cancels the drag when the cursor returns with no button held (debt #17)', () => {
    // Simulates: user mousedowns → drags out of the viewport →
    // releases outside (mouseup never fires on document) → moves
    // the cursor back in with buttons === 0. handleMove detects
    // the missing button and abandons the drag.
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onUpdateContactDepth },
    )
    const strip = container.querySelector('[data-testid="contact-drag-strip"]')!
    fireEvent.mouseDown(strip, { clientY: 0, button: 0 })
    // Mousemove with buttons=0 → drag abandoned without commit.
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientY: 5, buttons: 0, bubbles: true }),
      )
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    expect(onUpdateContactDepth).not.toHaveBeenCalled()
  })

  it('does not commit Infinity when pxPerMetre collapses to 0 (debt #19)', () => {
    // Pathological collapsed viewport — levelToScreen returns a
    // constant, so pxPerMetre = 0. The drag math would divide by
    // zero and yield Infinity; the guards in handleMove + handleUp
    // suppress the commit entirely.
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
    ]
    const constantLevelToScreen = (): number => 15
    const { container } = render(
      <svg>
        <ContactsLayer
          contacts={contacts}
          formations={[makeFormation({ name: 'X' })]}
          placedColumns={[makeBoreholePlaced('bh-1', 100)]}
          levelToScreen={constantLevelToScreen}
          plotTop={0}
          plotBottom={50}
          onUpdateContactDepth={onUpdateContactDepth}
        />
      </svg>,
    )
    const strip = container.querySelector('[data-testid="contact-drag-strip"]')
    // pxPerMetre = 0 means bodyTop === bodyBottom for every layer;
    // the layer still renders but the drag math is undefined. Guard
    // either skips the strip render (no harm) OR catches the zero
    // inside handleMove / handleUp before committing.
    if (strip) {
      fireEvent.mouseDown(strip, { clientY: 0, button: 0 })
      // buttons: 1 so the cancel signal under test is the
      // pxPerMetre === 0 guard, not the buttons-released guard.
      act(() => {
        document.dispatchEvent(
          new MouseEvent('mousemove', { clientY: 10, buttons: 1, bubbles: true }),
        )
      })
      act(() => {
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      })
    }
    expect(onUpdateContactDepth).not.toHaveBeenCalled()
  })

  it('reprojects segments when only levelToScreen changes (vertical pan)', () => {
    // Debt #29 regression: the data-classification pass should stay
    // cached when only the vertical transform changes, BUT the
    // projection step must re-run so the visible segment Y reflects
    // the new ``levelToScreen``. With surface=10 and depth=3 on a
    // borehole, segment Y = levelToScreen(10-3) = levelToScreen(7).
    //
    // First render: flipped(7) = 20-7 = 13. Re-render with a shifted
    // transform: flipped_shifted(7) = 30-7 = 23. The segment must
    // move from y=13 to y=23 with no other inputs changing.
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
    ]
    const formations = [makeFormation({ name: 'X' })]
    const placed = [makeBoreholePlaced('bh-1', 100)]
    const { container, rerender } = render(
      <svg>
        <ContactsLayer
          contacts={contacts}
          formations={formations}
          placedColumns={placed}
          levelToScreen={(level: number) => 20 - level}
          plotTop={0}
          plotBottom={50}
        />
      </svg>,
    )
    const initialY = Number(container.querySelector('line')?.getAttribute('y1'))
    expect(initialY).toBeCloseTo(13, 1)

    rerender(
      <svg>
        <ContactsLayer
          contacts={contacts}
          formations={formations}
          placedColumns={placed}
          levelToScreen={(level: number) => 30 - level}
          plotTop={0}
          plotBottom={50}
        />
      </svg>,
    )
    const shiftedY = Number(container.querySelector('line')?.getAttribute('y1'))
    expect(shiftedY).toBeCloseTo(23, 1)
  })

  it('pre-indexes contacts by anchor so unrelated contacts at other anchors are ignored', () => {
    // Debt #29 regression — the new data pass pre-indexes contacts
    // by anchor id (O(M) once) rather than walking every contact for
    // every column (O(N×M)). The behaviour pin: a contact with an
    // anchor id absent from placedColumns produces no render, and
    // the contacts at present anchors render normally.
    const contacts = [
      makeContact({ id: 'c-keep', borehole_id: 'bh-1', depth_top_m: 3 }),
      makeContact({ id: 'c-orphan', borehole_id: 'bh-orphan', depth_top_m: 4 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
    )
    // One present borehole + one orphan → only one top segment.
    expect(container.querySelectorAll('line').length).toBe(1)
  })

  it('uses the formation colour for both segment + polyline stroke', () => {
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1' }),
      makeContact({ id: 'c-2', borehole_id: 'bh-2' }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ color: '#aabbcc' })],
      [makeBoreholePlaced('bh-1', 50), makeBoreholePlaced('bh-2', 150)],
    )
    expect(container.querySelector('path')?.getAttribute('stroke')).toBe('#aabbcc')
    expect(container.querySelector('line')?.getAttribute('stroke')).toBe('#aabbcc')
  })
})
