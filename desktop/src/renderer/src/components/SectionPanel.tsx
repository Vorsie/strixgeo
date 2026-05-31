/**
 * Cross-section panel — viewport state + coordinate transforms +
 * SVG composition. Sub-components for header, scrub bar, columns,
 * DEM polyline live in ``components/sections/``; data fetching
 * (DEM samples, CPT plot batch, projected investigations) lives in
 * the ``useSectionData`` hook.
 *
 * What this orchestrator owns:
 *
 *   * Viewport state — xMin/xMax, levelMin/levelMax, VEX. These are
 *     interaction-driven (pan, wheel-zoom, slider, scrub bar) and
 *     drive every coordinate transform on screen.
 *   * Coordinate transforms — ``xToScreen``, ``levelToScreen``, and
 *     their inverses. Cached as ``useCallback``s with the viewport
 *     in the dep list so the sub-components see stable identities
 *     across renders that don't actually change the transform.
 *   * Pan / wheel-zoom / scrub-bar / zoom-button interactions.
 *   * Collision-handled column layout (``placedColumns``). Depends
 *     on viewport because the per-column screen X comes from
 *     ``xToScreen``, so it lives here rather than in the data hook.
 *   * Render composition — wires the data layer into the SVG.
 *
 * Rendering choice: SVG over Canvas. Matches BoreholeLog / CptChart
 * which already handle 1000+ elements without trouble, and keeps
 * DOM inspection / hover tooltips / accessibility easy. If column
 * rendering pushes into >2000 elements range we'll revisit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Layers } from 'lucide-react'

import { EmptyState } from '../shell/EmptyState'
import type {
  AdmixtureItem,
  BoreholeListItem,
  CptListItem,
  BoreholeDetailResponse,
  CptPlotResponse,
  CrossSectionResponse,
  FormationContactBatchUpdateEntry,
  FormationContactResponse,
  FormationSurfaceResponse,
  GeologicalFormationCreatePayload,
  GeologicalFormationResponse,
  LensBoundaryNode,
  LensBoundaryResponse,
  LensRenderStyle,
  LithoContactCorrelationEdge,
  LithoLayerSuggestion,
  LithoLensListItem,
  VirtueleBoringInvestigationPrediction,
} from '../api/client'
import { verticalDatumShort } from '../utils/verticalDatum'
import { log } from '../utils/log'
import { nudgeColumns } from '../utils/columnLayout'
import type { ProjectedInvestigation } from '../utils/sectionProjection'
import { SoilPatterns } from '../utils/soilPatterns'
import FormationPickerDialog from './interpretation/FormationPickerDialog'
import LithoCompositionPickerDialog from './interpretation/LithoCompositionPickerDialog'
import BoreholeColumn from './sections/BoreholeColumn'
import ColumnContextMenu from './sections/ColumnContextMenu'
import { buildRemoveFromSectionCommand } from './sections/removeFromSectionCommand'
import ContactPickBar from './sections/ContactPickBar'
import ContactsLayer, {
  type ContactCopyPayload,
  type MarqueeState,
  type SnapCandidate,
} from './sections/ContactsLayer'
import { lookupCptValueAtDepth } from './sections/cptInterpolation'
import { useColumnContextMenu } from './sections/useColumnContextMenu'
import { useContactPicker } from './sections/useContactPicker'
import { useFocusColumn } from './sections/useFocusColumn'
import CptDataColumn from './sections/CptDataColumn'
import {
  cptBandFullWidth,
  cptBandHalfWidth,
  enabledBoreholeChannelCount,
  pickQcFullScaleMpa,
  type CptChannels,
} from './sections/cptChannels'
import DemSurfaceLine from './sections/DemSurfaceLine'
import InvestigationColumns from './sections/InvestigationColumns'
import CorrelationEdgesOverlay, {
  type ContactGestureState,
} from './sections/CorrelationEdgesOverlay'
import LensWedgeOverlay from './sections/LensWedgeOverlay'
import LithoSuggestionGhostColumns from './sections/LithoSuggestionGhostColumns'
import { type WarpAnchor } from './sections/sectionWarp'

/** Stable empty map so the LensWedgeOverlay prop identity doesn't churn. */
const EMPTY_LENS_BOUNDARIES: ReadonlyMap<string, LensBoundaryResponse> = new Map()
import PinchOutGhostOverlay, {
  PinchOutConfirmPanel,
} from './sections/PinchOutGhostOverlay'
import VirtueleBoringGhostColumns, {
  virtueleBoringGhostRailWidth,
} from './sections/VirtueleBoringGhostColumns'
import VirtueleBoringStrip from './sections/VirtueleBoringStrip'
import SectionHeader from './sections/SectionHeader'
import SectionScrubBar from './sections/SectionScrubBar'
// MarkAsLensDialog removed in #101 R5 (Approach-C → Position 4)
import { useSectionData } from './sections/useSectionData'
import {
  BARE_COLUMN_WIDTH_PX,
  COLUMN_EDGE_GAP_PX,
  DEFAULT_LEVEL_RANGE,
  MARGIN,
  VEX_DEFAULT,
  WHEEL_ZOOM_FACTOR,
  collectSnapDepths,
  sectionLengthM,
  ticks,
  useElementSize,
  type PlacedColumn,
  type PlacedColumnInput,
  type Viewport,
} from './sections/utils'
import {
  selectVisibleLabels,
  type ColumnLabelMode,
} from '../utils/columnLabelLod'

interface Props {
  section: CrossSectionResponse
  /** Project-level vertical EPSG used for the y-axis label.
   * ``null`` → the axis renders without a datum suffix (just
   * "Level (m)"). */
  zEpsg?: number | null
  /** All CPTs in the project. The panel filters down to those that
   * project within the section's buffer + endpoints. */
  cpts?: readonly CptListItem[]
  /** All boreholes in the project. Same filter as cpts. */
  boreholes?: readonly BoreholeListItem[]
  /** Patch the section row server-side. Called on slider release
   * for ``projection_buffer_m`` and ``vertical_exaggeration`` and
   * on every channel-toggle click for ``view_state.cpt_channels``,
   * so the values persist across opens and ride the .gmproj
   * bundle. The handler is optional so the test-render path can
   * mount without a network seam. */
  onPatch?: (patch: {
    projection_buffer_m?: number
    vertical_exaggeration?: number
    view_state?: Record<string, unknown>
    excluded_cpt_ids?: string[]
    excluded_borehole_ids?: string[]
  }) => Promise<void>
  /** Close the section view — typically clears the parent's
   * selectedSectionId so the App's render branch flips back to the
   * map. Optional so the test-render path can mount without a
   * navigation seam. */
  onClose?: () => void
  /** Double-click handlers for the projected column glyphs. A
   * double-click opens the CPT/borehole detail panel (same handler
   * as the map's click-to-open flow). Single-click stays inert —
   * the anti-accidental-pan-click decision is preserved; only an
   * explicit double-click navigates away. Optional for the test-
   * render path. */
  onSelectCpt?: (id: string) => void
  onSelectBorehole?: (id: string) => void
  /**
   * Callback fired whenever the section's focused column changes.
   *
   * Lifted to the shell so ``SectionsToolbar`` can use the focused
   * column's kind/id for the litho-axis "Suggest litho" button
   * (which needs a section-local focus, not the global CPT/borehole
   * selection that the map/data clicks set).  Absent in the test-
   * render path.
   */
  onFocusedColumnChange?: (col: import('./sections/useFocusColumn').FocusTarget | null) => void
  /** Active geological model's formation contacts — render as the
   * Phase 4 editor overlay (horizontal lines connecting picks per
   * formation across the projected investigations). Filtered by the
   * section's ``seeded_formation_contact_ids`` (the explicit-content
   * invariant), so it's a SUBSET of the active model's contacts. */
  contacts?: readonly FormationContactResponse[]
  /** UNFILTERED active-axis contacts (NOT seeded-only). Used by the
   * crossings-banner zoom-to-detail effect to resolve focused
   * contact ids → anchor → column, because the offending crossing
   * contacts are global to the geological model and may not be in
   * this section's seeded set. Optional; falls back to ``contacts``
   * when omitted (older tests + integration sites that don't supply
   * the full list). */
  focusableContacts?: readonly FormationContactResponse[]
  /** P1b (dogfeed 2026-05-30) — forwarded to ContactsLayer so the
   *  matching contact renders at the live depth during a cross-store
   *  suggestion drag. SectionsCanvas owns the state. */
  liveContactDepthOverride?: { contactId: string; depthM: number } | null
  /** Formation vocabulary — used to colour each contact polyline
   * with the formation's own colour. */
  formations?: readonly GeologicalFormationResponse[]
  /** Borehole IDs the active model excludes from contact rendering.
   * The ContactsLayer skips polyline vertices at these anchors. */
  excludedBoreholeIds?: readonly string[]
  /** Cached TIN surfaces for the active geological model, keyed by
   * formation id. Forwarded straight to ContactsLayer; when present
   * the surface line renders as a slice-of-TIN against the section
   * line so off-line picks contribute properly. Absent → connect-the-
   * dots fallback in ContactsLayer (still works for sparse data). */
  surfacesByFormationId?: ReadonlyMap<string, FormationSurfaceResponse>
  /**
   * Reference (backdrop) formations from the parent geological model — rendered
   * as faint read-only polylines behind the active litho contacts.  Only
   * populated on the litho axis; absent on the geological axis (zero regression).
   * Forwarded straight to ContactsLayer which owns the backdrop render path.
   */
  referenceFormations?: readonly GeologicalFormationResponse[]
  /**
   * Cached TIN surfaces for the geological backdrop model, keyed by formation id.
   * Forwarded straight to ContactsLayer.  Absent when no backdrop is loaded yet.
   */
  referenceSurfacesByFormationId?: ReadonlyMap<string, FormationSurfaceResponse>
  /**
   * Geological contacts for the backdrop polyline render — snap-to-contact
   * version of the backdrop on the litho axis. The TIN-slice backdrop
   * (``referenceSurfacesByFormationId``) shows the formation surface AT the
   * section line's (x,y), but investigations are projected onto the section
   * from offset positions and the slice elevation at the projected_x diverges
   * from the user's actual contact depth. These contacts let ContactsLayer
   * draw the backdrop as a polyline through every contact's (anchor_x,
   * contact_elevation) so the line goes exactly through the picks.
   */
  referenceContacts?: readonly FormationContactResponse[]
  /** Contact ids the user has asked to be visually highlighted —
   * driven by the crossings banner click (debt #9). Forwarded to
   * ContactsLayer which renders the ring + pulse. Transient: App
   * clears the array on a short timer after dispatch. */
  focusedContactIds?: readonly string[]
  /** Click-to-place hook. Fires when the user picks a formation on
   * the picker modal — caller (App) POSTs the contact and updates
   * the contacts state. Omitting it leaves the section read-only.
   *
   * ``snapped`` reflects whether the depth came from a snap-to-
   * stratigraphy boundary; the caller uses it to decide the
   * contact's ``source`` + ``confidence`` fields (debt #22/#23). */
  onCreateContact?: (
    anchorKind: 'cpt' | 'borehole',
    anchorId: string,
    depth_m: number,
    formationId: string,
    snapped: boolean,
  ) => Promise<void>
  /** Drag-to-re-pick hook. Fires on the drag's mouseup with the
   * contact id, its new depth_top_m, and whether the depth landed
   * on a snap candidate. Caller PATCHes and updates the local
   * contacts state. */
  onUpdateContactDepth?: (
    contactId: string,
    newDepthM: number,
    snapped: boolean,
  ) => Promise<void>
  /** Right-click → confirm → delete a contact. Forwarded straight
   * through to ContactsLayer; the picker / drag flows don't touch
   * it. Caller deletes the row and prunes the local contacts
   * state so the overlay updates without a refetch. */
  onDeleteContact?: (contactId: string) => Promise<void>
  /** Break the litho↔geo coupling on a lithostratigraphic contact.
   * Forwarded straight to ContactsLayer; absent on the geological axis. */
  onUnlinkLithoFromGeo?: (contactId: string) => Promise<void>
  /** Establish the litho↔geo coupling on an uncoupled lithostratigraphic contact.
   * Forwarded straight to ContactsLayer; absent on the geological axis. */
  onLinkLithoToGeo?: (contactId: string) => Promise<void>
  /** All-or-nothing batch update — fired by the section editor's
   * multi-drag (same-column depth shift) and cross-column re-anchor
   * (Alt+drag MOVE) flows. Forwarded straight to ContactsLayer;
   * the caller posts the batch and refreshes the local contacts
   * state in one pass. */
  onBatchUpdateContacts?: (
    updates: readonly FormationContactBatchUpdateEntry[],
  ) => Promise<void>
  /** Batch CREATE — fired by cross-column drag WITHOUT Alt (the
   * COPY default). Each entry becomes a new contact at the target
   * anchor with the dragged depth; originals stay where they were.
   * Forwarded to ContactsLayer. */
  onBatchCreateContacts?: (
    creates: readonly ContactCopyPayload[],
  ) => Promise<void>
  /** Inline-create a formation from the picker modal's "New
   * formation here" affordance. Returns the new row's id so the
   * picker can chain to a contact commit. */
  onCreateFormation?: (
    payload: GeologicalFormationCreatePayload,
  ) => Promise<{ id: string } | null>
  /** Fire the "Export DXF" header action. The handler owns the
   * fetch + Electron save-dialog + file-write flow so the panel
   * stays storage-agnostic. Omitting it (or there being no active
   * geological model) hides the button. */
  onExportDxf?: () => Promise<void>
  /**
   * Which model axis is active on this section.  Defaults to
   * ``'geological'`` (existing behaviour — zero regression).
   *
   * When ``'lithostratigraphic'``, the formation-contact picker
   * renders ``LithoCompositionPickerDialog`` instead of
   * ``FormationPickerDialog``.  The geological + geotechnical axes
   * use the original dialog unchanged.
   */
  axisMode?: 'geological' | 'lithostratigraphic'
  /**
   * Inclusive snap tolerance (m) for the litho↔geological drag-
   * indicator (debt #134-B).  Threaded straight to ContactsLayer.
   * Only meaningful on the litho axis; the geological axis ignores
   * it.  When ``undefined`` on the litho axis the in-flight badge
   * is suppressed (still post-release behaviour via SectionsCanvas).
   */
  geoSnapToleranceM?: number
  /**
   * Litho axis: fired when the user picks a composition in the "New
   * unit" tab of ``LithoCompositionPickerDialog``.  The caller posts
   * the synthetic accept-litho-suggestions payload and returns the
   * created (or found) formation id.
   *
   * When ``undefined`` the new-unit path in the picker is still
   * reachable but ``onCreateLithoUnit`` no-ops (open/test render).
   *
   * Parameters
   * ----------
   * mainCode
   *     Base lithology token (ZAND / KLEI / SILT / GRIND / VEEN).
   * admixtures
   *     Admixture items in the order the user added them.
   * anchorKind
   *     ``'cpt'`` or ``'borehole'``.
   * anchorId
   *     Id of the investigation the contact is placed on.
   * depthM
   *     Depth below ground surface for the contact.
   */
  onManualLithoUnitCreate?: (
    mainCode: string,
    admixtures: AdmixtureItem[],
    anchorKind: 'cpt' | 'borehole',
    anchorId: string,
    depthM: number,
  ) => Promise<{ formationId: string } | null>
  /** Debt #151 dogfeed refinement 2026-05-27 — wire the picker's
   *  "Existing units" tab on the litho axis.  The default
   *  ``onSelect`` flow goes through ``useContactPicker``'s
   *  ``onCreateContact``, which is undefined on litho axis (left-click
   *  doesn't open the picker — by design), so the existing-units
   *  click silently does nothing.  This callback runs instead on the
   *  litho axis: looks up the chosen formation by id and creates a
   *  manual ghost using its ``litho_main_soil_code`` + admixtures. */
  onLithoExistingUnitPick?: (
    anchorKind: 'cpt' | 'borehole',
    anchorId: string,
    depthM: number,
    formationId: string,
  ) => Promise<void>
  /** Per-project confidence-fade toggle (debt #94 follow-up).  When
   *  false, the low-confidence stroke opacity multiplier becomes 1.0
   *  so the uncertainty cue disappears.  Defaults to true. */
  showConfidenceFade?: boolean
  /**
   * Active lithostratigraphic model id.  Required for the lens-naming
   * context-menu gesture — passed through so the action always has a
   * valid model UUID even when no contacts have been seeded yet.
   * When absent (or when ``axisMode !== 'lithostratigraphic'``) the
   * lens-naming menu item is hidden.
   */
  activeLithoModelId?: string | null
  /** Fire the "Seed from stratigraphy" header action. Receives the
   * borehole IDs projected onto the active section (computed here
   * from placedColumns); the handler scopes the auto-populate call
   * to that list. Omitting it (or no active model) hides the button. */
  onAutoPopulateFromStratigraphy?: (
    boreholeIds: readonly string[],
  ) => Promise<void>
  /** DOV Virtuele Boring overlay — informative-only ghost columns
   * rendered next to each investigation. Empty array / undefined
   * prop = no overlay. Up to two model codes are honoured (the UI
   * provides two dropdowns); extras are silently truncated. */
  virtueleBoringActiveModels?: readonly string[]
  /** Per-investigation overlay payload — built by App.tsx from
   * ``api.virtueleBoring.predictions`` and cached there across
   * renders so toggling the section view doesn't refetch. */
  virtueleBoringPredictions?: readonly VirtueleBoringInvestigationPrediction[]
  /** Picker state, owned by App.tsx (round-trips via project
   * view_state). The overlay strip mounts at the top of the section
   * pane and writes through these props. */
  virtueleBoringModelA?: string | null
  virtueleBoringModelB?: string | null
  virtueleBoringMaxDepthM?: number | null
  /** Per-pane visibility flag (localStorage-backed in App). When
   * false, the ghost columns hide but the picker stays expanded so
   * the user can flip it back on without losing state. */
  virtueleBoringShowOnSection?: boolean
  onChangeVirtueleBoringPicker?: (next: {
    modelA: string | null
    modelB: string | null
    maxDepthM: number | null
  }) => void
  onChangeVirtueleBoringShowOnSection?: (next: boolean) => void
  /**
   * Litho-suggestion ghost state (slice 3, #55).  When present, a ghost
   * column overlay renders to the LEFT of the targeted investigation's band
   * showing the segmenter's layer boundaries — click to accept, right-click
   * to reject.  Absent / undefined = no overlay (zero regression for callers
   * that don't use the litho axis).
   */
  lithoGhostState?: {
    /** Suggestion layers ordered top→bottom from the segmenter. */
    suggestions: readonly LithoLayerSuggestion[]
    /** Id of the CPT or borehole whose suggestions are shown. */
    investigationId: string
    /** mTAW surface elevation used to convert depth→absolute level. */
    surfaceElevationM: number | null
    /** Indices already accepted (contact created). */
    acceptedIndices: ReadonlySet<number>
    /** Indices explicitly rejected. */
    rejectedIndices: ReadonlySet<number>
    /** Fire when the user left-clicks a pending layer to accept it. */
    onAccept: (idx: number) => void
    /** Fire when the user right-clicks / Shift-clicks to reject. */
    onReject: (idx: number) => void
    /** Undo a prior reject — restore the layer to pending (debt #80). */
    onUnreject?: (idx: number) => void
    /**
     * Drag-resize state (Phase 2). Map from suggestion index to user
     * edits on its top / base depth. The ghost renderer applies these
     * at render time so the layer rect tracks the user's drag commit.
     * Empty Map / undefined = no edits.
     */
    edits?: ReadonlyMap<number, { depth_top_m?: number; depth_base_m?: number }>
    /**
     * Commit a drag edit to one suggestion. Partial: set just the
     * touched edge. The state owner merges into existing edits so
     * dragging the same edge twice composes.
     */
    onEdit?: (idx: number, edit: { depth_top_m?: number; depth_base_m?: number }) => void
    /**
     * Debt #86: cross-investigation paste of an Alt-drag-copied
     * composition.  Routes to ``handleEditBulkLitho`` with the target
     * anchor id resolved from the document-level hit-test.
     */
    onCrossColumnPaste?: (
      targetAnchorId: string,
      idx: number,
      edit: {
        suggested_lithology: string
        suggested_admixtures: readonly { soil_code: string; amount: string; locally: boolean }[]
      },
    ) => void
    /** Debt #85: insert a new pending litho layer at the shared
     *  boundary between ``afterIdx`` and ``afterIdx+1`` for this
     *  bundle's focused anchor. */
    onInsertLayer?: (
      afterIdx: number,
      composition: {
        suggested_lithology: string
        suggested_admixtures: readonly { soil_code: string; amount: string; locally: boolean }[]
      },
    ) => void
    /** Debt #98: split a pending litho layer in two at its midpoint. */
    onSplitLayer?: (idx: number) => void
    /** Debt #102: merge two adjacent same-lithology pending layers. */
    onMergeLayers?: (upperIdx: number) => void
    /** Dogfeed 2026-05-25: Shift+drag absorb — dragger absorbs neighbour. */
    onAbsorbLayer?: (draggerIdx: number, direction: 'up' | 'down') => void
    /** Extend a ghost sentinel to the nearest committed contacts.
     *  Returns ``{ ok: true }`` on success or ``{ ok: false, reason }``
     *  on overlap — caller is expected to surface the reason to the user. */
    onExtendToNearest?: (idx: number) => { ok: boolean; reason?: string }
    /** Slice 3 of unified-boundary-drag: committed litho contacts for
     *  the focused anchor, used by the cross-store dispatch in
     *  useBoundaryDrag to find the contact whose depth matches the
     *  dragged boundary. Filtered at SectionsCanvas level. */
    committedContactsForAnchor?: readonly FormationContactResponse[]
    /** Robust-fix follow-up (dogfeed 2026-05-30): contact ids per
     *  accepted suggestion idx, populated by the accept handlers. */
    contactIdsByAcceptedIdx?: ReadonlyMap<number, readonly string[]>
    /** Slice 3 of unified-boundary-drag: PATCH callback fired when a
     *  pending drag moves a shared boundary with an accepted neighbour.
     *  Same signature as ContactsLayer's drag commit; the suggestion-
     *  drag surface is just another entry point to the audit-point
     *  ``UpdateFormationContact`` PATCH. */
    onUpdateContactDepth?: (
      contactId: string,
      newDepthM: number,
      snapped: boolean,
    ) => Promise<void>
    /** P1b (dogfeed 2026-05-30) — live preview during a cross-store
     *  drag. Forwarded to ``useBoundaryDrag`` so it fires on every
     *  mousemove. SectionsCanvas holds the override Map and passes
     *  it to ContactsLayer as ``liveContactDepthOverrides``. */
    onContactLivePreview?: (
      contactId: string | null,
      liveDepthM: number,
    ) => void
  }
  /**
   * Multi-anchor ghost state (debt #73 / Phase 3). Map<anchorId, BulkAnchorGhost>
   * — one entry per investigation the bulk "Suggest all" verb fanned
   * out to. SectionPanel renders one LithoSuggestionGhostColumns per
   * entry simultaneously, in addition to any single-anchor ghost
   * above. Handlers are anchor-scoped via the anchorId arg so each
   * ghost column commits to its own anchor.
   */
  bulkLithoGhostState?: {
    anchorGhosts: ReadonlyMap<
      string,
      {
        kind: 'cpt' | 'borehole'
        suggestions: readonly LithoLayerSuggestion[]
        surfaceElevationM: number | null
        accepted: ReadonlySet<number>
        rejected: ReadonlySet<number>
        edits: ReadonlyMap<number, { depth_top_m?: number; depth_base_m?: number }>
      }
    >
    onAccept: (anchorId: string, idx: number) => void | Promise<void>
    onReject: (anchorId: string, idx: number) => void
    /** Undo a prior bulk reject — restore the layer to pending (debt #80). */
    onUnreject?: (anchorId: string, idx: number) => void
    onEdit: (
      anchorId: string,
      idx: number,
      edit: { depth_top_m?: number; depth_base_m?: number },
    ) => void
    /** Debt #86: cross-investigation paste, same shape as the
     *  single-anchor variant above. */
    onCrossColumnPaste?: (
      targetAnchorId: string,
      idx: number,
      edit: {
        suggested_lithology: string
        suggested_admixtures: readonly { soil_code: string; amount: string; locally: boolean }[]
      },
    ) => void
    /** Debt #85: bulk variant of the insert-layer handler — takes
     *  the anchorId of the bulk ghost being targeted. */
    onInsertLayer?: (
      anchorId: string,
      afterIdx: number,
      composition: {
        suggested_lithology: string
        suggested_admixtures: readonly { soil_code: string; amount: string; locally: boolean }[]
      },
    ) => void
    /** Debt #98: bulk variant of split — takes the anchorId. */
    onSplitLayer?: (anchorId: string, idx: number) => void
    /** Debt #102: bulk variant of merge — takes the anchorId. */
    onMergeLayers?: (anchorId: string, upperIdx: number) => void
    /** Dogfeed 2026-05-25: bulk variant of absorb — takes the anchorId. */
    onAbsorbLayer?: (anchorId: string, draggerIdx: number, direction: 'up' | 'down') => void
    /** Extend a bulk ghost sentinel to the nearest committed contacts.
     *  Takes the anchorId; returns ok/reason. */
    onExtendToNearest?: (anchorId: string, idx: number) => { ok: boolean; reason?: string }
  }
  /**
   * Pinch-out ghost-preview state (ghost-UX slice).  When present, a
   * dashed semi-transparent wedge renders from the formation's last real
   * contact toward the computed tip, with a floating Confirm/Dismiss
   * panel.  Absent / undefined = no overlay (zero regression).
   *
   * ``onPreviewPinchOut`` is the invocation path from the contact
   * context menu — it receives the contact id + formation id + anchor
   * so the caller can resolve the target formation and direction
   * through a picker or inline heuristic before calling the dry_run
   * endpoint.
   */
  pinchOutGhostState?: {
    /** Active dry_run preview. Null = no ghost rendered. */
    preview: {
      tip_along_m: number
      tip_elevation_m: number
      formation_id: string
      target_formation_id: string
      direction: 'left' | 'right'
      section_id: string
      model_id: string
    } | null
    /** True while a dry_run or commit call is in flight. */
    loading: boolean
    /** Formation vocabulary — used by the overlay for colour + name. */
    formations: readonly GeologicalFormationResponse[]
    /**
     * Fired when the user right-clicks a contact and picks
     * "Extrapolate pinch-out…".  The caller owns the formation +
     * direction picker flow and eventually calls the dry_run endpoint
     * to populate ``preview``.
     *
     * Parameters
     * ----------
     * contactId
     *     The id of the right-clicked contact.
     * formationId
     *     Formation the contact belongs to.
     * anchorKind
     *     ``'cpt'`` or ``'borehole'``.
     * anchorId
     *     Id of the CPT or borehole the contact is anchored to.
     */
    onPreviewPinchOut: (
      contactId: string,
      formationId: string,
      anchorKind: 'cpt' | 'borehole',
      anchorId: string,
    ) => void
    /** Fire to commit the active preview (calls the commit endpoint). */
    onConfirm: () => void
    /** Fire to dismiss the preview without committing. */
    onDismiss: () => void
  }
  /**
   * Callback from SectionsCanvas — fired when the user picks
   * "Inspect lens body…" from a body chip's context menu (#101 Blocker 1).
   * Opens ``InspectLensBodyPanel`` at the SectionsCanvas level.
   * Optional so the test-render path can mount without a seam.
   */
  onInspectLensBody?: (formationId: string, bodyOrdinal: number) => void
  /**
   * Undo stack push hook (dogfeed 2026-05-23). When present, the
   * "Remove from section" gesture (right-click a column → "Remove
   * from section") pushes an undo command so Ctrl+Z restores the
   * previous excluded_*_ids list. Optional so the test-render path
   * + read-only callers can mount without an undo seam.
   */
  undoStack?: {
    push: (cmd: {
      description: string
      revert: () => Promise<void>
      reapply: () => Promise<void>
    }) => void
  }
  /**
   * Formation ids whose committed bands should pulse amber briefly —
   * the "your correlation succeeded" cue. Set transiently after a
   * successful correlate; cleared by the caller after PULSE_MS.
   * Passed through to CorrelationEdgesOverlay. Optional.
   */
  pulsingFormationIds?: ReadonlySet<string>
  /**
   * Fired when the user saves from "Edit admixtures for this body" in the
   * body chip context menu.  Propagated to CorrelationEdgesOverlay.
   * Optional so callers that don't need the admixture path skip it.
   */
  onPropagateAdmixtures?: (
    seedFormationId: string,
    admixtures: import('./interpretation/LithoGhostCompositionEditor').GhostAdmixtureItem[],
  ) => Promise<void>
  /**
   * Geology-stage deep-link callback (litho axis only).
   *
   * Forwarded straight to ``ContactsLayer`` which wires it onto the
   * reference-contact hit-strips.  When present and the section is
   * displayed on the litho axis, a right-click on any geological
   * (reference) contact strip shows an "Edit in Geology stage" menu
   * item that fires this callback with the contact id + formation id.
   * Absent on the geological axis (zero regression).
   */
  onEditInGeologyStage?: (contactId: string, formationId: string) => void
  /**
   * Contact-level correlation edges (#133 Phase 1).
   *
   * Forwarded to ``CorrelationEdgesOverlay`` which draws point-to-point
   * solid emerald lines between the topY of each correlated contact's
   * band.  Absent / undefined = no contact-edge overlay (zero regression
   * on the geological axis or when the model has no contact correlations).
   */
  contactEdges?: readonly LithoContactCorrelationEdge[]
  /**
   * Gesture state for the boundary-click correlate gesture (#133 Phase 1).
   *
   * When present and ``contactCorrelateMode`` is true, hit-target rects
   * render at the top boundary of each band so the user can click a
   * contact line to arm it, then click another to create a contact edge.
   * Absent / undefined = read-only (contact edges visible, no gesture UI).
   */
  contactGestureState?: ContactGestureState
  /**
   * Fired when the user mousedowns on an unapproved edge's grab handle to
   * start a drag-to-retarget gesture (#133 Phase 2+3 Task 26).
   * Forwarded verbatim to ``CorrelationEdgesOverlay``.
   * Absent = no grab handles rendered.
   */
  onUnapprovedDragStart?: (
    e: React.MouseEvent,
    edge: LithoContactCorrelationEdge,
    handle: 'a' | 'b',
  ) => void
  /**
   * Live drag state while the user is mid drag-to-retarget (#133 Task 26).
   * Forwarded verbatim to ``CorrelationEdgesOverlay`` for ghost-line rendering.
   */
  unapprovedEdgeDrag?: {
    anchorContactId: string
    cursorViewportX: number
    cursorViewportY: number
  }
  /**
   * Fired when the user picks "Delete correlation" from a correlation
   * edge's right-click menu (#163e). Forwarded verbatim to
   * ``CorrelationEdgesOverlay``. Absent = no right-click-delete affordance.
   */
  onRequestDeleteEdge?: (edge: LithoContactCorrelationEdge) => void
  /**
   * Fired when the user picks "Accept correlation" from a pending edge's
   * right-click menu (dogfeed 2026-05-31). Forwarded verbatim to
   * ``CorrelationEdgesOverlay``. Absent = the Accept item is suppressed.
   */
  onRequestAcceptEdge?: (edge: LithoContactCorrelationEdge) => void
  /**
   * Detected lens bodies for the active litho model (#163f Slice 2). When
   * present, rendered as shapeable wedges by ``LensWedgeOverlay``. Absent =
   * no lens wedges.
   */
  lenses?: readonly LithoLensListItem[]
  /** Stored boundary shape per lens id (render style + control nodes). */
  lensBoundaries?: ReadonlyMap<string, LensBoundaryResponse>
  /** Full-replace a lens's boundary shape after a ghost-node drag/add. */
  onSaveLensShape?: (
    lensId: string,
    upperNodes: LensBoundaryNode[],
    lowerNodes: LensBoundaryNode[],
    style: LensRenderStyle,
  ) => void
  /** Right-click a wedge → dissolve the lens by deleting its defining edges. */
  onDeleteLens?: (aboveContactId: string, belowContactId: string, targetContactId: string) => void
}

export default function SectionPanel({
  section,
  zEpsg = null,
  cpts = [],
  boreholes = [],
  onPatch,
  onClose,
  contacts = [],
  focusableContacts,
  liveContactDepthOverride,
  formations = [],
  excludedBoreholeIds,
  surfacesByFormationId,
  referenceFormations,
  referenceSurfacesByFormationId,
  referenceContacts,
  focusedContactIds,
  onCreateContact,
  onUpdateContactDepth,
  onDeleteContact,
  onUnlinkLithoFromGeo,
  onLinkLithoToGeo,
  onBatchUpdateContacts,
  onBatchCreateContacts,
  onAutoPopulateFromStratigraphy,
  onCreateFormation,
  onExportDxf,
  onSelectCpt,
  onSelectBorehole,
  onFocusedColumnChange,
  virtueleBoringActiveModels,
  virtueleBoringPredictions,
  virtueleBoringModelA = null,
  virtueleBoringModelB = null,
  virtueleBoringMaxDepthM = null,
  virtueleBoringShowOnSection = true,
  onChangeVirtueleBoringPicker,
  onChangeVirtueleBoringShowOnSection,
  lithoGhostState,
  bulkLithoGhostState,
  pinchOutGhostState,
  onInspectLensBody,
  onPropagateAdmixtures,
  undoStack,
  pulsingFormationIds,
  axisMode = 'geological',
  geoSnapToleranceM,
  onManualLithoUnitCreate,
  onLithoExistingUnitPick,
  showConfidenceFade = true,
  activeLithoModelId,
  onEditInGeologyStage,
  contactEdges,
  contactGestureState,
  onUnapprovedDragStart,
  unapprovedEdgeDrag,
  onRequestDeleteEdge,
  onRequestAcceptEdge,
  lenses,
  lensBoundaries,
  onSaveLensShape,
  onDeleteLens,
}: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const size = useElementSize(containerRef)
  // Latest warp anchors, read by the wheel-zoom handler (defined above the
  // warp memo, so it reaches them through this ref rather than a closure dep).
  const warpAnchorsRef = useRef<WarpAnchor[]>([])
  // Latest column-spacing slider value (0..1). Mirrored from the
  // ``useSectionData`` destructure further down via a useEffect so
  // ``handleWheel`` (declared above that destructure) can blend the
  // cursor anchor by spacing without TDZ.
  const columnSpacingRef = useRef<number>(1)
  // Layout state needed for the wheel-zoom exact simulation
  // (cumulative-width offset at the post-zoom bandHalfWidth). Mirrored
  // from the SectionPanel's useMemos below via a useEffect — handleWheel
  // is declared above them so it consumes them via the ref. Initialised
  // empty; the wheel handler falls back to the per-column-ratio
  // approximation when the ref is empty (mount race).
  const layoutStateRef = useRef<{
    placedColumns: PlacedColumn[]
    cptPlots: Map<string, CptPlotResponse> | null | undefined
    boreholeDetails:
      | Map<string, BoreholeDetailResponse>
      | null
      | undefined
    cptChannels: CptChannels
    enabledBhChannels: number
    ghostFootprintForLayout: number
    lithoGhostAnchorIds: Set<string>
  } | null>(null)
  const lengthM = useMemo(() => sectionLengthM(section), [section])

  // Default viewport — full section length, default vertical
  // window. Recomputed when the section changes so switching
  // sections in the sidebar fits the new one without inheriting the
  // previous framing.
  const defaultViewport = useMemo<Viewport>(
    () => ({
      xMin: 0,
      xMax: lengthM,
      levelMin: section.min_depth_m ?? DEFAULT_LEVEL_RANGE.min,
      levelMax: section.max_depth_m ?? DEFAULT_LEVEL_RANGE.max,
    }),
    [lengthM, section.min_depth_m, section.max_depth_m],
  )

  const [viewport, setViewport] = useState<Viewport>(defaultViewport)
  // Reset to default framing when the section identity changes
  // (the user picked a different section in the sidebar).
  useEffect(() => {
    setViewport(defaultViewport)
  }, [defaultViewport])

  // Marquee (box-select) state lives here so the SVG root's
  // mousedown handler can decide between marquee (Shift held) and
  // pan (plain). ContactsLayer handles the mousemove/mouseup, hit-
  // test against its layer index, and the selection update;
  // SectionPanel just owns "is there an active marquee, and what
  // are its start coords."
  const [marquee, setMarquee] = useState<MarqueeState | null>(null)
  // Selection reset counter — bumped on a plain (no-Shift) bg
  // click that didn't move the mouse. ContactsLayer watches the
  // counter and clears its selection on each tick. Click-to-clear.
  const [selectionResetCounter, setSelectionResetCounter] = useState(0)

  // Hovered column id — tracked so the LOD pass can force the hovered
  // column's label to 'full' regardless of spacing. Transient UI state;
  // not persisted (it resets naturally when the user moves the mouse).
  const [hoveredColumnId, setHoveredColumnId] = useState<string | null>(null)

  const [vex, setVex] = useState<number>(section.vertical_exaggeration ?? VEX_DEFAULT)
  useEffect(() => {
    setVex(section.vertical_exaggeration ?? VEX_DEFAULT)
  }, [section.id, section.vertical_exaggeration])

  // Drawing-area pixel size. The SVG's ``viewBox`` always spans
  // the full container; coordinate transforms convert world →
  // viewBox.
  const plotWidth = Math.max(1, (size?.width ?? 800) - MARGIN.left - MARGIN.right)
  const plotHeight = Math.max(1, (size?.height ?? 400) - MARGIN.top - MARGIN.bottom)

  // World-to-screen scaling. scaleH and scaleV are derived from the
  // viewport; VEX is the ratio between them.
  const scaleH = plotWidth / Math.max(1e-6, viewport.xMax - viewport.xMin)
  // Apply VEX by amplifying scaleV relative to scaleH. The vertical
  // viewport extent is then derived from plotHeight and the
  // resulting scaleV — keeps the centre fixed when the user drags
  // the slider.
  const scaleV = scaleH * vex
  const visibleLevelExtent = plotHeight / scaleV
  const levelCentre = (viewport.levelMin + viewport.levelMax) / 2
  // Effective vertical viewport — what's actually visible given the
  // current VEX. Different from ``viewport.levelMin/Max`` only when
  // VEX has been changed since the last setViewport.
  const effLevelMin = levelCentre - visibleLevelExtent / 2
  const effLevelMax = levelCentre + visibleLevelExtent / 2

  const xToScreen = useCallback(
    (x: number) => MARGIN.left + (x - viewport.xMin) * scaleH,
    [viewport.xMin, scaleH],
  )
  const levelToScreen = useCallback(
    (level: number) => MARGIN.top + (effLevelMax - level) * scaleV,
    [effLevelMax, scaleV],
  )
  // Inverses of the forward transforms (#163f) — used by LensWedgeOverlay to
  // map a dragged ghost node's screen position back to section-local
  // (along_m, elevation_m). Must invert the SAME forward transform used to
  // render so render + commit stay consistent.
  const screenXToAlong = useCallback(
    (x: number) => (x - MARGIN.left) / scaleH + viewport.xMin,
    [viewport.xMin, scaleH],
  )
  const screenToLevel = useCallback(
    (y: number) => effLevelMax - (y - MARGIN.top) / scaleV,
    [effLevelMax, scaleV],
  )

  // ---- Pan / zoom interactions ---------------------------------------

  const panStart = useRef<{ px: number; py: number; viewport: Viewport } | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  // True while a CAD-style both-buttons-held pan is active, so the
  // trailing right-button contextmenu is suppressed (see the SVG
  // onContextMenu wrapper). Reset on the next single-button mousedown.
  const bothBtnPanRef = useRef(false)

  function handleMouseDown(e: React.MouseEvent<SVGSVGElement>): void {
    // CAD/Plaxis-style pan: holding BOTH mouse buttons pans regardless
    // of which button fired this event. Left-drag pan + shift-marquee
    // (below) are unchanged. e.buttons is a bitmask: 1=left, 2=right.
    if ((e.buttons & 1) === 1 && (e.buttons & 2) === 2) {
      e.preventDefault()
      bothBtnPanRef.current = true
      const r = e.currentTarget.getBoundingClientRect()
      panStart.current = {
        px: e.clientX - r.left,
        py: e.clientY - r.top,
        viewport,
      }
      setIsPanning(true)
      return
    }
    bothBtnPanRef.current = false
    // Only the left button starts a pan — right-click is reserved
    // for a future context menu, middle-click stays for browser
    // autoscroll.
    if (e.button !== 0) return
    // Shift held → start a marquee instead of a pan. Owning the
    // dispatch on the SVG ROOT (vs the bg rect) means Shift+click
    // ANYWHERE on the section — including on a column glyph — opens
    // the marquee, satisfying the "shift+click on column = multi-
    // select" requirement.
    if (e.shiftKey && onBatchUpdateContacts) {
      const svgEl = e.currentTarget
      const rect = svgEl.getBoundingClientRect()
      setMarquee({
        startClientX: e.clientX,
        startClientY: e.clientY,
        currentClientX: e.clientX,
        currentClientY: e.clientY,
        svgLeft: rect.left,
        svgTop: rect.top,
        // Always additive — the user's selection grows.
        additive: true,
      })
      // Don't start pan in parallel.
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    panStart.current = {
      px: e.clientX - rect.left,
      py: e.clientY - rect.top,
      viewport,
    }
    setIsPanning(true)
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>): void {
    if (panStart.current === null) return
    const rect = e.currentTarget.getBoundingClientRect()
    const dx = e.clientX - rect.left - panStart.current.px
    const dy = e.clientY - rect.top - panStart.current.py
    // dx in pixels → world metres via scaleH. Drag right means the
    // world moves left under the viewport, so subtract.
    const dxWorld = dx / scaleH
    const dyWorld = dy / scaleV
    setViewport({
      xMin: panStart.current.viewport.xMin - dxWorld,
      xMax: panStart.current.viewport.xMax - dxWorld,
      // Drag down means viewport.levelMax (which is at the top of
      // the screen) needs to go up in world terms — add dyWorld.
      levelMin: panStart.current.viewport.levelMin + dyWorld,
      levelMax: panStart.current.viewport.levelMax + dyWorld,
    })
  }

  function handleMouseUp(e: React.MouseEvent<SVGSVGElement>): void {
    const start = panStart.current
    panStart.current = null
    setIsPanning(false)
    // Click-without-drag on the section background → clear the
    // contact selection. Threshold mirrors the marquee's click-vs-
    // drag dead-zone so a tiny mouse jitter doesn't cancel the
    // clear. Skip when Shift is held (additive selection semantics)
    // or when the click landed on an element that handles its own
    // mousedown (hit-strips stopPropagation, columns route via
    // onClick — neither triggers this clear path).
    if (start === null) return
    if (e.shiftKey) return
    // A click that landed on a correlate band hit-rect arms/correlates via its
    // own onClick — don't also reset selection or clear the armed source here.
    if ((e.target as Element | null)?.closest?.('[data-testid="contact-gesture-rects"]')) {
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const dx = Math.abs(e.clientX - rect.left - start.px)
    const dy = Math.abs(e.clientY - rect.top - start.py)
    if (dx < 3 && dy < 3) {
      setSelectionResetCounter(c => c + 1)
      // Void click in correlate mode → clear the armed correlation source
      // (dogfeed 2026-05-29): clicking empty space deselects the boundary,
      // matching the section's deselect-on-background-click behaviour.
      if (contactGestureState?.contactCorrelateMode) {
        contactGestureState.onClearArmedContact()
      }
    }
  }

  // Wheel-zoom centred on the cursor — the world point under the
  // mouse stays put while the viewport shrinks or grows around it.
  // Matches Leaflet's interaction, so engineers' map muscle memory
  // transfers.
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault()
      const svg = containerRef.current?.querySelector('svg')
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      // Bail when the cursor is outside the plot area — wheel
      // events bubbling up from the toolbar wouldn't otherwise be
      // excluded.
      if (px < MARGIN.left || px > MARGIN.left + plotWidth) return
      if (py < MARGIN.top || py > MARGIN.top + plotHeight) return

      // Cursor zoom anchor — SPACING-AWARE blend (dogfeed 2026-05-31).
      // Two endpoints, blended by the column-spacing slider:
      //
      //   * spacing = 1 (no compression): the cursor's LINEAR along-
      //     section world position. Cursor at world 50 m → zoom
      //     anchored at 50 m. Standard cursor-anchor behaviour.
      //
      //   * spacing = 0 (fully packed): the leftmost test's along.
      //     At spacing=0 every column's screen X is packedX_0 +
      //     Σ widths, where packedX_0 = xToScreen(leftmost.along). All
      //     packed columns translate UNIFORMLY when the leftmost's
      //     screen X moves. So anchoring on the leftmost's along
      //     keeps every column at the same pixel — the cursor's
      //     column stays under the cursor, no drift.
      //
      // Linear interpolation between the two endpoints by spacing
      // matches the lerp the column-layout itself does
      // (lerpedX = packedX + (trueX - packedX) * spacing). Without
      // this blend, wheel zoom at spacing=0 drifts rightward (the
      // packed columns translate while the linear anchor preserves
      // a world point that's decoupled from the visible content).
      // Cursor anchor — keep the column UNDER the cursor at the same
      // pixel after the zoom, even at spacing < 1 where bands pack
      // edge-to-edge instead of sitting at their world-along screen
      // positions.
      //
      // For a column at index C, post-warp:
      //   nudgedX_C ≈ packedX_0 * (1-α) + trueX_C * α + (1-α) * offset_C
      // where
      //   packedX_0 = MARGIN.left + (L - xMin) * scaleH   (leftmost test's screen X)
      //   trueX_C   = MARGIN.left + (col.along - xMin) * scaleH
      //   offset_C  = (nudgedX_C - packedX_0_old)         (current packed offset, in px)
      //   α         = columnSpacing
      //
      // bandHalfWidth scales with scaleH, so offset_C grows in
      // proportion when zooming in — the wheel handler scales it by
      // (new bandHalfWidth / old bandHalfWidth) to estimate the new
      // packed offset.
      //
      // Solving "nudgedX_C_new = cursor_px" for new_xMin gives the
      // formula below.  At spacing=1 it collapses to the standard
      // linear cursor anchor (worldX = col.along, offset term vanishes).
      // At spacing=0 it accounts for the cumulative width shift that
      // would otherwise drift columns rightward on every wheel step.
      const anchorsNow = warpAnchorsRef.current
      const spacing = columnSpacingRef.current
      const factor = e.deltaY < 0 ? 1 / WHEEL_ZOOM_FACTOR : WHEEL_ZOOM_FACTOR
      const newXRange = (viewport.xMax - viewport.xMin) * factor
      const newLevelRange = (viewport.levelMax - viewport.levelMin) * factor
      const newScaleH = plotWidth / newXRange
      const newBandHalfWidth = cptBandHalfWidth(newScaleH)
      const oldBandHalfWidth = cptBandHalfWidth(scaleH)
      // Refuse the wheel zoom if bandHalfWidth is already at its
      // clamp AND wouldn't change with this step. Past the clamp,
      // horizontal stops scaling but vertical keeps growing →
      // tests "elongate" instead of zooming. Dogfeed 2026-05-31.
      // Both ends matter: max clamp (factor=3.0 → BHW=72) on zoom-
      // in, min clamp (factor=0.6 → BHW=14) on zoom-out.
      if (oldBandHalfWidth === newBandHalfWidth) {
        const zoomingIn = factor < 1
        // Upper clamp = 6.0 × → 144 px halfwidth.
        // Lower clamp = 0.6 × → 14 px halfwidth.
        const atUpperClamp = oldBandHalfWidth >= 144 && zoomingIn
        const atLowerClamp = oldBandHalfWidth <= 14 && !zoomingIn
        if (atUpperClamp || atLowerClamp) return
      }
      // Find the column closest to the cursor in current screen X.
      // Anchors are sorted ascending by ``along``; ``effX`` is the
      // current nudgedX — what the user actually sees under the
      // cursor.  If no anchors yet (fresh section without projected
      // columns), fall back to pure linear cursor anchor.
      let cursorAlong: number
      let cursorOffsetPxNew: number
      const linearAlong = viewport.xMin + (px - MARGIN.left) / scaleH
      if (anchorsNow.length === 0) {
        cursorAlong = linearAlong
        cursorOffsetPxNew = 0
      } else {
        let bestIdx = 0
        let bestDist = Math.abs(anchorsNow[0].effX - px)
        for (let i = 1; i < anchorsNow.length; i += 1) {
          const d = Math.abs(anchorsNow[i].effX - px)
          if (d < bestDist) {
            bestDist = d
            bestIdx = i
          }
        }
        const cursorCol = anchorsNow[bestIdx]
        const leftmost = anchorsNow[0]
        // Compute the EXACT cumulative pixel offset at the new
        // bandHalfWidth (same simulation the banner-zoom uses).
        // Walks every placed column up to the cursor's index and sums
        // the per-column visualWidth at the post-zoom scale. No
        // approximation — works at any spacing because the formula
        // matches what placedColumns will ACTUALLY render at the new
        // viewport.
        //
        // Falls back to the per-column-ratio approximation when the
        // layoutStateRef hasn't been populated yet (fresh mount race).
        const state = layoutStateRef.current
        if (state !== null && state.placedColumns.length > 0) {
          const widthAtNew = (col: PlacedColumn): number => {
            if (col.kind === 'cpt') {
              const trackW = state.cptPlots?.has(col.proj.item.id)
                ? cptBandFullWidth(
                    col.proj.item.cpt_type,
                    state.cptChannels,
                    newBandHalfWidth,
                  )
                : 0
              const lithoBandW = state.lithoGhostAnchorIds.has(col.proj.item.id)
                ? 2 * newBandHalfWidth
                : 0
              return (
                BARE_COLUMN_WIDTH_PX +
                Math.max(trackW, lithoBandW) +
                state.ghostFootprintForLayout
              )
            }
            const stripsW = state.boreholeDetails?.has(col.proj.item.id)
              ? state.enabledBhChannels * 2 * newBandHalfWidth
              : 0
            const lithoBandW = state.lithoGhostAnchorIds.has(col.proj.item.id)
              ? 2 * newBandHalfWidth
              : 0
            return (
              BARE_COLUMN_WIDTH_PX +
              Math.max(stripsW, lithoBandW) +
              state.ghostFootprintForLayout
            )
          }
          const sorted = [...state.placedColumns].sort(
            (a, b) => a.proj.along - b.proj.along,
          )
          const cursorIdx = sorted.findIndex(c => c.proj.along === cursorCol.along)
          let cumOff = 0
          if (cursorIdx > 0) {
            for (let i = 1; i <= cursorIdx; i += 1) {
              cumOff +=
                (widthAtNew(sorted[i - 1]) + widthAtNew(sorted[i])) / 2 +
                COLUMN_EDGE_GAP_PX
            }
          }
          cursorOffsetPxNew = cumOff
        } else {
          // Fall-back per-column ratio when layout ref hasn't been
          // mirrored yet. Same approximation as the previous fix.
          const oldPerCol =
            BARE_COLUMN_WIDTH_PX + 2 * oldBandHalfWidth + COLUMN_EDGE_GAP_PX
          const newPerCol =
            BARE_COLUMN_WIDTH_PX + 2 * newBandHalfWidth + COLUMN_EDGE_GAP_PX
          const widthRatio = oldPerCol > 0 ? newPerCol / oldPerCol : 1
          cursorOffsetPxNew = (cursorCol.effX - leftmost.effX) * widthRatio
        }
        // Blend with leftmost.along by spacing — at spacing=1 we anchor
        // on the cursor column's along, at spacing=0 we anchor on the
        // leftmost.along and the offset term carries the packed
        // location.
        cursorAlong = leftmost.along * (1 - spacing) + cursorCol.along * spacing
      }

      const newXMin =
        cursorAlong - (px - MARGIN.left - (1 - spacing) * cursorOffsetPxNew) / newScaleH
      const newXMax = newXMin + newXRange

      const worldLevel = effLevelMax - (py - MARGIN.top) / scaleV
      const levelFraction =
        (worldLevel - viewport.levelMin) / (viewport.levelMax - viewport.levelMin)
      setViewport({
        xMin: newXMin,
        xMax: newXMax,
        levelMin: worldLevel - levelFraction * newLevelRange,
        levelMax: worldLevel + (1 - levelFraction) * newLevelRange,
      })
    },
    [viewport, scaleH, scaleV, effLevelMax, plotWidth, plotHeight],
  )

  // React's onWheel is passive-by-default (preventDefault is a
  // no-op there). Attach the listener natively so we can intercept
  // the page scroll. Same pattern as the BoreholeLog Ctrl+wheel
  // zoom.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  function resetView(): void {
    setViewport(defaultViewport)
    setVex(section.vertical_exaggeration ?? VEX_DEFAULT)
  }

  // Centred zoom — same factor as the wheel, but pivoting on the
  // viewport's centre instead of the mouse position. Wired to the
  // header's +/- buttons for users who'd rather click than scroll.
  const zoomBy = useCallback((factor: number) => {
    setViewport(prev => {
      const cx = (prev.xMin + prev.xMax) / 2
      const cl = (prev.levelMin + prev.levelMax) / 2
      const xHalf = (prev.xMax - prev.xMin) * factor * 0.5
      const lHalf = (prev.levelMax - prev.levelMin) * factor * 0.5
      return {
        xMin: cx - xHalf,
        xMax: cx + xHalf,
        levelMin: cl - lHalf,
        levelMax: cl + lHalf,
      }
    })
  }, [])
  const zoomIn = useCallback(() => zoomBy(1 / WHEEL_ZOOM_FACTOR), [zoomBy])
  const zoomOut = useCallback(() => zoomBy(WHEEL_ZOOM_FACTOR), [zoomBy])

  // Horizontal pan for the scrub bar. Sets the viewport's
  // xMin/xMax to a new window of the same width, with the centre
  // CLAMPED so the viewport never scrolls "too far" past the data:
  //
  //   * At scrub far-right, xMax = rightmostAlong + small buffer →
  //     the rightmost test sits on the RIGHT SIDE of the plot with a
  //     bit of breathing room (NOT in the middle).
  //   * At scrub far-left, xMin = leftmostAlong - small buffer →
  //     symmetric.
  //   * In between, centred on the requested centerX.
  //
  // Buffer = 5 % of the current viewport width. Reads bounds from
  // ``scrubBoundsRef`` — declared above ``scrubTo``, populated by a
  // useEffect further down once ``placedColumns`` is in scope. The
  // ref pattern dodges the TDZ that a direct closure capture would
  // hit (placedColumns + scrubDataMinM/MaxM are declared later in
  // the component body).
  const scrubBoundsRef = useRef<{ min: number; max: number }>({ min: 0, max: 0 })
  const scrubTo = useCallback((centerX: number) => {
    setViewport(prev => {
      const half = (prev.xMax - prev.xMin) / 2
      const buffer = (prev.xMax - prev.xMin) * 0.05
      const { min: dMin, max: dMax } = scrubBoundsRef.current
      const minCentre = dMin + half - buffer
      const maxCentre = dMax - half + buffer
      let clamped: number
      if (maxCentre < minCentre) {
        // Viewport is wider than the data — centre on the data
        // midpoint so both edges show equal margin.
        clamped = (dMin + dMax) / 2
      } else {
        clamped = Math.max(minCentre, Math.min(maxCentre, centerX))
      }
      return { ...prev, xMin: clamped - half, xMax: clamped + half }
    })
  }, [])

  // ---- Tick generation -----------------------------------------------

  const xTicks = useMemo(
    () => ticks(viewport.xMin, viewport.xMax, 8),
    [viewport.xMin, viewport.xMax],
  )
  const levelTicks = useMemo(
    () => ticks(effLevelMin, effLevelMax, 6),
    [effLevelMin, effLevelMax],
  )

  // ---- Data layer (DEM + CPT plots + projected investigations) -------

  // Boreholes the active model excludes are filtered out of the
  // section view entirely (column doesn't render, picker can't fire,
  // contacts don't appear). The "Boreholes in model" checkbox in the
  // InterpretationPane controls inclusion; unchecking removes the
  // borehole from every section editor view of this model. Cleaner
  // mental model than "column shown but contacts hidden" (which was
  // a real source of "I clicked but nothing happened" confusion in
  // dogfooding).
  const includedBoreholes = useMemo(() => {
    if (!excludedBoreholeIds || excludedBoreholeIds.length === 0) {
      return boreholes
    }
    const excluded = new Set(excludedBoreholeIds)
    return boreholes.filter(b => !excluded.has(b.id))
  }, [boreholes, excludedBoreholeIds])

  const {
    cptChannels,
    setCptChannels,
    boreholeChannels,
    setBoreholeChannels,
    columnSpacing,
    setColumnSpacing,
    snapToStratigraphy,
    setSnapToStratigraphy,
    demSamples,
    cptPlots,
    projectedCpts,
    projectedBoreholes,
    boreholeDetails,
  } = useSectionData(section, cpts, includedBoreholes)

  // Channel-toggle commit: update the in-memory state optimistically
  // for an instant re-render, then PATCH the section row's
  // ``view_state.cpt_channels`` so the change survives section
  // reopens + .gmproj round-trips. Falls back to local-only when
  // ``onPatch`` is absent (test-render path).
  const handleChannelsChange = useCallback(
    (next: typeof cptChannels) => {
      setCptChannels(next)
      if (onPatch) {
        void onPatch({ view_state: { cpt_channels: next } })
      }
    },
    [setCptChannels, onPatch],
  )

  // Same shape for borehole interpretation toggles — optimistic
  // in-memory update + PATCH so the choice rides .gmproj saves.
  const handleBoreholeChannelsChange = useCallback(
    (next: typeof boreholeChannels) => {
      setBoreholeChannels(next)
      if (onPatch) {
        void onPatch({ view_state: { borehole_channels: next } })
      }
    },
    [setBoreholeChannels, onPatch],
  )

  const handleSnapToStratigraphyChange = useCallback(
    (next: boolean) => {
      setSnapToStratigraphy(next)
      if (onPatch) {
        void onPatch({ view_state: { snap_to_stratigraphy: next } })
      }
    },
    [setSnapToStratigraphy, onPatch],
  )

  // Spacing-slider commit. Same shape as channels — optimistic local
  // update for instant feedback while the user drags, server-side
  // PATCH on release so the chosen spacing rides the .gmproj bundle.
  // SectionHeader calls ``setColumnSpacing`` on every input change
  // (smooth visual update) and ``handleSpacingCommit`` on release.
  const handleSpacingCommit = useCallback(
    (next: number) => {
      if (onPatch) {
        void onPatch({ view_state: { column_spacing: next } })
      }
    },
    [onPatch],
  )

  // Band half-width scales with horizontal zoom — at low zoom keep
  // columns compact, at high zoom let curves breathe. The wheel-zoom
  // handler accounts for the spacing-dependent cumulative-width
  // offset when computing the cursor anchor, so growing bands no
  // longer cause column drift at spacing < 1.
  const bandHalfWidth = useMemo(() => cptBandHalfWidth(scaleH), [scaleH])

  // Column collision handling — when multiple investigations project
  // near the same along-distance their columns would overlap into an
  // unreadable stack. Combine both kinds, nudge in a single sweep so
  // crowded ones cascade rightward, and surface the displacement
  // back to the column renderer so it can draw a tie-back diagonal.
  // Recomputes on viewport pan / zoom because the available pixel
  // space changes with scaleH.
  const enabledBhChannels = useMemo(
    () => enabledBoreholeChannelCount(boreholeChannels),
    [boreholeChannels],
  )

  // Ghost-rail footprint per column when the Virtuele Boring
  // overlay is showing on this pane. Each column carries this extra
  // width into the nudge pass so neighbouring columns don't sit on
  // top of the ghosts to their right. Reads as 0 when the overlay
  // is off — keeps the no-overlay layout pixel-identical to before.
  const virtueleBoringActiveModelsForLayout = useMemo<readonly string[]>(
    () => (virtueleBoringActiveModels ?? []).slice(0, 2),
    [virtueleBoringActiveModels],
  )
  const ghostFootprintForLayout =
    virtueleBoringShowOnSection &&
    virtueleBoringActiveModelsForLayout.length > 0
      ? virtueleBoringGhostRailWidth(virtueleBoringActiveModelsForLayout.length)
      : 0

  // Anchors that render a litho suggestion ghost on this section. Their band
  // is drawn ``2 * bandHalfWidth`` wide regardless of whether the CPT data
  // band is shown, so the column-nudge footprint must reserve that width or
  // adjacent litho bands overlap into an unreadable smear for closely-spaced
  // tests (#28 dogfeed 2026-05-29).
  const lithoGhostAnchorIds = useMemo(() => {
    const ids = new Set<string>()
    if (lithoGhostState != null) ids.add(lithoGhostState.investigationId)
    if (bulkLithoGhostState != null) {
      for (const anchorId of bulkLithoGhostState.anchorGhosts.keys()) ids.add(anchorId)
    }
    return ids
  }, [lithoGhostState, bulkLithoGhostState])

  const placedColumns = useMemo<PlacedColumn[]>(() => {
    // ``columnSpacing`` lerps between two layouts, both collision-safe:
    //
    //   spacing = 1.0 → TRUTH layout: each column's trueX is its
    //     projected along-distance. Nudge runs over the truth and
    //     only displaces columns whose natural positions would
    //     overlap. Distant tests sit exactly where they should.
    //   spacing = 0.0 → PACKED layout: columns are placed
    //     edge-to-edge in projection-order starting from the
    //     leftmost trueX. Adjacent tests sit "right next to each
    //     other" regardless of how far apart they are on the actual
    //     section line.
    //
    // For each column we feed the lerped position as its trueX into
    // nudgeColumns, so the standard edge-gap collision rule applies
    // at every spacing value — bands NEVER overlap.
    // Type the array as the discriminated union directly so TS
    // doesn't widen the per-branch ``proj`` to a single union and
    // force the cast back at the consumer (debt #28).
    type RawCpt = {
      kind: 'cpt'
      proj: ProjectedInvestigation<CptListItem>
      trueX: number
      visualWidth: number
    }
    type RawBh = {
      kind: 'borehole'
      proj: ProjectedInvestigation<BoreholeListItem>
      trueX: number
      visualWidth: number
    }
    // The ghost rail extends to the right of each column's data
    // band. Adding the same footprint to every column's visualWidth
    // means the nudge pass guarantees: column[i+1].left_edge >=
    // column[i].band_right + ghostFootprint + edgeGap, which is the
    // condition for the ghosts NOT to overlap column[i+1]'s band.
    // The extra is symmetric (both sides) for nudge math symmetry —
    // a small over-spacing on the leftmost column is acceptable.
    // Litho band footprint (#28): a suggestion ghost draws ``2 * bandHalfWidth``
    // wide even when the data band is off, so reserve at least that so the
    // nudge keeps adjacent litho bands from overlapping.
    const lithoBandW = (id: string): number =>
      lithoGhostAnchorIds.has(id) ? 2 * bandHalfWidth : 0
    const rawItems: (RawCpt | RawBh)[] = [
      ...projectedCpts.map((proj): RawCpt => {
        const trackW = cptPlots?.has(proj.item.id)
          ? cptBandFullWidth(proj.item.cpt_type, cptChannels, bandHalfWidth)
          : 0
        return {
          kind: 'cpt',
          proj,
          trueX: xToScreen(proj.along),
          visualWidth:
            BARE_COLUMN_WIDTH_PX +
            Math.max(trackW, lithoBandW(proj.item.id)) +
            ghostFootprintForLayout,
        }
      }),
      ...projectedBoreholes.map((proj): RawBh => {
        const stripsW = boreholeDetails?.has(proj.item.id)
          ? enabledBhChannels * 2 * bandHalfWidth
          : 0
        return {
          kind: 'borehole',
          proj,
          trueX: xToScreen(proj.along),
          visualWidth:
            BARE_COLUMN_WIDTH_PX +
            Math.max(stripsW, lithoBandW(proj.item.id)) +
            ghostFootprintForLayout,
        }
      }),
    ]
    // Stable sort by trueX for the packed layout. The original order
    // re-emerges naturally because each item carries its identity
    // (kind + item.id); rendering uses the result keyed by id.
    const sorted = [...rawItems].sort((a, b) => a.trueX - b.trueX)
    // Edge-to-edge packed positions starting from the leftmost trueX.
    // Each consecutive column's centre lands half-its-width past the
    // previous column's right edge.
    const packedXBySortedIndex: number[] = []
    let cursor = sorted.length > 0 ? sorted[0].trueX : 0
    for (let i = 0; i < sorted.length; i += 1) {
      const halfW = sorted[i].visualWidth / 2
      if (i === 0) {
        packedXBySortedIndex.push(cursor)
        cursor = cursor + halfW
      } else {
        cursor += halfW
        packedXBySortedIndex.push(cursor)
        cursor += halfW
      }
    }
    // Re-attach the packed X to each item by identity; rawItems is in
    // CPT-then-borehole order so we look up each one's place in
    // ``sorted`` via reference identity.
    const items: PlacedColumnInput[] = rawItems.map(item => {
      const sortedIdx = sorted.indexOf(item)
      const packedX = packedXBySortedIndex[sortedIdx]
      const lerpedX = packedX + (item.trueX - packedX) * columnSpacing
      // Branch on kind so the (kind, proj) pair stays correlated —
      // a single literal-object return widens to a non-discriminated
      // union and tsc loses the narrowing.
      return item.kind === 'cpt'
        ? { kind: 'cpt', proj: item.proj, trueX: lerpedX, width: item.visualWidth }
        : { kind: 'borehole', proj: item.proj, trueX: lerpedX, width: item.visualWidth }
    })
    return nudgeColumns(items, COLUMN_EDGE_GAP_PX).map(r =>
      r.item.kind === 'cpt'
        ? {
            kind: 'cpt' as const,
            proj: r.item.proj,
            trueX: r.trueX,
            nudgedX: r.nudgedX,
            width: r.item.width,
            displaced: r.displaced,
          }
        : {
            kind: 'borehole' as const,
            proj: r.item.proj,
            trueX: r.trueX,
            nudgedX: r.nudgedX,
            width: r.item.width,
            displaced: r.displaced,
          },
    )
  }, [
    projectedCpts,
    projectedBoreholes,
    xToScreen,
    cptPlots,
    boreholeDetails,
    cptChannels,
    bandHalfWidth,
    columnSpacing,
    enabledBhChannels,
    ghostFootprintForLayout,
    lithoGhostAnchorIds,
  ])

  // Scrub-bar outer bounds: leftmost-test / rightmost-test
  // along-section position (world m). The scrub-bar track represents
  // this range — NOT 0..sectionLength — so the engineer scrubs over
  // where the data actually sits, not the empty section tail. Falls
  // back to [0, lengthM] when no columns are placed yet (fresh section
  // before projection lands), so the bar stays grab-able. Recomputes
  // on every change to placedColumns (zoom-driven layout changes,
  // spacing slider, new investigation imported — all of which
  // re-rerun the placedColumns memo).
  const { scrubDataMinM, scrubDataMaxM } = useMemo(() => {
    if (placedColumns.length === 0) {
      return { scrubDataMinM: 0, scrubDataMaxM: lengthM }
    }
    let lo = Infinity
    let hi = -Infinity
    for (const col of placedColumns) {
      const a = col.proj.along
      if (a < lo) lo = a
      if (a > hi) hi = a
    }
    return { scrubDataMinM: lo, scrubDataMaxM: hi }
  }, [placedColumns, lengthM])

  // Feed the latest data bounds into the ref that ``scrubTo``
  // (declared above ``placedColumns``) consumes. The ref dodges the
  // TDZ that would otherwise hit if scrubTo's useCallback closed over
  // scrubDataMinM/MaxM directly.
  useEffect(() => {
    scrubBoundsRef.current = { min: scrubDataMinM, max: scrubDataMaxM }
  }, [scrubDataMinM, scrubDataMaxM])

  // Same TDZ-dodging pattern for handleWheel's spacing-aware cursor
  // anchor: mirror the live ``columnSpacing`` into the ref the wheel
  // handler reads.
  useEffect(() => {
    columnSpacingRef.current = columnSpacing
  }, [columnSpacing])

  // Mirror the layout state the wheel handler's exact-simulation path
  // needs into ``layoutStateRef``. handleWheel is declared above all
  // these memos / destructures so it can't close over them directly.
  // The ref lets the wheel compute cumulative widths at the post-zoom
  // bandHalfWidth for the cursor's column without the per-column-
  // ratio approximation that drifts at intermediate spacing.
  useEffect(() => {
    layoutStateRef.current = {
      placedColumns,
      cptPlots,
      boreholeDetails,
      cptChannels,
      enabledBhChannels,
      ghostFootprintForLayout,
      lithoGhostAnchorIds,
    }
  }, [
    placedColumns,
    cptPlots,
    boreholeDetails,
    cptChannels,
    enabledBhChannels,
    ghostFootprintForLayout,
    lithoGhostAnchorIds,
  ])

  // Virtuele Boring overlay — index the predictions by
  // investigation_id once per prop change so the SVG render walks a
  // single Map lookup per column. Truncate active models to two; the
  // UI only exposes two dropdown slots so anything beyond would
  // overflow the ghost-column rail (each slot owns its own ghost).
  const virtueleBoringActiveModelsClamped = useMemo<readonly string[]>(
    () => (virtueleBoringActiveModels ?? []).slice(0, 2),
    [virtueleBoringActiveModels],
  )
  const virtueleBoringPredictionsByInvestigationId = useMemo(() => {
    const map = new Map<string, VirtueleBoringInvestigationPrediction>()
    for (const pred of virtueleBoringPredictions ?? []) {
      map.set(pred.investigation_id, pred)
    }
    return map
  }, [virtueleBoringPredictions])

  // Zoom-to-detail on the focused contact(s) — crossings-banner click
  // flow (dogfeed 2026-05-30). Fits the viewport so the offending
  // column(s) fill the screen: vertical from the deepest sample up to
  // the surface elevation ("max vertical extent"), horizontal tight
  // around the column(s) ("minimum horizontal extent"). The user's
  // exact wording from the dogfeed.
  //
  // Operates on raw proj.along (world along-section m). The column-
  // spacing modifier + nudge layout are render-side concerns — they
  // re-apply on top of the new viewport so the offending column ends
  // up visually centred regardless of spacing (see
  // feedback_section_view_spacing_modifier memory).
  //
  // Falls back to a no-op when: no focus; the anchors don't resolve
  // to placed columns; or none of the columns has a known surface
  // elevation. Identity-checked so re-rendering with the same array
  // ref doesn't re-fit (a banner click always supplies a fresh array).
  const focusedContactsLastRef = useRef<readonly string[] | null>(null)
  useEffect(() => {
    if (!focusedContactIds || focusedContactIds.length === 0) {
      focusedContactsLastRef.current = null
      return
    }
    if (focusedContactsLastRef.current === focusedContactIds) return

    // NB: the lock-ref is set at the BOTTOM of this effect, only after
    // we actually changed the viewport.  An earlier version set it
    // here, before the data-availability checks below — which meant
    // that if ``contacts`` or ``placedColumns`` weren't loaded yet
    // on the first render after a Geology → Sections deep-link, the
    // effect bailed AND locked, so subsequent re-renders with the
    // populated data never re-ran the zoom.  Banner-click from the
    // Geology stage looked broken (always landed on the default-fit
    // viewport).

    const focusedSet = new Set(focusedContactIds)
    interface ColumnFit {
      along: number
      nudgedX: number
      topZ: number
      bottomZ: number
    }
    const fits: ColumnFit[] = []
    log.debug(
      'section-zoom',
      `focusedContactIds.length=${focusedContactIds.length} focusableContacts=${focusableContacts?.length ?? 'undef'} contacts=${contacts.length} placedColumns=${placedColumns.length}`,
    )
    // Use the UNFILTERED axis contacts when supplied — the crossings
    // banner's contact_ids are global to the geological model and
    // routinely span contacts not in this section's
    // ``seeded_formation_contact_ids`` (the explicit-content
    // invariant). Falling back to ``contacts`` (the seeded subset)
    // preserves behaviour for callers that don't supply the full
    // list.
    const lookupContacts = focusableContacts ?? contacts
    for (const contact of lookupContacts) {
      if (!focusedSet.has(contact.id)) continue
      const anchorId = contact.borehole_id ?? contact.cpt_id ?? null
      if (!anchorId) continue
      const col = placedColumns.find(c => c.proj.item.id === anchorId)
      if (!col) continue
      const elevation = col.proj.item.elevation_m
      if (elevation === null || elevation === undefined) continue

      // Deepest data point — drives the bottom of the vertical fit.
      // CPT: last sample of the loaded plot. Borehole: total_depth_m
      // off the detail map. If neither loaded yet, fall back to a
      // typical 20 m so the fit still has a sensible vertical span.
      let depthBottom: number | null = null
      if (col.kind === 'cpt') {
        const plot = cptPlots?.get(anchorId)
        if (plot && plot.depths_m.length > 0) {
          depthBottom = plot.depths_m[plot.depths_m.length - 1]
        }
      } else {
        const detail = boreholeDetails?.get(anchorId)
        if (detail && detail.total_depth_m !== null) {
          depthBottom = detail.total_depth_m
        }
      }
      if (depthBottom === null) depthBottom = 20
      fits.push({
        along: col.proj.along,
        nudgedX: col.nudgedX,
        topZ: elevation,
        bottomZ: elevation - depthBottom,
      })
    }
    if (fits.length === 0) {
      log.debug(
        'section-zoom',
        `BAIL fits.length=0 — no offending contact's anchor was found in placedColumns. focusedContactIds=${focusedContactIds.length} lookupContacts=${(focusableContacts ?? contacts).length}`,
      )
      return
    }

    // De-dup by column (multiple contacts on the same anchor → one
    // column entry). The crossing validator returns every offending
    // vertex's contact_id, so a two-formation crossing across the
    // whole section can return ~60 contacts; without dedup the
    // bounding box degenerates to the whole section. We want to zoom
    // to ONE column, not fit-everything.
    //
    // Sort the deduped list by along ascending so the LEFTMOST column
    // is "first". Predictable across re-renders, and the engineer can
    // scrub right from there to step through the rest.
    const dedup = new Map<number, (typeof fits)[number]>()
    for (const f of fits) {
      if (!dedup.has(f.along)) dedup.set(f.along, f)
    }
    const distinctCols = [...dedup.values()].sort((a, b) => a.along - b.along)

    const alongsAll = distinctCols.map(f => f.along)
    const fullMinAlong = Math.min(...alongsAll)
    const fullMaxAlong = Math.max(...alongsAll)
    const FIT_ALL_HORIZONTAL_THRESHOLD_M = 200

    let activeCols: typeof distinctCols
    if (fullMaxAlong - fullMinAlong > FIT_ALL_HORIZONTAL_THRESHOLD_M) {
      // Too spread (e.g. a system-wide formation crossing) — zoom to
      // the FIRST affected column only. The amber-pulse highlight
      // still fires on every contact, so the engineer sees the full
      // extent of the issue while landing tightly on a specific
      // problem location. They can scrub to the others.
      activeCols = [distinctCols[0]]
    } else {
      activeCols = distinctCols
    }

    const alongs = activeCols.map(f => f.along)
    const minAlong = Math.min(...alongs)
    const maxAlong = Math.max(...alongs)
    const topZ = Math.max(...activeCols.map(f => f.topZ))
    const bottomZ = Math.min(...activeCols.map(f => f.bottomZ))

    // Bail early if the plot hasn't been measured yet (SectionPanel's
    // first render before ResizeObserver fires sets plotWidth = 0,
    // which would NaN out the spacing<1 math). DON'T lock the ref —
    // the effect re-fires once placedColumns recomputes with real
    // dimensions, and we want that re-fire to succeed.
    if (plotWidth <= 0 || scaleH <= 0) {
      log.debug(
        'section-zoom',
        `BAIL plotWidth=${plotWidth} scaleH=${scaleH} — layout not ready yet, will retry`,
      )
      return
    }

    // Horizontal viewport. Branches by spacing because the visible
    // column layout differs:
    //
    // * spacing == 1: columns sit at world-along positions. Tight
    //   world-coord zoom (50 m margin for 1 column; 30 % for many).
    //
    // * spacing < 1: columns are positioned in PIXELS as
    //   packedX_0 + cumulative widths, decoupled from along. Use a
    //   FIXED target xRange (TARGET_XRANGE_M) and solve for xMin
    //   such that the target column's POST-ZOOM packed position
    //   lands at the plot centre. bandHalfWidth scales with scaleH
    //   (within the [0.6, 3.0] clamp), so the cumulative-offset is
    //   estimated by oldOffset × (newBandHalfWidth / oldBandHalfWidth).
    //   This delivers BOTH the zoom-in and the centring the user
    //   asked for (image 17 was correctly centred but not zoomed).
    const TARGET_XRANGE_M = 100
    let xMin: number
    let xMax: number
    if (columnSpacing >= 1.0) {
      if (minAlong === maxAlong) {
        xMin = minAlong - 50
        xMax = maxAlong + 50
      } else {
        const xRange = maxAlong - minAlong
        const margin = Math.max(15, xRange * 0.3)
        xMin = minAlong - margin
        xMax = maxAlong + margin
      }
    } else {
      // Packed layout: SIMULATE the post-zoom column layout exactly
      // instead of estimating with a per-column ratio. We re-walk
      // every column at the new bandHalfWidth and sum the cumulative
      // offset to the target column. No estimation, no compounding
      // error on the first click, no "needs two clicks" pattern.
      const newScaleH = plotWidth / TARGET_XRANGE_M
      const newBandHalfWidth = cptBandHalfWidth(newScaleH)

      // Predict visualWidth for each placed column at the POST-zoom
      // bandHalfWidth, ASSUMING the per-CPT plot / per-borehole
      // detail has loaded. On Geology -> Sections deep-link the
      // section mounts before the async cptPlots / boreholeDetails
      // fetches return, so checking ``cptPlots?.has(...)`` would
      // read ``false`` for every column and the simulated cumulative
      // offset would underestimate by a factor of ~8x. The actual
      // placedColumns useMemo recomputes once the data lands and the
      // columns balloon to full width — at which point the target
      // column has drifted way past the plot centre (the "test on
      // the right" report). Assume the eventual loaded state: every
      // CPT with applicable channels gets a 2 × bandHalfWidth track,
      // every borehole with enabledBhChannels > 0 gets the strip
      // band. This matches what the rendered layout settles to and
      // the target lands dead-centre once the data is in.
      const newVisualWidth = (col: typeof placedColumns[number]): number => {
        if (col.kind === 'cpt') {
          const trackW = cptBandFullWidth(
            col.proj.item.cpt_type,
            cptChannels,
            newBandHalfWidth,
          )
          const lithoBandW = lithoGhostAnchorIds.has(col.proj.item.id)
            ? 2 * newBandHalfWidth
            : 0
          return BARE_COLUMN_WIDTH_PX + Math.max(trackW, lithoBandW) + ghostFootprintForLayout
        }
        const stripsW = enabledBhChannels * 2 * newBandHalfWidth
        const lithoBandW = lithoGhostAnchorIds.has(col.proj.item.id)
          ? 2 * newBandHalfWidth
          : 0
        return BARE_COLUMN_WIDTH_PX + Math.max(stripsW, lithoBandW) + ghostFootprintForLayout
      }

      // Sort placedColumns by along (the packing order).
      const sortedCols = [...placedColumns].sort(
        (a, b) => a.proj.along - b.proj.along,
      )
      // Find the target column's index. activeCols[0] is the leftmost
      // focused column (we sorted distinctCols ASC).
      const targetAlong = activeCols[0].along
      const targetIdx = sortedCols.findIndex(c => c.proj.along === targetAlong)
      if (targetIdx < 0) {
        log.debug(
          'section-zoom',
          `BAIL packed branch: target along=${targetAlong} not in placedColumns`,
        )
        return
      }

      // Walk 0..targetIdx and sum cumulative offset from packedX_0.
      // packedX_i = packedX_{i-1} + halfW_{i-1} + halfW_i + edgeGap
      // (the placedColumns useMemo packs edge-to-edge with edge gap).
      let cumulativeOffsetPx = 0
      for (let i = 1; i <= targetIdx; i += 1) {
        const prevHalf = newVisualWidth(sortedCols[i - 1]) / 2
        const currHalf = newVisualWidth(sortedCols[i]) / 2
        cumulativeOffsetPx += prevHalf + currHalf + COLUMN_EDGE_GAP_PX
      }

      const leftmostAlong = sortedCols[0].proj.along
      const plotCentre = MARGIN.left + plotWidth / 2
      // Want target's POST-ZOOM nudgedX = plotCentre:
      //   plotCentre = MARGIN.left + (leftmostAlong - newXMin) * newScaleH
      //              + cumulativeOffsetPx
      // → newXMin = leftmostAlong - (plotCentre - MARGIN.left - cumulativeOffsetPx) / newScaleH
      xMin =
        leftmostAlong -
        (plotCentre - MARGIN.left - cumulativeOffsetPx) / newScaleH
      xMax = xMin + TARGET_XRANGE_M
      log.debug(
        'section-zoom',
        `PACKED targetIdx=${targetIdx}/${sortedCols.length} cumOff=${cumulativeOffsetPx.toFixed(0)} newBHW=${newBandHalfWidth} newScaleH=${newScaleH.toFixed(2)} leftmostAlong=${leftmostAlong} xMin=${xMin.toFixed(1)} xMax=${xMax.toFixed(1)}`,
      )
    }

    // Vertical: maximum extent ("top of test, bottom of test, fill
    // the screen"). Tight to the data span with a small ±5% margin
    // so the surface tick + deepest sample don't kiss the plot
    // edges.
    const zRange = topZ - bottomZ
    const zMargin = Math.max(0.5, zRange * 0.05)
    const levelMin = bottomZ - zMargin
    const levelMax = topZ + zMargin

    log.debug(
      'section-zoom',
      `APPLY fits=${fits.length} distinct=${distinctCols.length} activeCols=${activeCols.length} xMin=${xMin.toFixed(1)} xMax=${xMax.toFixed(1)} levelMin=${levelMin.toFixed(1)} levelMax=${levelMax.toFixed(1)}`,
    )
    setViewport(prev => ({
      ...prev,
      xMin,
      xMax,
      levelMin,
      levelMax,
    }))
    focusedContactsLastRef.current = focusedContactIds
    // reason: the packed-layout branch reads scaleH + viewport.xMin /
    // xMax via closure, but those must NOT be in deps — they change
    // on every wheel-zoom / pan, and the ref-check at the top of
    // the effect would short-circuit anyway. Closure capture is
    // correct because React re-defines the effect callback per
    // render with the latest values, so on each focusedContactIds-
    // driven fire the latest scaleH / viewport are used.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    focusedContactIds,
    contacts,
    focusableContacts,
    placedColumns,
    cptPlots,
    boreholeDetails,
    columnSpacing,
  ])

  // Click-to-place pick state + handlers. The hook owns the modal's
  // open / closed state and the create-on-select flow; the
  // ColumnGlyph + ContactPickBar + BoreholeColumn click handlers
  // call into its handlePickCpt / handlePickBorehole entries, and
  // the FormationPickerDialog's onSelect / onCancel hit
  // handlePickerSelect / cancel respectively. Debt #30.
  const {
    pickContext,
    handlePickCpt,
    handlePickBorehole,
    handlePickerSelect,
    cancel: cancelPicker,
  } = useContactPicker(onCreateContact)

  // Focus mode — when set, the section renders only the named test's
  // column (no DEM, no neighbours). Used for single-test boundary
  // editing without leaving the section view's existing pick / snap /
  // picker plumbing. Transient: not persisted to view_state because
  // it's a momentary edit state, not a saved preference. The hook
  // also owns the auto-zoom-on-entry / restore-on-exit snapshot.
  // Debt #30.
  const { focusedColumn, enterFocus, exitFocus } = useFocusColumn(
    placedColumns,
    viewport,
    vex,
    plotWidth,
    plotHeight,
    setViewport,
    setVex,
  )

  // Lift focusedColumn to the shell so SectionsToolbar can gate the
  // litho-axis "Suggest litho" button on the section-local focus
  // (not the global map/data selection). The callback is optional so
  // the test-render path can mount without a seam.
  useEffect(() => {
    onFocusedColumnChange?.(focusedColumn)
  }, [focusedColumn, onFocusedColumnChange])

  // Filter the layout pass to just the focused column when active, and
  // re-anchor it to its TRUE projected X so it renders dead-centre at
  // any columnSpacing. Downstream warpAnchors, showLabelsByCptId,
  // hideStickIds all read through this.
  const visibleColumns = useMemo(() => {
    if (focusedColumn === null) return placedColumns
    return placedColumns
      .filter(
        c => c.kind === focusedColumn.kind && c.proj.item.id === focusedColumn.id,
      )
      .map(c => {
        // In focus the column is the sole subject. Render it at its TRUE
        // projected position (xToScreen(along)) instead of the packed /
        // nudged multi-column position. enterFocus centres the viewport
        // on proj.along, so xToScreen(along) == plot centre — the column
        // lands dead-centre at ANY columnSpacing. At spacing<1 the packed
        // nudgedX is unrelated to along, which is why focusing while
        // packed left the test off-screen ("had to pan to find it").
        // xToScreen is pure-linear in the viewport, so this is stable
        // (no packed-cumulative feedback loop). All focus consumers
        // (ContactPickBar, InvestigationColumns, warpAnchors, labels)
        // read nudgedX through visibleColumns, so they stay consistent.
        const sx = xToScreen(c.proj.along)
        return { ...c, trueX: sx, nudgedX: sx, displaced: false }
      })
  }, [placedColumns, focusedColumn, xToScreen])

  // Right-click context menu state + handlers — both the
  // ColumnGlyph hit-box handler and the SVG-level catch-all
  // fallback live in this hook (debt #30).
  const {
    contextMenu,
    handleColumnContextMenu,
    handleSvgContextMenu,
    dismiss: dismissContextMenu,
  } = useColumnContextMenu(visibleColumns, containerRef)

  // Remove-from-section handler — appends the column's id to the
  // section's excluded_{cpt,borehole}_ids list and PATCHes. The
  // backend's section projection already filters by these arrays,
  // so the column disappears on the next render. Reversible (the
  // test stays in the project + on the map); per UX rules no
  // confirmation dialog. Returns the next list shape locally to
  // avoid a refetch round-trip — App's PATCH handler replaces the
  // section state with the server's response anyway.
  const handleRemoveFromSection = useCallback(
    async (kind: 'cpt' | 'borehole', id: string): Promise<void> => {
      if (!onPatch) return
      // Closure-captured pre-remove list — see the helper's docstring.
      const { firstApply, undoCmd } = buildRemoveFromSectionCommand(
        kind,
        id,
        {
          excluded_cpt_ids: section.excluded_cpt_ids,
          excluded_borehole_ids: section.excluded_borehole_ids,
        },
        onPatch,
      )
      await firstApply()
      undoStack?.push(undoCmd)
    },
    [
      onPatch,
      section.excluded_cpt_ids,
      section.excluded_borehole_ids,
      undoStack,
    ],
  )

  // Esc exits focus + dismisses any open context menu. Skip when the
  // user is typing into an input so we don't steal text-editing Esc.
  // Lives after the useColumnContextMenu call because the dep array
  // references contextMenu + dismissContextMenu — TDZ would crash
  // first render if this useEffect sat above the hook.
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (contextMenu !== null) {
        dismissContextMenu()
      } else if (focusedColumn !== null) {
        exitFocus()
      } else if (onClose) {
        // L-final: nothing else to peel — deselect the section, which
        // unmounts SectionPanel and falls back to the section map view
        // (SectionsCanvas renders MapView when selectedSectionId is
        // null). Mirrors the Data-stage Esc-to-map peel (debt #43).
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [contextMenu, focusedColumn, exitFocus, dismissContextMenu, onClose])

  // Per-borehole snap candidates for the contact-drag interaction.
  // Empty when snap is off — ContactsLayer treats absent entries as
  // "free drag" so CPTs (which have no stratigraphy to snap to) also
  // fall through correctly. Same set of depths the click-to-place
  // snap consumer in BoreholeColumn uses (formal + informal
  // stratigraphy layer tops + bases).
  // Lookup callback for ContactsLayer's drag readout — interpolates
  // qc + Rf at the dragged depth from the CPT's plot series.
  // Returns null when the CPT id isn't currently loaded (still
  // streaming, off-section, etc.) so the readout falls back to
  // depth + mTAW only.
  const getCptValuesAtDepth = useCallback(
    (cptId: string, depthM: number) => {
      const plot = cptPlots?.get(cptId)
      if (!plot) return null
      return {
        qc: lookupCptValueAtDepth(plot.depths_m, plot.qc_mpa, depthM),
        rf: lookupCptValueAtDepth(plot.depths_m, plot.rf_pct ?? [], depthM),
      }
    },
    [cptPlots],
  )

  // Debt #136 — snap candidates now combine borehole stratigraphy (the
  // original source) with the section's committed contacts on the same
  // anchor.  Tagging each contact-sourced candidate with its contactId
  // lets ContactsLayer's drag handler exclude the dragger's own row, so
  // a small drag doesn't pull back to its starting depth (self-snap
  // suppression).  Both sources gate on ``snapToStratigraphy``: one
  // toggle covers all snap behaviour, matching the user mental model of
  // "do I want snap or not".
  const snapDepthsByAnchorId = useMemo(() => {
    const out = new Map<string, readonly SnapCandidate[]>()
    if (!snapToStratigraphy) return out
    const acc = new Map<string, SnapCandidate[]>()
    if (boreholeDetails !== null) {
      for (const [id, detail] of boreholeDetails) {
        const stratDepths = collectSnapDepths(detail)
        if (stratDepths.length > 0) {
          acc.set(
            id,
            stratDepths.map(d => ({ depth: d })),
          )
        }
      }
    }
    if (contacts) {
      for (const c of contacts) {
        const anchorId = c.borehole_id ?? c.cpt_id
        if (!anchorId) continue
        const list = acc.get(anchorId) ?? []
        list.push({ depth: c.depth_top_m, contactId: c.id })
        acc.set(anchorId, list)
      }
    }
    for (const [k, v] of acc) out.set(k, v)
    return out
  }, [snapToStratigraphy, boreholeDetails, contacts])

  // Collision-aware gridline labels: a CPT only shows its per-CPT
  // gridline value labels ("2", "10 MPa", "2 %", "4 %") when its
  // nearest CPT neighbour on the cross-section is far enough away
  // that the label strips don't overlap. Without this gate, every
  // label band collapses into an unreadable wall at the default
  // section zoom.
  //
  // Threshold ~50 px gives the worst-case label ("10 MPa", ~32 px
  // wide at fontSize=7) plus a small gap. Tight columns drop labels
  // silently; the user can zoom in to spread them out.
  const showLabelsByCptId = useMemo(() => {
    const LABEL_MIN_SPACING_PX = 50
    const cptCols = visibleColumns.filter(c => c.kind === 'cpt')
    const m = new Map<string, boolean>()
    for (const col of cptCols) {
      let minDist = Infinity
      for (const other of cptCols) {
        if (other === col) continue
        const d = Math.abs(col.nudgedX - other.nudgedX)
        if (d < minDist) minDist = d
      }
      m.set(col.proj.item.id, minDist >= LABEL_MIN_SPACING_PX)
    }
    return m
  }, [visibleColumns])

  // Column-label level-of-detail. At dense column spacings the three-line
  // header stack collides into an unreadable mess. ``selectVisibleLabels``
  // decides per column whether to render the full header, a rotated id, or
  // nothing. Selected (focusedColumn) and hovered columns always get full.
  // Recomputes when the layout changes (zoom / pan / spacing) or when
  // hover/focus changes.
  const { labelModeById, calloutIds } = useMemo(() => {
    const lodInputs = visibleColumns.map(col => ({
      id: col.proj.item.id,
      nudgedX: col.nudgedX,
      selected: focusedColumn !== null && col.proj.item.id === focusedColumn.id,
      hovered: col.proj.item.id === hoveredColumnId,
    }))
    const results = selectVisibleLabels(lodInputs)
    const modeMap = new Map<string, ColumnLabelMode>(results.map(r => [r.id, r.mode]))
    const callout = new Set<string>(results.filter(r => r.callout).map(r => r.id))
    return { labelModeById: modeMap, calloutIds: callout }
  }, [visibleColumns, focusedColumn, hoveredColumnId])

  // Warped along-distance → screen X. The Spacing slider's lerp
  // moves each test from its true projected X toward its packed
  // position; without warping any other X-positioned content, the
  // DEM ground-surface line draws at the TRUE along-distance and
  // visually detaches from the tests at low spacing. Build a
  // piecewise-linear map anchored by each placed column's
  // ``(along, nudgedX)`` pair so the DEM "bends" along with the
  // tests. Outside the test range we fall back to true scaling so
  // the line extends naturally past the leftmost / rightmost test.
  //
  // At spacing=1, ``nudgedX`` ≈ ``xToScreen(along)`` (modulo
  // collision nudges) so the warp is essentially identity. At
  // spacing=0, each test sits at its packed X and the function
  // interpolates the DEM through those.
  const warpAnchors = useMemo<WarpAnchor[]>(() => {
    return [...visibleColumns]
      .map(col => ({ along: col.proj.along, effX: col.nudgedX }))
      .sort((a, b) => a.along - b.along)
  }, [visibleColumns])

  // Feed the latest anchors to the wheel-zoom handler's ref (it is declared
  // above this memo, so it cannot close over ``warpAnchors`` directly).
  useEffect(() => {
    warpAnchorsRef.current = warpAnchors
  }, [warpAnchors])

  const warpedXToScreen = useCallback(
    (along: number): number => {
      if (warpAnchors.length === 0) return xToScreen(along)
      // Before the first anchor — extrapolate at true scale so the
      // DEM extends to the left edge with its natural slope.
      if (along <= warpAnchors[0].along) {
        return warpAnchors[0].effX - (warpAnchors[0].along - along) * scaleH
      }
      // After the last anchor — same on the right.
      const last = warpAnchors[warpAnchors.length - 1]
      if (along >= last.along) {
        return last.effX + (along - last.along) * scaleH
      }
      // Inside — find the segment and linearly interpolate.
      let i = 0
      while (i < warpAnchors.length - 1 && warpAnchors[i + 1].along < along) i += 1
      const a = warpAnchors[i]
      const b = warpAnchors[i + 1]
      // Defensive against duplicate-along anchors (two tests
      // projected to the same along-distance) — fall back to ``a``'s
      // effX rather than dividing by zero.
      if (b.along === a.along) return a.effX
      const frac = (along - a.along) / (b.along - a.along)
      return a.effX + frac * (b.effX - a.effX)
    },
    [warpAnchors, xToScreen, scaleH],
  )

  // Section-wide qc full scale in MPa. Default 40 (DOV CPT-graph
  // convention); steps up to 60/80/100/150/200/+50 when any CPT in
  // the section shows ≥ 20 consecutive qc samples above the current
  // step — i.e. a real thick high-qc layer, not a transient spike.
  // Passed verbatim to every CptDataColumn so every column reads on
  // the same axis (DOV cross-comparison rule).
  const qcFullScaleMpa = useMemo(() => {
    if (cptPlots === null) return 40
    const arr: { qc_mpa: ReadonlyArray<number | null | undefined> | null }[] = []
    for (const plot of cptPlots.values()) arr.push({ qc_mpa: plot.qc_mpa })
    return pickQcFullScaleMpa(arr)
  }, [cptPlots])

  // IDs of investigations that already have a data band rendered —
  // CPTs with loaded plot data + boreholes with loaded detail — and
  // a known elevation. For these the ColumnGlyph cap + body line is
  // redundant ("you can see where the test sits, that's the band"),
  // so we suppress the stick visual but keep the name + elevation
  // labels above the band as the identifier.
  const hideStickIds = useMemo(() => {
    const s = new Set<string>()
    if (cptPlots !== null) {
      for (const col of visibleColumns) {
        if (col.kind !== 'cpt') continue
        const item = col.proj.item
        if (cptPlots.has(item.id) && item.elevation_m !== null) s.add(item.id)
      }
    }
    if (boreholeDetails !== null && enabledBhChannels > 0) {
      // Borehole stick only gets hidden when at least one
      // interpretation strip is actually showing. With zero channels
      // enabled BoreholeColumn renders nothing and the stick stays
      // as the column's only visual.
      for (const col of visibleColumns) {
        if (col.kind !== 'borehole') continue
        const item = col.proj.item
        if (boreholeDetails.has(item.id) && item.elevation_m !== null) s.add(item.id)
      }
    }
    return s
  }, [visibleColumns, cptPlots, boreholeDetails, enabledBhChannels])

  // CM fix (dogfeed 2026-05-25): filter contacts passed to CorrelationEdgesOverlay
  // so correlate gesture rects are not drawn at depths covered by active PENDING
  // ghost layers. Old committed contacts from a prior suggest+accept cycle remain
  // in the DB (backend Phase 1 limitation in accept_litho_suggestions.py) and
  // produce clickable correlate zones even when the ghost has been re-merged into
  // a different shape. Only PENDING layers shadow contacts — accepted layers ARE
  // the committed contacts (correct DB state); rejected layers are dismissed.
  const correlateContacts = useMemo((): readonly FormationContactResponse[] => {
    if (!contactGestureState?.contactCorrelateMode || !contacts) return contacts ?? []

    // Build combined investigation → ghost map (focused anchor + bulk anchors).
    type GhostEntry = {
      suggestions: readonly LithoLayerSuggestion[]
      accepted: ReadonlySet<number>
      rejected: ReadonlySet<number>
      edits: ReadonlyMap<number, { depth_top_m?: number; depth_base_m?: number }>
    }
    const ghostMap = new Map<string, GhostEntry>()

    if (bulkLithoGhostState != null) {
      for (const [anchorId, ghost] of bulkLithoGhostState.anchorGhosts) {
        ghostMap.set(anchorId, {
          suggestions: ghost.suggestions,
          accepted: ghost.accepted,
          rejected: ghost.rejected,
          edits: ghost.edits,
        })
      }
    }
    if (lithoGhostState != null) {
      // Focused anchor overwrites the bulk entry so the most specific state wins.
      ghostMap.set(lithoGhostState.investigationId, {
        suggestions: lithoGhostState.suggestions,
        accepted: lithoGhostState.acceptedIndices,
        rejected: lithoGhostState.rejectedIndices,
        edits: lithoGhostState.edits ?? new Map(),
      })
    }
    if (ghostMap.size === 0) return contacts

    return contacts.filter(c => {
      const anchorId = c.cpt_id ?? c.borehole_id
      if (!anchorId) return true
      const ghost = ghostMap.get(anchorId)
      if (!ghost || ghost.suggestions.length === 0) return true
      // Remove contacts whose depth_top_m falls inside any PENDING ghost layer.
      // Pending = not accepted and not rejected.
      const isShadowed = ghost.suggestions.some((s, idx) => {
        if (ghost.accepted.has(idx) || ghost.rejected.has(idx)) return false
        const topM = ghost.edits.get(idx)?.depth_top_m ?? s.depth_top_m
        const baseM = ghost.edits.get(idx)?.depth_base_m ?? s.depth_base_m
        return c.depth_top_m >= topM && c.depth_top_m < baseM
      })
      return !isShadowed
    })
  }, [contacts, contactGestureState, lithoGhostState, bulkLithoGhostState])

  // Debt #151 dogfeed refinement 2026-05-27 — per-anchor pending
  // ghost depth ranges fed into ContactsLayer so it can SPLIT the
  // accepted band around an inserted ghost.  Pending only (accepted
  // ghosts don't render anyway, rejected shouldn't carve).
  const pendingGhostRangesByAnchorId = useMemo(() => {
    const out = new Map<string, { depth_top_m: number; depth_base_m: number }[]>()
    const pushRanges = (
      anchorId: string,
      suggestions: readonly LithoLayerSuggestion[],
      accepted: ReadonlySet<number>,
      rejected: ReadonlySet<number>,
      edits: ReadonlyMap<number, { depth_top_m?: number; depth_base_m?: number }>,
    ) => {
      const ranges = suggestions
        .map((s, idx) => ({ s, idx }))
        .filter(({ idx }) => !accepted.has(idx) && !rejected.has(idx))
        .map(({ s, idx }) => ({
          depth_top_m: edits.get(idx)?.depth_top_m ?? s.depth_top_m,
          depth_base_m: edits.get(idx)?.depth_base_m ?? s.depth_base_m,
        }))
      if (ranges.length > 0) out.set(anchorId, ranges)
    }
    if (bulkLithoGhostState != null) {
      for (const [anchorId, ghost] of bulkLithoGhostState.anchorGhosts) {
        pushRanges(anchorId, ghost.suggestions, ghost.accepted, ghost.rejected, ghost.edits)
      }
    }
    if (lithoGhostState != null) {
      pushRanges(
        lithoGhostState.investigationId,
        lithoGhostState.suggestions,
        lithoGhostState.acceptedIndices,
        lithoGhostState.rejectedIndices,
        lithoGhostState.edits ?? new Map(),
      )
    }
    return out
  }, [lithoGhostState, bulkLithoGhostState])

  // ---- Render --------------------------------------------------------

  const datumShort = verticalDatumShort(zEpsg)
  const yAxisLabel = datumShort ? `Level (${datumShort})` : 'Level (m)'

  return (
    <div className="flex flex-col h-full w-full bg-surface-page">
      <SectionHeader
        section={section}
        lengthM={lengthM}
        onClose={onClose}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        vex={vex}
        onVexChange={setVex}
        onVexCommit={
          // Persist VEX on slider release so reopening the section
          // keeps the user's last setting. Local ``vex`` already
          // updated optimistically by ``setVex``; this just flushes
          // the value to the server.
          onPatch
            ? next => void onPatch({ vertical_exaggeration: next })
            : undefined
        }
        onBufferCommit={
          onPatch
            ? next => void onPatch({ projection_buffer_m: next })
            : undefined
        }
        channels={cptChannels}
        onChannelsChange={handleChannelsChange}
        boreholeChannels={boreholeChannels}
        onBoreholeChannelsChange={handleBoreholeChannelsChange}
        snapToStratigraphy={snapToStratigraphy}
        onSnapToStratigraphyChange={handleSnapToStratigraphyChange}
        columnSpacing={columnSpacing}
        onColumnSpacingChange={setColumnSpacing}
        onColumnSpacingCommit={onPatch ? handleSpacingCommit : undefined}
        scaleH={scaleH}
        scaleV={scaleV}
        onReset={resetView}
      />

      {/* DOV Virtuele Boring overlay controls — picker dropdowns +
          depth + per-pane show toggle. Sits directly under the
          SectionHeader so the engineer can flip on the overlay
          without leaving the section view. */}
      {onChangeVirtueleBoringPicker && onChangeVirtueleBoringShowOnSection && (
        <VirtueleBoringStrip
          modelA={virtueleBoringModelA}
          modelB={virtueleBoringModelB}
          maxDepthM={virtueleBoringMaxDepthM}
          showOnSection={virtueleBoringShowOnSection}
          onChangePicker={onChangeVirtueleBoringPicker}
          onChangeShowOnSection={onChangeVirtueleBoringShowOnSection}
        />
      )}

      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden select-none"
        style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      >
        {size && (
          <svg
            width={size.width}
            height={size.height}
            viewBox={`0 0 ${size.width} ${size.height}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onContextMenu={e => {
              // Swallow the contextmenu that fires when the right
              // button is released at the end of a both-button pan.
              if (bothBtnPanRef.current) {
                e.preventDefault()
                bothBtnPanRef.current = false
                return
              }
              handleSvgContextMenu(e)
            }}
          >
            {/* Soil-code pattern defs — hoisted to a single ``<defs>``
                so every BoreholeColumn renders into the same pattern
                instances (one render of each pattern per SVG, not per
                column). Pattern ids are stable (``soil-FZ``,
                ``soil-KL``, …); ``getSoilFillUrl`` produces matching
                ``url(#soil-XXX)`` references from the layer's soil
                code. */}
            <defs>
              <SoilPatterns />
            </defs>

            {/* Plot-area background — surface one step above the page
                background so the grid + axes read cleanly over it.
                Uses CSS-var tokens (section-plot-*) defined in
                index.css :root/.dark because SVG attributes can't
                use Tailwind dark: variants. Marquee + pan dispatch
                lives on the SVG root (see handleMouseDown above) so
                this rect only needs to draw — its mousedown bubbles
                up to the SVG and gets routed there. */}
            <rect
              x={MARGIN.left}
              y={MARGIN.top}
              width={plotWidth}
              height={plotHeight}
              fill="var(--section-plot-bg)"
              stroke="var(--section-plot-border)"
              data-testid="section-marquee-bg"
            />

            {/* Vertical gridlines + x-axis ticks (along-distance).
                Position uses ``warpedXToScreen`` so the gridlines
                and axis labels track the test packing at low
                spacing — same warp the DEM polyline uses. The label
                values themselves stay at the true along-distance
                they represent (the "200 m" tick is still 200 m
                along the section, just rendered at a compressed
                screen X). */}
            {xTicks.map(v => {
              const sx = warpedXToScreen(v)
              return (
                <g key={`xt-${v}`}>
                  <line
                    x1={sx}
                    x2={sx}
                    y1={MARGIN.top}
                    y2={MARGIN.top + plotHeight}
                    stroke="var(--section-grid)"
                  />
                  <text
                    x={sx}
                    y={MARGIN.top + plotHeight + 14}
                    fontSize={10}
                    fill="var(--section-axis-tick)"
                    textAnchor="middle"
                  >
                    {Math.round(v)}
                  </text>
                </g>
              )
            })}

            {/* Horizontal gridlines + y-axis ticks (level). */}
            {levelTicks.map(v => {
              const sy = levelToScreen(v)
              return (
                <g key={`lt-${v}`}>
                  <line
                    x1={MARGIN.left}
                    x2={MARGIN.left + plotWidth}
                    y1={sy}
                    y2={sy}
                    stroke="var(--section-grid)"
                  />
                  <text
                    x={MARGIN.left - 6}
                    y={sy + 3}
                    fontSize={10}
                    fill="var(--section-axis-tick)"
                    textAnchor="end"
                  >
                    {/* One decimal when the step is sub-metre so
                        labels like "-12.5" don't collapse to "-13". */}
                    {Number.isInteger(v) ? v : v.toFixed(1)}
                  </text>
                </g>
              )
            })}

            {/* DEM ground-surface polyline. Drawn below the
                investigation columns so the column caps + name
                labels read cleanly on top — the surface line is
                context, not the primary content. Breaks at NoData
                samples (gaps outside DHMVII coverage). Suppressed
                in focus mode so the single visible column reads as
                a standalone test view. */}
            {demSamples !== null && focusedColumn === null && (
              <DemSurfaceLine
                samples={demSamples}
                // Use the warped x-mapping so the surface line
                // bends to follow the packed test positions at low
                // spacing. At spacing=1 the warp is identity and
                // the DEM draws at its true along-distance.
                xToScreen={warpedXToScreen}
                levelToScreen={levelToScreen}
                plotTop={MARGIN.top}
                plotBottom={MARGIN.top + plotHeight}
                plotLeft={MARGIN.left}
                plotRight={MARGIN.left + plotWidth}
              />
            )}

            {/* CPT data tracks (qc curve + Rf curve + optional fs /
                u2 / q_total). Drawn BEFORE the column glyphs so the
                cap + name label + tie-back sit on top and stay
                readable. Only renders for CPTs whose plot data
                finished loading; bare columns render fine without
                it. Widths scale with horizontal zoom so curves stay
                readable when the user zooms in. */}
            {cptPlots !== null &&
              visibleColumns.map(col => {
                if (col.kind !== 'cpt') return null
                const item = col.proj.item
                const plot = cptPlots.get(item.id)
                if (!plot || item.elevation_m === null) return null
                return (
                  <CptDataColumn
                    key={`cpt-data-${item.id}`}
                    plot={plot}
                    cptType={item.cpt_type}
                    channels={cptChannels}
                    halfWidth={bandHalfWidth}
                    screenX={col.nudgedX}
                    surfaceElevationM={item.elevation_m}
                    plotTop={MARGIN.top}
                    plotBottom={MARGIN.top + plotHeight}
                    levelToScreen={levelToScreen}
                    showLabels={showLabelsByCptId.get(item.id) ?? true}
                    qcFullScaleMpa={qcFullScaleMpa}
                  />
                )
              })}

            {/* Borehole lithology strips — DOV lengteprofiel
                convention, patterned coloured rectangles per
                coded_lithology layer. Renders ONLY for boreholes
                whose detail finished loading AND that have a known
                elevation; bare cap-only columns render fine without
                a strip. Drawn before InvestigationColumns so the
                cap + name label overlays on top. */}
            {boreholeDetails !== null &&
              visibleColumns.map(col => {
                if (col.kind !== 'borehole') return null
                const item = col.proj.item
                const detail = boreholeDetails.get(item.id)
                if (!detail || item.elevation_m === null) return null
                return (
                  <BoreholeColumn
                    key={`bh-strip-${item.id}`}
                    detail={detail}
                    channels={boreholeChannels}
                    screenX={col.nudgedX}
                    halfWidth={bandHalfWidth}
                    surfaceElevationM={item.elevation_m}
                    plotTop={MARGIN.top}
                    plotBottom={MARGIN.top + plotHeight}
                    levelToScreen={levelToScreen}
                    onCommitDepth={onCreateContact ? handlePickBorehole : undefined}
                    snapToStratigraphy={snapToStratigraphy}
                    showHoverReadout={focusedColumn !== null}
                    onDoubleClickOpen={
                      onSelectBorehole ? () => onSelectBorehole(item.id) : undefined
                    }
                  />
                )
              })}

            {/* CPT contact-pick affordance. Renders an invisible
                hover-capture overlay over each CPT's data band; on
                mouse-move shows a ghost depth line + readout
                (qc / Rf / depth / mTAW), on click commits the depth
                via ``handlePickCpt`` which opens the formation
                picker. Skipped when no contact-create callback is
                wired (read-only test view). */}
            {cptPlots !== null && (onCreateContact || focusedColumn !== null) &&
              visibleColumns.map(col => {
                if (col.kind !== 'cpt') return null
                const item = col.proj.item
                const plot = cptPlots.get(item.id)
                if (!plot || item.elevation_m === null) return null
                // Re-derive the cap-clamped data extent the
                // CptDataColumn uses so the pick area matches the
                // band the user sees.
                const surfaceY = levelToScreen(item.elevation_m)
                const bottomDepth =
                  plot.depths_m.length > 0
                    ? plot.depths_m[plot.depths_m.length - 1]
                    : 0
                const dataBottomY = levelToScreen(item.elevation_m - bottomDepth)
                const bgTopY = Math.max(
                  MARGIN.top,
                  Math.min(MARGIN.top + plotHeight, surfaceY),
                )
                const bgBottomY = Math.max(
                  MARGIN.top,
                  Math.min(MARGIN.top + plotHeight, dataBottomY),
                )
                return (
                  <ContactPickBar
                    key={`cpt-pick-${item.id}`}
                    plot={plot}
                    cptType={item.cpt_type}
                    cptName={item.name}
                    cptId={item.id}
                    screenX={col.nudgedX}
                    halfWidth={bandHalfWidth}
                    surfaceElevationM={item.elevation_m}
                    plotTop={MARGIN.top}
                    plotBottom={MARGIN.top + plotHeight}
                    bgTopY={bgTopY}
                    bgBottomY={bgBottomY}
                    levelToScreen={levelToScreen}
                    onCommitDepth={onCreateContact ? handlePickCpt : undefined}
                    onDoubleClickOpen={
                      onSelectCpt ? () => onSelectCpt(item.id) : undefined
                    }
                  />
                )
              })}

            {/* Investigation columns. Both kinds rendered from a
                single nudged list — the layout pass spaces crowded
                projections rightward while drawing tie-back
                diagonals so each column's true projected position
                stays inspectable. */}
            <InvestigationColumns
              columns={visibleColumns}
              levelToScreen={levelToScreen}
              plotTop={MARGIN.top}
              plotBottom={MARGIN.top + plotHeight}
              // Single-click stays inert on the column itself — the
              // ContactPickBar / BoreholeColumn overlays own the
              // contact-place gesture (now debounced 250 ms behind a
              // dbl-click gate, see useClickDebounce). Double-click on
              // the outer column glyph opens detail; the inner pick
              // rects forward their own dbl-click via onDoubleClickOpen
              // so dbl-clicks on the data band also open detail.
              onSelectCpt={undefined}
              onSelectBorehole={undefined}
              onDoubleClickCpt={onSelectCpt}
              onDoubleClickBorehole={onSelectBorehole}
              onColumnContextMenu={handleColumnContextMenu}
              hideStickIds={hideStickIds}
              labelModeById={labelModeById}
              calloutIds={calloutIds}
              onColumnHover={setHoveredColumnId}
            />

            {/* DOV Virtuele Boring ghost columns — informative-only
                overlay showing what DOV's 3D model predicts at each
                investigation's (x, y). One labelled column per
                active model, faded so it reads as "DOV says…"
                rather than ground truth. Engineers use it to inform
                manual contact picks. Renders nothing when both
                dropdowns are off, no predictions have been fetched,
                or the user toggled visibility off on this pane. */}
            {virtueleBoringShowOnSection && (
              <VirtueleBoringGhostColumns
                columns={visibleColumns}
                activeModels={virtueleBoringActiveModelsClamped}
                predictionsByInvestigationId={virtueleBoringPredictionsByInvestigationId}
                levelToScreen={levelToScreen}
                plotTop={MARGIN.top}
                plotBottom={MARGIN.top + plotHeight}
                bandHalfWidth={bandHalfWidth}
                maxDepthMBelowSurface={virtueleBoringMaxDepthM}
              />
            )}

            {/* Geological-model formation contacts. Each formation
                with ≥1 contact in this section renders as a
                coloured polyline through its anchor columns; the
                formation's name label sits to the right of the
                rightmost vertex. Empty when the project has no
                contacts yet (the Phase 4 editor's blank canvas).

                Render order note (debt #75, 2026-05-21): ContactsLayer
                paints BEFORE the litho ghost overlays so the ghost
                drag handles sit on top of the per-contact drag
                strips. Without this order, the contact strips (which
                span between investigation columns horizontally)
                capture mousedown events meant for the ghost handles
                in the multi-column bulk-suggest view — the drag
                handles appeared to do nothing in zoomed-out mode. */}
            <ContactsLayer
              contacts={contacts}
              liveContactDepthOverride={liveContactDepthOverride}
              formations={formations}
              placedColumns={visibleColumns}
              // #159-followup: the active model's cross-column formation
              // surfaces (TIN slice + connect-the-dots) group BY FORMATION
              // and auto-join same-lithology contacts across columns,
              // ignoring the explicit correlation graph.  Wrong on the
              // litho axis — connectivity there is the user's explicit
              // correlation ribbons, not an auto-join (confirmed via the
              // dashed-inventory diagnostic, 2026-05-29).  Geological axis
              // keeps them (formations ARE laterally continuous).
              renderFormationSurfaces={axisMode !== 'lithostratigraphic'}
              // Debt #142 follow-up — the post-accept hide of litho
              // suggestion ghosts removed the bold colour fill the user
              // previously read as "this band is a SAND / SILT / CLAY
              // unit".  Bump the band opacity on the litho axis so
              // lithology colours stand on their own against the
              // underlying CPT trace.  Geological axis keeps the
              // original 0.18 (light backdrop where bands would
              // otherwise compete with contact lines + labels).
              bandFillOpacity={axisMode === 'lithostratigraphic' ? 0.55 : 0.18}
              // Cross-column TIN-derived formationFillBands need a
              // built litho surface to produce geometry; on a typical
              // litho-axis CPT column with no surface the band cell is
              // empty.  perColumnBandsFromContacts paints a coloured
              // rect between adjacent committed contacts on every
              // column directly — independent of any TIN — so the
              // user always sees the lithology stack.
              perColumnBandsFromContacts={axisMode === 'lithostratigraphic'}
              // Debt #151 dogfeed refinement 2026-05-27 — pending
              // ghost ranges per anchor so the per-column band can
              // SPLIT around the ghost (ghost visible on top, no
              // colour mash-up underneath).  PENDING only — accepted
              // ghost layers don't render via #142 and rejected ones
              // shouldn't carve the band.
              pendingGhostRangesByAnchorId={pendingGhostRangesByAnchorId}
              // Debt #152 — hard floor of 10 cm between adjacent litho
              // contacts now that cross-merge is off (commit 9d4a01db).
              // Geological axis keeps its cross-merge absorb gesture
              // and stays unclamped (prop undefined).
              contactDragClampMinThicknessM={
                axisMode === 'lithostratigraphic' ? 0.1 : undefined
              }
              // Debt #134-B — pre-release "↦ snap on release" hint in
              // the drag readout.  Only meaningful on the litho axis;
              // ContactsLayer also guards on ``referenceContacts``
              // being non-empty, so passing the tolerance unconditionally
              // on the litho axis is safe.  The caller (SectionsCanvas)
              // is expected to pass ``geoSnapToleranceM`` through.
              geoSnapToleranceM={
                axisMode === 'lithostratigraphic' ? geoSnapToleranceM : undefined
              }
              // Debt #151 — right-click on empty litho column → "Add
              // new suggestion" routes through the existing picker
              // (useContactPicker's handlePickCpt / handlePickBorehole
              // sets pickContext, which opens the
              // LithoCompositionPickerDialog mounted below).  Litho
              // axis only — geological axis already has its own
              // create-contact flows via ContactPickBar / BoreholeColumn.
              onRequestAddLithoSuggestion={
                axisMode === 'lithostratigraphic'
                  ? (kind, anchorId, depth_m, anchorName, elevationM) => {
                      if (kind === 'cpt') {
                        handlePickCpt({
                          kind: 'cpt',
                          cptId: anchorId,
                          cptName: anchorName,
                          depth_m,
                          elevationM,
                          snapped: false,
                        })
                      } else {
                        handlePickBorehole({
                          kind: 'borehole',
                          boreholeId: anchorId,
                          boreholeName: anchorName,
                          depth_m,
                          elevationM,
                          snapped: false,
                        })
                      }
                    }
                  : undefined
              }
              excludedBoreholeIds={
                excludedBoreholeIds === undefined
                  ? undefined
                  : new Set(excludedBoreholeIds)
              }
              levelToScreen={levelToScreen}
              plotTop={MARGIN.top}
              plotBottom={MARGIN.top + plotHeight}
              onUpdateContactDepth={onUpdateContactDepth}
              onDeleteContact={onDeleteContact}
              onUnlinkLithoFromGeo={onUnlinkLithoFromGeo}
              onLinkLithoToGeo={onLinkLithoToGeo}
              onPinchOutContact={pinchOutGhostState?.onPreviewPinchOut}
              onBatchUpdateContacts={onBatchUpdateContacts}
              onBatchCreateContacts={onBatchCreateContacts}
              marquee={marquee}
              onSetMarquee={setMarquee}
              selectionResetSignal={selectionResetCounter}
              snapDepthsByAnchorId={snapDepthsByAnchorId}
              getCptValuesAtDepth={getCptValuesAtDepth}
              surfacesByFormationId={surfacesByFormationId}
              // The user's placed contacts are the single source of truth on
              // the section: draw the active surface as a chord through every
              // pick rather than a TIN slice along the section line (which
              // diverges from off-line investigations' actual contact depth —
              // dogfeed 2026-05-29). The backdrop already does this via
              // referenceContacts; this brings the active surface in line.
              surfaceThroughPicks
              // Suppress the depth-drag hit-strip while correlating so it can't
              // intercept boundary-select clicks (dogfeed 2026-05-29).
              correlateMode={contactGestureState?.contactCorrelateMode ?? false}
              referenceFormations={referenceFormations}
              referenceSurfacesByFormationId={referenceSurfacesByFormationId}
              referenceContacts={referenceContacts}
              focusedContactIds={
                focusedContactIds && focusedContactIds.length > 0
                  ? new Set(focusedContactIds)
                  : undefined
              }
              showConfidenceFade={showConfidenceFade}
              sectionLine={{
                startX: section.start_x,
                startY: section.start_y,
                endX: section.end_x,
                endY: section.end_y,
              }}
              alongMToScreenX={warpedXToScreen}
              onEditInGeologyStage={onEditInGeologyStage}
            />

            {/* Litho-suggestion ghost column (slice 3, #55) — interactive
                overlay to the LEFT of the targeted investigation showing
                the Robertson-2015/borehole segmenter output. Click a
                layer to accept (creates contact + formation), right-click
                to reject. Renders nothing when the prop is absent.
                Painted AFTER ContactsLayer so the ghost drag handles
                are on top of contact strips (debt #75). */}
            {lithoGhostState && lithoGhostState.suggestions.length > 0 && (
              <LithoSuggestionGhostColumns
                columns={visibleColumns}
                investigationId={lithoGhostState.investigationId}
                suggestions={lithoGhostState.suggestions}
                levelToScreen={levelToScreen}
                surfaceElevationM={lithoGhostState.surfaceElevationM}
                plotTop={MARGIN.top}
                plotBottom={MARGIN.top + plotHeight}
                bandHalfWidth={bandHalfWidth}
                acceptedIndices={lithoGhostState.acceptedIndices}
                rejectedIndices={lithoGhostState.rejectedIndices}
                onAccept={lithoGhostState.onAccept}
                onReject={lithoGhostState.onReject}
                onUnreject={lithoGhostState.onUnreject}
                // Pass formations so the ghost tooltip can show the parent
                // formation name from suggestion.parent_formation_id.
                formations={formations}
                // Phase 2 drag-resize state — the renderer applies edits
                // on top of the raw suggestions and commits new edits
                // via onEdit on mouseup.
                edits={lithoGhostState.edits}
                onEdit={lithoGhostState.onEdit}
                onCrossColumnPaste={lithoGhostState.onCrossColumnPaste}
                onInsertLayer={lithoGhostState.onInsertLayer}
                onSplitLayer={lithoGhostState.onSplitLayer}
                onMergeLayers={lithoGhostState.onMergeLayers}
                onAbsorbLayer={lithoGhostState.onAbsorbLayer}
                onExtendToNearest={lithoGhostState.onExtendToNearest}
                committedContactsForAnchor={lithoGhostState.committedContactsForAnchor}
                contactIdsByAcceptedIdx={lithoGhostState.contactIdsByAcceptedIdx}
                onUpdateContactDepth={lithoGhostState.onUpdateContactDepth}
                onContactLivePreview={lithoGhostState.onContactLivePreview}
                // Per-CPT depth series for the drag readout (qc + Rf).
                // ``cptPlots`` is already loaded by useSectionData for the
                // CPT data columns; reuse here so the readout doesn't
                // require a fresh round-trip. ?? undefined keeps the prop
                // genuinely absent while loading.
                cptPlotByAnchorId={cptPlots ?? undefined}
              />
            )}

            {/* Bulk-suggest ghost overlays (debt #73 / Phase 3) —
                one LithoSuggestionGhostColumns instance per bulk
                anchor. Each gets the same widget but bound to its
                own (kind, id, accepted/rejected/edits) slice of
                the bulk Map. Handlers are anchor-scoped — onAccept
                / onReject / onEdit forward the anchorId so the
                parent commits to the right column. Renders nothing
                when the prop is absent. Same paint-after-contacts
                ordering as the single-anchor ghost above. */}
            {bulkLithoGhostState != null &&
              Array.from(bulkLithoGhostState.anchorGhosts.entries()).map(
                ([anchorId, ghost]) => (
                  <LithoSuggestionGhostColumns
                    key={`bulk-ghost-${anchorId}`}
                    columns={visibleColumns}
                    investigationId={anchorId}
                    suggestions={ghost.suggestions}
                    levelToScreen={levelToScreen}
                    surfaceElevationM={ghost.surfaceElevationM}
                    plotTop={MARGIN.top}
                    plotBottom={MARGIN.top + plotHeight}
                    bandHalfWidth={bandHalfWidth}
                    acceptedIndices={ghost.accepted}
                    rejectedIndices={ghost.rejected}
                    onAccept={idx => {
                      void bulkLithoGhostState.onAccept(anchorId, idx)
                    }}
                    onReject={idx => {
                      bulkLithoGhostState.onReject(anchorId, idx)
                    }}
                    onUnreject={
                      bulkLithoGhostState.onUnreject
                        ? idx => {
                            bulkLithoGhostState.onUnreject?.(anchorId, idx)
                          }
                        : undefined
                    }
                    formations={formations}
                    edits={ghost.edits}
                    onEdit={(idx, edit) => {
                      bulkLithoGhostState.onEdit(anchorId, idx, edit)
                    }}
                    onCrossColumnPaste={bulkLithoGhostState.onCrossColumnPaste}
                    onInsertLayer={
                      bulkLithoGhostState.onInsertLayer !== undefined
                        ? (afterIdx, composition) => {
                            bulkLithoGhostState.onInsertLayer!(
                              anchorId,
                              afterIdx,
                              composition,
                            )
                          }
                        : undefined
                    }
                    onSplitLayer={
                      bulkLithoGhostState.onSplitLayer !== undefined
                        ? idx => {
                            bulkLithoGhostState.onSplitLayer!(anchorId, idx)
                          }
                        : undefined
                    }
                    onMergeLayers={
                      bulkLithoGhostState.onMergeLayers !== undefined
                        ? upperIdx => {
                            bulkLithoGhostState.onMergeLayers!(anchorId, upperIdx)
                          }
                        : undefined
                    }
                    onAbsorbLayer={
                      bulkLithoGhostState.onAbsorbLayer !== undefined
                        ? (draggerIdx, direction) => {
                            bulkLithoGhostState.onAbsorbLayer!(
                              anchorId,
                              draggerIdx,
                              direction,
                            )
                          }
                        : undefined
                    }
                    onExtendToNearest={
                      bulkLithoGhostState.onExtendToNearest !== undefined
                        ? idx => {
                            return bulkLithoGhostState.onExtendToNearest!(anchorId, idx)
                          }
                        : undefined
                    }
                    cptPlotByAnchorId={cptPlots ?? undefined}
                  />
                ),
              )}

            {/* Pinch-out ghost-wedge overlay (ghost-UX slice).  Renders a
                dashed semi-transparent triangle from the pinching
                formation's last real contact toward the computed tip.
                Shown only after the engineer triggers a dry_run via the
                contact context menu.  Absent when no preview is active or
                the prop is not wired. */}
            {pinchOutGhostState && (
              <PinchOutGhostOverlay
                preview={pinchOutGhostState.preview}
                loading={pinchOutGhostState.loading}
                contacts={contacts}
                formations={pinchOutGhostState.formations}
                placedColumns={visibleColumns}
                alongMToScreenX={warpedXToScreen}
                levelToScreen={levelToScreen}
                plotTop={MARGIN.top}
                plotBottom={MARGIN.top + plotHeight}
                onConfirm={pinchOutGhostState.onConfirm}
                onDismiss={pinchOutGhostState.onDismiss}
              />
            )}

            {/* Litho correlation overlay: body chips, contact-level edges,
                and contact gesture hit-targets (#133 Phase 1 + #135).
                Mounted on the litho axis only (axisMode ===
                'lithostratigraphic'); absent on the geological axis so the
                overlay never intercepts geological-axis interactions.
                pointerEvents=none at the group level — the component
                enables pointer-events only for gesture rects when
                contactCorrelateMode is active. */}
            {axisMode === 'lithostratigraphic' && (
              <CorrelationEdgesOverlay
                contacts={correlateContacts}
                formations={formations}
                placedColumns={visibleColumns}
                levelToScreen={levelToScreen}
                plotTop={MARGIN.top}
                plotBottom={MARGIN.top + plotHeight}
                pulsingFormationIds={pulsingFormationIds}
                onInspectLensBody={onInspectLensBody}
                onPropagateAdmixtures={onPropagateAdmixtures}
                contactEdges={contactEdges}
                contactGestureState={contactGestureState}
                onUnapprovedDragStart={onUnapprovedDragStart}
                unapprovedEdgeDrag={unapprovedEdgeDrag}
                onRequestDeleteEdge={onRequestDeleteEdge}
                onRequestAcceptEdge={onRequestAcceptEdge}
              />
            )}
            {/* Lens wedges (#163f Slice 2) — detected lenses rendered as
                shapeable tapering wedges with draggable ghost nodes. Litho
                axis only; isolated from CorrelationEdgesOverlay. */}
            {axisMode === 'lithostratigraphic' && lenses !== undefined && (
              <LensWedgeOverlay
                lenses={lenses}
                boundariesByLensId={lensBoundaries ?? EMPTY_LENS_BOUNDARIES}
                contacts={correlateContacts}
                placedColumns={visibleColumns}
                contactEdges={contactEdges ?? []}
                alongToScreenX={xToScreen}
                levelToScreen={levelToScreen}
                screenXToAlong={screenXToAlong}
                screenToLevel={screenToLevel}
                plotTop={MARGIN.top}
                plotBottom={MARGIN.top + plotHeight}
                onSaveLensShape={onSaveLensShape}
                onDeleteLens={onDeleteLens}
              />
            )}

            {/* P4 (dogfeed 2026-05-30) — second pass of CptDataColumn in
                ``overlayMode`` so the qc/Rf reference gridlines + value
                labels (2 / 10 MPa, 2 / 4 %) render ON TOP of the litho
                band fills. The first pass at line 2034 paints them
                behind the bands (correct for the track background and
                curves); the overlay layer here picks them out
                separately and renders them last with stronger stroke
                + pointerEvents:none so the underlying drag surfaces
                stay clickable. */}
            {cptPlots !== null &&
              visibleColumns.map(col => {
                if (col.kind !== 'cpt') return null
                const item = col.proj.item
                const plot = cptPlots.get(item.id)
                if (!plot || item.elevation_m === null) return null
                return (
                  <CptDataColumn
                    key={`cpt-ref-overlay-${item.id}`}
                    plot={plot}
                    cptType={item.cpt_type}
                    channels={cptChannels}
                    halfWidth={bandHalfWidth}
                    screenX={col.nudgedX}
                    surfaceElevationM={item.elevation_m}
                    plotTop={MARGIN.top}
                    plotBottom={MARGIN.top + plotHeight}
                    levelToScreen={levelToScreen}
                    showLabels={showLabelsByCptId.get(item.id) ?? true}
                    qcFullScaleMpa={qcFullScaleMpa}
                    overlayMode
                  />
                )
              })}

            {/* Axis labels. */}
            <text
              x={MARGIN.left + plotWidth / 2}
              y={MARGIN.top + plotHeight + 28}
              fontSize={11}
              fill="var(--section-axis-title)"
              textAnchor="middle"
            >
              Distance along section (m)
            </text>
            <text
              x={14}
              y={MARGIN.top + plotHeight / 2}
              fontSize={11}
              fill="var(--section-axis-title)"
              textAnchor="middle"
              transform={`rotate(-90 14 ${MARGIN.top + plotHeight / 2})`}
            >
              {yAxisLabel}
            </text>
          </svg>
        )}
        {!size && (
          <div className="flex items-center justify-center h-full text-xs text-gray-400">
            Sizing canvas…
          </div>
        )}
        {contextMenu !== null && (
          <ColumnContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            name={contextMenu.name}
            onFocus={() =>
              enterFocus({
                kind: contextMenu.kind,
                id: contextMenu.id,
                name: contextMenu.name,
              })
            }
            onOpenDetail={
              contextMenu.kind === 'cpt'
                ? onSelectCpt
                  ? () => onSelectCpt(contextMenu.id)
                  : undefined
                : onSelectBorehole
                  ? () => onSelectBorehole(contextMenu.id)
                  : undefined
            }
            onRemoveFromSection={
              onPatch
                ? () => {
                    void handleRemoveFromSection(contextMenu.kind, contextMenu.id)
                  }
                : undefined
            }
            onClose={dismissContextMenu}
          />
        )}
        {/* Pinch-out confirm/dismiss panel.  Rendered OUTSIDE the SVG
            so pointer events work reliably without foreignObject quirks.
            Sits in the top-right corner of the section panel. */}
        {pinchOutGhostState && (
          <PinchOutConfirmPanel
            preview={pinchOutGhostState.preview}
            loading={pinchOutGhostState.loading}
            formationName={
              pinchOutGhostState.preview
                ? (pinchOutGhostState.formations.find(
                    f => f.id === pinchOutGhostState.preview!.formation_id,
                  )?.name ?? 'Formation')
                : ''
            }
            onConfirm={pinchOutGhostState.onConfirm}
            onDismiss={pinchOutGhostState.onDismiss}
          />
        )}

        {focusedColumn !== null && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-purple-600 text-white text-xs px-3 py-1.5 rounded-full shadow">
            <span>Focus: {focusedColumn.name}</span>
            <button
              type="button"
              className="hover:text-purple-200"
              onClick={exitFocus}
              title="Exit focus mode (Esc)"
              aria-label="Exit focus mode"
            >
              ✕
            </button>
          </div>
        )}
        {/* Seed hint — never-seeded section is the common case after
            the P2 explicit-content gate: nothing appears on a section
            without the user clicking a button on that section. Show a
            compact overlay so the engineer knows what to do next.
            pointer-events-none keeps the SVG pan/zoom fully interactive
            through the hint. */}
        {contacts.length === 0 && size && (
          <div
            className="absolute inset-0 flex items-end justify-center pb-8 pointer-events-none"
            aria-hidden="true"
          >
            <EmptyState
              compact
              icon={<Layers />}
              title="No formation contacts on this section"
              hint={
                onAutoPopulateFromStratigraphy
                  ? "Click 'Seed' in the toolbar to populate from the active model, or draw contacts manually."
                  : 'Define formations in the Geology stage first, then return here to seed or draw contacts manually.'
              }
            />
          </div>
        )}
        <CanvasHints
          axisMode={axisMode}
          correlateBlocked={
            contactGestureState?.contactCorrelateMode === true
            && correlateContacts.length === 0
          }
        />
      </div>

      <SectionScrubBar
        dataMinM={scrubDataMinM}
        dataMaxM={scrubDataMaxM}
        xMin={viewport.xMin}
        xMax={viewport.xMax}
        onScrubTo={scrubTo}
      />

      {/* Hidden-from-section restore footer — mirrors the Sidebar's
          "N removed · restore all" pattern. Only renders when the
          section has at least one excluded id; clicking the link
          clears both arrays in a single PATCH so the columns
          reappear on the next render. Reversible action's undo
          surface. */}
      {onPatch &&
        (section.excluded_cpt_ids.length + section.excluded_borehole_ids.length) > 0 && (
          <div
            className="flex items-center justify-between px-3 py-1 text-[11px] text-gray-500 bg-gray-50 border-t border-gray-200"
            data-testid="section-hidden-footer"
          >
            <span>
              {section.excluded_cpt_ids.length + section.excluded_borehole_ids.length}{' '}
              hidden from this section
            </span>
            <button
              type="button"
              className="text-blue-600 hover:text-blue-800 hover:underline"
              onClick={() =>
                void onPatch({
                  excluded_cpt_ids: [],
                  excluded_borehole_ids: [],
                })
              }
              title="Restore every test hidden from this section. Their columns reappear on the next render."
            >
              restore all
            </button>
          </div>
        )}

      {/* Formation picker — branches on axisMode.
          - geological / geotechnical axis: FormationPickerDialog (unchanged).
          - lithostratigraphic axis: LithoCompositionPickerDialog (Phase-1.5).
          Opens whenever a child fires ``onCommitDepth``. */}
      {axisMode === 'lithostratigraphic' ? (
        <LithoCompositionPickerDialog
          open={pickContext !== null}
          lithoFormations={formations}
          // referenceFormations carries the geological formations on the litho
          // axis (the geological backdrop); used for group headings in Tab 1.
          geoFormations={referenceFormations ?? []}
          anchor={
            pickContext === null
              ? null
              : {
                  kind: pickContext.kind,
                  name: pickContext.anchorName,
                  depth_m: pickContext.depth_m,
                  elevationM: pickContext.elevationM,
                }
          }
          // Server resolves parent_formation_id from the geology TIN at accept
          // time — we cannot cheaply determine it client-side without a round-trip.
          // Always pass null so the no-context warning renders; the backend still
          // assigns the correct parent (owner decision: allow with warning).
          parentFormationName={null}
          // Debt #151 dogfeed refinement 2026-05-27 — filter the
          // Existing Units roster to litho units within the geological
          // formation at the click depth.  Derive the parent formation
          // id by finding the deepest geological contact on the anchor
          // whose ``depth_top_m <= pickContext.depth_m``.
          parentFormationId={(() => {
            if (!pickContext) return null
            const anchor = pickContext.anchorId
            const onAnchor = (referenceContacts ?? [])
              .filter(c => (c.borehole_id ?? c.cpt_id) === anchor)
              .slice()
              .sort((a, b) => a.depth_top_m - b.depth_top_m)
            if (onAnchor.length === 0) return null
            let chosen: typeof onAnchor[number] | null = null
            for (const c of onAnchor) {
              if (c.depth_top_m <= pickContext.depth_m) chosen = c
              else break
            }
            return chosen?.formation_id ?? null
          })()}
          // Debt #151 dogfeed refinement 2026-05-27 — route Existing
          // Units click through ``onLithoExistingUnitPick`` (which
          // creates a ghost from the existing formation's litho code +
          // admixtures).  ``handlePickerSelect`` early-returns on the
          // litho axis because ``onCreateContact`` is intentionally
          // undefined there (left-click-on-CPT-data must NOT open the
          // picker), so the previous wiring made the Existing Units
          // tab silently no-op.
          onSelect={async (formationId) => {
            if (!pickContext || !onLithoExistingUnitPick) return
            await onLithoExistingUnitPick(
              pickContext.kind,
              pickContext.anchorId,
              pickContext.depth_m,
              formationId,
            )
            cancelPicker()
          }}
          onCreateLithoUnit={async (mainCode, admixtures) => {
            if (!pickContext || !onManualLithoUnitCreate) return null
            return onManualLithoUnitCreate(
              mainCode,
              admixtures,
              pickContext.kind,
              pickContext.anchorId,
              pickContext.depth_m,
            )
          }}
          onCancel={cancelPicker}
        />
      ) : (
        <FormationPickerDialog
          open={pickContext !== null}
          formations={formations}
          anchor={
            pickContext === null
              ? null
              : {
                  kind: pickContext.kind,
                  name: pickContext.anchorName,
                  depth_m: pickContext.depth_m,
                  elevationM: pickContext.elevationM,
                }
          }
          onSelect={handlePickerSelect}
          onCreateFormation={async payload => {
            if (!onCreateFormation) return null
            return onCreateFormation(payload)
          }}
          onCancel={cancelPicker}
        />
      )}

    </div>
  )
}

/**
 * Bottom-left gesture cheat pill for the section canvas.
 *
 * Always lists the canvas-wide pan / zoom / column gestures; on the
 * lithostratigraphic axis it adds a second line for the litho-ghost
 * layer gestures (accept / copy / context menu) — these are otherwise
 * undiscoverable, esp. the Alt+drag copy-composition gesture (debt #95).
 *
 * Parameters
 * ----------
 * axisMode
 *     Which model axis the section is editing. Drives whether the
 *     litho-specific gesture line is shown.
 */
function CanvasHints({
  axisMode,
  correlateBlocked = false,
}: {
  axisMode: 'geological' | 'lithostratigraphic'
  /** Debt #139 — user has entered correlate mode on a section with zero
   *  litho contacts.  The CorrelationEdgesOverlay paints no hit-rects in
   *  this state, leaving the user with no clickable surface.  Surface a
   *  hint line so the failure mode is discoverable instead of silent. */
  correlateBlocked?: boolean
}): JSX.Element {
  return (
    // SVG can't use Tailwind dark: variants; the hint pill's background and
    // text colour are driven by --section-hint-* CSS-var tokens (index.css
    // :root/.dark) so they match the dark plot-area chrome.
    <div
      className="absolute bottom-2 left-2 z-10 text-[10px] px-1.5 py-0.5 rounded pointer-events-none leading-snug"
      style={{
        color: 'var(--section-hint-text)',
        background: 'var(--section-hint-bg)',
      }}
    >
      <div>
        Drag to pan · scroll to zoom · right-click a column to focus · double-click a column to open
      </div>
      {axisMode === 'lithostratigraphic' && (
        <div data-testid="litho-gesture-hint">
          Litho layer: double-click to accept · Alt+drag to copy composition ·
          Shift+drag past neighbour midpoint to absorb · right-click for more
        </div>
      )}
      {correlateBlocked && (
        <div data-testid="correlate-blocked-hint" style={{ color: 'var(--section-hint-emphasis, #fbbf24)' }}>
          Accept litho suggestions to enable correlation — 0 accepted contacts on this section.
        </div>
      )}
    </div>
  )
}
