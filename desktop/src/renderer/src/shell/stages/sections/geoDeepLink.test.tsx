// Geo deep-link tests (dogfeed 2026-05-25, Slice 6).
//
// GD1 — right-click on a reference (geological backdrop) contact hit-strip
//        in the litho section view → the contact context menu opens with the
//        "Edit in Stratigraphy stage" item present.
//
// GD2 — clicking "Edit in Stratigraphy stage" calls the onEditInGeologyStage
//        callback with the correct contactId + formationId args, and the
//        menu does NOT show Delete / Pinch-out for reference contacts.
//
// GD5 — Reference-contact hit-strips render AFTER (on top of) active
//        litho-contact drag strips in SVG DOM order (Slice D z-order fix,
//        dogfeed 2026-05-25).  The strips must be topmost so right-click
//        on a geological contact position wins over any overlapping litho
//        hit-strip at the same depth.
//
// GD1/GD2/GD5/GD6 exercise ContactsLayer (the hit-strip + menu item surface).
//
// The former GD3/GD4 pinned the OLD "Edit in Stratigraphy stage" target — the
// GeologyInspector (3D-stage) payload consumer. That target was the debt #156
// mis-land (it opened the globe). The deep-link now opens the SECTION VIEW and
// is consumed in AppShell; GD3/GD4 were removed with the GeologyInspector
// consumer. The replacement pins live in AppShell.test.tsx (routing to the
// Sections stage on the geological axis) and useSections.axis.test.ts (DL1 —
// the geological-axis focus override).

import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// GD1 / GD2  — ContactsLayer ref-contact hit-strip + menu item
// ---------------------------------------------------------------------------

import ContactsLayer from '../../../components/sections/ContactsLayer'
import type {
  FormationContactResponse,
  GeologicalFormationResponse,
} from '../../../api/client'
import type { PlacedColumn } from '../../../components/sections/utils'

// Minimal PlacedColumn that satisfies all required PlacedColumnBase fields.
const makePlacedColumn = (anchorId: string): PlacedColumn =>
  ({
    kind: 'borehole',
    nudgedX: 100,
    trueX: 100,
    displaced: false,
    width: 40,
    proj: {
      along: 0,
      offset: 0,
      perpOffset: 0,
      item: { id: anchorId, elevation_m: 10 } as PlacedColumn['proj']['item'],
    },
  }) as PlacedColumn

const makeContact = (
  id: string,
  formationId: string,
  anchorId: string,
): FormationContactResponse =>
  ({
    id,
    model_id: 'model-1',
    formation_id: formationId,
    depth_top_m: 2,
    borehole_id: anchorId,
    cpt_id: null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    source: 'manual_pick',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }) as FormationContactResponse

const makeFormation = (id: string, name: string): GeologicalFormationResponse =>
  ({
    id,
    name,
    regional_ref: null,
    color: '#aabbcc',
    display_order: 0,
    pinned_order: false,
    app_project_id: 'proj-1',
    code: null,
    description: null,
    lithology: null,
    nad_class: null,
    parent_formation_id: null,
    parent_formation_name: null,
    parent_extrapolated: false,
    litho_main_soil_code: null,
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }) as GeologicalFormationResponse

// Wrap ContactsLayer in a minimal SVG so SVGElement methods don't throw.
function renderContactsLayer(
  props: Parameters<typeof ContactsLayer>[0],
): ReturnType<typeof render> {
  return render(
    <svg width="600" height="400" data-testid="section-svg">
      <ContactsLayer {...props} />
    </svg>,
  )
}

describe('GD1 — right-click reference contact shows "Edit in Stratigraphy stage" menu item', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the context menu with geo-deep-link-menu-item on right-click', () => {
    const onEditInGeologyStage = vi.fn()
    const anchorId = 'borehole-1'
    const contactId = 'ref-contact-1'
    const formationId = 'formation-1'

    renderContactsLayer({
      contacts: [],
      formations: [],
      placedColumns: [makePlacedColumn(anchorId)],
      levelToScreen: (level) => (10 - level) * 20,
      plotTop: 0,
      plotBottom: 400,
      referenceContacts: [makeContact(contactId, formationId, anchorId)],
      referenceFormations: [makeFormation(formationId, 'Boom Klei')],
      onEditInGeologyStage,
    })

    const strip = document.querySelector('[data-testid="ref-contact-drag-strip"]')
    expect(strip).not.toBeNull()

    fireEvent.contextMenu(strip!)
    const menuItem = screen.getByTestId('geo-deep-link-menu-item')
    expect(menuItem).toBeTruthy()
    expect(menuItem.textContent).toBe('Edit in Stratigraphy stage')
  })

  it('does NOT render a hit-strip when onEditInGeologyStage is absent', () => {
    const anchorId = 'borehole-1'
    const contactId = 'ref-contact-1'
    const formationId = 'formation-1'

    renderContactsLayer({
      contacts: [],
      formations: [],
      placedColumns: [makePlacedColumn(anchorId)],
      levelToScreen: (level) => (10 - level) * 20,
      plotTop: 0,
      plotBottom: 400,
      referenceContacts: [makeContact(contactId, formationId, anchorId)],
      referenceFormations: [makeFormation(formationId, 'Boom Klei')],
      // onEditInGeologyStage absent — hit-strips must not render
    })

    const strip = document.querySelector('[data-testid="ref-contact-drag-strip"]')
    expect(strip).toBeNull()
  })
})

describe('GD2 — clicking "Edit in Stratigraphy stage" calls the callback with correct args', () => {
  afterEach(() => {
    cleanup()
  })

  it('fires onEditInGeologyStage with the contact id + formation id', () => {
    const onEditInGeologyStage = vi.fn()
    const anchorId = 'borehole-1'
    const contactId = 'ref-contact-1'
    const formationId = 'formation-1'

    renderContactsLayer({
      contacts: [],
      formations: [],
      placedColumns: [makePlacedColumn(anchorId)],
      levelToScreen: (level) => (10 - level) * 20,
      plotTop: 0,
      plotBottom: 400,
      referenceContacts: [makeContact(contactId, formationId, anchorId)],
      referenceFormations: [makeFormation(formationId, 'Boom Klei')],
      onEditInGeologyStage,
    })

    const strip = document.querySelector('[data-testid="ref-contact-drag-strip"]')!
    fireEvent.contextMenu(strip)

    const menuItem = screen.getByTestId('geo-deep-link-menu-item')
    fireEvent.click(menuItem)

    expect(onEditInGeologyStage).toHaveBeenCalledTimes(1)
    expect(onEditInGeologyStage).toHaveBeenCalledWith(contactId, formationId)
  })

  it('does NOT render Delete or Pinch-out items for reference contacts', () => {
    const onEditInGeologyStage = vi.fn()
    const onDeleteContact = vi.fn().mockResolvedValue(undefined)
    const anchorId = 'borehole-1'
    const contactId = 'ref-contact-1'
    const formationId = 'formation-1'

    renderContactsLayer({
      contacts: [],
      formations: [],
      placedColumns: [makePlacedColumn(anchorId)],
      levelToScreen: (level) => (10 - level) * 20,
      plotTop: 0,
      plotBottom: 400,
      referenceContacts: [makeContact(contactId, formationId, anchorId)],
      referenceFormations: [makeFormation(formationId, 'Boom Klei')],
      onEditInGeologyStage,
      onDeleteContact,
    })

    const strip = document.querySelector('[data-testid="ref-contact-drag-strip"]')!
    fireEvent.contextMenu(strip)

    // Reference contact menu: no Delete, no Pinch-out, only deep-link item
    expect(screen.queryByText('Delete contact')).toBeNull()
    expect(screen.queryByText(/Extrapolate pinch-out/)).toBeNull()
    expect(screen.getByTestId('geo-deep-link-menu-item')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// GD5 — coincident reference strip is SUPPRESSED, not topmost (#159 supersedes
// the Slice-D 2026-05-25 z-order fix).
// ---------------------------------------------------------------------------
//
// The original GD5 placed a litho contact and a reference contact at the same
// depth and asserted the reference strip rendered LAST (on top) "so it
// receives the right-click first".  That very behaviour was the #159
// drag-lock: the topmost reference strip ate the litho contact's hover +
// mousedown, so the two-ended drag cursor never appeared.  The corrected
// contract is to SUPPRESS the coincident reference strip so the litho
// contact's own drag-strip wins; the geo-deep-link stays reachable from the
// litho contact's own context menu (covered by GD1-GD4).

describe('GD5 — coincident reference strip is suppressed so the litho contact stays draggable (#159)', () => {
  afterEach(() => {
    cleanup()
  })

  it('suppresses the ref-contact-drag-strip when a litho contact sits at the same anchor + depth', () => {
    // Arrange: one active litho contact AND one reference (geological) contact
    // at the same anchor + same depth.  The reference strip must NOT render —
    // otherwise it would sit on top of the litho drag-strip and lock the drag.
    const onEditInGeologyStage = vi.fn()
    const onDeleteContact = vi.fn().mockResolvedValue(undefined)
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const anchorId = 'borehole-1'
    const lithoFormationId = 'litho-formation-1'
    const geoFormationId = 'geo-formation-1'

    const lithoContact = makeContact('litho-contact-1', lithoFormationId, anchorId)
    const refContact = makeContact('ref-contact-1', geoFormationId, anchorId)
    // Place both at depth 2 m so they map to the same segY (coincident).
    lithoContact.depth_top_m = 2
    refContact.depth_top_m = 2

    renderContactsLayer({
      contacts: [lithoContact],
      formations: [makeFormation(lithoFormationId, 'Zand')],
      placedColumns: [makePlacedColumn(anchorId)],
      levelToScreen: (level) => (10 - level) * 20,
      plotTop: 0,
      plotBottom: 400,
      referenceContacts: [refContact],
      referenceFormations: [makeFormation(geoFormationId, 'Boom Klei')],
      onEditInGeologyStage,
      onDeleteContact,
      onUpdateContactDepth,
    })

    const refStrip = document.querySelector('[data-testid="ref-contact-drag-strip"]')
    const activeStrip = document.querySelector('[data-testid="contact-drag-strip"]')

    // The coincident reference strip is suppressed; the litho drag-strip wins.
    expect(refStrip).toBeNull()
    expect(activeStrip).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// GD6 — "Edit in Stratigraphy stage" on litho contact when parent geo contact exists
//
// Regression for dogfeed Bug 1 (2026-05-26): right-clicking a NON-TOPMOST
// litho contact (i.e. a litho-litho boundary within a geological formation)
// must also show "Edit in Stratigraphy stage" when the litho formation has a
// parent_formation_id AND a matching geological contact at the same anchor
// exists in referenceContacts.  Before the fix only the topmost boundary
// (which had a dedicated reference hit-strip) offered the item; lower
// boundaries silently had no geological context menu.
// ---------------------------------------------------------------------------

describe('GD6 — litho contact right-click shows geo-deep-link when parent geo contact exists', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows "Edit in Stratigraphy stage" for a litho contact whose formation has a parent', () => {
    const onEditInGeologyStage = vi.fn()
    const onDeleteContact = vi.fn().mockResolvedValue(undefined)
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const anchorId = 'borehole-1'

    // Litho formation with a parent geological formation.
    const lithoFormationId = 'litho-formation-1'
    const geoFormationId = 'geo-formation-1'
    const geoContactId = 'geo-contact-1'
    const lithoContactId = 'litho-contact-1'

    const lithoFormation: GeologicalFormationResponse = {
      ...makeFormation(lithoFormationId, 'ZAND'),
      parent_formation_id: geoFormationId,
    }

    // Active litho contact at 3 m depth.
    const lithoContact = makeContact(lithoContactId, lithoFormationId, anchorId)
    lithoContact.depth_top_m = 3

    // Reference geological contact at 1 m (topmost geo boundary) — different
    // depth so it is a truly separate strip.  The litho contact at 3 m is
    // BELOW this geological boundary, making it a litho-litho boundary.
    const geoContact = makeContact(geoContactId, geoFormationId, anchorId)
    geoContact.depth_top_m = 1

    const geoFormation = makeFormation(geoFormationId, 'Quaternary')

    renderContactsLayer({
      contacts: [lithoContact],
      formations: [lithoFormation],
      placedColumns: [makePlacedColumn(anchorId)],
      levelToScreen: (level) => (10 - level) * 20,
      plotTop: 0,
      plotBottom: 400,
      referenceContacts: [geoContact],
      referenceFormations: [geoFormation],
      onEditInGeologyStage,
      onDeleteContact,
      onUpdateContactDepth,
    })

    // The litho contact drag-strip is present.
    const activeStrip = document.querySelector('[data-testid="contact-drag-strip"]')
    expect(activeStrip).not.toBeNull()

    // Right-click the litho contact strip → menu must include the geo deep-link item.
    fireEvent.contextMenu(activeStrip!)
    const menuItem = screen.getByTestId('geo-deep-link-menu-item')
    expect(menuItem).toBeTruthy()
    expect(menuItem.textContent).toBe('Edit in Stratigraphy stage')
  })

  it('calls onEditInGeologyStage with the parent geo contact id (not the litho contact id)', () => {
    const onEditInGeologyStage = vi.fn()
    const onDeleteContact = vi.fn().mockResolvedValue(undefined)
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const anchorId = 'borehole-1'

    const lithoFormationId = 'litho-f-1'
    const geoFormationId = 'geo-f-1'
    const geoContactId = 'geo-c-1'
    const lithoContactId = 'litho-c-1'

    const lithoFormation: GeologicalFormationResponse = {
      ...makeFormation(lithoFormationId, 'KLEI'),
      parent_formation_id: geoFormationId,
    }

    const lithoContact = makeContact(lithoContactId, lithoFormationId, anchorId)
    lithoContact.depth_top_m = 5

    const geoContact = makeContact(geoContactId, geoFormationId, anchorId)
    geoContact.depth_top_m = 2

    renderContactsLayer({
      contacts: [lithoContact],
      formations: [lithoFormation],
      placedColumns: [makePlacedColumn(anchorId)],
      levelToScreen: (level) => (10 - level) * 20,
      plotTop: 0,
      plotBottom: 400,
      referenceContacts: [geoContact],
      referenceFormations: [makeFormation(geoFormationId, 'Quaternary')],
      onEditInGeologyStage,
      onDeleteContact,
      onUpdateContactDepth,
    })

    const activeStrip = document.querySelector('[data-testid="contact-drag-strip"]')!
    fireEvent.contextMenu(activeStrip)
    const menuItem = screen.getByTestId('geo-deep-link-menu-item')
    fireEvent.click(menuItem)

    // The callback must receive the PARENT geological contact id, not the litho contact id.
    expect(onEditInGeologyStage).toHaveBeenCalledTimes(1)
    expect(onEditInGeologyStage).toHaveBeenCalledWith(geoContactId, lithoFormationId)
  })

  it('does NOT show geo-deep-link for a litho contact with no parent formation', () => {
    const onEditInGeologyStage = vi.fn()
    const onDeleteContact = vi.fn().mockResolvedValue(undefined)
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const anchorId = 'borehole-1'

    // Litho formation WITHOUT a parent.
    const lithoFormationId = 'litho-f-orphan'
    const lithoContact = makeContact('litho-c-orphan', lithoFormationId, anchorId)
    lithoContact.depth_top_m = 3

    renderContactsLayer({
      contacts: [lithoContact],
      formations: [makeFormation(lithoFormationId, 'GRIND')], // parent_formation_id is null
      placedColumns: [makePlacedColumn(anchorId)],
      levelToScreen: (level) => (10 - level) * 20,
      plotTop: 0,
      plotBottom: 400,
      onEditInGeologyStage,
      onDeleteContact,
      onUpdateContactDepth,
    })

    const activeStrip = document.querySelector('[data-testid="contact-drag-strip"]')!
    fireEvent.contextMenu(activeStrip)
    expect(screen.queryByTestId('geo-deep-link-menu-item')).toBeNull()
  })
})
