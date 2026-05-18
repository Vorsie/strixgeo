// Behaviour tests for ContactsLayer — the formation-contact
// polyline overlay on the cross-section.

import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type {
  BoreholeListItem,
  FormationContactBatchUpdateEntry,
  FormationContactResponse,
  FormationSurfaceResponse,
  GeologicalFormationResponse,
} from '../../api/client'
import type { ContactCopyPayload } from './ContactsLayer'
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
    onDeleteContact?: (id: string) => Promise<void>
    onBatchUpdateContacts?: (
      updates: readonly FormationContactBatchUpdateEntry[],
    ) => Promise<void>
    onBatchCreateContacts?: (
      creates: readonly ContactCopyPayload[],
    ) => Promise<void>
    snapDepthsByAnchorId?: ReadonlyMap<string, readonly number[]>
    surfacesByFormationId?: ReadonlyMap<string, FormationSurfaceResponse>
    sectionLine?: { startX: number; startY: number; endX: number; endY: number }
    alongMToScreenX?: (alongM: number) => number
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
        onDeleteContact={extras.onDeleteContact}
        onBatchUpdateContacts={extras.onBatchUpdateContacts}
        onBatchCreateContacts={extras.onBatchCreateContacts}
        snapDepthsByAnchorId={extras.snapDepthsByAnchorId}
        surfacesByFormationId={extras.surfacesByFormationId}
        sectionLine={extras.sectionLine}
        alongMToScreenX={extras.alongMToScreenX}
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
    // One per-formation cross-column polyline (the dashed top line).
    // We target paths that aren't the fill band — fills also render
    // as <path> now but carry a ``data-testid="formation-fill-..."``.
    const lines = Array.from(container.querySelectorAll('path')).filter(
      p => !p.getAttribute('data-testid')?.startsWith('formation-fill-'),
    )
    expect(lines.length).toBe(1)
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
    // The fill band path has stroke="none" — skip it. Target the
    // formation's actual top polyline by excluding the fill testid.
    const linePath = Array.from(container.querySelectorAll('path')).find(
      p => !p.getAttribute('data-testid')?.startsWith('formation-fill-'),
    )
    expect(linePath?.getAttribute('stroke')).toBe('#aabbcc')
    expect(container.querySelector('line')?.getAttribute('stroke')).toBe('#aabbcc')
  })

  it('emits the hit-strip even when only onDeleteContact is wired', () => {
    // Hit-strip presence gates the right-click handler — without it
    // the contextmenu event has nowhere to fire. Broadening the gate
    // from "drag-only" to "drag OR delete" is the behaviour change
    // this test pins.
    const contacts = [makeContact({ id: 'c-1', borehole_id: 'bh-1' })]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onDeleteContact: vi.fn().mockResolvedValue(undefined) },
    )
    expect(
      container.querySelectorAll('[data-testid="contact-drag-strip"]').length,
    ).toBe(1)
  })

  it('right-click + confirm fires onDeleteContact with the contact id', () => {
    const onDeleteContact = vi.fn().mockResolvedValue(undefined)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const contacts = [makeContact({ id: 'c-7', borehole_id: 'bh-1' })]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onDeleteContact },
    )
    const strip = container.querySelector(
      '[data-testid="contact-drag-strip"]',
    )!
    // Right-click opens the portal context menu in document.body.
    // We then click "Delete contact" — that is what triggers window.confirm.
    act(() => {
      strip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    })
    const menu = document.body.querySelector('[data-testid="contact-context-menu"]')!
    const deleteBtn = Array.from(menu.querySelectorAll('button')).find(
      b => b.textContent?.trim() === 'Delete contact',
    )!
    act(() => {
      fireEvent.click(deleteBtn)
    })
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(onDeleteContact).toHaveBeenCalledTimes(1)
    expect(onDeleteContact.mock.calls[0][0]).toBe('c-7')
    confirmSpy.mockRestore()
  })

  it('right-click + cancel does NOT fire onDeleteContact', () => {
    const onDeleteContact = vi.fn().mockResolvedValue(undefined)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const contacts = [makeContact({ id: 'c-7', borehole_id: 'bh-1' })]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onDeleteContact },
    )
    const strip = container.querySelector(
      '[data-testid="contact-drag-strip"]',
    )!
    // Right-click opens the portal context menu in document.body.
    // Clicking "Delete contact" triggers window.confirm; returning false
    // means onDeleteContact must NOT be called.
    act(() => {
      strip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    })
    const menu = document.body.querySelector('[data-testid="contact-context-menu"]')!
    const deleteBtn = Array.from(menu.querySelectorAll('button')).find(
      b => b.textContent?.trim() === 'Delete contact',
    )!
    act(() => {
      fireEvent.click(deleteBtn)
    })
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(onDeleteContact).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('right-click is a no-op when onDeleteContact is absent', () => {
    // Drag wired but no delete handler — confirm() must NEVER appear.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const contacts = [makeContact({ id: 'c-1', borehole_id: 'bh-1' })]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onUpdateContactDepth: vi.fn().mockResolvedValue(undefined) },
    )
    const strip = container.querySelector(
      '[data-testid="contact-drag-strip"]',
    )!
    strip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    expect(confirmSpy).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  // -----------------------------------------------------------------
  // Selection model: Ctrl-toggle, Shift-range, ESC-clear, halo render
  // -----------------------------------------------------------------

  it('Ctrl+Click toggles a contact in/out of selection without dragging', () => {
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contacts = [makeContact({ id: 'c-1', borehole_id: 'bh-1' })]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onUpdateContactDepth },
    )
    const strip = container.querySelector(
      '[data-testid="contact-drag-strip"]',
    )!

    // First Ctrl+Click adds to selection — halo (the slate-blue
    // 4px-wide line under the segment) appears.
    fireEvent.mouseDown(strip, { button: 0, ctrlKey: true })
    expect(container.querySelectorAll('line[stroke="#2563eb"]').length).toBe(1)

    // Drag handler was NOT invoked — modifier clicks update selection
    // only.
    expect(onUpdateContactDepth).not.toHaveBeenCalled()

    // Second Ctrl+Click toggles back out.
    fireEvent.mouseDown(strip, { button: 0, ctrlKey: true })
    expect(container.querySelectorAll('line[stroke="#2563eb"]').length).toBe(0)
  })

  it('Shift+Click selects the depth-range within the same anchor', () => {
    // Three contacts on borehole bh-1 at depths 2 / 5 / 9. Ctrl-click
    // c-1, Shift-click c-3 → all three selected.
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 2 }),
      makeContact({ id: 'c-2', borehole_id: 'bh-1', depth_top_m: 5 }),
      makeContact({ id: 'c-3', borehole_id: 'bh-1', depth_top_m: 9 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onUpdateContactDepth: vi.fn().mockResolvedValue(undefined) },
    )
    const strips = container.querySelectorAll(
      '[data-testid="contact-drag-strip"]',
    )
    fireEvent.mouseDown(strips[0], { button: 0, ctrlKey: true })
    // Shift+mousedown now starts a deferred drag (shiftHeld) so the
    // shift+click vs shift+drag gestures can share a modifier. The
    // range-select fires on mouseup IF the press wasn't a drag — so
    // we also need a mouseup with no intervening movement.
    fireEvent.mouseDown(strips[2], { button: 0, shiftKey: true })
    fireEvent.mouseUp(document, { button: 0 })
    // All three halos.
    expect(container.querySelectorAll('line[stroke="#2563eb"]').length).toBe(3)
  })

  it('selectionResetSignal bump clears the active selection', () => {
    // Pin the controlled-prop reset path used by SectionPanel's
    // click-anywhere-to-clear flow. ContactsLayer's useEffect on
    // the signal counter clears selection on each bump.
    const contacts = [makeContact({ id: 'c-1', borehole_id: 'bh-1' })]
    const { container, rerender } = render(
      <svg>
        <ContactsLayer
          contacts={contacts}
          formations={[makeFormation({ name: 'X' })]}
          placedColumns={[makeBoreholePlaced('bh-1', 100)]}
          levelToScreen={flipped}
          plotTop={0}
          plotBottom={50}
          onUpdateContactDepth={vi.fn().mockResolvedValue(undefined)}
          selectionResetSignal={0}
        />
      </svg>,
    )
    const strip = container.querySelector(
      '[data-testid="contact-drag-strip"]',
    )!
    fireEvent.mouseDown(strip, { button: 0, ctrlKey: true })
    expect(container.querySelectorAll('line[stroke="#2563eb"]').length).toBe(1)

    // Bump the counter — ContactsLayer must clear its selection.
    rerender(
      <svg>
        <ContactsLayer
          contacts={contacts}
          formations={[makeFormation({ name: 'X' })]}
          placedColumns={[makeBoreholePlaced('bh-1', 100)]}
          levelToScreen={flipped}
          plotTop={0}
          plotBottom={50}
          onUpdateContactDepth={vi.fn().mockResolvedValue(undefined)}
          selectionResetSignal={1}
        />
      </svg>,
    )
    expect(container.querySelectorAll('line[stroke="#2563eb"]').length).toBe(0)
  })

  it('ESC clears the active selection when no drag is running', () => {
    const contacts = [makeContact({ id: 'c-1', borehole_id: 'bh-1' })]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onUpdateContactDepth: vi.fn().mockResolvedValue(undefined) },
    )
    const strip = container.querySelector(
      '[data-testid="contact-drag-strip"]',
    )!
    fireEvent.mouseDown(strip, { button: 0, ctrlKey: true })
    expect(container.querySelectorAll('line[stroke="#2563eb"]').length).toBe(1)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(container.querySelectorAll('line[stroke="#2563eb"]').length).toBe(0)
  })

  // -----------------------------------------------------------------
  // Marquee (box-select) — only rendered when plotLeft/Right wired
  // -----------------------------------------------------------------

  it('renders no marquee preview when no marquee state is provided', () => {
    // Marquee state is owned by SectionPanel — ContactsLayer renders
    // the dashed preview rect only when ``marquee`` prop is set.
    const contacts = [makeContact({ id: 'c-1', borehole_id: 'bh-1' })]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      {
        onUpdateContactDepth: vi.fn().mockResolvedValue(undefined),
        onBatchUpdateContacts: vi.fn().mockResolvedValue(undefined),
      },
    )
    expect(
      container.querySelector('[data-testid="contacts-marquee-preview"]'),
    ).toBeNull()
  })

  // -----------------------------------------------------------------
  // Cross-column drag → onBatchUpdateContacts with new anchor
  // -----------------------------------------------------------------

  it('cross-column plain drag fires onBatchCreateContacts (COPY default)', () => {
    // Two columns: bh-1 at nudgedX=50, bh-2 at nudgedX=200. Drag c-1
    // from bh-1 horizontally past the 15px hysteresis into bh-2's
    // band. Plain (no Alt) cross-column = COPY → creates new contact
    // at bh-2 with the same formation; the original at bh-1 stays.
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({
        id: 'c-1',
        borehole_id: 'bh-1',
        depth_top_m: 3,
        formation_id: 'f-X',
      }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ id: 'f-X', name: 'X' })],
      [makeBoreholePlaced('bh-1', 50), makeBoreholePlaced('bh-2', 200)],
      undefined,
      {
        onUpdateContactDepth,
        onBatchUpdateContacts: onUpdate,
        onBatchCreateContacts: onCreate,
      },
    )
    const strip = container.querySelector(
      '[data-testid="contact-drag-strip"]',
    )!
    fireEvent.mouseDown(strip, { button: 0, clientX: 50, clientY: 10 })
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          clientX: 200,
          clientY: 10,
          buttons: 1,
        }),
      )
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })

    expect(onUpdateContactDepth).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onCreate).toHaveBeenCalledTimes(1)
    const creates = onCreate.mock.calls[0][0]
    expect(creates.length).toBe(1)
    expect(creates[0].formation_id).toBe('f-X')
    expect(creates[0].borehole_id).toBe('bh-2')
    expect(creates[0].cpt_id).toBeNull()
  })

  it('cross-column Alt+drag fires onBatchUpdateContacts (MOVE — explicit opt-in)', () => {
    // Same setup as above but the mouseup carries altKey=true →
    // re-anchor (the original first-ship behaviour, now opt-in).
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 50), makeBoreholePlaced('bh-2', 200)],
      undefined,
      {
        onUpdateContactDepth: vi.fn().mockResolvedValue(undefined),
        onBatchUpdateContacts: onUpdate,
        onBatchCreateContacts: onCreate,
      },
    )
    const strip = container.querySelector(
      '[data-testid="contact-drag-strip"]',
    )!
    fireEvent.mouseDown(strip, { button: 0, clientX: 50, clientY: 10 })
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          clientX: 200,
          clientY: 10,
          buttons: 1,
        }),
      )
    })
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mouseup', { altKey: true }),
      )
    })

    expect(onCreate).not.toHaveBeenCalled()
    expect(onUpdate).toHaveBeenCalledTimes(1)
    const updates = onUpdate.mock.calls[0][0]
    expect(updates[0].contact_id).toBe('c-1')
    expect(updates[0].borehole_id).toBe('bh-2')
  })

  it('Shift+drag paints the source contact onto every column passed over', () => {
    // Six columns at nudgedX 50 / 100 / 150 / 200 / 250 / 300.
    // Source contact lives on bh-1 (50); user shift-drags rightward
    // past bh-2 / bh-3 / bh-4 / bh-5 into bh-6's band. Paint-through
    // stamps the source contact's depth onto bh-2..bh-6 (source bh-1
    // excluded — it already carries the contact). Drop Y is ignored;
    // every stamp uses the source's ORIGINAL depth.
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({
        id: 'c-1',
        borehole_id: 'bh-1',
        depth_top_m: 3,
        formation_id: 'f-X',
      }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ id: 'f-X', name: 'X' })],
      [
        makeBoreholePlaced('bh-1', 50),
        makeBoreholePlaced('bh-2', 100),
        makeBoreholePlaced('bh-3', 150),
        makeBoreholePlaced('bh-4', 200),
        makeBoreholePlaced('bh-5', 250),
        makeBoreholePlaced('bh-6', 300),
      ],
      undefined,
      {
        onUpdateContactDepth,
        onBatchUpdateContacts: onUpdate,
        onBatchCreateContacts: onCreate,
      },
    )
    const strip = container.querySelector(
      '[data-testid="contact-drag-strip"]',
    )!
    // Shift+mousedown at the source column, drag to a Y unrelated to
    // any sensible depth to confirm drop Y is ignored, mouseup over
    // bh-6's band.
    fireEvent.mouseDown(strip, {
      button: 0,
      shiftKey: true,
      clientX: 50,
      clientY: 10,
    })
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          clientX: 300,
          clientY: 200,
          buttons: 1,
          shiftKey: true,
        }),
      )
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { shiftKey: true }))
    })

    expect(onUpdateContactDepth).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onCreate).toHaveBeenCalledTimes(1)
    const creates = onCreate.mock.calls[0][0]
    // Five stamps: bh-2..bh-6, source bh-1 excluded.
    expect(creates.length).toBe(5)
    expect(creates.map((c: ContactCopyPayload) => c.borehole_id)).toEqual([
      'bh-2',
      'bh-3',
      'bh-4',
      'bh-5',
      'bh-6',
    ])
    // Every stamp at the SOURCE's depth (3 m), drop Y ignored.
    for (const c of creates) {
      expect(c.depth_top_m).toBe(3)
      expect(c.formation_id).toBe('f-X')
      expect(c.cpt_id).toBeNull()
    }
  })

  it('cross-column drag degrades to MOVE when only onBatchUpdateContacts is wired', () => {
    // Caller didn't wire COPY but wired MOVE — avoids a silent no-op
    // by routing the plain drag through the update path (with
    // anchor-change semantics).
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 50), makeBoreholePlaced('bh-2', 200)],
      undefined,
      {
        onUpdateContactDepth: vi.fn().mockResolvedValue(undefined),
        onBatchUpdateContacts: onUpdate,
        // onBatchCreateContacts intentionally omitted.
      },
    )
    const strip = container.querySelector(
      '[data-testid="contact-drag-strip"]',
    )!
    fireEvent.mouseDown(strip, { button: 0, clientX: 50, clientY: 10 })
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          clientX: 200,
          clientY: 10,
          buttons: 1,
        }),
      )
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0][0].borehole_id).toBe('bh-2')
  })

  it('same-column depth drag still routes through onUpdateContactDepth', () => {
    // Single-contact, same-anchor drag preserves the existing PATCH
    // path so the batch endpoint isn't called for what is a single
    // depth tweak.
    const onBatch = vi.fn().mockResolvedValue(undefined)
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onUpdateContactDepth, onBatchUpdateContacts: onBatch },
    )
    const strip = container.querySelector(
      '[data-testid="contact-drag-strip"]',
    )!
    fireEvent.mouseDown(strip, { button: 0, clientX: 100, clientY: 10 })
    act(() => {
      // Vertical-only move — cursorX stays in source column.
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          clientX: 100,
          clientY: 20,
          buttons: 1,
        }),
      )
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })

    expect(onBatch).not.toHaveBeenCalled()
    expect(onUpdateContactDepth).toHaveBeenCalledTimes(1)
  })

  it('renders fresh slice-of-TIN solid + opacity 0.7', () => {
    // Three contacts on three boreholes — enough for a Delaunay
    // triangle. Surface is fresh (is_stale=false). Section cuts
    // horizontally through y=0; alongMToScreenX is identity for the
    // test.
    const formation = makeFormation({ id: 'f', color: '#ff0000' })
    const contacts = [
      makeContact({ id: 'c1', borehole_id: 'bh-1', formation_id: 'f', depth_top_m: 1 }),
      makeContact({ id: 'c2', borehole_id: 'bh-2', formation_id: 'f', depth_top_m: 1 }),
      makeContact({ id: 'c3', borehole_id: 'bh-3', formation_id: 'f', depth_top_m: 1 }),
    ]
    const surface: FormationSurfaceResponse = {
      id: 's',
      model_id: 'm',
      formation_id: 'f',
      method: 'tin',
      vertices: [
        [0, -2, 9],
        [100, -2, 9],
        [50, 5, 9],
      ],
      triangles: [[0, 1, 2]],
      source_contact_count: 3,
      is_stale: false,
      created_at: '2026-05-14T00:00:00Z',
      updated_at: '2026-05-14T00:00:00Z',
    }
    const surfacesByFormationId = new Map<string, FormationSurfaceResponse>([
      ['f', surface],
    ])
    const { container } = renderLayer(
      contacts,
      [formation],
      [
        makeBoreholePlaced('bh-1', 0),
        makeBoreholePlaced('bh-2', 100),
        makeBoreholePlaced('bh-3', 50),
      ],
      undefined,
      {
        surfacesByFormationId,
        sectionLine: { startX: -10, startY: 0, endX: 110, endY: 0 },
        alongMToScreenX: along => along + 10,
      },
    )
    const slice = container.querySelector('[data-testid="formation-surface-f"]')
    expect(slice).not.toBeNull()
    expect(slice!.getAttribute('stroke-opacity')).toBe('0.7')
    expect(slice!.getAttribute('stroke-dasharray')).toBeNull()
    expect(slice!.getAttribute('data-stale')).toBeNull()
  })

  it('renders stale slice-of-TIN dashed + opacity 0.35', () => {
    // Same setup but is_stale=true → demoted style.
    const formation = makeFormation({ id: 'f', color: '#ff0000' })
    const contacts = [
      makeContact({ id: 'c1', borehole_id: 'bh-1', formation_id: 'f', depth_top_m: 1 }),
      makeContact({ id: 'c2', borehole_id: 'bh-2', formation_id: 'f', depth_top_m: 1 }),
      makeContact({ id: 'c3', borehole_id: 'bh-3', formation_id: 'f', depth_top_m: 1 }),
    ]
    const surface: FormationSurfaceResponse = {
      id: 's',
      model_id: 'm',
      formation_id: 'f',
      method: 'tin',
      vertices: [
        [0, -2, 9],
        [100, -2, 9],
        [50, 5, 9],
      ],
      triangles: [[0, 1, 2]],
      source_contact_count: 3,
      is_stale: true,
      created_at: '2026-05-14T00:00:00Z',
      updated_at: '2026-05-14T00:00:00Z',
    }
    const surfacesByFormationId = new Map<string, FormationSurfaceResponse>([
      ['f', surface],
    ])
    const { container } = renderLayer(
      contacts,
      [formation],
      [
        makeBoreholePlaced('bh-1', 0),
        makeBoreholePlaced('bh-2', 100),
        makeBoreholePlaced('bh-3', 50),
      ],
      undefined,
      {
        surfacesByFormationId,
        sectionLine: { startX: -10, startY: 0, endX: 110, endY: 0 },
        alongMToScreenX: along => along + 10,
      },
    )
    const slice = container.querySelector('[data-testid="formation-surface-f"]')
    expect(slice).not.toBeNull()
    expect(slice!.getAttribute('stroke-opacity')).toBe('0.35')
    expect(slice!.getAttribute('stroke-dasharray')).toBe('6 3')
    expect(slice!.getAttribute('data-stale')).toBe('true')
  })

  it('paints formation polylines in stratigraphic order — older first, younger on top', () => {
    // Two formations: F-old (display_order=0) and F-young (display_order=10).
    // Each has contacts on two boreholes so both render as polylines.
    // Geological superposition: older paints first, younger paints last
    // (= visible on top in SVG paint order). DOM order is paint order,
    // so querySelectorAll returns them in render sequence.
    const formations = [
      makeFormation({ id: 'f-young', name: 'Young', color: '#0000ff', display_order: 10 }),
      makeFormation({ id: 'f-old', name: 'Old', color: '#ff0000', display_order: 0 }),
    ]
    const contacts = [
      makeContact({ id: 'c-y1', borehole_id: 'bh-1', formation_id: 'f-young', depth_top_m: 1 }),
      makeContact({ id: 'c-y2', borehole_id: 'bh-2', formation_id: 'f-young', depth_top_m: 1.5 }),
      makeContact({ id: 'c-o1', borehole_id: 'bh-1', formation_id: 'f-old', depth_top_m: 5 }),
      makeContact({ id: 'c-o2', borehole_id: 'bh-2', formation_id: 'f-old', depth_top_m: 6 }),
    ]
    const { container } = renderLayer(
      contacts,
      formations,
      [makeBoreholePlaced('bh-1', 50), makeBoreholePlaced('bh-2', 150)],
    )
    const paths = container.querySelectorAll('[data-testid^="formation-polyline-"]')
    expect(paths.length).toBe(2)
    // Older first, younger last.
    expect(paths[0].getAttribute('data-testid')).toBe('formation-polyline-f-old')
    expect(paths[1].getAttribute('data-testid')).toBe('formation-polyline-f-young')
  })

  // -----------------------------------------------------------------
  // 3-state fill contract (§10 on-click build): the SOLID colour band
  // is gated on a built surface. Fill (Geology stage) creates contacts
  // but NEVER builds a TIN, so until "Build 3D model" runs the section
  // must show ONLY the dashed connect-the-dots line — no colour fill.
  // These pin the gate that regressed (solid bands appeared pre-Build).
  // -----------------------------------------------------------------

  // Shared fixture: 3 boreholes carrying one contact each for one
  // formation — enough for a connect-the-dots polyline (and a TIN
  // slice when a surface is wired). The only variable across the
  // three cases is the surface (absent / fresh / stale).
  const fillContacts = [
    makeContact({ id: 'c1', borehole_id: 'bh-1', formation_id: 'f', depth_top_m: 1 }),
    makeContact({ id: 'c2', borehole_id: 'bh-2', formation_id: 'f', depth_top_m: 1 }),
    makeContact({ id: 'c3', borehole_id: 'bh-3', formation_id: 'f', depth_top_m: 1 }),
  ]
  const fillFormation = makeFormation({ id: 'f', color: '#ff0000' })
  const fillPlaced = [
    makeBoreholePlaced('bh-1', 0),
    makeBoreholePlaced('bh-2', 100),
    makeBoreholePlaced('bh-3', 50),
  ]
  function makeFillSurface(isStale: boolean): FormationSurfaceResponse {
    return {
      id: 's',
      model_id: 'm',
      formation_id: 'f',
      method: 'tin',
      vertices: [
        [0, -2, 9],
        [100, -2, 9],
        [50, 5, 9],
      ],
      triangles: [[0, 1, 2]],
      source_contact_count: 3,
      is_stale: isStale,
      created_at: '2026-05-14T00:00:00Z',
      updated_at: '2026-05-14T00:00:00Z',
    }
  }

  it('emits NO solid fill band when contacts exist but no surface is built (Fill, pre-Build)', () => {
    // The regression: a colour-filled band appeared straight after
    // Fill, before any Build. Contract: no surface row → no fill,
    // ONLY the dashed connect-the-dots polyline.
    const { container } = renderLayer(
      fillContacts,
      [fillFormation],
      fillPlaced,
      undefined,
      {
        sectionLine: { startX: -10, startY: 0, endX: 110, endY: 0 },
        alongMToScreenX: along => along + 10,
        // surfacesByFormationId deliberately omitted — never Built.
      },
    )
    expect(
      container.querySelectorAll('[data-testid^="formation-fill-"]').length,
    ).toBe(0)
    // The draft is still drawn — the connect-the-dots polyline remains.
    expect(
      container.querySelector('[data-testid="formation-polyline-f"]'),
    ).not.toBeNull()
  })

  it('emits a solid fill band at opacity 0.18 when the surface is freshly built', () => {
    const { container } = renderLayer(
      fillContacts,
      [fillFormation],
      fillPlaced,
      undefined,
      {
        surfacesByFormationId: new Map([['f', makeFillSurface(false)]]),
        sectionLine: { startX: -10, startY: 0, endX: 110, endY: 0 },
        alongMToScreenX: along => along + 10,
      },
    )
    const band = container.querySelector('[data-testid="formation-fill-f"]')
    expect(band).not.toBeNull()
    expect(band!.getAttribute('fill-opacity')).toBe('0.18')
  })

  it('emits a faded fill band at opacity 0.08 when the surface is stale', () => {
    const { container } = renderLayer(
      fillContacts,
      [fillFormation],
      fillPlaced,
      undefined,
      {
        surfacesByFormationId: new Map([['f', makeFillSurface(true)]]),
        sectionLine: { startX: -10, startY: 0, endX: 110, endY: 0 },
        alongMToScreenX: along => along + 10,
      },
    )
    const band = container.querySelector('[data-testid="formation-fill-f"]')
    expect(band).not.toBeNull()
    expect(band!.getAttribute('fill-opacity')).toBe('0.08')
  })
})
