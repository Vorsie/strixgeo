// Behaviour tests for ContactsLayer — the formation-contact
// polyline overlay on the cross-section.

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type {
  BoreholeListItem,
  FormationContactBatchUpdateEntry,
  FormationContactResponse,
  FormationSurfaceResponse,
  GeologicalFormationResponse,
} from '../../api/client'
import type { ContactCopyPayload, SnapCandidate } from './ContactsLayer'
import type { ProjectedInvestigation } from '../../utils/sectionProjection'
import ContactsLayer from './ContactsLayer'
import type { PlacedColumn } from './utils'
import { nadClassColor, nadClassName } from '../../utils/nadClasses'

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
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
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
    snapDepthsByAnchorId?: ReadonlyMap<string, readonly SnapCandidate[]>
    surfacesByFormationId?: ReadonlyMap<string, FormationSurfaceResponse>
    sectionLine?: { startX: number; startY: number; endX: number; endY: number }
    alongMToScreenX?: (alongM: number) => number
    plotLeft?: number
    plotRight?: number
    referenceFormations?: readonly GeologicalFormationResponse[]
    referenceContacts?: readonly FormationContactResponse[]
    bandFillOpacity?: number
    perColumnBandsFromContacts?: boolean
    contactDragClampMinThicknessM?: number
    onRequestAddLithoSuggestion?: (
      anchorKind: 'cpt' | 'borehole',
      anchorId: string,
      depth_m: number,
      anchorName: string,
      elevationM: number,
    ) => void
    onUnlinkLithoFromGeo?: (id: string) => Promise<void>
    onLinkLithoToGeo?: (id: string) => Promise<void>
    renderFormationSurfaces?: boolean
    axisMode?: 'geological' | 'lithostratigraphic' | 'geotechnical'
    columnBandDisplayAxis?: 'geological' | 'lithostratigraphic' | 'geotechnical'
    correlateMode?: boolean
    onShowLithoUnitStatistics?: (formationId: string) => void
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
        onUnlinkLithoFromGeo={extras.onUnlinkLithoFromGeo}
        onLinkLithoToGeo={extras.onLinkLithoToGeo}
        onBatchUpdateContacts={extras.onBatchUpdateContacts}
        onBatchCreateContacts={extras.onBatchCreateContacts}
        snapDepthsByAnchorId={extras.snapDepthsByAnchorId}
        surfacesByFormationId={extras.surfacesByFormationId}
        sectionLine={extras.sectionLine}
        alongMToScreenX={extras.alongMToScreenX}
        plotLeft={extras.plotLeft}
        plotRight={extras.plotRight}
        referenceFormations={extras.referenceFormations}
        referenceContacts={extras.referenceContacts}
        bandFillOpacity={extras.bandFillOpacity}
        perColumnBandsFromContacts={extras.perColumnBandsFromContacts}
        contactDragClampMinThicknessM={extras.contactDragClampMinThicknessM}
        onRequestAddLithoSuggestion={extras.onRequestAddLithoSuggestion}
        renderFormationSurfaces={extras.renderFormationSurfaces}
        axisMode={extras.axisMode}
        columnBandDisplayAxis={extras.columnBandDisplayAxis}
        correlateMode={extras.correlateMode}
        onShowLithoUnitStatistics={extras.onShowLithoUnitStatistics}
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

  it('geotech per-column bands use the NAD packing colour, not the stored lithology colour', () => {
    // Geotech formation: stored ``color`` is the base lithology colour (every sand
    // the same yellow), but the band must render the NAD colour for its nad_class
    // so the column agrees with the NAD-coloured fill overlay beside it.
    const geotechFormation = makeFormation({ id: 'f-nad6', color: '#fbbf24', nad_class: 6 })
    const contacts = [
      makeContact({ id: 'c-1', formation_id: 'f-nad6', borehole_id: 'bh-1', depth_top_m: 2 }),
    ]
    const { container } = renderLayer(
      contacts,
      [geotechFormation],
      [makeBoreholePlaced('bh-1', 50)],
      undefined,
      { perColumnBandsFromContacts: true, axisMode: 'geotechnical' },
    )
    const band = container.querySelector(
      '[data-testid^="per-column-litho-band-"]',
    ) as SVGRectElement | null
    expect(band).not.toBeNull()
    expect(band?.getAttribute('fill')).toBe(nadClassColor(6))
    expect(band?.getAttribute('fill')).not.toBe('#fbbf24')
  })

  it('the column stack follows the fill that is actually painted, not the axis', () => {
    // Owner: the section has to read as one continuous geology. On the geotech
    // axis with "Show litho fill" swapped in, the gaps paint lithology colours —
    // so the columns beside them must paint lithology colours too, or the fill
    // changes identity at every column edge.
    const geotechFormation = makeFormation({ id: 'f-nad6', color: '#fbbf24', nad_class: 6 })
    const contacts = [
      makeContact({ id: 'c-1', formation_id: 'f-nad6', borehole_id: 'bh-1', depth_top_m: 2 }),
    ]
    const { container } = renderLayer(
      contacts,
      [geotechFormation],
      [makeBoreholePlaced('bh-1', 50)],
      undefined,
      {
        perColumnBandsFromContacts: true,
        axisMode: 'geotechnical',
        columnBandDisplayAxis: 'lithostratigraphic',
      },
    )
    const band = container.querySelector(
      '[data-testid^="per-column-litho-band-"]',
    ) as SVGRectElement | null
    expect(band?.getAttribute('fill')).toBe('#fbbf24')
    expect(band?.getAttribute('fill')).not.toBe(nadClassColor(6))
  })

  it('geotech band label uses the NAD packing name once a class is assigned', () => {
    // Stored name is the lithology ("SAND"); after subdivision the band label
    // must read the NAD packing class ("SAND, dense" for nad_class 7).
    const geotechFormation = makeFormation({
      id: 'f-nad7',
      color: '#fbbf24',
      nad_class: 7,
      name: 'SAND',
    })
    const contacts = [
      makeContact({ id: 'c-1', formation_id: 'f-nad7', borehole_id: 'bh-1', depth_top_m: 2 }),
    ]
    const { container } = renderLayer(
      contacts,
      [geotechFormation],
      [makeBoreholePlaced('bh-1', 50)],
      undefined,
      { perColumnBandsFromContacts: true, axisMode: 'geotechnical' },
    )
    const titles = [...container.querySelectorAll('title')].map(t => t.textContent)
    expect(titles).toContain(nadClassName(7)) // "SAND, dense"
    expect(titles).not.toContain('SAND') // the bare lithology name is replaced
  })

  it('geotech band keeps the lithology name when not yet classified (nad_class null)', () => {
    const unclassified = makeFormation({ id: 'f-x', nad_class: null, name: 'CLAY' })
    const contacts = [
      makeContact({ id: 'c-1', formation_id: 'f-x', borehole_id: 'bh-1', depth_top_m: 2 }),
    ]
    const { container } = renderLayer(
      contacts,
      [unclassified],
      [makeBoreholePlaced('bh-1', 50)],
      undefined,
      { perColumnBandsFromContacts: true, axisMode: 'geotechnical' },
    )
    const titles = [...container.querySelectorAll('title')].map(t => t.textContent)
    expect(titles).toContain('CLAY') // falls back to lithology before subdivision
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

  // ---- Litho-axis contact-marker dot gating (owner directive 2026-06-05) ----
  //
  // The coupling-glyph amber circles rendered per coupled contact are noise on
  // the litho axis when the partition fill is the primary interaction surface.
  // Rule: hidden when axisMode='lithostratigraphic' AND NOT correlating; shown
  // when correlating (contacts are clickable for the correlate gesture).

  it('AM1 — litho axis, not correlating → coupling-glyph circles hidden', () => {
    // A coupled contact (parent_geo_contact_id set) on the litho axis without
    // correlate mode should NOT render the coupling glyph circles.
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3, parent_geo_contact_id: 'geo-c-1' }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation()],
      [makeBoreholePlaced('bh-1', 50)],
      undefined,
      { axisMode: 'lithostratigraphic', correlateMode: false },
    )
    // The coupling glyph carries a testid starting with 'coupling-glyph-'.
    expect(container.querySelectorAll('[data-testid^="coupling-glyph-"]').length).toBe(0)
  })

  it('AM2 — litho axis + correlating → coupling-glyph circles present', () => {
    // Correlate mode lifts the gate so contacts are clickable for correlate.
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3, parent_geo_contact_id: 'geo-c-1' }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation()],
      [makeBoreholePlaced('bh-1', 50)],
      undefined,
      { axisMode: 'lithostratigraphic', correlateMode: true },
    )
    expect(container.querySelectorAll('[data-testid^="coupling-glyph-"]').length).toBe(1)
  })

  it('AM3 — geology axis → coupling-glyph circles present regardless of correlateMode', () => {
    // Geological axis always shows the glyph (the full contact-marker set).
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3, parent_geo_contact_id: 'geo-c-1' }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation()],
      [makeBoreholePlaced('bh-1', 50)],
      undefined,
      { axisMode: 'geological', correlateMode: false },
    )
    expect(container.querySelectorAll('[data-testid^="coupling-glyph-"]').length).toBe(1)
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

  // #143 — litho contact boundary lines must read against their own band.
  // A litho band is filled with the formation's lithology colour; drawing
  // the boundary line in that same colour makes the accepted contact
  // disappear into the band. Litho contacts get a near-black line + a
  // light halo (so it also reads on the dark KLEI/VEEN bands); geological
  // contacts keep the formation-coloured line.
  describe('litho contact line visibility (#143)', () => {
    it('draws a litho contact boundary in near-black with a light halo, not the band colour', () => {
      const lithoFormation = makeFormation({
        id: 'f-litho',
        litho_main_soil_code: 'KLEI',
        color: '#6b7280', // blue-grey clay — identical to the band fill
      })
      const contacts = [
        makeContact({ id: 'c-1', formation_id: 'f-litho', borehole_id: 'bh-1', depth_top_m: 3 }),
      ]
      const { container } = renderLayer(contacts, [lithoFormation], [makeBoreholePlaced('bh-1', 50)])
      const line = container.querySelector('[data-testid="contact-line-c-1"]')
      expect(line).not.toBeNull()
      // Not drawn in the band colour — that is exactly what made it vanish.
      expect(line!.getAttribute('stroke')).not.toBe('#6b7280')
      expect(line!.getAttribute('stroke')).toBe('#0f172a')
      // Light halo behind the line so it reads on the dark bands too.
      const halo = container.querySelector('[data-testid="contact-line-halo-c-1"]')
      expect(halo).not.toBeNull()
      expect(halo!.getAttribute('stroke')).toBe('#f8fafc')
    })

    it('leaves a geological contact line in the formation colour, with no halo', () => {
      const geoFormation = makeFormation({
        id: 'f-geo',
        litho_main_soil_code: null,
        color: '#ff8800',
      })
      const contacts = [
        makeContact({ id: 'c-1', formation_id: 'f-geo', borehole_id: 'bh-1', depth_top_m: 3 }),
      ]
      const { container } = renderLayer(contacts, [geoFormation], [makeBoreholePlaced('bh-1', 50)])
      const line = container.querySelector('[data-testid="contact-line-c-1"]')
      expect(line!.getAttribute('stroke')).toBe('#ff8800')
      expect(container.querySelector('[data-testid="contact-line-halo-c-1"]')).toBeNull()
    })
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
    // Each label <text> now carries a <title> child (the full-name
    // hover tooltip), so assert on the visible (non-title) text node
    // and on the tooltip separately rather than textContent (which
    // would concatenate title + label).
    const texts = Array.from(container.querySelectorAll('text'))
    const labels = texts.filter(
      t => t.querySelector('title')?.textContent === 'X',
    )
    expect(labels.length).toBe(2)
    for (const t of labels) {
      const visible = Array.from(t.childNodes)
        .filter(n => n.nodeType === 3 /* TEXT_NODE */)
        .map(n => n.textContent)
        .join('')
      expect(visible).toBe('X')
    }
  })

  it('exposes the full untruncated formation name in a hover <title>', () => {
    // Long name + the fixture's narrow (~14 px) column → the visible
    // label truncates with an ellipsis, but the <title> must still
    // carry the complete string so the engineer can tell e.g.
    // "Lid van Aalbeke" from "Lid van Roubaix".
    const fullName = 'Paleogeen: Formatie van Kortrijk - Lid van Aalbeke'
    const contacts = [makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 })]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: fullName })],
      [makeBoreholePlaced('bh-1', 50)],
    )
    const titles = Array.from(container.querySelectorAll('title')).map(
      t => t.textContent,
    )
    expect(titles).toContain(fullName)
    // The visible label is truncated (does not equal the full name).
    const labelText = container.querySelector('text')
    const visible = Array.from(labelText?.childNodes ?? [])
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent)
      .join('')
    expect(visible).not.toBe(fullName)
    expect(visible.length).toBeLessThan(fullName.length)
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
    const snapDepthsByAnchorId = new Map<string, readonly SnapCandidate[]>([
      ['bh-1', [{ depth: 10 }]],
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

  // Debt #136 — manual contact drag should snap to OTHER committed
  // contacts on the same anchor.  Before the fix snap-depth candidates
  // were sourced from borehole stratigraphy only, so dragging onto a
  // neighbouring committed contact's depth never engaged the snap.
  it('S-SC1: drag snaps to a committed contact on the same anchor', () => {
    // pxPerMetre = 1.  Dragging contact c-1 from depth=3 down by 5 px
    // (raw depth = 8).  Committed contact c-2 sits at depth=10 → 2 m
    // (= 2 px) away from the raw drag depth, inside SNAP_TOLERANCE_PX=8.
    // Commit should land on 10.
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
      makeContact({ id: 'c-2', borehole_id: 'bh-1', depth_top_m: 10 }),
    ]
    const snapDepthsByAnchorId = new Map<string, readonly SnapCandidate[]>([
      // Tagged with contactId so the snap fn can exclude the dragger
      // from its own candidate set (see S-SC2).
      [
        'bh-1',
        [
          { depth: 3, contactId: 'c-1' },
          { depth: 10, contactId: 'c-2' },
        ],
      ],
    ])
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onUpdateContactDepth, snapDepthsByAnchorId },
    )
    // Grab the strip belonging to c-1 (the contact at depth=3) — there
    // are now two strips, one per contact.
    const stripC1 = container.querySelector(
      '[data-testid="contact-drag-strip"][data-contact-id="c-1"]',
    )!
    expect(stripC1).not.toBeNull()
    fireEvent.mouseDown(stripC1, { clientY: 0, button: 0 })
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

  it('S-SC2: drag does NOT self-snap to the dragged contact own depth', () => {
    // Dragging c-1 (depth=3) by 4 px → raw depth = 7.  c-1's own depth (3)
    // is 4 m away → 4 px → INSIDE snap tolerance, so without suppression
    // the snap would pull it back to 3 (no-op) and the user could not
    // budge the contact off its starting depth.  The fix excludes the
    // dragger's own id from the candidate list.
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 3 }),
    ]
    const snapDepthsByAnchorId = new Map<string, readonly SnapCandidate[]>([
      ['bh-1', [{ depth: 3, contactId: 'c-1' }]],
    ])
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onUpdateContactDepth, snapDepthsByAnchorId },
    )
    const stripC1 = container.querySelector(
      '[data-testid="contact-drag-strip"][data-contact-id="c-1"]',
    )!
    fireEvent.mouseDown(stripC1, { clientY: 0, button: 0 })
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientY: 4, buttons: 1, bubbles: true }),
      )
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    expect(onUpdateContactDepth).toHaveBeenCalledTimes(1)
    // Commit should land on the RAW depth (7), not the dragger's own
    // pre-drag depth (3).
    expect(onUpdateContactDepth.mock.calls[0][1]).toBeCloseTo(7, 5)
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

  it('right-click + confirm-dialog confirms fires onDeleteContact with the contact id', () => {
    const onDeleteContact = vi.fn().mockResolvedValue(undefined)
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
    // Clicking "Delete contact" now opens the styled confirm dialog
    // (debt #62 item 1) instead of firing window.confirm.
    act(() => {
      strip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    })
    const menu = document.body.querySelector('[data-testid="contact-context-menu"]')!
    const menuDeleteBtn = Array.from(menu.querySelectorAll('button')).find(
      b => b.textContent?.trim() === 'Delete contact',
    )!
    act(() => {
      fireEvent.click(menuDeleteBtn)
    })
    // The dialog now renders; find its "Delete contact" button and
    // click to confirm. There are two buttons with the same label
    // (menu item + dialog action); the menu closed on click so only
    // the dialog's remains.
    const dialogDeleteBtn = Array.from(
      document.body.querySelectorAll('button'),
    ).find(b => b.textContent?.trim() === 'Delete contact')!
    act(() => {
      fireEvent.click(dialogDeleteBtn)
    })
    expect(onDeleteContact).toHaveBeenCalledTimes(1)
    expect(onDeleteContact.mock.calls[0][0]).toBe('c-7')
  })

  it('right-click + confirm-dialog cancel does NOT fire onDeleteContact', () => {
    const onDeleteContact = vi.fn().mockResolvedValue(undefined)
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
    act(() => {
      strip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    })
    const menu = document.body.querySelector('[data-testid="contact-context-menu"]')!
    const menuDeleteBtn = Array.from(menu.querySelectorAll('button')).find(
      b => b.textContent?.trim() === 'Delete contact',
    )!
    act(() => {
      fireEvent.click(menuDeleteBtn)
    })
    // Dialog opens; click Cancel — onDeleteContact must NOT fire.
    const cancelBtn = Array.from(
      document.body.querySelectorAll('button'),
    ).find(b => b.textContent?.trim() === 'Cancel')!
    act(() => {
      fireEvent.click(cancelBtn)
    })
    expect(onDeleteContact).not.toHaveBeenCalled()
  })

  it('right-click hides the Delete item entirely when onDeleteContact is absent', () => {
    // No delete handler → the context menu hides the Delete item so
    // there is no path that could ever open the confirm dialog.
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
    act(() => {
      strip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    })
    const menu = document.body.querySelector('[data-testid="contact-context-menu"]')
    // Menu may render (for pinch-out / other actions) but no Delete
    // contact item is visible.
    const deleteItem =
      menu &&
      Array.from(menu.querySelectorAll('button')).find(
        b => b.textContent?.trim() === 'Delete contact',
      )
    expect(deleteItem).toBeFalsy()
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

  it('draws the surface through placed picks, not a TIN slice at the section line', () => {
    // The middle/right picks sit at DIFFERENT depths than the flat z=9
    // TIN surface, so a slice (flat at screenY 11) and a chord-through-
    // picks line diverge: the pick at depth 4 lands at screenY 14
    // (flipped = 20-(10-4)). The line must pass through 14 (the pick)
    // and the polyline must read as a BUILT surface (solid, opacity
    // 0.7) — not the dashed "unbuilt" fallback. Mirrors the placed-
    // boundaries-are-truth rule the backdrop already follows via
    // referenceContacts (dogfeed 2026-05-29).
    const formation = makeFormation({ id: 'f', color: '#ff0000' })
    const contacts = [
      makeContact({ id: 'c1', borehole_id: 'bh-1', formation_id: 'f', depth_top_m: 1 }),
      makeContact({ id: 'c2', borehole_id: 'bh-2', formation_id: 'f', depth_top_m: 4 }),
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
        surfacesByFormationId: new Map([['f', surface]]),
        sectionLine: { startX: -10, startY: 0, endX: 110, endY: 0 },
        alongMToScreenX: along => along + 10,
      },
    )
    // The surface IS the through-picks contact polyline.
    const poly = container.querySelector('[data-testid="formation-polyline-f"]')
    expect(poly).not.toBeNull()
    // It passes through the depth-4 pick at screenY 14 — a flat TIN
    // slice (screenY 11 everywhere) never would.
    expect(poly!.getAttribute('d')).toContain('14.00')
    // Built + fresh surface → solid, opacity 0.7, no dash (NOT the
    // dashed 0.55 "unbuilt" fallback).
    expect(poly!.getAttribute('stroke-opacity')).toBe('0.7')
    expect(poly!.getAttribute('stroke-dasharray')).toBeNull()
  })

  it('renders the stale-surface polyline dashed + opacity 0.35', () => {
    // Same setup but is_stale=true → demoted style on the
    // through-picks polyline.
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
    const poly = container.querySelector('[data-testid="formation-polyline-f"]')
    expect(poly).not.toBeNull()
    expect(poly!.getAttribute('stroke-opacity')).toBe('0.35')
    expect(poly!.getAttribute('stroke-dasharray')).toBe('6 3')
  })

  // -------------------------------------------------------------------------
  // renderFormationSurfaces gate (#159-followup, owner dogfeed 2026-05-29).
  // The active model's cross-column formation surfaces (through-picks
  // polylines) group BY FORMATION, auto-joining same-lithology
  // contacts across columns regardless of the explicit correlation graph.
  // Correct on the geological axis; clutter on the litho axis (a real
  // section produced 13 spurious connect-the-dots lines). SectionPanel
  // passes renderFormationSurfaces=false on the litho axis.
  // -------------------------------------------------------------------------

  it('FS1 — suppresses active-model surface polylines when renderFormationSurfaces=false', () => {
    const formation = makeFormation({ id: 'f', color: '#ff0000' })
    const contacts = [
      makeContact({ id: 'c1', borehole_id: 'bh-1', formation_id: 'f', depth_top_m: 2 }),
      makeContact({ id: 'c2', borehole_id: 'bh-2', formation_id: 'f', depth_top_m: 3 }),
      makeContact({ id: 'c3', borehole_id: 'bh-3', formation_id: 'f', depth_top_m: 3 }),
    ]
    // A built surface exists → the surface polyline would normally fire.
    const surface: FormationSurfaceResponse = {
      id: 's',
      model_id: 'm',
      formation_id: 'f',
      method: 'tin',
      vertices: [
        [0, -2, 9],
        [50, -2, 9],
        [25, 5, 9],
      ],
      triangles: [[0, 1, 2]],
      source_contact_count: 3,
      is_stale: false,
      created_at: '2026-05-14T00:00:00Z',
      updated_at: '2026-05-14T00:00:00Z',
    }
    const { container } = renderLayer(
      contacts,
      [formation],
      [
        makeBoreholePlaced('bh-1', 0),
        makeBoreholePlaced('bh-2', 50),
        makeBoreholePlaced('bh-3', 100),
      ],
      undefined,
      {
        renderFormationSurfaces: false,
        surfacesByFormationId: new Map([['f', surface]]),
        sectionLine: { startX: -10, startY: 0, endX: 110, endY: 0 },
        alongMToScreenX: along => along + 10,
      },
    )
    // The active-model surface renderer is gated off.
    expect(container.querySelector('[data-testid="formation-polyline-f"]')).toBeNull()
  })

  it('FS2 — renders active-model surfaces by default (geological axis unchanged)', () => {
    const formation = makeFormation({ id: 'f', color: '#ff0000' })
    const contacts = [
      makeContact({ id: 'c1', borehole_id: 'bh-1', formation_id: 'f', depth_top_m: 2 }),
      makeContact({ id: 'c2', borehole_id: 'bh-2', formation_id: 'f', depth_top_m: 3 }),
      makeContact({ id: 'c3', borehole_id: 'bh-3', formation_id: 'f', depth_top_m: 3 }),
    ]
    const surface: FormationSurfaceResponse = {
      id: 's',
      model_id: 'm',
      formation_id: 'f',
      method: 'tin',
      vertices: [
        [0, -2, 9],
        [50, -2, 9],
        [25, 5, 9],
      ],
      triangles: [[0, 1, 2]],
      source_contact_count: 3,
      is_stale: false,
      created_at: '2026-05-14T00:00:00Z',
      updated_at: '2026-05-14T00:00:00Z',
    }
    const { container } = renderLayer(
      contacts,
      [formation],
      [
        makeBoreholePlaced('bh-1', 0),
        makeBoreholePlaced('bh-2', 50),
        makeBoreholePlaced('bh-3', 100),
      ],
      undefined,
      {
        // renderFormationSurfaces omitted → defaults true.
        surfacesByFormationId: new Map([['f', surface]]),
        sectionLine: { startX: -10, startY: 0, endX: 110, endY: 0 },
        alongMToScreenX: along => along + 10,
      },
    )
    expect(container.querySelector('[data-testid="formation-polyline-f"]')).not.toBeNull()
  })

  it('fill band reaches every anchor with a contact', () => {
    // Real-world dogfeed: Paleogeen has contacts on cols 1, 2, 3, 5;
    // col 4 has no contact (unobserved). The fill geometry comes from
    // the through-picks polyline, which visits EVERY column with a
    // contact — so the fill must reach col 5's anchor even across the
    // unobserved gap.
    const formation = makeFormation({ id: 'f', color: '#ff8800' })
    const contacts = [
      makeContact({ id: 'c1', borehole_id: 'bh-1', formation_id: 'f', depth_top_m: 3 }),
      makeContact({ id: 'c2', borehole_id: 'bh-2', formation_id: 'f', depth_top_m: 4 }),
      makeContact({ id: 'c3', borehole_id: 'bh-3', formation_id: 'f', depth_top_m: 5 }),
      makeContact({ id: 'c5', borehole_id: 'bh-5', formation_id: 'f', depth_top_m: 8 }),
    ]
    // TIN covers only cols 1-3 worth (trim removed col-5 corner).
    // Slice X extent ≈ screen-X [10, 70] — well short of bh-5 at 110.
    const surface: FormationSurfaceResponse = {
      id: 's',
      model_id: 'm',
      formation_id: 'f',
      method: 'tin',
      vertices: [
        [0, -2, 7],
        [60, -2, 6],
        [30, 5, 5],
      ],
      triangles: [[0, 1, 2]],
      source_contact_count: 3,
      is_stale: false,
      created_at: '2026-05-14T00:00:00Z',
      updated_at: '2026-05-14T00:00:00Z',
    }
    const { container } = renderLayer(
      contacts,
      [formation],
      [
        makeBoreholePlaced('bh-1', 0),
        makeBoreholePlaced('bh-2', 30),
        makeBoreholePlaced('bh-3', 60),
        // No bh-4 — gap = the unobserved column.
        makeBoreholePlaced('bh-5', 110),
      ],
      undefined,
      {
        surfacesByFormationId: new Map([['f', surface]]),
        sectionLine: { startX: -10, startY: 0, endX: 130, endY: 0 },
        alongMToScreenX: along => along + 10,
        plotLeft: 0,
        plotRight: 200,
      },
    )
    const fill = container.querySelector('[data-testid="formation-fill-f"]')
    expect(fill).not.toBeNull()
    const d = fill!.getAttribute('d')!
    // The fill's path must include the bh-5 anchor X (screen-x = 110,
    // ``makeBoreholePlaced`` takes screen-X directly so anchors are
    // not shifted by alongMToScreenX) on the top edge.
    expect(d).toMatch(/[ML] 110\.00 /)
  })

  it('renders a snap-to-contact backdrop polyline when referenceContacts provided', () => {
    // The litho-axis backdrop should pass EXACTLY through every
    // geological contact's anchor position, not through the TIN
    // slice (which diverges due to the 3D→2D projection error when
    // investigations are offset from the section line).
    const refFormation = makeFormation({ id: 'geo-f', color: '#5fb3d6' })
    const refContacts = [
      makeContact({ id: 'rc1', borehole_id: 'bh-1', formation_id: 'geo-f', depth_top_m: 3 }),
      makeContact({ id: 'rc2', borehole_id: 'bh-2', formation_id: 'geo-f', depth_top_m: 5 }),
    ]
    const { container } = renderLayer(
      [],
      [],
      [makeBoreholePlaced('bh-1', 50), makeBoreholePlaced('bh-2', 150)],
      undefined,
      {
        referenceFormations: [refFormation],
        referenceContacts: refContacts,
      },
    )
    const path = container.querySelector('[data-testid="backdrop-contact-geo-f"]')
    expect(path).not.toBeNull()
    const d = path!.getAttribute('d')!
    // Polyline must include both anchor X positions (50, 150). With
    // surface elevation = 10 and depth = 3 / 5, elevation = 7 / 5,
    // levelToScreen(7) = 13, levelToScreen(5) = 15.
    expect(d).toMatch(/M 50\.00 13\.00 /)
    expect(d).toMatch(/L 150\.00 15\.00/)
  })

  it('omits the snap-to-contact backdrop when referenceContacts is absent', () => {
    const refFormation = makeFormation({ id: 'geo-f' })
    const { container } = renderLayer(
      [],
      [],
      [makeBoreholePlaced('bh-1', 50)],
      undefined,
      { referenceFormations: [refFormation] }, // contacts omitted
    )
    expect(
      container.querySelector('[data-testid="backdrop-contact-geo-f"]'),
    ).toBeNull()
  })

  it('extends polyline laterally to plotLeft / plotRight (halfspace extrapolation)', () => {
    // Contacts on cols at screen-X 50 and 150. Plot bounds set to
    // 0..200 → the rendered polyline path must include vertices at
    // x=0 and x=200 (the synthetic halfspace endpoints) so the
    // formation line "draws through" past the outermost anchor.
    // gINT / LeapFrog convention.
    const formation = makeFormation({ id: 'f', color: '#ff0000' })
    const contacts = [
      makeContact({ id: 'c1', borehole_id: 'bh-1', formation_id: 'f', depth_top_m: 1 }),
      makeContact({ id: 'c2', borehole_id: 'bh-2', formation_id: 'f', depth_top_m: 1 }),
    ]
    const { container } = renderLayer(
      contacts,
      [formation],
      [makeBoreholePlaced('bh-1', 50), makeBoreholePlaced('bh-2', 150)],
      undefined,
      { plotLeft: 0, plotRight: 200 },
    )
    const poly = container.querySelector('[data-testid="formation-polyline-f"]')
    expect(poly).not.toBeNull()
    const d = poly!.getAttribute('d')!
    // First vertex must be the synthetic plotLeft (x=0), last must be
    // the synthetic plotRight (x=200). Path is "M 0.00 ... L ... L 200.00 ...".
    expect(d.startsWith('M 0.00 ')).toBe(true)
    expect(d).toMatch(/L 200\.00 /)
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

  it('PC1: renders per-column litho bands between adjacent contacts (debt #142 follow-up)', () => {
    // Dogfeed 2026-05-27 — the post-#142 hide of accepted ghosts
    // removed the colour fill on litho-axis CPT columns.  TIN-based
    // formationFillBands need a built surface to produce geometry;
    // on a litho-axis CPT without a built litho TIN the band cell is
    // empty.  Per-column bands render a coloured rect between
    // adjacent committed contacts on each investigation, sourcing
    // colour from the formation's ``color`` field.  Independent of
    // any TIN slice.
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 0, formation_id: 'f-sand' }),
      makeContact({ id: 'c-2', borehole_id: 'bh-1', depth_top_m: 3, formation_id: 'f-clay' }),
    ]
    const formations = [
      makeFormation({ id: 'f-sand', name: 'SAND', color: '#fbbf24' }),
      makeFormation({ id: 'f-clay', name: 'CLAY', color: '#64748b' }),
    ]
    const { container } = renderLayer(
      contacts,
      formations,
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { perColumnBandsFromContacts: true },
    )
    // Two bands: one between c-1 and c-2 (SAND), one below c-2
    // extending to total_depth_m=30 (CLAY).  The bottom-extension
    // band was added in the 2026-05-27 dogfeed follow-up — without
    // it the deepest litho unit had no rect ("bottom layer not
    // rendered").
    const bands = container.querySelectorAll('[data-testid^="per-column-litho-band-"]')
    expect(bands.length).toBe(2)
    // First band: shallower contact's formation (SAND).
    expect(bands[0].getAttribute('fill')).toBe('#fbbf24')
    // Bottom-extension band uses the LAST contact's formation (CLAY).
    expect(bands[1].getAttribute('fill')).toBe('#64748b')
  })

  it('PC2: per-column bands are absent when the prop is off (default)', () => {
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 0, formation_id: 'f-sand' }),
      makeContact({ id: 'c-2', borehole_id: 'bh-1', depth_top_m: 3, formation_id: 'f-clay' }),
    ]
    const formations = [
      makeFormation({ id: 'f-sand', name: 'SAND' }),
      makeFormation({ id: 'f-clay', name: 'CLAY' }),
    ]
    const { container } = renderLayer(
      contacts,
      formations,
      [makeBoreholePlaced('bh-1', 100)],
      // perColumnBandsFromContacts omitted → false.
    )
    expect(
      container.querySelectorAll('[data-testid^="per-column-litho-band-"]').length,
    ).toBe(0)
  })

  // Debt #151 — right-click verbs on the litho column: "Remove" on
  // a band, "Add new suggestion" on empty area.  Both halves share
  // the same context menu surface; only the visible item changes.
  it('LB1: right-click on a per-column litho band opens the "Remove" menu', () => {
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 1, formation_id: 'f-sand' }),
      makeContact({ id: 'c-2', borehole_id: 'bh-1', depth_top_m: 5, formation_id: 'f-clay' }),
    ]
    const formations = [
      makeFormation({ id: 'f-sand', name: 'SAND' }),
      makeFormation({ id: 'f-clay', name: 'CLAY' }),
    ]
    const { container } = renderLayer(
      contacts,
      formations,
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      // The delete handler is the menu's precondition — the menu's only item opens the
      // delete-confirm dialog, which is itself gated on it.
      { perColumnBandsFromContacts: true, onDeleteContact: vi.fn().mockResolvedValue(undefined) },
    )
    const band = container.querySelector(
      '[data-testid^="per-column-litho-band-"]',
    )!
    fireEvent.contextMenu(band, { clientX: 100, clientY: 30 })
    const menu = screen.queryByTestId('litho-band-context-menu')
    expect(menu).not.toBeNull()
    expect(menu).toHaveTextContent(/remove/i)
  })

  it('LB-THIN: a thin band gets invisible donated hit strips inside its fat neighbours (#158)', () => {
    // 1 px = 1 m at this scale. SAND 1–16 m (15px fat) / CLAY 16–19 m (3px
    // THIN) / SAND 19 m–TD (fat). The thin CLAY wants (12−3)/2 = 4.5px per
    // side; the SAND above can only donate its slack (15−12)/2 = 1.5px, the
    // SAND below donates the full 4.5. Right-clicking a donated strip opens
    // the THIN band's remove menu — before #158 that click landed on the fat
    // neighbour (the owner mis-clicked one band low twice in one week).
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 1, formation_id: 'f-sand' }),
      makeContact({ id: 'c-2', borehole_id: 'bh-1', depth_top_m: 16, formation_id: 'f-clay' }),
      makeContact({ id: 'c-3', borehole_id: 'bh-1', depth_top_m: 19, formation_id: 'f-sand' }),
    ]
    const formations = [
      makeFormation({ id: 'f-sand', name: 'SAND' }),
      makeFormation({ id: 'f-clay', name: 'CLAY' }),
    ]
    // The helper's default TD (30 m) would leave the bottom SAND at 11px —
    // itself under the 12px minimum and so (correctly) unable to donate.
    // Deepen it so the lower neighbour is honestly fat (19–40 → 21px,
    // slack (21−12)/2 = 4.5 — exactly the thin band's ask).
    const placed = makeBoreholePlaced('bh-1', 100)
    ;(placed.proj.item as { total_depth_m: number | null }).total_depth_m = 40
    const { container } = renderLayer(
      contacts,
      formations,
      [placed],
      undefined,
      { perColumnBandsFromContacts: true, onDeleteContact: vi.fn().mockResolvedValue(undefined) },
    )
    const strips = container.querySelectorAll('[data-testid^="per-column-litho-band-hit-"]')
    expect(strips.length).toBeGreaterThanOrEqual(2)
    // The strip below the thin band borrows 4.5px from the fat SAND under it.
    const below = container.querySelector('[data-testid="per-column-litho-band-hit-bh-1-c-2-below"]')!
    expect(below).not.toBeNull()
    expect(Number(below.getAttribute('height'))).toBeCloseTo(4.5, 1)
    fireEvent.contextMenu(below, { clientX: 100, clientY: 30 })
    // The menu itself is generic ("Remove this litho unit"); the proof the
    // strip belongs to the THIN band is the confirm dialog naming CLAY, not
    // the fat SAND the pointer is visually inside.
    fireEvent.click(screen.getByTestId('litho-band-remove'))
    const dialog = screen.queryByTestId('delete-contact-confirm-dialog')
    expect(dialog).not.toBeNull()
    expect(dialog).toHaveTextContent(/CLAY/)
  })

  // Owner ruling R1 (2026-08-27): right-click a litho unit on the section
  // litho axis → "Unit statistics…" → Parameters scoped to that LITHO unit.
  it('LB-US1: the litho band menu offers "Unit statistics…" and reports the FORMATION id', () => {
    const onShowLithoUnitStatistics = vi.fn()
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 1, formation_id: 'f-sand' }),
      makeContact({ id: 'c-2', borehole_id: 'bh-1', depth_top_m: 5, formation_id: 'f-clay' }),
    ]
    const formations = [
      makeFormation({ id: 'f-sand', name: 'SAND' }),
      makeFormation({ id: 'f-clay', name: 'CLAY' }),
    ]
    const { container } = renderLayer(
      contacts,
      formations,
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      {
        perColumnBandsFromContacts: true,
        onDeleteContact: vi.fn().mockResolvedValue(undefined),
        onShowLithoUnitStatistics,
      },
    )
    // The FIRST band is the SAND unit (between c-1 and c-2).
    const band = container.querySelector('[data-testid^="per-column-litho-band-"]')!
    fireEvent.contextMenu(band, { clientX: 100, clientY: 30 })
    fireEvent.click(screen.getByTestId('litho-band-menu-unit-statistics'))

    expect(onShowLithoUnitStatistics).toHaveBeenCalledWith('f-sand')
    // The jump closes the menu.
    expect(screen.queryByTestId('litho-band-context-menu')).toBeNull()
  })

  it('LB-US2: the statistics handler alone is enough to open the band menu', () => {
    // The menu used to be gated on the DELETE handler only; a surface wired
    // for the jump but not for deletion must still answer the right-click.
    const onShowLithoUnitStatistics = vi.fn()
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 1, formation_id: 'f-sand' }),
      makeContact({ id: 'c-2', borehole_id: 'bh-1', depth_top_m: 5, formation_id: 'f-clay' }),
    ]
    const formations = [
      makeFormation({ id: 'f-sand', name: 'SAND' }),
      makeFormation({ id: 'f-clay', name: 'CLAY' }),
    ]
    const { container } = renderLayer(
      contacts,
      formations,
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { perColumnBandsFromContacts: true, onShowLithoUnitStatistics },
    )
    const band = container.querySelector('[data-testid^="per-column-litho-band-"]')!
    fireEvent.contextMenu(band, { clientX: 100, clientY: 30 })

    expect(screen.getByTestId('litho-band-context-menu')).toBeTruthy()
    expect(screen.getByTestId('litho-band-menu-unit-statistics')).toBeTruthy()
    // ...but no Remove item without its handler — the no-affordance rule.
    expect(screen.queryByTestId('litho-band-remove')).toBeNull()
  })

  it('LB-US4: without the statistics handler the menu carries no jump (litho fill is not accessible from the geotech stage)', () => {
    // S7a (owner 2026-08-27): "Litho fill shouldn't be accesible in the
    // geotech stage." The geotech axis simply never passes the
    // litho-statistics handler — so even where ANOTHER item legitimately
    // opens this menu, no unit-statistics jump is offered.
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 1, formation_id: 'f-sand' }),
      makeContact({ id: 'c-2', borehole_id: 'bh-1', depth_top_m: 5, formation_id: 'f-clay' }),
    ]
    const formations = [
      makeFormation({ id: 'f-sand', name: 'SAND' }),
      makeFormation({ id: 'f-clay', name: 'CLAY' }),
    ]
    const { container } = renderLayer(
      contacts,
      formations,
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { perColumnBandsFromContacts: true, onDeleteContact: vi.fn().mockResolvedValue(undefined) },
    )
    const band = container.querySelector('[data-testid^="per-column-litho-band-"]')!
    fireEvent.contextMenu(band, { clientX: 100, clientY: 30 })

    expect(screen.getByTestId('litho-band-context-menu')).toBeTruthy()
    expect(screen.queryByTestId('litho-band-menu-unit-statistics')).toBeNull()
  })

  it('LB-US3: with neither handler, right-click opens no menu (the geotech-axis guard)', () => {
    // ``perColumnBandsFromContacts`` is true on the geotech axis too; an
    // unconditional handler there would swallow right-clicks that belong to
    // the packing-band overlay above these rects.
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 1, formation_id: 'f-sand' }),
      makeContact({ id: 'c-2', borehole_id: 'bh-1', depth_top_m: 5, formation_id: 'f-clay' }),
    ]
    const formations = [
      makeFormation({ id: 'f-sand', name: 'SAND' }),
      makeFormation({ id: 'f-clay', name: 'CLAY' }),
    ]
    const { container } = renderLayer(
      contacts,
      formations,
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { perColumnBandsFromContacts: true },
    )
    const band = container.querySelector('[data-testid^="per-column-litho-band-"]')!
    fireEvent.contextMenu(band, { clientX: 100, clientY: 30 })

    expect(screen.queryByTestId('litho-band-context-menu')).toBeNull()
  })

  it('LB2: clicking "Remove" opens the existing delete-contact confirm dialog', () => {
    const onDeleteContact = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 1, formation_id: 'f-sand' }),
      makeContact({ id: 'c-2', borehole_id: 'bh-1', depth_top_m: 5, formation_id: 'f-clay' }),
    ]
    const formations = [
      makeFormation({ id: 'f-sand', name: 'SAND' }),
      makeFormation({ id: 'f-clay', name: 'CLAY' }),
    ]
    const { container } = renderLayer(
      contacts,
      formations,
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { perColumnBandsFromContacts: true, onDeleteContact },
    )
    const band = container.querySelector(
      '[data-testid^="per-column-litho-band-"]',
    )!
    fireEvent.contextMenu(band, { clientX: 100, clientY: 30 })
    fireEvent.click(screen.getByTestId('litho-band-remove'))
    // Existing delete-contact-confirm dialog opens; its primary action
    // calls onDeleteContact with the band's contact id.
    expect(screen.queryByTestId('delete-contact-confirm-dialog')).not.toBeNull()
  })

  // Debt #151 dogfeed refinement 2026-05-27: the "Add" gesture moved
  // from a right-click on empty column space to a LEFT-click on a
  // litho band.  Empty-space right-click no longer renders a menu.
  it('LB5: left-click on a litho band opens the picker at the click depth', () => {
    const onRequestAddLithoSuggestion = vi.fn()
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 1, formation_id: 'f-sand' }),
      makeContact({ id: 'c-2', borehole_id: 'bh-1', depth_top_m: 5, formation_id: 'f-clay' }),
    ]
    const formations = [
      makeFormation({ id: 'f-sand', name: 'SAND' }),
      makeFormation({ id: 'f-clay', name: 'CLAY' }),
    ]
    const { container } = renderLayer(
      contacts,
      formations,
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { perColumnBandsFromContacts: true, onRequestAddLithoSuggestion },
    )
    const band = container.querySelector(
      '[data-testid^="per-column-litho-band-"]',
    )!
    // surface at svg-Y=10 (flipped(10) = 20-10 = 10), pxPerMetre=1.
    // clientY=15 → depth = (15-10)/1 = 5 m.
    fireEvent.click(band, { clientY: 15 })
    expect(onRequestAddLithoSuggestion).toHaveBeenCalledTimes(1)
    const [kind, id, depth, name] = onRequestAddLithoSuggestion.mock.calls[0]
    expect(kind).toBe('borehole')
    expect(id).toBe('bh-1')
    expect(name).toBe('bh-1')
    expect(depth).toBeCloseTo(5, 5)
  })

  // Debt #151 dogfeed refinement 2026-05-27: after deleting a contact
  // between two same-lithology neighbours, the user is offered a
  // follow-up merge to remove the now-redundant boundary below.
  it('MP1: delete between same-lithology neighbours opens the merge popup', () => {
    const onDeleteContact = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 1, formation_id: 'f-sand-a' }),
      makeContact({ id: 'c-2', borehole_id: 'bh-1', depth_top_m: 3, formation_id: 'f-clay' }),
      makeContact({ id: 'c-3', borehole_id: 'bh-1', depth_top_m: 5, formation_id: 'f-sand-b' }),
    ]
    const formations = [
      makeFormation({ id: 'f-sand-a', name: 'SAND-a', litho_main_soil_code: 'ZAND' }),
      makeFormation({ id: 'f-clay', name: 'CLAY', litho_main_soil_code: 'KLEI' }),
      makeFormation({ id: 'f-sand-b', name: 'SAND-b', litho_main_soil_code: 'ZAND' }),
    ]
    const { container } = renderLayer(
      contacts,
      formations,
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { perColumnBandsFromContacts: true, onDeleteContact },
    )
    // Find the CLAY band's rect (top contact is c-2) and right-click → Remove → confirm.
    const claybBand = container.querySelector(
      '[data-testid="per-column-litho-band-bh-1-c-2"]',
    )!
    fireEvent.contextMenu(claybBand, { clientX: 100, clientY: 30 })
    fireEvent.click(screen.getByTestId('litho-band-remove'))
    fireEvent.click(screen.getByTestId('delete-contact-confirm'))
    // First delete fires immediately; merge popup appears because the
    // contacts on either side of c-2 share litho code ZAND.
    expect(onDeleteContact).toHaveBeenCalledTimes(1)
    expect(onDeleteContact.mock.calls[0][0]).toBe('c-2')
    expect(screen.queryByTestId('litho-merge-confirm-dialog')).not.toBeNull()
  })

  it('MP2: confirming merge fires a SECOND delete on the redundant below-neighbour', () => {
    const onDeleteContact = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 1, formation_id: 'f-sand-a' }),
      makeContact({ id: 'c-2', borehole_id: 'bh-1', depth_top_m: 3, formation_id: 'f-clay' }),
      makeContact({ id: 'c-3', borehole_id: 'bh-1', depth_top_m: 5, formation_id: 'f-sand-b' }),
    ]
    const formations = [
      makeFormation({ id: 'f-sand-a', name: 'SAND-a', litho_main_soil_code: 'ZAND' }),
      makeFormation({ id: 'f-clay', name: 'CLAY', litho_main_soil_code: 'KLEI' }),
      makeFormation({ id: 'f-sand-b', name: 'SAND-b', litho_main_soil_code: 'ZAND' }),
    ]
    const { container } = renderLayer(
      contacts,
      formations,
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { perColumnBandsFromContacts: true, onDeleteContact },
    )
    const claybBand = container.querySelector(
      '[data-testid="per-column-litho-band-bh-1-c-2"]',
    )!
    fireEvent.contextMenu(claybBand, { clientX: 100, clientY: 30 })
    fireEvent.click(screen.getByTestId('litho-band-remove'))
    fireEvent.click(screen.getByTestId('delete-contact-confirm'))
    fireEvent.click(screen.getByTestId('litho-merge-confirm'))
    expect(onDeleteContact).toHaveBeenCalledTimes(2)
    // The second call deletes c-3 (the redundant below-neighbour that
    // mirrors c-1's lithology); collapsing the boundary leaves one
    // continuous SAND band from c-1 down to test bottom.
    expect(onDeleteContact.mock.calls[1][0]).toBe('c-3')
  })

  // Debt #152 — litho-axis contact drag must clamp at 10 cm from
  // adjacent contacts now that cross-merge is off (commit 9d4a01db,
  // 2026-05-27 owner directive).  Without the clamp, a runaway drag
  // creates zero-thickness or inverted units in the DB.
  it('CL1: contact drag clamps at (next.depth - minThickness) when dragging DOWN', () => {
    // Two contacts on the same anchor at 3 m and 5 m.  Drag c-top
    // DOWN with no min thickness → would commit at the cursor depth.
    // With min thickness 0.10, the drag commits AT MOST at 5 - 0.10
    // = 4.90 — 10 cm above the lower contact's top.
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-top', borehole_id: 'bh-1', depth_top_m: 3 }),
      makeContact({ id: 'c-bot', borehole_id: 'bh-1', depth_top_m: 5 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onUpdateContactDepth, contactDragClampMinThicknessM: 0.1 },
    )
    const stripTop = container.querySelector(
      '[data-testid="contact-drag-strip"][data-contact-id="c-top"]',
    )!
    fireEvent.mouseDown(stripTop, { clientY: 0, button: 0 })
    // pxPerMetre=1 in the test fixture → drag 100 px down attempts
    // to commit at raw depth = 3 + 1 = 4.  Within bound (4.90), so
    // commits unchanged.
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientY: 1, buttons: 1, bubbles: true }),
      )
    })
    // Drag a further 5 px → raw depth 4 + 5 = ... wait pxPerMetre=1
    // means 5 px = 5 m, so raw = 3 + 5 = 8.  Bound at 4.90 → clamp.
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientY: 5, buttons: 1, bubbles: true }),
      )
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    expect(onUpdateContactDepth).toHaveBeenCalledTimes(1)
    // Final commit clamped at 5 - 0.10 = 4.90.
    expect(onUpdateContactDepth.mock.calls[0][1]).toBeCloseTo(4.9, 5)
  })

  it('CL2: contact drag clamps at (prev.depth + minThickness) when dragging UP', () => {
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-top', borehole_id: 'bh-1', depth_top_m: 3 }),
      makeContact({ id: 'c-bot', borehole_id: 'bh-1', depth_top_m: 5 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onUpdateContactDepth, contactDragClampMinThicknessM: 0.1 },
    )
    const stripBot = container.querySelector(
      '[data-testid="contact-drag-strip"][data-contact-id="c-bot"]',
    )!
    fireEvent.mouseDown(stripBot, { clientY: 0, button: 0 })
    // Drag c-bot UP to depth 0 → raw = 5 - 5 = 0.  Bound at 3 + 0.10
    // = 3.10 → clamp at 3.10.
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientY: -5, buttons: 1, bubbles: true }),
      )
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    expect(onUpdateContactDepth).toHaveBeenCalledTimes(1)
    expect(onUpdateContactDepth.mock.calls[0][1]).toBeCloseTo(3.1, 5)
  })

  it('CL3: clamp is absent when prop is undefined (geological-axis behaviour unchanged)', () => {
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contacts = [
      makeContact({ id: 'c-top', borehole_id: 'bh-1', depth_top_m: 3 }),
      makeContact({ id: 'c-bot', borehole_id: 'bh-1', depth_top_m: 5 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onUpdateContactDepth }, // no contactDragClampMinThicknessM
    )
    const stripTop = container.querySelector(
      '[data-testid="contact-drag-strip"][data-contact-id="c-top"]',
    )!
    fireEvent.mouseDown(stripTop, { clientY: 0, button: 0 })
    // Drag 8 m down past c-bot — no clamp → commits at raw depth.
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientY: 8, buttons: 1, bubbles: true }),
      )
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    expect(onUpdateContactDepth).toHaveBeenCalledTimes(1)
    // No clamp → raw depth 11 commits unchanged.
    expect(onUpdateContactDepth.mock.calls[0][1]).toBeCloseTo(11, 5)
  })

  it('CL4: clamp-hit pops a small popup near the drag readout', () => {
    const contacts = [
      makeContact({ id: 'c-top', borehole_id: 'bh-1', depth_top_m: 3 }),
      makeContact({ id: 'c-bot', borehole_id: 'bh-1', depth_top_m: 5 }),
    ]
    const { container } = renderLayer(
      contacts,
      [makeFormation({ name: 'X' })],
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { onUpdateContactDepth: vi.fn().mockResolvedValue(undefined), contactDragClampMinThicknessM: 0.1 },
    )
    const stripTop = container.querySelector(
      '[data-testid="contact-drag-strip"][data-contact-id="c-top"]',
    )!
    fireEvent.mouseDown(stripTop, { clientY: 0, button: 0 })
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { clientY: 10, buttons: 1, bubbles: true }),
      )
    })
    // Popup is portalled to document.body — query via screen rather
    // than the test's render container.
    expect(screen.queryByTestId('contact-drag-clamp-popup')).not.toBeNull()
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    // Drag ends → popup gone.
    expect(screen.queryByTestId('contact-drag-clamp-popup')).toBeNull()
  })

  it('PC4: per-column bands extend below the deepest contact to test bottom (#142 follow-up)', () => {
    // Dogfeed 2026-05-27: "bottom layer not rendered" — the deepest
    // litho unit had no rect because the previous loop only painted
    // BETWEEN adjacent contacts.  The last contact's formation
    // continues to ``total_depth_m`` (borehole) / ``max_depth_m``
    // (CPT); this test pins that.
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 5, formation_id: 'f-sand' }),
    ]
    const formations = [
      makeFormation({ id: 'f-sand', name: 'SAND', color: '#fbbf24' }),
    ]
    const { container } = renderLayer(
      contacts,
      formations,
      [makeBoreholePlaced('bh-1', 100)], // total_depth_m=30 in fixture
      undefined,
      { perColumnBandsFromContacts: true },
    )
    const bands = container.querySelectorAll('[data-testid^="per-column-litho-band-"]')
    // Only one contact → no between-contact band, just the
    // bottom-extension band from depth 5 → 30.
    expect(bands.length).toBe(1)
    expect(bands[0].getAttribute('data-testid')).toMatch(/-bottom$/)
    expect(bands[0].getAttribute('fill')).toBe('#fbbf24')
  })

  it('PC3b: per-column bands read the stored litho formation colour (#145)', () => {
    // The backend now stamps the lithology colour onto the formation's
    // ``color`` at create + backfills legacy grey rows (#145), so the
    // per-column band reads ``formation.color`` directly — no
    // presentation-layer override (the earlier #142 override was removed
    // in #146 once the stored value became authoritative).
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 0, formation_id: 'f-zand' }),
      makeContact({ id: 'c-2', borehole_id: 'bh-1', depth_top_m: 3, formation_id: 'f-klei' }),
    ]
    const formations = [
      makeFormation({
        id: 'f-zand',
        name: 'ZAND',
        color: '#fbbf24', // lithology colour stamped at create
        litho_main_soil_code: 'ZAND',
      }),
      makeFormation({
        id: 'f-klei',
        name: 'KLEI',
        color: '#6b7280',
        litho_main_soil_code: 'KLEI',
      }),
    ]
    const { container } = renderLayer(
      contacts,
      formations,
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { perColumnBandsFromContacts: true },
    )
    const band = container.querySelector('[data-testid^="per-column-litho-band-"]')
    expect(band).not.toBeNull()
    expect(band!.getAttribute('fill')).toBe('#fbbf24')
  })

  it('PC3: per-column bands honour bandFillOpacity', () => {
    const contacts = [
      makeContact({ id: 'c-1', borehole_id: 'bh-1', depth_top_m: 0, formation_id: 'f-sand' }),
      makeContact({ id: 'c-2', borehole_id: 'bh-1', depth_top_m: 3, formation_id: 'f-clay' }),
    ]
    const formations = [
      makeFormation({ id: 'f-sand', name: 'SAND', color: '#fbbf24' }),
      makeFormation({ id: 'f-clay', name: 'CLAY', color: '#64748b' }),
    ]
    const { container } = renderLayer(
      contacts,
      formations,
      [makeBoreholePlaced('bh-1', 100)],
      undefined,
      { perColumnBandsFromContacts: true, bandFillOpacity: 0.55 },
    )
    const band = container.querySelector('[data-testid^="per-column-litho-band-"]')
    expect(band).not.toBeNull()
    expect(band!.getAttribute('fill-opacity')).toBe('0.55')
  })

  it('honours bandFillOpacity prop — caller can boost the fill (debt #142 follow-up)', () => {
    // Dogfeed 2026-05-27: post-#142 the accepted ghost no longer
    // provides the bold colour fill between committed contacts on a
    // CPT column.  SectionPanel passes a higher opacity on the litho
    // axis so the lithology colours remain visible against the CPT
    // trace.  Default 0.18 stays for the geological axis (light
    // backdrop, doesn't compete with curves).
    const { container } = renderLayer(
      fillContacts,
      [fillFormation],
      fillPlaced,
      undefined,
      {
        surfacesByFormationId: new Map([['f', makeFillSurface(false)]]),
        sectionLine: { startX: -10, startY: 0, endX: 110, endY: 0 },
        alongMToScreenX: along => along + 10,
        bandFillOpacity: 0.55,
      },
    )
    const band = container.querySelector('[data-testid="formation-fill-f"]')
    expect(band).not.toBeNull()
    expect(band!.getAttribute('fill-opacity')).toBe('0.55')
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

  // -----------------------------------------------------------------
  // Geological backdrop (litho axis) — subordinate read-only render
  // -----------------------------------------------------------------

  function makeBackdropSurface(isStale: boolean): FormationSurfaceResponse {
    return {
      id: 'bs',
      model_id: 'geo-m',
      formation_id: 'geo-f',
      method: 'tin',
      vertices: [
        [0, -2, 8],
        [100, -2, 8],
        [50, 5, 8],
      ],
      triangles: [[0, 1, 2]],
      source_contact_count: 3,
      is_stale: isStale,
      created_at: '2026-05-14T00:00:00Z',
      updated_at: '2026-05-14T00:00:00Z',
    }
  }

  it('renders a fresh backdrop polyline at strokeOpacity 0.25 with no dash', () => {
    // The backdrop is rendered via referenceFormations +
    // referenceSurfacesByFormationId.  A fresh surface (is_stale=false)
    // should paint at opacity 0.25 with no strokeDasharray.
    const referenceFormations = [makeFormation({ id: 'geo-f', color: '#00ff00', display_order: 0 })]
    const { container } = render(
      <svg>
        <ContactsLayer
          contacts={[]}
          formations={[]}
          placedColumns={[makeBoreholePlaced('bh-1', 50)]}
          levelToScreen={flipped}
          plotTop={0}
          plotBottom={50}
          referenceFormations={referenceFormations}
          referenceSurfacesByFormationId={
            new Map([['geo-f', makeBackdropSurface(false)]])
          }
          sectionLine={{ startX: -10, startY: 0, endX: 110, endY: 0 }}
          alongMToScreenX={along => along + 10}
        />
      </svg>,
    )
    const backdrop = container.querySelector('[data-testid="backdrop-surface-geo-f"]')
    expect(backdrop).not.toBeNull()
    expect(backdrop!.getAttribute('stroke-opacity')).toBe('0.25')
    expect(backdrop!.getAttribute('stroke-dasharray')).toBeNull()
    expect(backdrop!.getAttribute('data-stale')).toBeNull()
    // Must carry pointerEvents="none" — never hit-tested.
    expect(backdrop!.getAttribute('pointer-events')).toBe('none')
  })

  it('renders a stale backdrop polyline at strokeOpacity 0.12 with dash "8 4"', () => {
    const referenceFormations = [makeFormation({ id: 'geo-f', color: '#00ff00', display_order: 0 })]
    const { container } = render(
      <svg>
        <ContactsLayer
          contacts={[]}
          formations={[]}
          placedColumns={[makeBoreholePlaced('bh-1', 50)]}
          levelToScreen={flipped}
          plotTop={0}
          plotBottom={50}
          referenceFormations={referenceFormations}
          referenceSurfacesByFormationId={
            new Map([['geo-f', makeBackdropSurface(true)]])
          }
          sectionLine={{ startX: -10, startY: 0, endX: 110, endY: 0 }}
          alongMToScreenX={along => along + 10}
        />
      </svg>,
    )
    const backdrop = container.querySelector('[data-testid="backdrop-surface-geo-f"]')
    expect(backdrop).not.toBeNull()
    expect(backdrop!.getAttribute('stroke-opacity')).toBe('0.12')
    expect(backdrop!.getAttribute('stroke-dasharray')).toBe('8 4')
    expect(backdrop!.getAttribute('data-stale')).toBe('true')
  })

  it('renders backdrop BEFORE the active litho polylines (lower in SVG paint order)', () => {
    // The backdrop <path> must appear earlier in the DOM than any
    // active-layer element so it paints underneath — standard SVG
    // paint order: first in DOM = furthest back.
    const referenceFormations = [makeFormation({ id: 'geo-f', color: '#00ff00', display_order: 0 })]
    const lithoContacts = [
      makeContact({ id: 'c-litho', borehole_id: 'bh-1', formation_id: 'f-1', depth_top_m: 3 }),
      makeContact({ id: 'c-litho-2', borehole_id: 'bh-2', formation_id: 'f-1', depth_top_m: 4 }),
    ]
    const { container } = render(
      <svg>
        <ContactsLayer
          contacts={lithoContacts}
          formations={[makeFormation({ id: 'f-1', color: '#ff0000', display_order: 0 })]}
          placedColumns={[
            makeBoreholePlaced('bh-1', 0),
            makeBoreholePlaced('bh-2', 100),
          ]}
          levelToScreen={flipped}
          plotTop={0}
          plotBottom={50}
          referenceFormations={referenceFormations}
          referenceSurfacesByFormationId={
            new Map([['geo-f', makeBackdropSurface(false)]])
          }
          sectionLine={{ startX: -10, startY: 0, endX: 110, endY: 0 }}
          alongMToScreenX={along => along + 10}
        />
      </svg>,
    )
    const allPaths = Array.from(container.querySelectorAll('path'))
    const backdropIdx = allPaths.findIndex(
      p => p.getAttribute('data-testid') === 'backdrop-surface-geo-f',
    )
    const activeLayers = allPaths.filter(
      p =>
        p.getAttribute('data-testid')?.startsWith('formation-polyline-') ||
        p.getAttribute('data-testid')?.startsWith('formation-fill-'),
    )
    // Backdrop must exist.
    expect(backdropIdx).toBeGreaterThanOrEqual(0)
    // Every active layer path must come AFTER the backdrop in DOM order.
    for (const activeEl of activeLayers) {
      const activeIdx = allPaths.indexOf(activeEl)
      expect(activeIdx).toBeGreaterThan(backdropIdx)
    }
  })

  it('renders no backdrop when referenceFormations is absent', () => {
    // Geological axis — neither reference prop is passed.
    const { container } = renderLayer(
      [makeContact({ id: 'c-1', borehole_id: 'bh-1' })],
      [makeFormation()],
      [makeBoreholePlaced('bh-1', 50)],
    )
    expect(container.querySelectorAll('[data-testid^="backdrop-surface-"]').length).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // Bug A — right-click on backdrop contact polyline opens geology menu
  // via nearest-column proximity (dogfeed 2026-05-26)
  // ---------------------------------------------------------------------------

  it('BA1 — right-click on backdrop contact polyline hit-path opens context menu; clicking "Edit in Geology stage" fires onEditInGeologyStage with nearest-column contact id', () => {
    // Setup: two reference contacts on two borehole columns.
    // Left column (bh-1, nudgedX=20): geological contact c-geo-left for formation geo-f.
    // Right column (bh-2, nudgedX=80): geological contact c-geo-right for formation geo-f.
    // Right-click near the left column (clientX=25, svgLeft=0 in jsdom → clickX=25).
    // Distance to bh-1=5, distance to bh-2=55 → nearest = bh-1 → c-geo-left.
    const geoFormation = makeFormation({ id: 'geo-f', color: '#00ff00', display_order: 0 })
    const leftRefContact = makeContact({
      id: 'c-geo-left',
      borehole_id: 'bh-1',
      cpt_id: null,
      model_id: 'geo-model',
      formation_id: 'geo-f',
      depth_top_m: 3,
    })
    const rightRefContact = makeContact({
      id: 'c-geo-right',
      borehole_id: 'bh-2',
      cpt_id: null,
      model_id: 'geo-model',
      formation_id: 'geo-f',
      depth_top_m: 3,
    })

    const onEditInGeologyStage = vi.fn()

    const { container } = render(
      <svg>
        <ContactsLayer
          // Active litho contacts (non-empty so the layer renders).
          contacts={[makeContact({ id: 'c-litho', borehole_id: 'bh-1', formation_id: 'f-1', depth_top_m: 1 })]}
          formations={[makeFormation({ id: 'f-1' })]}
          placedColumns={[
            makeBoreholePlaced('bh-1', 20),
            makeBoreholePlaced('bh-2', 80),
          ]}
          levelToScreen={flipped}
          plotTop={0}
          plotBottom={50}
          referenceFormations={[geoFormation]}
          referenceContacts={[leftRefContact, rightRefContact]}
          onEditInGeologyStage={onEditInGeologyStage}
        />
      </svg>,
    )

    // The backdrop contact polyline hit-path: transparent stroke, no data-testid.
    const allPaths = Array.from(container.querySelectorAll('path'))
    const hitPaths = allPaths.filter(
      p =>
        p.getAttribute('stroke') === 'transparent' &&
        !p.getAttribute('data-testid'),
    )
    expect(hitPaths.length).toBe(1)

    // Right-click fires the onContextMenu handler which sets contactMenu state
    // and renders the portal context menu in document.body.
    act(() => {
      hitPaths[0].dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 25, clientY: 15 }),
      )
    })

    // The context menu should now be in the portal (document.body).
    const menu = document.body.querySelector('[data-testid="contact-context-menu"]')
    expect(menu).not.toBeNull()

    // Click "Edit in Geology stage" menu item.
    const editBtn = Array.from(menu!.querySelectorAll('button')).find(
      b => b.textContent?.includes('Edit in Geology'),
    )
    expect(editBtn).not.toBeNull()
    act(() => {
      fireEvent.click(editBtn!)
    })

    // onEditInGeologyStage must have been called with the nearest-column contact.
    expect(onEditInGeologyStage).toHaveBeenCalledTimes(1)
    expect(onEditInGeologyStage).toHaveBeenCalledWith('c-geo-left', 'geo-f')
  })

  it('BA2 — backdrop contact polyline hit-path NOT rendered when onEditInGeologyStage is absent', () => {
    // Without the deep-link prop, the hit-path must not be added — avoids
    // confusing pointer-events on the geological axis.
    const geoFormation = makeFormation({ id: 'geo-f', color: '#00ff00', display_order: 0 })
    const refContact = makeContact({
      id: 'c-geo',
      borehole_id: 'bh-1',
      model_id: 'geo-model',
      formation_id: 'geo-f',
      depth_top_m: 3,
    })

    const { container } = render(
      <svg>
        <ContactsLayer
          contacts={[makeContact({ id: 'c-litho', borehole_id: 'bh-1', formation_id: 'f-1', depth_top_m: 1 })]}
          formations={[makeFormation({ id: 'f-1' })]}
          placedColumns={[makeBoreholePlaced('bh-1', 50)]}
          levelToScreen={flipped}
          plotTop={0}
          plotBottom={50}
          referenceFormations={[geoFormation]}
          referenceContacts={[refContact]}
          // onEditInGeologyStage intentionally absent
        />
      </svg>,
    )

    const allPaths = Array.from(container.querySelectorAll('path'))
    const hitPaths = allPaths.filter(
      p =>
        p.getAttribute('stroke') === 'transparent' &&
        !p.getAttribute('data-testid'),
    )
    // No hit-path without the deep-link prop.
    expect(hitPaths.length).toBe(0)
  })

  // -------------------------------------------------------------------------
  // Litho↔geo unlink gesture (#162 Task 6)
  // -------------------------------------------------------------------------

  describe('unlink-from-geology context menu item', () => {
    it('UG1 — menu item appears for a coupled contact and fires with the contact id', async () => {
      // A coupled contact: parent_geo_contact_id is set.
      const contact = makeContact({
        id: 'c-coupled',
        borehole_id: 'bh-1',
        depth_top_m: 3,
        parent_geo_contact_id: 'geo-contact-99',
      })
      const handler = vi.fn().mockResolvedValue(undefined)
      renderLayer(
        [contact],
        [makeFormation()],
        [makeBoreholePlaced('bh-1', 50)],
        undefined,
        { onDeleteContact: vi.fn(), onUnlinkLithoFromGeo: handler },
      )

      // Right-click the drag strip to open the context menu.
      const strip = screen.getByTestId('contact-drag-strip')
      fireEvent.contextMenu(strip)

      // The "Unlink from geology" item must be present.
      const unlinkItem = await screen.findByTestId('unlink-geo-menu-item')
      expect(unlinkItem).toBeTruthy()

      // Clicking it fires the handler with the contact id.
      fireEvent.click(unlinkItem)
      expect(handler).toHaveBeenCalledWith('c-coupled')
    })

    it('UG1b — menu item is absent when the contact is NOT coupled', async () => {
      // Uncoupled contact: parent_geo_contact_id is null.
      const contact = makeContact({
        id: 'c-uncoupled',
        borehole_id: 'bh-1',
        depth_top_m: 3,
        parent_geo_contact_id: null,
      })
      const handler = vi.fn().mockResolvedValue(undefined)
      renderLayer(
        [contact],
        [makeFormation()],
        [makeBoreholePlaced('bh-1', 50)],
        undefined,
        { onDeleteContact: vi.fn(), onUnlinkLithoFromGeo: handler },
      )

      // Right-click opens the menu.
      const strip = screen.getByTestId('contact-drag-strip')
      fireEvent.contextMenu(strip)

      // The "Unlink from geology" item must NOT appear.
      const unlinkItem = screen.queryByTestId('unlink-geo-menu-item')
      expect(unlinkItem).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Litho↔geo link gesture (#162 Slice 2) — inverse of unlink
  // -------------------------------------------------------------------------

  describe('link-to-geology context menu item', () => {
    it('LG1 — menu item appears for an uncoupled contact and fires with the contact id', async () => {
      // Uncoupled contact: parent_geo_contact_id is null — "Link to geology" must show.
      const contact = makeContact({
        id: 'c-uncoupled',
        borehole_id: 'bh-1',
        depth_top_m: 3,
        parent_geo_contact_id: null,
      })
      const handler = vi.fn().mockResolvedValue(undefined)
      renderLayer(
        [contact],
        [makeFormation()],
        [makeBoreholePlaced('bh-1', 50)],
        undefined,
        { onDeleteContact: vi.fn(), onLinkLithoToGeo: handler },
      )

      // Right-click the drag strip to open the context menu.
      const strip = screen.getByTestId('contact-drag-strip')
      fireEvent.contextMenu(strip)

      // The "Link to geology" item must be present.
      const linkItem = await screen.findByTestId('link-geo-menu-item')
      expect(linkItem).toBeTruthy()

      // Clicking it fires the handler with the contact id.
      fireEvent.click(linkItem)
      expect(handler).toHaveBeenCalledWith('c-uncoupled')
    })

    it('LG1b — menu item is absent when the contact IS coupled', async () => {
      // Coupled contact: parent_geo_contact_id is non-null — "Link to geology" must be hidden.
      const contact = makeContact({
        id: 'c-coupled',
        borehole_id: 'bh-1',
        depth_top_m: 3,
        parent_geo_contact_id: 'geo-contact-99',
      })
      const handler = vi.fn().mockResolvedValue(undefined)
      renderLayer(
        [contact],
        [makeFormation()],
        [makeBoreholePlaced('bh-1', 50)],
        undefined,
        { onDeleteContact: vi.fn(), onLinkLithoToGeo: handler },
      )

      // Right-click opens the menu.
      const strip = screen.getByTestId('contact-drag-strip')
      fireEvent.contextMenu(strip)

      // The "Link to geology" item must NOT appear.
      const linkItem = screen.queryByTestId('link-geo-menu-item')
      expect(linkItem).toBeNull()
    })
  })

  describe('coupling glyph (#162 Task 6)', () => {
    it('UG2 — glyph renders for a coupled contact', () => {
      const contact = makeContact({
        id: 'c-linked',
        borehole_id: 'bh-1',
        depth_top_m: 3,
        parent_geo_contact_id: 'geo-abc',
      })
      const { container } = renderLayer(
        [contact],
        [makeFormation()],
        [makeBoreholePlaced('bh-1', 50)],
      )
      // Glyph must be present.
      const glyph = container.querySelector('[data-testid="coupling-glyph-c-linked"]')
      expect(glyph).toBeTruthy()
    })

    it('UG2b — glyph absent for an uncoupled contact', () => {
      const contact = makeContact({
        id: 'c-free',
        borehole_id: 'bh-1',
        depth_top_m: 3,
        parent_geo_contact_id: null,
      })
      const { container } = renderLayer(
        [contact],
        [makeFormation()],
        [makeBoreholePlaced('bh-1', 50)],
      )
      // No glyph.
      const glyph = container.querySelector('[data-testid="coupling-glyph-c-free"]')
      expect(glyph).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Reference hit-strip suppression when litho contact is coupled (#162)
  // -------------------------------------------------------------------------

  describe('reference hit-strip suppression for coupled litho contacts (#162)', () => {
    it('RS1 — reference hit-strip is suppressed when a litho contact is coupled to that geo contact', () => {
      // A coupled litho contact whose parent_geo_contact_id == the reference
      // contact's id.  The reference strip must NOT render — the litho
      // contact's own drag-strip (contact-drag-strip) already handles drag
      // AND its context menu offers "Unlink from geology", so the reference
      // strip would only eat pointer events.
      const geoId = 'geo-ref-1'
      const lithoContact = makeContact({
        id: 'c-coupled',
        borehole_id: 'bh-1',
        depth_top_m: 3,
        parent_geo_contact_id: geoId,
      })
      const geoRefContact = makeContact({
        id: geoId,
        borehole_id: 'bh-1',
        depth_top_m: 3,
        model_id: 'geo-model',
        formation_id: 'geo-f',
      })
      const geoFormation = makeFormation({ id: 'geo-f' })
      const onEditInGeologyStage = vi.fn()

      const { container } = render(
        <svg>
          <ContactsLayer
            contacts={[lithoContact]}
            formations={[makeFormation()]}
            placedColumns={[makeBoreholePlaced('bh-1', 50)]}
            levelToScreen={flipped}
            plotTop={0}
            plotBottom={50}
            referenceFormations={[geoFormation]}
            referenceContacts={[geoRefContact]}
            onEditInGeologyStage={onEditInGeologyStage}
            onDeleteContact={vi.fn().mockResolvedValue(undefined)}
            onUnlinkLithoFromGeo={vi.fn().mockResolvedValue(undefined)}
          />
        </svg>,
      )

      // The reference strip for geoId must NOT be rendered (suppressed because
      // lithoContact is coupled to it).
      const refStrip = container.querySelector(`[data-testid="ref-contact-drag-strip"][data-contact-id="${geoId}"]`)
      expect(refStrip).toBeNull()

      // The litho contact's own drag strip must still be present.
      const lithoStrip = container.querySelector('[data-testid="contact-drag-strip"]')
      expect(lithoStrip).not.toBeNull()
    })

    it('RS1b — "Unlink from geology" menu item is reachable on the litho strip when reference strip is suppressed', async () => {
      // Confirm that suppressing the reference strip does not lose the ability
      // to right-click the coupled litho contact and pick "Unlink from geology".
      const geoId = 'geo-ref-2'
      const lithoContact = makeContact({
        id: 'c-coupled-2',
        borehole_id: 'bh-1',
        depth_top_m: 3,
        parent_geo_contact_id: geoId,
      })
      const geoRefContact = makeContact({
        id: geoId,
        borehole_id: 'bh-1',
        depth_top_m: 3,
        model_id: 'geo-model',
        formation_id: 'geo-f',
      })
      const geoFormation = makeFormation({ id: 'geo-f' })
      const unlinkHandler = vi.fn().mockResolvedValue(undefined)

      render(
        <svg>
          <ContactsLayer
            contacts={[lithoContact]}
            formations={[makeFormation()]}
            placedColumns={[makeBoreholePlaced('bh-1', 50)]}
            levelToScreen={flipped}
            plotTop={0}
            plotBottom={50}
            referenceFormations={[geoFormation]}
            referenceContacts={[geoRefContact]}
            onEditInGeologyStage={vi.fn()}
            onDeleteContact={vi.fn().mockResolvedValue(undefined)}
            onUnlinkLithoFromGeo={unlinkHandler}
          />
        </svg>,
      )

      // Right-click the litho contact's drag strip.
      const lithoStrip = screen.getByTestId('contact-drag-strip')
      fireEvent.contextMenu(lithoStrip)

      // "Unlink from geology" must be in the menu.
      const unlinkItem = await screen.findByTestId('unlink-geo-menu-item')
      expect(unlinkItem).toBeTruthy()

      fireEvent.click(unlinkItem)
      expect(unlinkHandler).toHaveBeenCalledWith('c-coupled-2')
    })

    it('RS2 — reference hit-strip is still rendered for an UNCOUPLED reference contact', () => {
      // Control case: an uncoupled reference contact (not linked to any litho
      // contact) must still render its hit-strip so the user can right-click
      // it for "Edit in Geology stage".
      const geoId = 'geo-ref-3'
      const lithoContact = makeContact({
        id: 'c-uncoupled',
        borehole_id: 'bh-1',
        depth_top_m: 1,
        parent_geo_contact_id: null,   // different contact — not coupled to geoId
      })
      const geoRefContact = makeContact({
        id: geoId,
        borehole_id: 'bh-1',
        depth_top_m: 3,
        model_id: 'geo-model',
        formation_id: 'geo-f',
      })
      const geoFormation = makeFormation({ id: 'geo-f' })

      const { container } = render(
        <svg>
          <ContactsLayer
            contacts={[lithoContact]}
            formations={[makeFormation()]}
            placedColumns={[makeBoreholePlaced('bh-1', 50)]}
            levelToScreen={flipped}
            plotTop={0}
            plotBottom={50}
            referenceFormations={[geoFormation]}
            referenceContacts={[geoRefContact]}
            onEditInGeologyStage={vi.fn()}
            onDeleteContact={vi.fn().mockResolvedValue(undefined)}
          />
        </svg>,
      )

      // Reference strip must be present — not suppressed.
      const refStrip = container.querySelector(`[data-testid="ref-contact-drag-strip"][data-contact-id="${geoId}"]`)
      expect(refStrip).not.toBeNull()
    })

    it('RS3 — reference hit-strip is suppressed when a litho contact is COINCIDENT (same depth) but NOT coupled (#159)', () => {
      // The #159 drag-lock: after the litho-geo snap dialog ("Snap litho"
      // or "Move geo") the litho contact and the geological contact sit at
      // the SAME depth on the SAME anchor, but parent_geo_contact_id is
      // NOT set (only explicit "Link to geology" / accept-couple set it).
      // The reference strip is painted on top of the litho drag-strip and
      // eats the hover + mousedown — the two-ended drag cursor never shows
      // and the litho contact can no longer be grabbed. Suppressing the
      // coincident reference strip restores the drag (the litho contact's
      // own menu still offers "Edit in Geology stage").
      const geoId = 'geo-ref-4'
      const lithoContact = makeContact({
        id: 'c-coincident',
        borehole_id: 'bh-1',
        depth_top_m: 3,
        parent_geo_contact_id: null, // coincident but NOT coupled
      })
      const geoRefContact = makeContact({
        id: geoId,
        borehole_id: 'bh-1',
        depth_top_m: 3, // same depth + same anchor as the litho contact
        model_id: 'geo-model',
        formation_id: 'geo-f',
      })
      const geoFormation = makeFormation({ id: 'geo-f' })

      const { container } = render(
        <svg>
          <ContactsLayer
            contacts={[lithoContact]}
            formations={[makeFormation()]}
            placedColumns={[makeBoreholePlaced('bh-1', 50)]}
            levelToScreen={flipped}
            plotTop={0}
            plotBottom={50}
            referenceFormations={[geoFormation]}
            referenceContacts={[geoRefContact]}
            onEditInGeologyStage={vi.fn()}
            onDeleteContact={vi.fn().mockResolvedValue(undefined)}
          />
        </svg>,
      )

      // The coincident reference strip must be suppressed so it cannot eat
      // the litho contact's drag.
      const refStrip = container.querySelector(`[data-testid="ref-contact-drag-strip"][data-contact-id="${geoId}"]`)
      expect(refStrip).toBeNull()

      // The litho contact's own drag-strip must remain grabbable.
      const lithoStrip = container.querySelector('[data-testid="contact-drag-strip"]')
      expect(lithoStrip).not.toBeNull()
    })
  })
})
