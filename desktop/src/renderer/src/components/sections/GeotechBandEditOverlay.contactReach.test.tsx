// Whether a press aimed at a lithostratigraphic contact on the geotech axis actually
// REACHES it — the question no other test in this feature asks.
//
// Every other case renders one of the two components alone, or renders `SectionPanel`
// with `ContactsLayer` MOCKED (`SectionPanel.geotechSnap.test.tsx`). Alone, each is
// correct: the contact strip owns its press, the band rect owns its right-click. Together
// they are siblings inside one `<svg>` — `ContactsLayer` at `SectionPanel.tsx:2858`, this
// overlay at `:3206` — and SVG hands the press to whichever of them PAINTS LAST. The band
// rect spans its band's full height including the contact lines at its own top and bottom
// edges, so it took the press, found no mousedown handler of its own, and let it bubble to
// the SVG root, where the canvas starts a PAN. The contact drag was unreachable by mouse.
//
// So the fixture here is the real stack: both components, real, in SectionPanel's order.
//
// HOW the press is resolved. jsdom has no layout and no `document.elementFromPoint` (it is
// not implemented at all — not merely inert), so the honest check is to apply SVG's own
// hit-test rule to the geometry the components declare: among the rects whose x/y/width/
// height contain the point and whose pointer events are live, the one LAST in document
// order wins, because later siblings paint over earlier ones. `topmostRectAt` does exactly
// that and nothing else; it refuses to guess if a transform is in play. The resolved
// element is then pressed for real, so the claim is "the press reaches the contact drag",
// not "a rectangle contains a number".
//
// Pinned claims:
//   GS51  A press on a litho contact reaches the contact drag strip, and drags it.
//   GS52  Right-click inside the band still opens the split / remove menu (the fix must
//         not buy the drag by deleting the band's own gesture).
//   GS53  A band too thin to hold an interior keeps no press target at all, rather than
//         one that lies across the two grab strips already covering every pixel of it.
//   GS54  The overlay's own boundary strip still wins its pixels (Task 1 / GS42/46/47).

import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type {
  CptListItem,
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoLayerResponse,
} from '../../api/client'
import type { ProjectedInvestigation } from '../../utils/sectionProjection'
import ContactsLayer from './ContactsLayer'
import { restatingContactIds } from './geotechBoundaryKinds'
import { clampContactDrag, packingSnapCandidates } from './geotechSnapTargets'
import GeotechBandEditOverlay, { BAND_HIT_INSET_PX } from './GeotechBandEditOverlay'
import type { PlacedColumn } from './utils'

// ---------------------------------------------------------------------------
// One CPT column, drawn at 10 px per metre with its collar at y = 100:
//
//   litho:    KLEI 0 ....... 3        ZAND 3 ................. 9
//   packing:  g1 0-3            | g2 3-5 | g3 5-9
//   boundary:                   ^3 m LITHO CONTACT   ^5 m packing boundary
//
// The contact at 3 m is the one the owner most wants to move: on his data a column
// carries 17 internal boundaries of which only 3 are packing boundaries.
// ---------------------------------------------------------------------------

const PX_PER_M = 10
const COLUMN_ELEVATION_M = 10
const COLUMN_X = 100

/** Absolute elevation → screen y; the collar at 10 m lands at y = 100. */
const levelToScreen = (level: number): number => (20 - level) * PX_PER_M

/** Screen y for a depth below the collar. */
const yAtDepth = (depthM: number): number => levelToScreen(COLUMN_ELEVATION_M - depthM)

/**
 * One layer row on the CPT column.
 *
 * @param id Layer id.
 * @param top Depth of the top, in metres below the collar.
 * @param base Depth of the base, in metres below the collar.
 * @returns The layer row.
 */
function layer(id: string, top: number, base: number): LithoLayerResponse {
  return {
    id,
    model_id: 'm',
    formation_id: `f-${id}`,
    cpt_id: 'cpt-1',
    borehole_id: null,
    depth_top_m: top,
    depth_base_m: base,
    status: 'accepted',
    source: 'manual',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: `body-${id}`,
    notes: null,
    created_at: '2026-08-09T00:00:00Z',
    updated_at: '2026-08-09T00:00:00Z',
  } as LithoLayerResponse
}

/**
 * A contact on the CPT column. On the geotech axis these are the packing bands' tops,
 * and the ones sitting on a litho body edge ARE the lithostratigraphic contacts.
 *
 * @param id Contact id.
 * @param depthM Depth below the collar, in metres.
 * @returns The contact row.
 */
function contactAt(id: string, depthM: number): FormationContactResponse {
  return {
    id,
    model_id: 'm-1',
    formation_id: 'f-1',
    borehole_id: null,
    cpt_id: 'cpt-1',
    depth_top_m: depthM,
    source: 'manual_pick',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    created_at: '2026-08-09T00:00:00Z',
    updated_at: '2026-08-09T00:00:00Z',
  } as FormationContactResponse
}

const LITHO_LAYERS = [layer('L-klei', 0, 3), layer('L-zand', 3, 9)]
const GEOTECH_LAYERS = [layer('g1', 0, 3), layer('g2', 3, 5), layer('g3', 5, 9)]
const CONTACTS = [contactAt('g2', 3), contactAt('g3', 5)]

/**
 * A thin band inside ONE litho body: 3.0–3.5 m, i.e. 5 px tall, under twice the inset.
 * Both its boundaries are packing boundaries, so both carry a grab strip.
 */
const THIN_LITHO_LAYERS = [layer('L-one', 0, 9)]
const THIN_GEOTECH_LAYERS = [layer('t1', 0, 3), layer('t2', 3, 3.5), layer('t3', 3.5, 9)]

const FORMATION = {
  id: 'f-1',
  app_project_id: 'P',
  name: 'Unit',
  color: '#ff8800',
  code: null,
  display_order: 0,
  pinned_order: false,
  regional_ref: null,
  description: null,
  lithology: null,
  nad_class: null,
  parent_formation_id: null,
  litho_main_soil_code: null,
  litho_admixtures: null,
  instance_ordinal: null,
  instance_ordinal_locked: false,
  parent_formation_name: null,
  parent_extrapolated: false,
  source_litho_formation_id: null,
  source_geo_formation_id: null,
  created_at: '2026-08-09T00:00:00Z',
  updated_at: '2026-08-09T00:00:00Z',
} as GeologicalFormationResponse

/**
 * The placed CPT column both components draw on.
 *
 * @returns The placed column.
 */
function placedColumn(): PlacedColumn {
  const item = {
    id: 'cpt-1',
    name: 'CPT-1',
    elevation_m: COLUMN_ELEVATION_M,
    epsg: 31370,
    z_epsg: 5710,
  } as unknown as CptListItem
  const proj = {
    item,
    along: 0,
    offset: 0,
    side: 'on' as const,
  } as unknown as ProjectedInvestigation<CptListItem>
  return { kind: 'cpt', proj, trueX: COLUMN_X, nudgedX: COLUMN_X, width: 14, displaced: false }
}

/**
 * Read a numeric SVG geometry attribute.
 *
 * @param el The element.
 * @param name Attribute name.
 * @returns The parsed value, or NaN when absent.
 */
function attr(el: Element, name: string): number {
  return Number(el.getAttribute(name))
}

/**
 * Whether pointer events reach this element, i.e. neither it nor any ancestor up to the
 * SVG root switches them off (the overlay's grips and badges do exactly that).
 *
 * @param el The element.
 * @param root The SVG root to stop at.
 * @returns True when a press on this element's area would hit it.
 */
function pointerEventsLive(el: Element, root: Element): boolean {
  let node: Element | null = el
  while (node !== null) {
    const inline = (node as SVGElement & { style?: CSSStyleDeclaration }).style?.pointerEvents
    if (node.getAttribute('pointer-events') === 'none' || inline === 'none') return false
    // A transform would make the declared x/y meaningless for this hit test. Nothing in
    // either component puts a live hit target under one today; refuse rather than report
    // a confident wrong answer if that ever changes.
    if (node !== root && node.getAttribute('transform') !== null) {
      throw new Error(`hit test cannot resolve a transformed ancestor: ${node.nodeName}`)
    }
    if (node === root) return true
    node = node.parentElement
  }
  return true
}

/**
 * SVG's hit-test rule, applied to the declared geometry: the LAST rect in document order
 * whose box contains the point and whose pointer events are live. Later siblings paint
 * over earlier ones, so last in document order is topmost on screen.
 *
 * @param root The SVG root.
 * @param x Point x, in SVG user units.
 * @param y Point y, in SVG user units.
 * @returns The winning rect, or null when the point is over bare canvas.
 */
function topmostRectAt(root: Element, x: number, y: number): Element | null {
  let winner: Element | null = null
  for (const rect of Array.from(root.querySelectorAll('rect'))) {
    const w = attr(rect, 'width')
    const h = attr(rect, 'height')
    if (!(w > 0) || !(h > 0)) continue
    const rx = attr(rect, 'x')
    const ry = attr(rect, 'y')
    if (x < rx || x > rx + w || y < ry || y > ry + h) continue
    if (!pointerEventsLive(rect, root)) continue
    winner = rect
  }
  return winner
}

/**
 * Render the real stack — both components, unmocked, in SectionPanel's sibling order.
 *
 * @param opts Which fixture to draw.
 * @returns The SVG root, the pan spy on it, and the contact-move spy.
 */
function renderStack(opts: { thin?: boolean } = {}): {
  svg: Element
  svgMouseDown: ReturnType<typeof vi.fn>
  onUpdateContactDepth: ReturnType<typeof vi.fn>
} {
  // SectionPanel starts its PAN from a mousedown handler on the SVG root: anything the
  // overlay swallows and lets bubble becomes a pan instead of the gesture that was aimed at.
  const svgMouseDown = vi.fn()
  const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
  const lithoLayers = opts.thin === true ? THIN_LITHO_LAYERS : LITHO_LAYERS
  const geotechLayers = opts.thin === true ? THIN_GEOTECH_LAYERS : GEOTECH_LAYERS
  const { container } = render(
    <svg onMouseDown={svgMouseDown} data-testid="stack-root">
      <ContactsLayer
        contacts={CONTACTS}
        formations={[FORMATION]}
        placedColumns={[placedColumn()]}
        levelToScreen={levelToScreen}
        plotTop={0}
        plotBottom={2000}
        perColumnBandsFromContacts
        onUpdateContactDepth={onUpdateContactDepth}
        axisMode="geotechnical"
        restatingContactIds={restatingContactIds(geotechLayers, lithoLayers)}
        clampDragToBoundary={(contactId, rawDepthM) => {
          // The REAL rule, not a copy of it. This spec used to re-implement the clamp
          // inline, which meant it went on passing after the rule changed underneath —
          // it kept letting a drag land on a litho contact long after that became the
          // refusal. Only the lookup of the dragged row is local.
          const dragged = geotechLayers.find(l => l.id === contactId)
          const start = dragged?.depth_top_m
          const anchor = dragged?.cpt_id ?? dragged?.borehole_id ?? null
          if (anchor === null || start === undefined) {
            return { depthM: rawDepthM, atLimit: false, release: 'move' as const }
          }
          const cands = (packingSnapCandidates(geotechLayers).get(anchor) ?? []).filter(
            c => c.contactId !== contactId,
          )
          return clampContactDrag(
            start,
            rawDepthM,
            cands,
            restatingContactIds(geotechLayers, lithoLayers),
            0.1,
          )
        }}
      />
      <GeotechBandEditOverlay
        geotechLayers={geotechLayers}
        lithoLayers={lithoLayers}
        placedColumns={[placedColumn()]}
        levelToScreen={levelToScreen}
        plotTop={0}
        plotBottom={2000}
        onRequestSplit={vi.fn()}
        onRequestMerge={vi.fn()}
        onRequestMoveBoundary={vi.fn()}
      />
    </svg>,
  )
  const svg = container.querySelector('[data-testid="stack-root"]')
  if (svg === null) throw new Error('no svg root')
  return { svg, svgMouseDown, onUpdateContactDepth }
}

describe('a press aimed at a litho contact on the geotech axis', () => {
  it('GS51 — reaches the contact drag strip, and drags the contact', () => {
    const { svg, svgMouseDown, onUpdateContactDepth } = renderStack()

    const target = topmostRectAt(svg, COLUMN_X, yAtDepth(3))

    // The band rect used to win these pixels, so the press bubbled to the canvas as a pan.
    expect(target?.getAttribute('data-testid')).toBe('contact-drag-strip')
    expect(target?.getAttribute('data-contact-id')).toBe('g2')

    // And pressing what the hit test resolved really does start the contact drag rather
    // than the canvas pan — the geometry is only worth pinning because of what follows it.
    // Dragged PAST the 5 m packing boundary: a drag that crosses none commits nothing
    // (design §2 — the contact lands on boundaries, not wherever the cursor stopped),
    // so a nudge would prove the press was swallowed and a landing that it was not.
    fireEvent.mouseDown(target!, { clientY: yAtDepth(3), button: 0 })
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientY: yAtDepth(5.4), buttons: 1, bubbles: true }),
      )
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    expect(onUpdateContactDepth).toHaveBeenCalledTimes(1)
    expect(onUpdateContactDepth.mock.calls[0][1]).toBeCloseTo(5, 5)
    expect(svgMouseDown).not.toHaveBeenCalled()
  })

  it('GS52 — while a right-click inside the band still opens the band menu', () => {
    const { svg } = renderStack()

    // Mid-band, 4 m: well clear of both edges whatever the inset is.
    const target = topmostRectAt(svg, COLUMN_X, yAtDepth(4))
    expect(target?.getAttribute('data-testid')).toBe('geotech-band-hit-g2')

    fireEvent.contextMenu(target!, { clientY: yAtDepth(4) })

    expect(document.querySelector('[data-testid="geotech-band-menu-split"]')).not.toBeNull()
  })

  it('GS53 — a band too thin to hold an interior keeps no press target at all', () => {
    // 0.5 m at 10 px/m is 5 px: under twice the inset, so there is no pixel of this band
    // that is not already inside one of the two grab strips on its own boundaries. The
    // band therefore claims none, rather than lying across both of them.
    const { svg } = renderStack({ thin: true })

    expect(svg.querySelector('[data-testid="geotech-band-hit-t2"]')).toBeNull()
    // Its neighbours are 30 px and 55 px tall, so they keep theirs.
    expect(svg.querySelector('[data-testid="geotech-band-hit-t1"]')).not.toBeNull()
    expect(svg.querySelector('[data-testid="geotech-band-hit-t3"]')).not.toBeNull()
    // And the band stays reachable: both its boundaries are packing boundaries, so the
    // merge / drag strips are still there to grab.
    expect(svg.querySelector('[data-testid="geotech-band-boundary-t1"]')).not.toBeNull()
    expect(svg.querySelector('[data-testid="geotech-band-boundary-t2"]')).not.toBeNull()
  })

  it('GS54 — and the overlay still wins the pixels on its OWN boundary', () => {
    // Task 1's clamp (GS42/GS46/GS47) hands the press at a packing boundary to the strip.
    // Insetting the band rect frees pixels; it must not free these ones.
    const { svg } = renderStack()

    const target = topmostRectAt(svg, COLUMN_X, yAtDepth(5))

    expect(target?.getAttribute('data-testid')).toBe('geotech-band-boundary-g2')
  })
})

describe('the dragged contact STOPS at the next packing boundary', () => {
  // Design §2: "It clamps at the NEXT packing boundary in the direction of travel. A
  // single drag can never skip a boundary." The commit path enforced that on RELEASE
  // (planGeotechContactDrag), but the line followed the cursor the whole way there and
  // then jumped back — so the drag showed a landing it was never going to honour, and
  // the only signal that something was refused arrived afterwards, as a toast.
  //
  // The column here carries one packing boundary below the contact, at 5 m. The contact
  // starts at 3 m.

  it('GS59 — a drag released well past the boundary lands ON it, not where the cursor was', () => {
    const { onUpdateContactDepth } = renderStack()

    const strip = document.querySelector('[data-contact-id="g2"][data-testid="contact-drag-strip"]')
    fireEvent.mouseDown(strip!, { clientY: yAtDepth(3), button: 0 })
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientY: yAtDepth(8), buttons: 1, bubbles: true }),
      )
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    expect(onUpdateContactDepth).toHaveBeenCalledTimes(1)
    expect(
      onUpdateContactDepth.mock.calls[0][1],
      'the drag must stop at the 5 m packing boundary, not follow the cursor to 8 m',
    ).toBeCloseTo(5, 5)
  })

  it('GS61 — but a nudge that crosses NO boundary lands where the cursor did', () => {
    // Owner, 2026-08-09: "i want to be able to nudge those solids ... we're refining from
    // geo-litho-geotech, so if we want to refine in the geotech then the rest should move
    // too". Snapping the contact onto the nearest band edge made a small correction
    // impossible — the drag either jumped a whole boundary or did nothing at all.
    //
    // So the boundary is a WALL, not a magnet: anywhere short of it is free.
    const { onUpdateContactDepth } = renderStack()

    const strip = document.querySelector('[data-contact-id="g2"][data-testid="contact-drag-strip"]')
    fireEvent.mouseDown(strip!, { clientY: yAtDepth(3), button: 0 })
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientY: yAtDepth(3.4), buttons: 1, bubbles: true }),
      )
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    expect(onUpdateContactDepth).toHaveBeenCalledTimes(1)
    expect(
      onUpdateContactDepth.mock.calls[0][1],
      'a nudge short of the 5 m boundary must land at 3.4 m, not be snapped onto 5 m',
    ).toBeCloseTo(3.4, 5)
  })

  it('GS60 — and it says so while the cursor is still past it', () => {
    // The clamp is only honest if it is visible DURING the gesture. A landing that
    // silently differs from where the cursor sits is the thing being fixed.
    const { svg } = renderStack()

    const strip = document.querySelector('[data-contact-id="g2"][data-testid="contact-drag-strip"]')
    fireEvent.mouseDown(strip!, { clientY: yAtDepth(3), button: 0 })
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientY: yAtDepth(8), buttons: 1, bubbles: true }),
      )
    })

    expect(
      document.querySelector('[data-testid="contact-drag-clamp-popup"]'),
      'a drag held past the boundary must say it is clamped',
    ).not.toBeNull()

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    expect(svg).toBeTruthy()
  })
})

describe('the padlock answers the cursor, not itself', () => {
  // It used to render at opacity 0 and raise itself from its OWN onMouseEnter, so it
  // appeared only if the cursor found an invisible 9 px glyph beside the column. The old
  // tests passed because they fired the hover on that glyph — the one action a user cannot
  // perform. Owner, 2026-08-09: "no padlock appearing when hovering a solid line".
  //
  // These fire the hover on the GRAB STRIP, which is what the cursor is really over.

  it('GS62 — hovering a litho contact raises its padlock', () => {
    renderStack()
    const strip = document.querySelector('[data-contact-id="g2"][data-testid="contact-drag-strip"]')

    expect(document.querySelector('[data-testid="geotech-contact-marker-g2"]')).toBeNull()
    fireEvent.mouseEnter(strip!)

    expect(document.querySelector('[data-testid="geotech-contact-marker-g2"]')).not.toBeNull()
  })

  it('GS63 — leaving it takes the padlock away again', () => {
    renderStack()
    const strip = document.querySelector('[data-contact-id="g2"][data-testid="contact-drag-strip"]')

    fireEvent.mouseEnter(strip!)
    fireEvent.mouseLeave(strip!)

    expect(document.querySelector('[data-testid="geotech-contact-marker-g2"]')).toBeNull()
  })

  it('GS64 — a PACKING boundary raises none, because it locks nothing', () => {
    // g3's top at 5 m is inside one litho unit. A padlock there would claim the drag edits
    // the litho model, which it does not.
    renderStack()
    const strip = document.querySelector('[data-contact-id="g3"][data-testid="contact-drag-strip"]')

    fireEvent.mouseEnter(strip!)

    expect(document.querySelector('[data-testid="geotech-contact-marker-g3"]')).toBeNull()
  })

  it('GS65 — and it names the consequence, not a redirect', () => {
    renderStack()
    const strip = document.querySelector('[data-contact-id="g2"][data-testid="contact-drag-strip"]')
    fireEvent.mouseEnter(strip!)

    const title = document
      .querySelector('[data-testid="geotech-contact-marker-g2"]')
      ?.querySelector('title')
    expect(title?.textContent).toBe(
      'Lithological contact. Dragging it moves the litho model',
    )
  })
})

describe('the two boundary kinds are told apart by WEIGHT, not only by glyphs', () => {
  // The approved design (spec §5) leads with the line, not the marks beside it: a litho
  // contact is a heavy solid line, an internal packing boundary a thin dashed one. Only
  // the grip and padlock glyphs were built, so every boundary rendered identically and
  // the glyphs carried the whole distinction alone — which is what the owner rejected on
  // dogfeed ("i thought we locked in solid and dashed lines, not these ugly marks").
  //
  // Asserted on the drawn line because that is the thing being claimed. A test that
  // checked only the glyph is exactly the test that let this ship half-built.
  const lineAt = (svg: Element, contactId: string): Element => {
    const el = svg.querySelector(`[data-testid="contact-line-${contactId}"]`)
    if (el === null) throw new Error(`no contact line for ${contactId}`)
    return el
  }

  it('GS56 — a packing boundary is DASHED', () => {
    // g3's top at 5 m sits inside ZAND 3–9: the engineer's own subdivision, draggable.
    const { svg } = renderStack()

    expect(lineAt(svg, 'g3').getAttribute('stroke-dasharray')).toBeTruthy()
  })

  it('GS57 — a restated litho contact is SOLID', () => {
    // g2's top at 3 m is the KLEI/ZAND contact. Ruling 2 locks it as a packing boundary,
    // and §4c makes it draggable as the contact it is — either way it is not the same
    // kind of line as GS56's and must not be drawn like one.
    const { svg } = renderStack()

    expect(lineAt(svg, 'g2').getAttribute('stroke-dasharray')).toBeNull()
  })

  it('GS58 — and the contact is drawn HEAVIER than the packing boundary', () => {
    // Dash alone is a weak signal at working zoom on a column of thin bands; the design
    // says weight carries the meaning, so the two must differ in width as well as style.
    const { svg } = renderStack()

    const contact = Number(lineAt(svg, 'g2').getAttribute('stroke-width'))
    const packing = Number(lineAt(svg, 'g3').getAttribute('stroke-width'))

    expect(contact).toBeGreaterThan(packing)
  })
})

describe('the inset is sized against the strip it has to clear', () => {
  it('GS55 — it is at least the contact strip half-height, or the press lands wrong', () => {
    // `ContactsLayer` grabs a contact within DRAG_HIT_HALF_HEIGHT_PX = 5 px either side of
    // the line. An inset under that leaves part of the strip covered, and a press there
    // goes to the band. Stated as a bound, not a value, so re-tuning the inset upward
    // stays free.
    expect(BAND_HIT_INSET_PX).toBeGreaterThanOrEqual(5)
  })
})
