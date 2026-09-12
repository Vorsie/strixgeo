// ContactsLayer offers no contact-mutating gesture when the matching handler is absent.
//
// The geotech axis is view-only for contacts (`docs/design/geotech-stage.md` §4: they
// "cannot be created, dragged or deleted"), and SectionsCanvas enforces that by handing
// the panel no edit handlers on that axis. ContactsLayer itself must therefore offer no
// affordance that needs one — it already gates the drag hit-strip and the band's LEFT-
// click add on handler presence, but two right-click surfaces were left ungated and kept
// drawing over geotech packing bands: "Delete unit" on a band, and "Add new
// suggestion here" on the per-column capture rect. Both reached a dead end, and before
// the handlers were gated at all the Remove path really did delete a geotech contact,
// which the next "Subdivide all bodies" discarded without a word.
//
// The wired case is asserted alongside each gate, so removing the feature for everyone
// would not pass.

import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  BoreholeListItem,
  FormationContactResponse,
  GeologicalFormationResponse,
} from '../../api/client'
import type { ProjectedInvestigation } from '../../utils/sectionProjection'
import ContactsLayer from './ContactsLayer'
import type { PlacedColumn } from './utils'

/** Elevation → screen Y, flipped about 20 so 1 m of depth is 1 px. */
const flipped = (level: number): number => 20 - level

/**
 * A minimal litho-style formation.
 *
 * @param id Formation id, also used to key the band's test id.
 * @param name Display name shown in the band label and the remove menu.
 */
function makeFormation(id: string, name: string): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'P',
    name,
    color: '#fbbf24',
    code: null,
    display_order: 0,
    pinned_order: false,
    regional_ref: null,
    description: null,
    lithology: null,
    nad_class: null,
    parent_formation_id: null,
    litho_main_soil_code: 'ZAND',
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    parent_extrapolated: false,
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    created_at: '2026-08-02T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
  }
}

/**
 * A borehole-anchored contact at a given depth.
 *
 * @param id Contact id.
 * @param formationId Formation the contact's layer belongs to.
 * @param depthTopM Depth of the contact below the collar, in metres.
 */
function makeContact(
  id: string,
  formationId: string,
  depthTopM: number,
): FormationContactResponse {
  return {
    id,
    model_id: 'm-1',
    formation_id: formationId,
    borehole_id: 'bh-1',
    cpt_id: null,
    depth_top_m: depthTopM,
    source: 'manual_pick',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    created_at: '2026-08-02T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
  }
}

/** The single placed borehole column every case in this suite draws on. */
function makeColumn(): PlacedColumn {
  const item = {
    id: 'bh-1',
    name: 'bh-1',
    borehole_type: null,
    test_id: 'bh-1',
    location_x: 0,
    location_y: 0,
    elevation_m: 10,
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
  return { kind: 'borehole', proj, trueX: 100, nudgedX: 100, width: 14, displaced: false }
}

/**
 * Renders the layer with per-column bands on — true on the litho AND the geotech axis.
 *
 * @param handlers The two mutating handlers under test; omitting one is the geotech
 *   axis wiring for it.
 */
function renderLayer(handlers: {
  onDeleteContact?: (id: string) => Promise<void>
  onRequestAddLithoSuggestion?: (
    anchorKind: 'cpt' | 'borehole',
    anchorId: string,
    depth_m: number,
    anchorName: string,
    elevationM: number,
  ) => void
}) {
  return render(
    <svg>
      <ContactsLayer
        contacts={[makeContact('c-1', 'f-sand', 1), makeContact('c-2', 'f-clay', 5)]}
        formations={[makeFormation('f-sand', 'SAND'), makeFormation('f-clay', 'CLAY')]}
        placedColumns={[makeColumn()]}
        levelToScreen={flipped}
        plotTop={0}
        plotBottom={50}
        perColumnBandsFromContacts
        onDeleteContact={handlers.onDeleteContact}
        onRequestAddLithoSuggestion={handlers.onRequestAddLithoSuggestion}
      />
    </svg>,
  )
}

describe('ContactsLayer — no contact-mutating affordance without its handler', () => {
  afterEach(() => {
    cleanup()
  })

  it('VC1 — a band offers no "Remove" menu when no delete handler is wired', () => {
    const { container } = renderLayer({})

    const band = container.querySelector('[data-testid^="per-column-litho-band-"]')!
    fireEvent.contextMenu(band, { clientX: 100, clientY: 30 })

    expect(screen.queryByTestId('litho-band-context-menu')).toBeNull()
  })

  it('VC2 — empty column space offers no "Add" menu when no add handler is wired', () => {
    const { container } = renderLayer({})

    expect(container.querySelector('[data-testid^="per-column-rclick-capture-"]')).toBeNull()
  })

  it('VC3 — with both handlers wired, both surfaces are back', () => {
    const { container } = renderLayer({
      onDeleteContact: vi.fn().mockResolvedValue(undefined),
      onRequestAddLithoSuggestion: vi.fn(),
    })

    expect(container.querySelector('[data-testid^="per-column-rclick-capture-"]')).not.toBeNull()
    const band = container.querySelector('[data-testid^="per-column-litho-band-"]')!
    fireEvent.contextMenu(band, { clientX: 100, clientY: 30 })
    expect(screen.queryByTestId('litho-band-context-menu')).not.toBeNull()
  })
})
