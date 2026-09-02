// Geo deep-link tests (dogfeed 2026-05-25, Slice 6).
//
// GD1 â€” right-click on a reference (geological backdrop) contact hit-strip
//        in the litho section view â†’ the contact context menu opens with the
//        "Edit in Geology stage" item present.
//
// GD2 â€” clicking "Edit in Geology stage" calls the onEditInGeologyStage
//        callback with the correct contactId + formationId args, and the
//        menu does NOT show Delete / Pinch-out for reference contacts.
//
// GD3 â€” GeologyInspector mounts with a non-null ``geoDeepLinkTarget`` â†’
//        ``handleFocusContacts`` is called with the contact id.
//
// GD4 â€” GeologyInspector calls ``setGeoDeepLinkTarget(null)`` after
//        consuming the payload so a re-mount does not re-fire the focus.
//
// GD5 â€” Reference-contact hit-strips render AFTER (on top of) active
//        litho-contact drag strips in SVG DOM order (Slice D z-order fix,
//        dogfeed 2026-05-25).  The strips must be topmost so right-click
//        on a geological contact position wins over any overlapping litho
//        hit-strip at the same depth.
//
// GD1/GD2/GD5 exercise ContactsLayer (the hit-strip + menu item surface).
// GD3/GD4 exercise GeologyInspector (the payload consumer + clear).

import { render, cleanup, fireEvent, screen, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// GD1 / GD2  â€” ContactsLayer ref-contact hit-strip + menu item
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

describe('GD1 â€” right-click reference contact shows "Edit in Geology stage" menu item', () => {
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
    expect(menuItem.textContent).toBe('Edit in Geology stage')
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
      // onEditInGeologyStage absent â€” hit-strips must not render
    })

    const strip = document.querySelector('[data-testid="ref-contact-drag-strip"]')
    expect(strip).toBeNull()
  })
})

describe('GD2 â€” clicking "Edit in Geology stage" calls the callback with correct args', () => {
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
// GD5 â€” coincident reference strip is SUPPRESSED, not topmost (#159 supersedes
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

describe('GD5 â€” coincident reference strip is suppressed so the litho contact stays draggable (#159)', () => {
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
// GD6 â€” "Edit in Geology stage" on litho contact when parent geo contact exists
//
// Regression for dogfeed Bug 1 (2026-05-26): right-clicking a NON-TOPMOST
// litho contact (i.e. a litho-litho boundary within a geological formation)
// must also show "Edit in Geology stage" when the litho formation has a
// parent_formation_id AND a matching geological contact at the same anchor
// exists in referenceContacts.  Before the fix only the topmost boundary
// (which had a dedicated reference hit-strip) offered the item; lower
// boundaries silently had no geological context menu.
// ---------------------------------------------------------------------------

describe('GD6 â€” litho contact right-click shows geo-deep-link when parent geo contact exists', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows "Edit in Geology stage" for a litho contact whose formation has a parent', () => {
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

    // Reference geological contact at 1 m (topmost geo boundary) â€” different
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

    // Right-click the litho contact strip â†’ menu must include the geo deep-link item.
    fireEvent.contextMenu(activeStrip!)
    const menuItem = screen.getByTestId('geo-deep-link-menu-item')
    expect(menuItem).toBeTruthy()
    expect(menuItem.textContent).toBe('Edit in Geology stage')
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

// ---------------------------------------------------------------------------
// GD3 / GD4  â€” GeologyInspector payload consumer + clear
// ---------------------------------------------------------------------------

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import GeologyInspector from '../geology/GeologyInspector'

vi.mock('../../../api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
      },
    },
  }
})

vi.mock('../../../components/interpretation/FormationDialog', () => ({
  default: () => null,
}))

const noopAsync = (): Promise<void> => Promise.resolve()
const noopAsyncNull = (): Promise<null> => Promise.resolve(null)
const noopAsyncNullableModel =
  (): Promise<import('../../../api/client').GeologicalModelResponse | null> =>
    Promise.resolve(null)
const noopAsyncCandidates = (): Promise<{
  candidates: import('../../../hooks/useGeologicalModel').FormationCandidate[]
  collisions: import('../../../hooks/useGeologicalModel').LumpingCollision[]
}> => Promise.resolve({ candidates: [], collisions: [] })

function makeStubContext(overrides?: {
  geoDeepLinkTarget?: { sectionId: string; contactId: string } | null
  setGeoDeepLinkTarget?: (target: { sectionId: string; contactId: string } | null) => void
  handleFocusContacts?: (ids: readonly string[]) => void
}): ShellContextValue {
  const handleFocusContacts = overrides?.handleFocusContacts ?? vi.fn()
  const setGeoDeepLinkTarget = overrides?.setGeoDeepLinkTarget ?? vi.fn()
  const geoDeepLinkTarget = overrides?.geoDeepLinkTarget ?? null

  return {
    project: {
      id: 'proj-1',
      name: 'Test Project',
      project_number: null,
      client: null,
      site_label: null,
      description: null,
      tags: [],
      default_horizontal_epsg: 31370,
      default_vertical_epsg: 5710,
      phase: 'design',
      status: 'active',
      view_state: {},
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      archived_at: null,
    },
    lifecycle: {
      projectDirty: false,
      newProjectOpen: false,
      setNewProjectOpen: vi.fn(),
      metadataEditorOpen: false,
      setMetadataEditorOpen: vi.fn(),
      closeConfirmOpen: false,
      setCloseConfirmOpen: vi.fn(),
      unsavedDialogOpen: false,
      unsavedSaving: false,
      saveProject: () => Promise.resolve(true),
      discardSessionImports: vi.fn(),
      handleCloseProjectRequest: vi.fn(),
      handleUnsavedSave: noopAsync,
      handleUnsavedDiscard: vi.fn(),
      handleUnsavedCancel: vi.fn(),
      stageLumping: vi.fn(),
      currentLumping: null,
    },
    investigations: {
      cpts: [],
      boreholes: [],
      detailMap: new Map(),
      plotMap: new Map(),
      boreholeDetailMap: new Map(),
      importing: false,
      dovImporting: false,
      dovImportState: { status: 'idle' } as const,
      resetDovImport: vi.fn(),
      bboxImportType: null,
      removedCptIds: new Set(),
      removedBoreholeIds: new Set(),
      refreshList: noopAsync,
      refreshBoreholeList: noopAsync,
      loadCptDetail: noopAsync,
      loadChart: noopAsync,
      loadBoreholeDetail: noopAsync,
      cancelBboxDraw: vi.fn(),
      unhideCpts: vi.fn(),
      unhideBoreholes: vi.fn(),
      handleRemoveCpts: vi.fn(),
      handleRemoveBoreholes: vi.fn(),
      handleRestoreAllCpts: vi.fn(),
      handleRestoreAllBoreholes: vi.fn(),
      handlePatchCptElevation: noopAsync,
      handlePatchBoreholeElevation: noopAsync,
      handleImportCpt: noopAsync,
      handleImportDov: vi.fn(),
      handleImportBoreholeDov: vi.fn(),
      handleBboxDrawn: noopAsync,
      pendingCptPins: [],
    },
    visibleCpts: [],
    visibleBoreholes: [],
    geoModel: {
      activeGeologicalModel: null,
      models: [],
      activeLithoModel: null,
      handleCreateLithoModel: async () => null,
      handleActivateLithoModel: async () => {},
      lithoContacts: [],
      lithoLayers: [],
      lithoFormations: [],
      lithoSurfacesByFormationId: new Map(),
      handleCreateLithoContact: noopAsync,
      handleInlineLithoCreateFormation: noopAsyncNull,
      formations: [],
      visibleFormations: [],
      formationsRefreshCounter: 0,
      contacts: [],
      surfacesByFormationId: new Map(),
      crossingsRefreshCounter: 0,
      staleSurfaceCount: 0,
      handleFormationCreated: vi.fn(),
      handleFormationUpdated: vi.fn(),
      handleFormationDeleted: vi.fn(),
      handleInlineCreateFormation: noopAsyncNull,
      refetchFormations: vi.fn(),
      handleCreateContact: noopAsync,
      handleUpdateContactDepth: noopAsync,
      handleBatchCreateContacts: noopAsync,
      handleBatchUpdateContacts: noopAsync,
      handleDeleteContact: noopAsync,
      handleUnlinkLithoFromGeo: noopAsync,
      handleLinkLithoToGeo: noopAsync,
      handleAutoPopulateFromStratigraphy: noopAsync,
      handleDedupeContacts: () => Promise.resolve(0),
      handleRebuildSurfaces: noopAsync,
      handleExportModelPlaxis3d: noopAsync,
      handleToggleBoreholeInModel: noopAsync,
      discardContacts: vi.fn(),
      discoverBoreholeFormations: noopAsyncCandidates,
      applyBoreholeFormationSelection: noopAsync,
      handleDeleteModel: noopAsync,
      ensureActiveGeologicalModel: noopAsyncNullableModel,
      ghostsByAnchor: new Map(),
      // Recovery-only setter (docs/design/autosave-recovery.md §2, item 2).
      setGhostsByAnchor: vi.fn(),
      focusedSuggestAnchorId: null,
      handleEditLithoSuggestion: () => {},
      bulkLithoSuggesting: false,
      handleSuggestAllLitho: async () => {},
      handleAcceptBulkLitho: async () => {},
      handleAcceptAllBulkLitho: async () => {},
      handleRejectBulkLitho: () => {},
      handleUnrejectBulkLitho: () => {},
      handleEditBulkLitho: () => {},
      handleInsertLithoLayer: vi.fn(),
      handleSplitLithoLayer: vi.fn(),
      handleMergeLithoLayers: vi.fn(),
      handleAbsorbLithoLayer: vi.fn(),
      clearBulkLithoGhosts: () => {},
      handleStripLithoAdmixtures: () => {},
      handleReseedLithoAdmixtures: () => {},
      handleClearLithoModel: noopAsync,
      refetchLithoContacts: () => {},
      lithoSuggesting: false,
      handleSuggestLitho: noopAsync,
      handleAcceptLithoSuggestion: noopAsyncNull,
      handleAcceptAllLithoSuggestions: noopAsync,
      handleRejectLithoSuggestion: vi.fn(),
      handleUnrejectLithoSuggestion: vi.fn(),
      clearLithoSuggestions: vi.fn(),
      handleDeleteLithoModel: noopAsync,
      backdropSurfacesByFormationId: new Map(),
      handleLoadBackdropSurfaces: noopAsync,
      lithoSolids: [],
      lithoSolidsLoading: false,
      lithoSolidsBuilding: false,
      hasLithoSolids: false,
      hasStaleLithoSolid: false,
      buildLithoSolids: noopAsync,
      setBodyColor: vi.fn(),
      hideMarkers: false,
      setHideMarkers: vi.fn(),
      geotechSolids: [],
      geotechSolidsLoading: false,
      geotechSolidsBuilding: false,
      hasGeotechSolids: false,
      hasStaleGeotechSolid: false,
      buildGeotechSolids: noopAsync,
      setGeotechBodyColor: vi.fn(),
      geotechHideMarkers: false,
      setGeotechHideMarkers: vi.fn(),
      geotechGaplessReport: null,
      // Debt #266 — geotech columns standing on litho that has since moved.
      staleLithoGeotechColumns: [],
      staleLithoGeotechColumnIds: new Set<string>(),
      staleLithoGeotechColumnCount: 0,
      unstampedGeotechColumnCount: 0,
      refreshGeotechLithoStaleness: vi.fn(),
      lithoStaleSurfaceCount: 0,
      handleRebuildLithoSurfaces: noopAsync,
      handleAutoCorrelate: noopAsync,
      handleClearSuggestions: noopAsync,
      lithoCrossingPinchOuts: [],
      activeGeotechModel: null,
      geotechLayers: [],
      geotechLayersLoaded: true,
      geotechLayersVersion: 0,
      geotechContacts: [],
      geotechFormations: [],
      columnsNeedingRederive: [],
      handleCreateManualLithoGhost: vi.fn(),
      handleExtendLithoGhostToNearestContacts: vi.fn(() => ({ ok: true })),
      markMutated: vi.fn(),
      handleSubdivideAllBodies: noopAsync,
      handleDivideBoreholes: noopAsync,
      requestGeotechLayersRefetch: vi.fn(),
    },
    sections: {
      sections: [],
      selectedSectionId: null,
      drawingSection: false,
      focusedContactIds: [],
      visibleSections: [],
      effectiveHorizontalEpsg: 31370,
      sectionModelAxis: 'geological' as const,
      setSectionModelAxis: vi.fn(),
      backdropModelIdOverride: null,
      setBackdropModelIdOverride: vi.fn(),
      refreshSectionList: noopAsync,
      clearSectionSelection: vi.fn(),
      handleSectionCreated: vi.fn(),
      handleSectionDeleted: vi.fn(),
      handleCreateSection: noopAsyncNull,
      cancelSectionDraw: vi.fn(),
      handleSectionLineDrawn: noopAsync,
      handleDeleteSection: noopAsync,
      handlePatchSelectedSection: noopAsync,
      handleSelectSection: vi.fn(),
      handleFocusContacts,
      applyUpdatedSection: vi.fn(),
      sectionFocusedColumn: null,
      setSectionFocusedColumn: vi.fn(),
      correlateMode: false,
      correlationSource: null,
      enterCorrelateMode: vi.fn(),
      exitCorrelateMode: vi.fn(),
      armCorrelationSource: vi.fn(),
      clearCorrelationSource: vi.fn(),
      suggestedTies: [],
      handleSuggestTies: vi.fn(),
      handleAcceptTie: vi.fn(),
      handleAcceptAllTies: vi.fn(),
      handleRejectTie: vi.fn(),
      handleClearTieSuggestions: vi.fn(),
    },
    overlays: {
      demSource: null,
      demOverlay: { enabled: false, opacity: 0.6 },
      handleDemOverlayChange: noopAsync,
      virtueleBoringOverlay: { modelA: null, modelB: null, maxDepthM: null },
      virtueleBoringSectionModels: [],
      virtueleBoringPredictions: [],
      virtueleBoringLoading: false,
      virtueleBoringSkippedCount: 0,
      virtueleBoringPredictionByInvestigationId: new Map(),
      cptEffectiveModels: [],
      boreholeEffectiveModels: [],
      showOverlayOnSection: false,
      showOverlayOnCpt: false,
      showOverlayOnBorehole: false,
      cptVirtueleBoringOverride: '',
      boreholeVirtueleBoringOverride: '',
      handleChangeVirtueleBoringPicker: noopAsync,
      handleSetShowOverlay: vi.fn(),
      handleSetOverlayOverride: vi.fn(),
      showConfidenceFade: true,
      handleSetShowConfidenceFade: vi.fn(),
    },
    toasts: {
      toasts: [],
      toast: vi.fn(),
    },
    undo: {
      push: vi.fn(),
      undo: noopAsync,
      redo: noopAsync,
      clear: vi.fn(),
      canUndo: false,
      canRedo: false,
      busy: false,
    },
    boot: { ready: true, apiError: false },
    mapState: {
      hiddenCptTypes: new Set(),
      hiddenBoreholeValues: {
        drill_method: new Set<string>(),
        borehole_type: new Set<string>(),
      },
      boreholeAxis: 'drill_method',
      viewportBounds: null,
      mapCameraRef: { current: null },
      handleToggleCptType: vi.fn(),
      handleToggleBoreholeValue: vi.fn(),
      setBoreholeAxis: vi.fn(),
      handleViewportChange: vi.fn(),
      handleMapCameraChange: vi.fn(),
    },
    coordinator: {
      selectedId: null,
      selectedBoreholeId: null,
      setSelectedId: vi.fn(),
      setSelectedBoreholeId: vi.fn(),
      view: 'map',
      setView: vi.fn(),
      handleSelect: noopAsync,
      handleSelectBorehole: noopAsync,
      handleExportSectionDxf: noopAsync,
      handleExportSectionPlaxis2d: noopAsync,
      outOfViewportCptIds: new Set(),
      outOfViewportBoreholeIds: new Set(),
      projectFilePath: null,
      manifestFormationIds: new Set(),
      sessionImportCptIds: new Set(),
      sessionImportBoreholeIds: new Set(),
      sessionImportSectionIds: new Set(),
      sessionImportFormationIds: new Set(),
      marqueeSelectedIds: new Set(),
      setMarqueeSelectedIds: vi.fn(),
      hoveredTestId: null,
      setHoveredTestId: vi.fn(),
      geoDeepLinkTarget,
      setGeoDeepLinkTarget,
      sectionsDeepLinkTarget: null,
      setSectionsDeepLinkTarget: vi.fn(),
      parametersDeepLinkTarget: null,
      setParametersDeepLinkTarget: vi.fn(),
      selectedParameterUnit: null,
      setSelectedParameterUnit: vi.fn(),
      parametersActiveTab: 'per-test',
      setParametersActiveTab: vi.fn(),
      correlationEdgesRefetchNonce: 0,
      bodyRecomputeLithoNonce: 0,
      bodyRecomputeGeotechNonce: 0,
      requestBodyRecompute: vi.fn(),
    handleSelectWithoutView: vi.fn(),
    markMutated: vi.fn(),
    },
  }
}

describe('GD3 â€” GeologyInspector consumes geoDeepLinkTarget on mount', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('calls handleFocusContacts with the contact id when target is set', async () => {
    const handleFocusContacts = vi.fn()
    const setGeoDeepLinkTarget = vi.fn()
    const ctx = makeStubContext({
      geoDeepLinkTarget: { sectionId: 'section-1', contactId: 'contact-1' },
      handleFocusContacts,
      setGeoDeepLinkTarget,
    })

    await act(async () => {
      render(
        <ShellContext.Provider value={ctx}>
          <GeologyInspector />
        </ShellContext.Provider>,
      )
    })

    expect(handleFocusContacts).toHaveBeenCalledTimes(1)
    expect(handleFocusContacts).toHaveBeenCalledWith(['contact-1'])
  })

  it('does NOT call handleFocusContacts when geoDeepLinkTarget is null', async () => {
    const handleFocusContacts = vi.fn()
    const ctx = makeStubContext({ geoDeepLinkTarget: null, handleFocusContacts })

    await act(async () => {
      render(
        <ShellContext.Provider value={ctx}>
          <GeologyInspector />
        </ShellContext.Provider>,
      )
    })

    expect(handleFocusContacts).not.toHaveBeenCalled()
  })
})

describe('GD4 â€” GeologyInspector clears payload after first apply', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('calls setGeoDeepLinkTarget(null) to clear the bus after consuming the contact id', async () => {
    const handleFocusContacts = vi.fn()
    const setGeoDeepLinkTarget = vi.fn()
    const ctx = makeStubContext({
      geoDeepLinkTarget: { sectionId: 'section-1', contactId: 'contact-42' },
      handleFocusContacts,
      setGeoDeepLinkTarget,
    })

    await act(async () => {
      render(
        <ShellContext.Provider value={ctx}>
          <GeologyInspector />
        </ShellContext.Provider>,
      )
    })

    // The inspector must clear the target after consuming it so a
    // re-mount does not re-fire the focus.
    expect(setGeoDeepLinkTarget).toHaveBeenCalledTimes(1)
    expect(setGeoDeepLinkTarget).toHaveBeenCalledWith(null)
  })
})

