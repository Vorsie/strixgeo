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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { Layers } from "lucide-react";

import { EmptyState } from "../shell/EmptyState";
import type {
  AdmixtureItem,
  BoreholeListItem,
  BodyBoundaryNode,
  BodyBoundaryResponse,
  BodyListItem,
  BodyUnionListItem,
  BodyRenderStyle,
  CptListItem,
  BoreholeDetailResponse,
  CptPlotResponse,
  CrossSectionResponse,
  FormationContactBatchUpdateEntry,
  FormationContactResponse,
  FormationSurfaceResponse,
  GeologicalFormationCreatePayload,
  CrossingPinchOut,
  LithoContactCorrelationEdge,
  LithoBodySolidResponse,
  LithoLayerResponse,
  LithoLayerSuggestion,
  VirtueleBoringInvestigationPrediction,
} from "../api/client";
import { verticalDatumShort } from "../utils/verticalDatum";
import { log } from "../utils/log";
import { resolveLithoLayerAtClick } from "../utils/resolveLithoLayerAtClick";
import { computeScrubBounds } from "../utils/scrubBounds";
import {
  sectionLength,
  type ProjectedInvestigation,
} from "../utils/sectionProjection";
import { SoilPatterns } from "../utils/soilPatterns";
import FormationPickerDialog from "./interpretation/FormationPickerDialog";
import LithoCompositionPickerDialog from "./interpretation/LithoCompositionPickerDialog";
import BoreholeColumn from "./sections/BoreholeColumn";
import CanvasHints from "./sections/CanvasHints";
import ColumnContextMenu from "./sections/ColumnContextMenu";
import ColumnFindBar from "./sections/ColumnFindBar";
import GapRevealFlash from "./sections/GapRevealFlash";
import {
  panViewportToScreenX,
  type ColumnFindEntry,
} from "./sections/columnFind";
import type { SectionColumnRevealFn } from "./sections/sectionColumnReveal";
import { resolveColumnReveal } from "./sections/resolveColumnReveal";
import { useColumnFindHotkey } from "./sections/useColumnFindHotkey";
import { useSectionGapReveal } from "./sections/useSectionGapReveal";
import { buildRemoveFromSectionCommand } from "./sections/removeFromSectionCommand";
import ContactPickBar from "./sections/ContactPickBar";
import ContactsLayer, {
  type ContactCopyPayload,
  type MarqueeState,
  type SnapCandidate,
} from "./sections/ContactsLayer";
import { lookupCptValueAtDepth } from "./sections/cptInterpolation";
import { restatingContactIds } from "./sections/geotechBoundaryKinds";
import {
  clampContactDrag,
  packingSnapCandidates,
  type ContactDragRelease,
} from "./sections/geotechSnapTargets";
import { useColumnContextMenu } from "./sections/useColumnContextMenu";
import { buildColumnMenuVerbs } from "./sections/columnMenuVerbs";
import {
  useSectionKeyboardShortcuts,
  useSectionWheelZoom,
  type SectionWheelLayoutState,
} from "./sections/useSectionCanvasGestures";
import { useContactPicker } from "./sections/useContactPicker";
import { useFocusColumn } from "./sections/useFocusColumn";
import CptDataColumn from "./sections/CptDataColumn";
import {
  cptBandFullWidth,
  cptBandHalfWidth,
  enabledBoreholeChannelCount,
  pickQcFullScaleMpa,
  type CptChannels,
} from "./sections/cptChannels";
import DemSurfaceLine from "./sections/DemSurfaceLine";
import {
  buildBedClipPath,
  type BedClipPolygon,
} from "./sections/sectionBedClip";
import SectionGrid from "./sections/SectionGrid";
import InvestigationColumns from "./sections/InvestigationColumns";
import StaleColumnMarkers from "./sections/StaleColumnMarkers";
import CorrelationEdgesOverlay, {
  type ContactGestureState,
} from "./sections/CorrelationEdgesOverlay";
import {
  overlayEdgeSource,
  partitionColorSource,
  partitionEdgeSource,
  partitionLayerSource,
  shouldMountCorrelationOverlay,
} from "./sections/correlationOverlayAxis";
import GeotechBandEditOverlay from "./sections/GeotechBandEditOverlay";
import GeotechBoreholePreviewGhosts from "./sections/GeotechBoreholePreviewGhosts";
import PartitionFillOverlay, {
  type GeotechLithoFrame,
} from "./sections/PartitionFillOverlay";
import {
  buildPackingClassOf,
  buildSeamClassOf,
} from "../utils/geotechHierarchicalFill/packingClassOf";
import { toSeparatedPairs } from "../utils/partitionFillV2/separationConstraint";
import { useSectionScope } from "./sections/SectionScopeContext";
import { useT } from "../i18n/translate";
import ModelFillOverlay from "./sections/ModelFillOverlay";
import { buildModelFillMeshes } from "../utils/buildSectionModelFill";
import {
  sliceSolidsAtPlaneRobust,
  sliceSolidsAlongZigzag,
} from "../utils/sectionFromSolids";
import { resolveModelFillPolys } from "../utils/resolveModelFillPolys";
import { geotechBodyAutoLabel } from "../utils/geotechBodyLabel";
import type {
  SectionPlaneLine,
  SectionPoly,
  SolidMesh,
  ZigzagTest,
} from "../utils/sectionFromSolids";
import { useBandFillVisible } from "../utils/bandFillStore";
import { useCorrelationOverlayVisible } from "../utils/correlationOverlayStore";
import { useFormationFillVisible } from "../utils/formationFillStore";
import { useGeotechModelFillVisible } from "../utils/geotechModelFillStore";
import { useGeotechFillVisible } from "../utils/geotechFillStore";
import { useLithoFillOnGeotech } from "../utils/lithoFillOnGeotechStore";
import { selectSectionFill } from "../utils/sectionFillSelection";
import {
  boreholeLogFillOpacity,
  columnCardVeilOpacity,
  columnStackFillOpacity,
} from "../utils/sectionFillOpacity";
import { useSampleMarkersOn } from "../utils/sampleMarkersOnStore";
import { usePsdPreviewOn } from "../utils/psdPreviewOnStore";
import SampleGeotechOverlay from "./sections/SampleGeotechOverlay";
import type { HoveredSample } from "./sections/SampleGeotechOverlay";
import SamplePsdPopover from "./sections/SamplePsdPopover";
import {
  useSelectedGeotechBodyId,
  selectGeotechBody,
} from "../utils/geotechBodySelectionStore";
import BodyContextMenu from "./sections/BodyContextMenu";
import {
  firstLayerStampedToBody,
  type JoinPick,
  type JoinNotice,
} from "./sections/joinPick";
import { buildDisjoinOptions } from "./sections/disjoinOptions";
import ConfirmDialog from "./ui/ConfirmDialog";
import { lithologyAbbrev } from "../utils/lensLabel";
import LithoSuggestionGhostColumns from "./sections/LithoSuggestionGhostColumns";
import {
  type WarpAnchor,
  warpedAlongToScreenX,
  warpedScreenXToAlong,
} from "./sections/sectionWarp";
import {
  columnLayoutWidthPx,
  layoutColumnsHorizontally,
  zoomLayoutColumn,
  type ZoomLayoutColumn,
} from "./sections/wheelZoomAnchor";

/** Stable empty map so the PartitionFillOverlay prop identity doesn't churn. */
const EMPTY_LENS_BOUNDARIES: ReadonlyMap<string, BodyBoundaryResponse> =
  new Map();

/**
 * Thinnest layer a contact drag may leave behind, in metres.
 *
 * Serves both axes, which is why it is named rather than repeated. On the litho axis
 * it is the floor a drag keeps from its neighbouring contacts; on the geotech axis it
 * is how far short of a restated litho contact the line stops, so that reaching the
 * wall can never delete the unit between the two contacts. One value, so the two axes
 * cannot disagree about how thin a layer is allowed to become.
 */
const CONTACT_DRAG_MIN_THICKNESS_M = 0.1;

// Litho free-draw master switch — shared module so the voxel build gates on the SAME
// flag (off = off end to end, owner ruling 2026-08-07). Withholding onSaveBoundary /
// onCorrelateBoundary suppresses every grab handle, the add-strip, and the drag dispatch
// by construction (every handle memo short-circuits on ``!onSaveBoundary``); withholding
// ``boundariesByBodyId`` keeps stored nodes from shaping the fill-band geometry.
import { FREEDRAW_EDIT_ENABLED } from "../utils/freedrawEditFlag";
import VirtueleBoringGhostColumns, {
  virtueleBoringGhostRailWidth,
} from "./sections/VirtueleBoringGhostColumns";
import VirtueleBoringStrip from "./sections/VirtueleBoringStrip";
import SectionHeader from "./sections/SectionHeader";
import SectionScrubBar from "./sections/SectionScrubBar";
// MarkAsLensDialog removed in #101 R5 (Approach-C → Position 4)
import { useSectionData } from "./sections/useSectionData";
import { usePairArm } from "./sections/usePairArm";
import {
  COLUMN_EDGE_GAP_PX,
  CORRELATED_PAIR_EDGE_GAP_PX,
  DEFAULT_LEVEL_RANGE,
  FLASH_HIGHLIGHT_MS,
  MARGIN,
  VEX_DEFAULT,
  WHEEL_ZOOM_FACTOR,
  collectSnapDepths,
  ticks,
  useElementSize,
  type PlacedColumn,
  type Viewport,
} from "./sections/utils";
import {
  selectVisibleLabels,
  type ColumnLabelMode,
} from "../utils/columnLabelLod";
import { LITHO_SEGMENTER_DEFAULTS } from "../utils/lithoSegmenterPrefs";
import { geotechUnitColor, nadClassName } from "../utils/nadClasses";

interface Props {
  section: CrossSectionResponse;
  /** The project's bed-override polygons in the section's horizontal CRS (owner
   * ruling 2026-09-07 — the canal cut-out). Where the section crosses one, the
   * partition fill is clipped to the section's ground+bed line so no litho is
   * drawn above the dredged bed. Optional / defaults to none: a project without
   * a bed override renders byte-identically. */
  bedOverridePolygons?: readonly BedClipPolygon[];
  /** Patch the section row server-side. Called on slider release
   * for ``projection_buffer_m`` and ``vertical_exaggeration`` and
   * on every channel-toggle click for ``view_state.cpt_channels``,
   * so the values persist across opens and ride the .gmproj
   * bundle. The handler is optional so the test-render path can
   * mount without a network seam. */
  onPatch?: (patch: {
    projection_buffer_m?: number;
    vertical_exaggeration?: number;
    view_state?: Record<string, unknown>;
    excluded_cpt_ids?: string[];
    excluded_borehole_ids?: string[];
  }) => Promise<void>;
  /** Close the section view — typically clears the parent's
   * selectedSectionId so the App's render branch flips back to the
   * map. Optional so the test-render path can mount without a
   * navigation seam. */
  onClose?: () => void;
  /** Double-click handlers for the projected column glyphs. A
   * double-click opens the CPT/borehole detail panel (same handler
   * as the map's click-to-open flow). Single-click stays inert —
   * the anti-accidental-pan-click decision is preserved; only an
   * explicit double-click navigates away. Optional for the test-
   * render path. */
  onSelectCpt?: (id: string) => void;
  onSelectBorehole?: (id: string) => void;
  /**
   * Callback fired whenever the section's focused column changes.
   *
   * Lifted to the shell so ``SectionsToolbar`` can use the focused
   * column's kind/id for the litho-axis "Suggest litho" button
   * (which needs a section-local focus, not the global CPT/borehole
   * selection that the map/data clicks set).  Absent in the test-
   * render path.
   */
  onFocusedColumnChange?: (
    col: import("./sections/useFocusColumn").FocusTarget | null,
  ) => void;
  /**
   * Slot the panel publishes its column-reveal implementation into.
   *
   * The geotech pending-tie chip lives in the toolbar and has no way to know
   * where — or whether — a column is drawn. It names two INVESTIGATIONS and an
   * edge; this panel answers, because it owns ``visibleColumns`` and the pan.
   * A position or a column index must never cross that boundary the other way
   * (see ``components/sections/sectionColumnReveal.ts``).
   *
   * Absent in the test-render path and wherever nothing needs to reveal.
   */
  columnRevealRef?: MutableRefObject<SectionColumnRevealFn | null>;
  /** P1b (dogfeed 2026-05-30) — forwarded to ContactsLayer so the
   *  matching contact renders at the live depth during a cross-store
   *  suggestion drag. SectionsCanvas owns the state. */
  liveContactDepthOverride?: { contactId: string; depthM: number } | null;
  /** Click-to-place hook. Fires when the user picks a formation on
   * the picker modal — caller (App) POSTs the contact and updates
   * the contacts state. Omitting it leaves the section read-only.
   *
   * ``snapped`` reflects whether the depth came from a snap-to-
   * stratigraphy boundary; the caller uses it to decide the
   * contact's ``source`` + ``confidence`` fields (debt #22/#23). */
  onCreateContact?: (
    anchorKind: "cpt" | "borehole",
    anchorId: string,
    depth_m: number,
    formationId: string,
    snapped: boolean,
  ) => Promise<void>;
  /** Drag-to-re-pick hook. Fires on the drag's mouseup with the
   * contact id, its new depth_top_m, and whether the depth landed
   * on a snap candidate. Caller PATCHes and updates the local
   * contacts state. */
  onUpdateContactDepth?: (
    contactId: string,
    newDepthM: number,
    snapped: boolean,
  ) => Promise<void>;
  /** Right-click → confirm → delete a contact. Forwarded straight
   * through to ContactsLayer; the picker / drag flows don't touch
   * it. Caller deletes the row and prunes the local contacts
   * state so the overlay updates without a refetch. */
  onDeleteContact?: (contactId: string) => Promise<void>;
  /**
   * Split a packing sub-band by hand at a depth (geotech axis only).
   *
   * The bounded exception to this axis being view-only (owner spec 2026-08-01,
   * docs/debt.md #227). Unlike the contact handlers above, this does not move a contact —
   * it goes through an endpoint that re-derives the NAD class from the cone resistance over
   * each resulting interval. Absent → ``GeotechBandEditOverlay`` renders nothing and the
   * axis stays exactly as view-only as it was.
   */
  onRequestGeotechSplitBand?: (bandId: string, depthM: number) => void;
  /**
   * Set a BOREHOLE band's NAD class by hand (owner ask 2026-08-18). Borehole
   * bands only — a CPT band's class is measured from its own qc. Absent →
   * borehole bands stay view-only.
   */
  onRequestGeotechSetBandClass?: (
    bandId: string,
    nadClass: number,
    previousClass: number | null,
  ) => void;
  /**
   * Open the Parameters stage scoped to a geotech band's UNIT (owner ballot
   * 2026-08-26). Pure pass-through to ``GeotechBandEditOverlay``: the panel
   * neither navigates nor knows what a stage is — it forwards the unit id the
   * overlay names, and the shell does the rest. Absent → the menu item is not
   * offered.
   */
  onShowGeotechUnitStatistics?: (
    unitId: string,
    bodyId?: string | null,
  ) => void;
  /**
   * Open the Parameters stage scoped to a LITHO unit (owner ruling R1,
   * 2026-08-27) — the litho axis's half of the same jump. Forwarded to the
   * per-column band menu (``ContactsLayer``) and to the between-columns body
   * menu; the panel neither navigates nor knows what a stage is.
   */
  onShowLithoUnitStatistics?: (
    formationId: string,
    bodyId?: string | null,
  ) => void;
  /**
   * Clear ONE test's packing subdivision (owner ask 2026-08-18) — offered in
   * the column label's right-click menu on the geotech axis, only where the
   * column actually carries bands. The escape hatch of first-subdivision-wins.
   */
  onRequestGeotechClearColumn?: (investigationId: string, name: string) => void;
  /**
   * Merge two adjacent packing sub-bands inside one litho body (geotech axis only).
   * ``boundaryDepthM`` = their shared boundary today, the undo anchor.
   */
  onRequestGeotechMergeBands?: (
    upperBandId: string,
    lowerBandId: string,
    boundaryDepthM: number,
  ) => void;
  /**
   * Drag the shared boundary of two adjacent packing sub-bands (geotech axis only, owner
   * 2026-08-07). Absent → the boundary strips stay right-click-only and a press pans.
   */
  onRequestGeotechMoveBoundary?: (
    upperBandId: string,
    lowerBandId: string,
    newDepthM: number,
    preDragDepthM: number,
  ) => void;
  /**
   * Absorb an enclosed packing lens into its two same-class hosts — one merge over the
   * ``[upperHost, lens, lowerHost]`` run (geotech axis only). Absent → no lens suggestion.
   */
  onRequestGeotechAbsorbLens?: (
    upperHostId: string,
    lensId: string,
    lowerHostId: string,
    upperBoundaryDepthM: number,
    lowerBoundaryDepthM: number,
  ) => void;
  /** The geotech model's "thinnest packing band kept" pref — the lens badge's size gate. */
  geotechSmallLensThicknessM?: number;
  /** Break the litho↔geo coupling on a lithostratigraphic contact.
   * Forwarded straight to ContactsLayer; absent on the geological axis. */
  onUnlinkLithoFromGeo?: (contactId: string) => Promise<void>;
  /** Establish the litho↔geo coupling on an uncoupled lithostratigraphic contact.
   * Forwarded straight to ContactsLayer; absent on the geological axis. */
  onLinkLithoToGeo?: (contactId: string) => Promise<void>;
  /** All-or-nothing batch update — fired by the section editor's
   * multi-drag (same-column depth shift) and cross-column re-anchor
   * (Alt+drag MOVE) flows. Forwarded straight to ContactsLayer;
   * the caller posts the batch and refreshes the local contacts
   * state in one pass. */
  onBatchUpdateContacts?: (
    updates: readonly FormationContactBatchUpdateEntry[],
  ) => Promise<void>;
  /** Batch CREATE — fired by cross-column drag WITHOUT Alt (the
   * COPY default). Each entry becomes a new contact at the target
   * anchor with the dragged depth; originals stay where they were.
   * Forwarded to ContactsLayer. */
  onBatchCreateContacts?: (
    creates: readonly ContactCopyPayload[],
  ) => Promise<void>;
  /** Whether Shift+drag opens the contact multi-select MARQUEE.
   *
   * The marquee is a READ affordance — it highlights contacts; committing an
   * edit is a separate gesture. It used to be gated on ``onBatchUpdateContacts``
   * simply because that was the verb it was built to feed, which silently tied
   * a selection gesture to a mutation handler: gating the mutation off (the
   * geotech axis, 2026-08-04) also removed shift+drag select and turned the
   * gesture into a pan. Defaults to the old coupling so every existing caller
   * behaves exactly as before; pass it explicitly to decouple the two. */
  contactMarqueeEnabled?: boolean;
  /** Inline-create a formation from the picker modal's "New
   * formation here" affordance. Returns the new row's id so the
   * picker can chain to a contact commit. */
  onCreateFormation?: (
    payload: GeologicalFormationCreatePayload,
  ) => Promise<{ id: string } | null>;
  /** Fire the "Export DXF" header action. The handler owns the
   * fetch + Electron save-dialog + file-write flow so the panel
   * stays storage-agnostic. Omitting it (or there being no active
   * geological model) hides the button. */
  onExportDxf?: () => Promise<void>;
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
    anchorKind: "cpt" | "borehole",
    anchorId: string,
    depthM: number,
  ) => Promise<{ formationId: string } | null>;
  /** Debt #151 dogfeed refinement 2026-05-27 — wire the picker's
   *  "Existing units" tab on the litho axis.  The default
   *  ``onSelect`` flow goes through ``useContactPicker``'s
   *  ``onCreateContact``, which is undefined on litho axis (left-click
   *  doesn't open the picker — by design), so the existing-units
   *  click silently does nothing.  This callback runs instead on the
   *  litho axis: looks up the chosen formation by id and creates a
   *  manual ghost using its ``litho_main_soil_code`` + admixtures. */
  onLithoExistingUnitPick?: (
    anchorKind: "cpt" | "borehole",
    anchorId: string,
    depthM: number,
    formationId: string,
  ) => Promise<void>;
  /** Fire the "Seed from stratigraphy" header action. Receives the
   * borehole IDs projected onto the active section (computed here
   * from placedColumns); the handler scopes the auto-populate call
   * to that list. Omitting it (or no active model) hides the button. */
  onAutoPopulateFromStratigraphy?: (
    boreholeIds: readonly string[],
  ) => Promise<void>;
  onChangeVirtueleBoringPicker?: (next: {
    modelA: string | null;
    modelB: string | null;
    maxDepthM: number | null;
  }) => void;
  onChangeVirtueleBoringShowOnSection?: (next: boolean) => void;
  /**
   * Litho-suggestion ghost state (slice 3, #55).  When present, a ghost
   * column overlay renders to the LEFT of the targeted investigation's band
   * showing the segmenter's layer boundaries — click to accept, right-click
   * to reject.  Absent / undefined = no overlay (zero regression for callers
   * that don't use the litho axis).
   */
  lithoGhostState?: {
    /** Suggestion layers ordered top→bottom from the segmenter. */
    suggestions: readonly LithoLayerSuggestion[];
    /** Id of the CPT or borehole whose suggestions are shown. */
    investigationId: string;
    /** mTAW surface elevation used to convert depth→absolute level. */
    surfaceElevationM: number | null;
    /** Indices already accepted (contact created). */
    acceptedIndices: ReadonlySet<number>;
    /** Indices explicitly rejected. */
    rejectedIndices: ReadonlySet<number>;
    /** Fire when the user left-clicks a pending layer to accept it. */
    onAccept: (idx: number) => void;
    /** Fire when the user right-clicks / Shift-clicks to reject. */
    onReject: (idx: number) => void;
    /**
     * Drag-resize state (Phase 2). Map from suggestion index to user
     * edits on its top / base depth. The ghost renderer applies these
     * at render time so the layer rect tracks the user's drag commit.
     * Empty Map / undefined = no edits.
     */
    edits?: ReadonlyMap<
      number,
      { depth_top_m?: number; depth_base_m?: number }
    >;
    /**
     * Commit a drag edit to one suggestion. Partial: set just the
     * touched edge. The state owner merges into existing edits so
     * dragging the same edge twice composes.
     */
    onEdit?: (
      idx: number,
      edit: { depth_top_m?: number; depth_base_m?: number },
    ) => void;
    /**
     * Debt #86: cross-investigation paste of an Alt-drag-copied
     * composition.  Routes to ``handleEditBulkLitho`` with the target
     * anchor id resolved from the document-level hit-test.
     */
    onCrossColumnPaste?: (
      targetAnchorId: string,
      idx: number,
      edit: {
        suggested_lithology: string;
        suggested_admixtures: readonly {
          soil_code: string;
          amount: string;
          locally: boolean;
        }[];
      },
    ) => void;
    /** Debt #85: insert a new pending litho layer at the shared
     *  boundary between ``afterIdx`` and ``afterIdx+1`` for this
     *  bundle's focused anchor. */
    onInsertLayer?: (
      afterIdx: number,
      composition: {
        suggested_lithology: string;
        suggested_admixtures: readonly {
          soil_code: string;
          amount: string;
          locally: boolean;
        }[];
      },
    ) => void;
    /** Debt #98: split a pending litho layer in two at its midpoint. */
    onSplitLayer?: (idx: number) => void;
    /** Debt #102: merge two adjacent same-lithology pending layers. */
    onMergeLayers?: (upperIdx: number) => void;
    /** Extend a ghost sentinel to the nearest committed contacts.
     *  Returns ``{ ok: true }`` on success or ``{ ok: false, reason }``
     *  on overlap — caller is expected to surface the reason to the user. */
    onExtendToNearest?: (idx: number) => { ok: boolean; reason?: string };
    /** Slice 3 of unified-boundary-drag: committed litho contacts for
     *  the focused anchor, used by the cross-store dispatch in
     *  useBoundaryDrag to find the contact whose depth matches the
     *  dragged boundary. Filtered at SectionsCanvas level. */
    committedContactsForAnchor?: readonly FormationContactResponse[];
    /** Robust-fix follow-up (dogfeed 2026-05-30): contact ids per
     *  accepted suggestion idx, populated by the accept handlers. */
    contactIdsByAcceptedIdx?: ReadonlyMap<number, readonly string[]>;
    /** Slice 3 of unified-boundary-drag: PATCH callback fired when a
     *  pending drag moves a shared boundary with an accepted neighbour.
     *  Same signature as ContactsLayer's drag commit; the suggestion-
     *  drag surface is just another entry point to the audit-point
     *  ``UpdateFormationContact`` PATCH.
     *  The ``field`` discriminator selects which depth dimension is written:
     *  ``'top'`` for a below-neighbour whose TOP moves; ``'base'`` for an
     *  above-neighbour whose BASE is extended. */
    onUpdateContactDepth?: (
      contactId: string,
      newDepthM: number,
      snapped: boolean,
      field: "top" | "base",
    ) => Promise<void>;
    /** P1b (dogfeed 2026-05-30) — live preview during a cross-store
     *  drag. Forwarded to ``useBoundaryDrag`` so it fires on every
     *  mousemove. SectionsCanvas holds the override Map and passes
     *  it to ContactsLayer as ``liveContactDepthOverrides``. */
    onContactLivePreview?: (
      contactId: string | null,
      liveDepthM: number,
    ) => void;
  };
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
        kind: "cpt" | "borehole";
        suggestions: readonly LithoLayerSuggestion[];
        surfaceElevationM: number | null;
        accepted: ReadonlySet<number>;
        rejected: ReadonlySet<number>;
        edits: ReadonlyMap<
          number,
          { depth_top_m?: number; depth_base_m?: number }
        >;
      }
    >;
    onAccept: (anchorId: string, idx: number) => void | Promise<void>;
    onReject: (anchorId: string, idx: number) => void;
    onEdit: (
      anchorId: string,
      idx: number,
      edit: { depth_top_m?: number; depth_base_m?: number },
    ) => void;
    /** Debt #86: cross-investigation paste, same shape as the
     *  single-anchor variant above. */
    onCrossColumnPaste?: (
      targetAnchorId: string,
      idx: number,
      edit: {
        suggested_lithology: string;
        suggested_admixtures: readonly {
          soil_code: string;
          amount: string;
          locally: boolean;
        }[];
      },
    ) => void;
    /** Debt #85: bulk variant of the insert-layer handler — takes
     *  the anchorId of the bulk ghost being targeted. */
    onInsertLayer?: (
      anchorId: string,
      afterIdx: number,
      composition: {
        suggested_lithology: string;
        suggested_admixtures: readonly {
          soil_code: string;
          amount: string;
          locally: boolean;
        }[];
      },
    ) => void;
    /** Debt #98: bulk variant of split — takes the anchorId. */
    onSplitLayer?: (anchorId: string, idx: number) => void;
    /** Debt #102: bulk variant of merge — takes the anchorId. */
    onMergeLayers?: (anchorId: string, upperIdx: number) => void;
    /** Extend a bulk ghost sentinel to the nearest committed contacts.
     *  Takes the anchorId; returns ok/reason. */
    onExtendToNearest?: (
      anchorId: string,
      idx: number,
    ) => { ok: boolean; reason?: string };
  };
  /**
   * Callback from SectionsCanvas — fired when the user picks
   * "Inspect lens body…" from a body chip's context menu (#101 Blocker 1).
   * Opens ``InspectLensBodyPanel`` at the SectionsCanvas level.
   * Optional so the test-render path can mount without a seam.
   */
  onInspectLensBody?: (formationId: string, bodyOrdinal: number) => void;
  /**
   * Fired when the user saves from "Edit admixtures for this body" in the
   * body chip context menu.  Propagated to CorrelationEdgesOverlay.
   * Optional so callers that don't need the admixture path skip it.
   */
  onPropagateAdmixtures?: (
    seedFormationId: string,
    admixtures: import("./interpretation/LithoGhostCompositionEditor").GhostAdmixtureItem[],
  ) => Promise<void>;
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
  onEditInGeologyStage?: (contactId: string, formationId: string) => void;
  /**
   * Gesture state for the boundary-click correlate gesture (#133 Phase 1).
   *
   * When present and ``contactCorrelateMode`` is true, hit-target rects
   * render at the top boundary of each band so the user can click a
   * contact line to arm it, then click another to create a contact edge.
   * Absent / undefined = read-only (contact edges visible, no gesture UI).
   */
  contactGestureState?: ContactGestureState;
  /**
   * Fired when the user mousedowns on an unapproved edge's grab handle to
   * start a drag-to-retarget gesture (#133 Phase 2+3 Task 26).
   * Forwarded verbatim to ``CorrelationEdgesOverlay``.
   * Absent = no grab handles rendered.
   */
  onUnapprovedDragStart?: (
    e: React.MouseEvent,
    edge: LithoContactCorrelationEdge,
    handle: "a" | "b",
  ) => void;
  /**
   * Live drag state while the user is mid drag-to-retarget (#133 Task 26).
   * Forwarded verbatim to ``CorrelationEdgesOverlay`` for ghost-line rendering.
   */
  unapprovedEdgeDrag?: {
    anchorContactId: string;
    cursorViewportX: number;
    cursorViewportY: number;
  };
  /**
   * Fired when the user picks "Delete correlation" from a correlation
   * edge's right-click menu (#163e). Forwarded verbatim to
   * ``CorrelationEdgesOverlay``. Absent = no right-click-delete affordance.
   */
  onRequestDeleteEdge?: (edge: LithoContactCorrelationEdge) => void;
  /**
   * Fired when the user picks "Accept correlation" from a pending edge's
   * right-click menu (dogfeed 2026-05-31). Forwarded verbatim to
   * ``CorrelationEdgesOverlay``. Absent = the Accept item is suppressed.
   */
  onRequestAcceptEdge?: (edge: LithoContactCorrelationEdge) => void;
  /** Wording of the edge menu's accept row — the geotech axis says "Accept tie". */
  acceptEdgeLabel?: string;
  /** Confirms a tie the geotech rebuild flagged (clears `review_reason`). */
  onRequestConfirmEdgeReview?: (edge: LithoContactCorrelationEdge) => void;
  /**
   * Commit ONE borehole's preview ghosts — the geotech axis's right-click
   * "Accept these bands (divide this borehole)".
   *
   * Forwarded verbatim to ``GeotechBoreholePreviewGhosts``; absent means the
   * ghosts stay the read-only overlay they shipped as.
   */
  onDivideBoreholeFromPreview?: (boreholeId: string) => void;
  /** Full-replace a body's boundary shape after a ghost-node drag/add. */
  onSaveLensShape?: (
    bodyId: string,
    upperNodes: BodyBoundaryNode[],
    lowerNodes: BodyBoundaryNode[],
    style: BodyRenderStyle,
  ) => void;
  /**
   * S103 correlate-on-drag: create the section-scoped correlation an un-correlated two-band
   * boundary drag synthesized (ties the two upper-band litho layers, base-base). Reuses the
   * accepted-auto-correlation path in ``SectionsCanvas``. Absent = the tie does not persist.
   */
  onCorrelateBoundary?: (leftLayerId: string, rightLayerId: string) => void;
  /** Right-click a wedge → dissolve the lens by deleting its defining edges. */
  onDeleteLens?: (
    aboveContactId: string,
    belowContactId: string,
    targetContactId: string,
  ) => void;
  /**
   * Open the name-body dialog / flow. Fired from the ``BodyContextMenu`` when
   * the user picks "Name body".
   */
  onNameBody?: (bodyId: string) => void;
  /**
   * Edit an ACCEPTED litho layer's composition (installer #21). Fired from the
   * body context menu's "Edit composition…" with the clicked layer id. Litho
   * axis only — the caller opens the composition editor and PATCHes the layer.
   */
  onEditLithoComposition?: (layerId: string) => void;
  /**
   * Split an ACCEPTED litho layer at the clicked depth (installer #21). Fired
   * from the body context menu's "Split here" with the clicked layer id + the
   * clicked depth (m). Litho axis only.
   */
  onSplitLithoLayer?: (layerId: string, depthM: number) => void;
  /**
   * Dissolve a body (delete both its defining correlation edges so the
   * detector no longer reconstructs it). Fired from the ``BodyContextMenu``
   * when the user picks "Dissolve body".
   */
  onDissolveBody?: (bodyId: string) => void;
  /**
   * Commit a "Join" (owner ruling 2026-09-01): the two anchors' bodies are stated
   * to BE the same body — one group. Fired after the armed pick resolves a distinct
   * SAME-class target body. Present ⇒ the "Voeg samen met…" item is offered and the
   * arm is live. Wired on the GEOTECH axis only (the owner would not use it on
   * litho). (The Separate / Rejoin verbs were removed in the same simplification.)
   */
  onJoinBodies?: (anchorLayerId: string, targetAnchorLayerId: string) => void;
  /**
   * Lift a standing group (the un-join / Ontkoppelen). Fired from an "Ontkoppelen"
   * item. Present ⇒ the Ontkoppelen items are offered.
   */
  onDisjoinBody?: (unionId: string) => void;
  /**
   * The model's standing unions, each carrying both anchors' current-body display
   * info (server-resolved). SectionPanel filters these to the clicked body to
   * build its "Disjoin <label>" items — it owns no resolution map.
   */
  unions?: readonly BodyUnionListItem[];
  /**
   * Advisory feedback while a Join is armed: ``same`` (armed body re-clicked),
   * ``unresolvable`` (no single body), or ``cross-class`` (a class mismatch — the
   * join refused, carrying both class labels). The arm stays live; the parent
   * toasts. Absent ⇒ no advisory (the arm still works).
   */
  onJoinNotice?: (notice: JoinNotice) => void;
  /**
   * Whether the body list has landed (#279 item-1). Threaded to the partition
   * fill so the body-menu right-click (which arms Separate) waits for it.
   * Defaults to ``true`` where unwired.
   */
  bodiesLoaded?: boolean;
}

export default function SectionPanel({
  section,
  bedOverridePolygons,
  onPatch,
  onClose,
  liveContactDepthOverride,
  onCreateContact,
  onUpdateContactDepth,
  onDeleteContact,
  onRequestGeotechSplitBand,
  onRequestGeotechSetBandClass,
  onShowGeotechUnitStatistics,
  onShowLithoUnitStatistics,
  onRequestGeotechClearColumn,
  onRequestGeotechMergeBands,
  onRequestGeotechMoveBoundary,
  onRequestGeotechAbsorbLens,
  geotechSmallLensThicknessM,
  onUnlinkLithoFromGeo,
  onLinkLithoToGeo,
  onBatchUpdateContacts,
  onBatchCreateContacts,
  contactMarqueeEnabled,
  onAutoPopulateFromStratigraphy,
  onCreateFormation,
  onExportDxf,
  onSelectCpt,
  onSelectBorehole,
  onFocusedColumnChange,
  columnRevealRef,
  onChangeVirtueleBoringPicker,
  onChangeVirtueleBoringShowOnSection,
  lithoGhostState,
  bulkLithoGhostState,
  onInspectLensBody,
  onPropagateAdmixtures,
  onManualLithoUnitCreate,
  onLithoExistingUnitPick,
  onEditInGeologyStage,
  contactGestureState,
  onUnapprovedDragStart,
  unapprovedEdgeDrag,
  onRequestDeleteEdge,
  onRequestAcceptEdge,
  acceptEdgeLabel,
  onDivideBoreholeFromPreview,
  onRequestConfirmEdgeReview,
  onSaveLensShape,
  onCorrelateBoundary,
  onDeleteLens,
  onNameBody,
  onEditLithoComposition,
  onSplitLithoLayer,
  onDissolveBody,
  onJoinBodies,
  onDisjoinBody,
  unions,
  onJoinNotice,
  bodiesLoaded = true,
}: Props): JSX.Element {
  // i18n — the canvas hint pill, the along-axis label and the Join-arm readout
  // read the catalogue. Placed first so it sits above every early return / hook.
  const t = useT();
  // Section-scoped data slices (debt #201 round 2 / #178): provided by
  // SectionsCanvas via SectionScopeContext instead of prop-threading. The
  // first eight moved off Props in Phase B; their defaults mirror the old
  // destructure defaults so provider-less test mounts keep prop-omitted
  // behaviour.
  const {
    zEpsg = null,
    cpts = [],
    boreholes = [],
    contacts = [],
    formations = [],
    axisMode = "geological",
    geotechNotReconciled = false,
    activeLithoModelId,
    focusableContacts,
    excludedBoreholeIds,
    surfacesByFormationId,
    referenceFormations,
    referenceSurfacesByFormationId,
    referenceContacts,
    focusedContactIds,
    undoStack,
    geoSnapToleranceM,
    openExtentLengthM,
    modelSolids,
    contactEdges,
    geotechCorrelationEdges,
    crossingPinchOuts,
    lenses,
    lithoLayers,
    geotechModel,
    geotechBoreholePreview,
    geotechLayersLoaded = true,
    lensBoundaries,
    pulsingFormationIds,
    virtueleBoringActiveModels,
    virtueleBoringPredictions,
    sectionFillAtSectionLine = true,
    virtueleBoringModelA = null,
    virtueleBoringModelB = null,
    virtueleBoringMaxDepthM = null,
    virtueleBoringShowOnSection = true,
  } = useSectionScope();
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  // Latest warp anchors, read by the wheel-zoom handler (defined above the
  // warp memo, so it reaches them through this ref rather than a closure dep).
  const warpAnchorsRef = useRef<WarpAnchor[]>([]);
  // Latest column-spacing slider value (0..1). Mirrored from the
  // ``useSectionData`` destructure further down via a useEffect so
  // ``handleWheel`` (declared above that destructure) can blend the
  // cursor anchor by spacing without TDZ.
  const columnSpacingRef = useRef<number>(1);
  // Layout state needed for the wheel-zoom exact simulation
  // (cumulative-width offset at the post-zoom bandHalfWidth). Mirrored
  // from the SectionPanel's useMemos below via a useEffect — handleWheel
  // is declared above them so it consumes them via the ref. Initialised
  // empty; the wheel handler falls back to the per-column-ratio
  // approximation when the ref is empty (mount race).
  const layoutStateRef = useRef<SectionWheelLayoutState | null>(null);
  const lengthM = useMemo(() => sectionLength(section), [section]);

  // formation_id → body auto-name BASE. A2 (owner directive 2026-06-04): litho
  // units are geologically agnostic, so the base is just the lithology
  // abbreviation (e.g. ZAND → "Sa"); BodyExtentOverlay appends the depth rank →
  // "Sa1", "Sa2". The geological formation a body falls in is a SEPARATE derived
  // label (``body.geo_formation_name``), shown as context, not baked into the
  // name — so the old "QP"/"QH" geo-parent prefix is gone.
  // On the geotechnical axis, bands are coloured by NAD class and labelled
  // by NAD class name (e.g. "ZAND, dicht gp"). A null nad_class yields ""
  // so the band renders with no label (degenerate — zero CPTs for the lithology).
  // On litho / geological axes, label derives from soil code + colour from
  // the stored lithology colour.
  const formationLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of formations) {
      if (axisMode === "geotechnical") {
        // Geotech axis: label is the NAD class name. ``formations`` here is the
        // geotech (NAD-stamped) formation set, so every partition region's
        // formationId resolves to its NAD label.
        m.set(f.id, nadClassName(f.nad_class ?? null));
      } else {
        // Litho units carry the soil in ``litho_main_soil_code`` (e.g. ZAND);
        // ``lithology`` is a separate, usually-null field. Use the main soil.
        const base = lithologyAbbrev(f.litho_main_soil_code ?? f.lithology);
        m.set(f.id, base || f.name);
      }
    }
    return m;
  }, [formations, axisMode]);

  // formation_id → band fill colour.
  // Litho units: stored lithology colour (stamped at create + backfilled, #145).
  // Geological formations: user-chosen colour.
  // Geotech formations: geotechUnitColor — the colour the engineer picked on the
  // units pane where he picked one, else the NAD class colour (null → neutral
  // grey). Owner ruling 2026-08-26: a pick wins on every surface, and the fill
  // is the surface he is looking at while he picks.
  const formationColorById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of formations) {
      m.set(f.id, axisMode === "geotechnical" ? geotechUnitColor(f) : f.color);
    }
    return m;
  }, [formations, axisMode]);

  // litho_layer id → body_id, for the litho band menu's statistics jump
  // (owner body-scope ruling 2026-08-27). ContactsLayer's bands are built
  // from the CONTACT projection, which drops ``body_id`` — but a contact's id
  // IS its layer id (the UUID-preserving A2.5 backfill), so this map is how
  // the menu names the clicked band's body without widening the contact shape.
  const lithoBodyIdByLayerId = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const l of lithoLayers ?? []) m.set(l.id, l.body_id ?? null);
    return m;
  }, [lithoLayers]);

  // ``litho_layer id → body_id`` over BOTH the litho and geotech rows, for the
  // Separate arm's anchor lookup (debt #278 R5). The clicked region's layers
  // are litho ids on the litho axis and geotech ids on the geotech axis; the ids
  // are distinct UUIDs, so one merged map is anchor-correct on either axis and
  // matches the map ``PartitionFillOverlay`` resolves the target against.
  const armBodyIdByLayerId = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const l of lithoLayers ?? []) m.set(l.id, l.body_id ?? null);
    for (const l of geotechModel?.geotechLayers ?? [])
      m.set(l.id, l.body_id ?? null);
    return m;
  }, [lithoLayers, geotechModel]);

  // ``litho_layer id → packing-class label``, for the Join arm's cross-class
  // guard (debt #278). A body can only be one mass, so a Join across two classes
  // is refused with an advisory rather than committed. The class label is the
  // per-formation NAD label ``formationLabelById`` already derives on the geotech
  // axis (nadClassName) — reused, not re-derived — resolved per layer through the
  // layer's formation. Only consulted on the geotech axis (where Join is wired),
  // but built over both layer sets so the lookup is anchor-correct regardless.
  // A missing entry is silence to ``resolveJoinPick`` (it commits and lets the
  // write guard decide): label-difference implies class-difference, so this never
  // BLOCKS a legal join, it only pre-empts the obvious cross-class round-trip.
  const classByLayerId = useMemo(() => {
    const m = new Map<string, string>();
    const add = (
      layers: readonly { id: string; formation_id: string }[] | undefined,
    ): void => {
      for (const l of layers ?? []) {
        const label = formationLabelById.get(l.formation_id);
        if (label !== undefined && label.length > 0) m.set(l.id, label);
      }
    };
    add(lithoLayers);
    add(geotechModel?.geotechLayers);
    return m;
  }, [lithoLayers, geotechModel, formationLabelById]);

  // ``litho_layer id → soil code``, the sibling of ``classByLayerId`` for the Join
  // cross-class ADVISORY (owner ruling 2026-09-01): a refusal where the two soils
  // MATCH is a packing-class difference ("different packing classes"); where they
  // differ it is a lithology difference ("different lithologies"). Resolved per
  // layer through the layer's formation soil — geotech via ``nadMeta.soilCode``,
  // litho via ``lithoSoilByFormationId``. Join is geotech-only, so the geotech
  // anchors are what matter; a missing soil is silence to ``resolveJoinPick``,
  // which then falls to the broader lithology copy.
  const soilByLayerId = useMemo(() => {
    const m = new Map<string, string>();
    const soilByFormation = new Map<string, string | null>();
    for (const [fid, meta] of geotechModel?.nadMeta ?? [])
      soilByFormation.set(fid, meta.soilCode);
    for (const [fid, soil] of geotechModel?.lithoSoilByFormationId ?? []) {
      if (!soilByFormation.has(fid)) soilByFormation.set(fid, soil);
    }
    const add = (
      layers: readonly { id: string; formation_id: string }[] | undefined,
    ): void => {
      for (const l of layers ?? []) {
        const soil = soilByFormation.get(l.formation_id);
        if (soil != null && soil.length > 0) m.set(l.id, soil);
      }
    };
    add(lithoLayers);
    add(geotechModel?.geotechLayers);
    return m;
  }, [lithoLayers, geotechModel]);

  // Body band fill is an explicit, on-demand verb (owner directive 2026-06-03):
  // the user finishes correlating + pinch-outs, THEN clicks "Fill bands" in the
  // Bodies dropdown. It never auto-draws — default off — so a half-finished
  // interpretation isn't shown as a misleading fill. Driven from the toolbar
  // via the shared bandFill store (sibling components, single view toggle).
  // Geotech axis: the NAD-coloured bands ARE the geotechnical view's deliverable,
  // so the view loads filled (default ON) — but a densely-correlated model can be
  // busy, so the engineer can strip the fill to inspect the correlation ribbons
  // via the geotech "Show / hide fill" toolbar toggle (its own store, separate
  // from the litho bandFill toggle which defaults OFF). Other axes keep bandFill.
  const bandFillToggle = useBandFillVisible();
  const geotechFillVisible = useGeotechFillVisible();
  // "Show litho fill" on the geotech axis (owner 2026-08-06): ONE fill at a
  // time. The selection rule (sectionFillSelection.ts) decides which fill
  // paints: litho-by-request (the partition's source model swaps back), the
  // packing fill via its own toggle, or NOTHING on a clean slate — the litho
  // fill no longer leaks through when no packing model exists.
  const lithoFillOnGeotech = useLithoFillOnGeotech();
  const fillSelection = selectSectionFill({
    axisMode,
    bandFillVisible: bandFillToggle,
    geotechFillVisible,
    lithoFillOnGeotech,
    geotechUnitCount: geotechModel?.geotechLayers.length ?? 0,
    geotechAcceptedTieCount: (geotechCorrelationEdges ?? []).filter(
      (e) => e.user_approved,
    ).length,
  });
  const showBands = fillSelection.showBands;
  // The LITHO frame the geotech axis draws OVER its own partition (owner ruling
  // 2026-08-13): dark envelope outlines, plus lithology-coloured fills wherever
  // the packing model has no bands. Undefined off the geotech axis, and while
  // "Show litho fill" is on — then the litho partition IS the fill, so framing
  // it with a second copy of itself would only double the outlines.
  const geotechLithoFrame = useMemo((): GeotechLithoFrame | undefined => {
    if (axisMode !== "geotechnical" || geotechModel === undefined)
      return undefined;
    if (fillSelection.showLithoFillInstead) return undefined;
    const geotechSoilByFormationId = new Map<string, string | null>();
    for (const [formationId, meta] of geotechModel.nadMeta) {
      geotechSoilByFormationId.set(formationId, meta.soilCode);
    }
    return {
      lithoLayers: lithoLayers ?? [],
      lithoEdges: contactEdges,
      lithoFormationColorById: geotechModel.lithoFormationColorById,
      lithoSoilByFormationId: geotechModel.lithoSoilByFormationId,
      geotechSoilByFormationId,
      packingClassByFormationId: buildPackingClassOf(geotechModel.nadMeta),
      // Admixture-aware SEAM identity (walk22b): draws the contact between two
      // same-class bands of different composition while the fill stays one mass.
      seamClassByFormationId: buildSeamClassOf(geotechModel.nadMeta),
    };
  }, [
    axisMode,
    geotechModel,
    fillSelection.showLithoFillInstead,
    lithoLayers,
    contactEdges,
  ]);
  // Cannot-link pairs threaded into the fill (the paint-seam guard). DORMANT
  // since the Separate verb was removed (owner ruling 2026-09-01 "way too
  // complicated"): no UI creates a separation any more, so this is always empty
  // — byte-identical to a model with no separations. The ``separationConstraint``
  // threading stays inert (empty set) rather than being ripped out; the backend
  // ``body_separation`` table is now dormant, a candidate for later removal.
  const separatedPairs = useMemo(() => toSeparatedPairs([]), []);
  // The lens suggestion compares NAD classes only; flattened here so the overlay's
  // column memo sees a stable map identity instead of rebuilding per render.
  const geotechNadClassByFormationId = useMemo(() => {
    if (geotechModel === undefined) return undefined;
    const out = new Map<string, number | null>();
    for (const [formationId, meta] of geotechModel.nadMeta)
      out.set(formationId, meta.nadClass);
    return out;
  }, [geotechModel]);
  // The band-edit class menu is built from the band's SOIL, never from the
  // class it carries (owner ruling 2026-08-26: "the nad coupling is absolute").
  // Flattened on its own so the overlay's column memo sees a stable identity,
  // exactly as the class map above is.
  const geotechSoilCodeByFormationId = useMemo(() => {
    if (geotechModel === undefined) return undefined;
    const out = new Map<string, string | null>();
    for (const [formationId, meta] of geotechModel.nadMeta)
      out.set(formationId, meta.soilCode);
    return out;
  }, [geotechModel]);
  // Correlation-overlay visibility — gates CorrelationEdgesOverlay so the user
  // can hide the 2-D correlation ribbons/lines (no link to the 3-D model).
  const showCorrelations = useCorrelationOverlayVisible();
  // Model-fill visibility — gates the solids-derived ModelFillOverlay (the
  // cross-section fill cut out of the built 3-D solids). One switch per model
  // axis, because each axis shows its OWN build: hiding the geotech model must
  // not blank the litho one. The litho axis no longer paints ContactsLayer's
  // formationFillBands; the geological axis keeps its own formationFillBands
  // fill independently and has no body build to show.
  const showLithoModelFill = useFormationFillVisible();
  const showGeotechModelFill = useGeotechModelFillVisible();
  const showModelFill =
    axisMode === "lithostratigraphic"
      ? showLithoModelFill
      : axisMode === "geotechnical"
        ? showGeotechModelFill
        : false;
  // Lab-sample extent markers + their grain-size hover card. Both draw on the
  // litho AND geotech axes, so both toggles live in whichever Display menu the
  // active axis shows. ``hoveredSample`` is renderer-only chrome — the card is
  // a read-out, it never writes.
  const showSampleMarkers = useSampleMarkersOn();
  const psdPreviewOn = usePsdPreviewOn();
  const [hoveredSample, setHoveredSample] = useState<HoveredSample | null>(
    null,
  );

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
  );

  const [viewport, setViewport] = useState<Viewport>(defaultViewport);

  // Ctrl+F column find (owner, 2026-08-17: "go easily to a column header
  // like s8"). The bar owns the query; this owns open/flash and the jump.
  const [findOpen, setFindOpen] = useState(false);
  // Which column to flash after a jump — looked up by id at render time so
  // the highlight lands on the column's POST-pan position, not where it was.
  const [findFlashId, setFindFlashId] = useState<string | null>(null);
  const findFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { gapFlashInvestigationIds, flashGap } = useSectionGapReveal();
  // Which correlation edge to flash after the pending-tie chip centred it
  // (owner ask 2026-08-25). Same shape and same lifetime as the Ctrl+F column
  // flash above — a brief pulse so the eye lands with the camera — and declared
  // beside it so no hook is added below an early return (the #201 trap).
  const [flashEdgeId, setFlashEdgeId] = useState<string | null>(null);
  // Which ties are in a crossing conflict, reported by the fill overlay because the fill
  // engine is what detects the crossing (owner ruling 2026-08-26). Held here only so it
  // can reach the tie overlay, which is this component's sibling child rather than the
  // fill overlay's — the panel is the nearest place the two meet. Declared beside the
  // flash state above so no hook is added below an early return (the #201 trap).
  const [conflictEdgeKeys, setConflictEdgeKeys] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const flashEdgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useColumnFindHotkey(() => setFindOpen(true));
  useEffect(
    () => () => {
      if (findFlashTimer.current !== null) clearTimeout(findFlashTimer.current);
      if (flashEdgeTimer.current !== null) clearTimeout(flashEdgeTimer.current);
    },
    [],
  );
  // Reset to default framing when the section identity changes
  // (the user picked a different section in the sidebar).
  useEffect(() => {
    setViewport(defaultViewport);
  }, [defaultViewport]);

  // Marquee (box-select) state lives here so the SVG root's
  // mousedown handler can decide between marquee (Shift held) and
  // pan (plain). ContactsLayer handles the mousemove/mouseup, hit-
  // test against its layer index, and the selection update;
  // SectionPanel just owns "is there an active marquee, and what
  // are its start coords."
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  // Selection reset counter — bumped on a plain (no-Shift) bg
  // click that didn't move the mouse. ContactsLayer watches the
  // counter and clears its selection on each tick. Click-to-clear.
  const [selectionResetCounter, setSelectionResetCounter] = useState(0);

  // Hovered column id — tracked so the LOD pass can force the hovered
  // column's label to 'full' regardless of spacing. Transient UI state;
  // not persisted (it resets naturally when the user moves the mouse).
  const [hoveredColumnId, setHoveredColumnId] = useState<string | null>(null);

  const [vex, setVex] = useState<number>(
    section.vertical_exaggeration ?? VEX_DEFAULT,
  );
  useEffect(() => {
    setVex(section.vertical_exaggeration ?? VEX_DEFAULT);
  }, [section.id, section.vertical_exaggeration]);

  // Drawing-area pixel size. The SVG's ``viewBox`` always spans
  // the full container; coordinate transforms convert world →
  // viewBox.
  const plotWidth = Math.max(
    1,
    (size?.width ?? 800) - MARGIN.left - MARGIN.right,
  );
  const plotHeight = Math.max(
    1,
    (size?.height ?? 400) - MARGIN.top - MARGIN.bottom,
  );

  // World-to-screen scaling. scaleH and scaleV are derived from the
  // viewport; VEX is the ratio between them.
  const scaleH = plotWidth / Math.max(1e-6, viewport.xMax - viewport.xMin);
  // Apply VEX by amplifying scaleV relative to scaleH. The vertical
  // viewport extent is then derived from plotHeight and the
  // resulting scaleV — keeps the centre fixed when the user drags
  // the slider.
  const scaleV = scaleH * vex;
  const visibleLevelExtent = plotHeight / scaleV;
  const levelCentre = (viewport.levelMin + viewport.levelMax) / 2;
  // Effective vertical viewport — what's actually visible given the
  // current VEX. Different from ``viewport.levelMin/Max`` only when
  // VEX has been changed since the last setViewport.
  const effLevelMin = levelCentre - visibleLevelExtent / 2;
  const effLevelMax = levelCentre + visibleLevelExtent / 2;

  const xToScreen = useCallback(
    (x: number) => MARGIN.left + (x - viewport.xMin) * scaleH,
    [viewport.xMin, scaleH],
  );
  const levelToScreen = useCallback(
    (level: number) => MARGIN.top + (effLevelMax - level) * scaleV,
    [effLevelMax, scaleV],
  );
  // Inverses of the forward transforms (#163f) — used by BodyExtentOverlay to
  // map a dragged ghost node's screen position back to section-local
  // (along_m, elevation_m). Must invert the SAME forward transform used to
  // render so render + commit stay consistent.
  const screenXToAlong = useCallback(
    (x: number) => (x - MARGIN.left) / scaleH + viewport.xMin,
    [viewport.xMin, scaleH],
  );
  const screenToLevel = useCallback(
    (y: number) => effLevelMax - (y - MARGIN.top) / scaleV,
    [effLevelMax, scaleV],
  );

  // (warpedScreenXToAlongCb is defined below, AFTER ``warpAnchors`` —
  //  see the dogfeed 2026-05-31 zoom-snap fix.)

  // ---- Pan / zoom interactions ---------------------------------------

  const panStart = useRef<{
    px: number;
    py: number;
    viewport: Viewport;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  // Cursor elevation (mTAW) under the pointer for the bottom-right readout HUD;
  // null when the cursor is outside the plot area (dogfeed 2026-06-19).
  const [cursorLevelM, setCursorLevelM] = useState<number | null>(null);
  // True while a CAD-style both-buttons-held pan is active, so the
  // trailing right-button contextmenu is suppressed (see the SVG
  // onContextMenu wrapper). Reset on the next single-button mousedown.
  const bothBtnPanRef = useRef(false);

  function handleMouseDown(e: React.MouseEvent<SVGSVGElement>): void {
    // CAD/Plaxis-style pan: holding BOTH mouse buttons pans regardless
    // of which button fired this event. Left-drag pan + shift-marquee
    // (below) are unchanged. e.buttons is a bitmask: 1=left, 2=right.
    if ((e.buttons & 1) === 1 && (e.buttons & 2) === 2) {
      e.preventDefault();
      bothBtnPanRef.current = true;
      const r = e.currentTarget.getBoundingClientRect();
      panStart.current = {
        px: e.clientX - r.left,
        py: e.clientY - r.top,
        viewport,
      };
      setIsPanning(true);
      return;
    }
    bothBtnPanRef.current = false;
    // Only the left button starts a pan — right-click is reserved
    // for a future context menu, middle-click stays for browser
    // autoscroll.
    if (e.button !== 0) return;
    // Shift held → start a marquee instead of a pan. Owning the
    // dispatch on the SVG ROOT (vs the bg rect) means Shift+click
    // ANYWHERE on the section — including on a column glyph — opens
    // the marquee, satisfying the "shift+click on column = multi-
    // select" requirement.
    // Selection gesture, not a mutation — see ``contactMarqueeEnabled``. The
    // ``??`` keeps the historical coupling for every caller that says nothing.
    if (
      e.shiftKey &&
      (contactMarqueeEnabled ?? onBatchUpdateContacts != null)
    ) {
      const svgEl = e.currentTarget;
      const rect = svgEl.getBoundingClientRect();
      setMarquee({
        startClientX: e.clientX,
        startClientY: e.clientY,
        currentClientX: e.clientX,
        currentClientY: e.clientY,
        svgLeft: rect.left,
        svgTop: rect.top,
        // Always additive — the user's selection grows.
        additive: true,
      });
      // Don't start pan in parallel.
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    panStart.current = {
      px: e.clientX - rect.left,
      py: e.clientY - rect.top,
      viewport,
    };
    setIsPanning(true);
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    // Cursor elevation readout (dogfeed 2026-06-19): show the mTAW height under
    // the cursor (bottom-right HUD) so the user can call out exact elevations.
    // Computed on EVERY move (before the pan guard); null when outside the plot.
    const svgY = e.clientY - rect.top;
    const inPlot = svgY >= MARGIN.top && svgY <= MARGIN.top + plotHeight;
    setCursorLevelM(inPlot ? screenToLevel(svgY) : null);
    if (panStart.current === null) return;
    const dx = e.clientX - rect.left - panStart.current.px;
    const dy = e.clientY - rect.top - panStart.current.py;
    // dx in pixels → world metres via scaleH. Drag right means the
    // world moves left under the viewport, so subtract.
    const dxWorld = dx / scaleH;
    const dyWorld = dy / scaleV;
    setViewport({
      xMin: panStart.current.viewport.xMin - dxWorld,
      xMax: panStart.current.viewport.xMax - dxWorld,
      // Drag down means viewport.levelMax (which is at the top of
      // the screen) needs to go up in world terms — add dyWorld.
      levelMin: panStart.current.viewport.levelMin + dyWorld,
      levelMax: panStart.current.viewport.levelMax + dyWorld,
    });
  }

  function handleMouseUp(e: React.MouseEvent<SVGSVGElement>): void {
    const start = panStart.current;
    panStart.current = null;
    setIsPanning(false);
    // Click-without-drag on the section background → clear the
    // contact selection. Threshold mirrors the marquee's click-vs-
    // drag dead-zone so a tiny mouse jitter doesn't cancel the
    // clear. Skip when Shift is held (additive selection semantics)
    // or when the click landed on an element that handles its own
    // mousedown (hit-strips stopPropagation, columns route via
    // onClick — neither triggers this clear path).
    if (start === null) return;
    if (e.shiftKey) return;
    // A click that landed on a correlate band hit-rect OR a bottom-of-test
    // handle arms/correlates via its own onClick — don't also reset selection
    // or clear the armed source here. (The bottom handles live in a SEPARATE
    // group from the band hit-rects, so they need their own exemption — without
    // it, clicking a bottom marker armed then immediately cleared the source,
    // breaking base↔base ties; dogfeed 2026-06-19.)
    if (
      (e.target as Element | null)?.closest?.(
        '[data-testid="contact-gesture-rects"], [data-testid="bottom-handles"]',
      )
    ) {
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = Math.abs(e.clientX - rect.left - start.px);
    const dy = Math.abs(e.clientY - rect.top - start.py);
    if (dx < 3 && dy < 3) {
      setSelectionResetCounter((c) => c + 1);
      // Void click in correlate mode → clear the armed correlation source
      // (dogfeed 2026-05-29): clicking empty space deselects the boundary,
      // matching the section's deselect-on-background-click behaviour.
      if (contactGestureState?.contactCorrelateMode) {
        contactGestureState.onClearArmedContact();
      }
    }
  }

  // Wheel-zoom centred on the cursor — extracted to
  // ``useSectionWheelZoom`` (debt #201 Move 4). The world point under
  // the mouse stays put while the viewport shrinks or grows around it
  // (Leaflet-style). The cursor anchor is spacing-aware: it reads the
  // post-nudge column positions via the refs so the column under the
  // cursor stays pinned at any ``column_spacing`` slider value.
  useSectionWheelZoom({
    containerRef,
    warpAnchorsRef,
    columnSpacingRef,
    layoutStateRef,
    viewport,
    scaleH,
    scaleV,
    effLevelMax,
    plotWidth,
    plotHeight,
    setViewport,
  });

  function resetView(): void {
    setViewport(defaultViewport);
    setVex(section.vertical_exaggeration ?? VEX_DEFAULT);
  }

  // Centred zoom — same factor as the wheel, but pivoting on the
  // viewport's centre instead of the mouse position. Wired to the
  // header's +/- buttons for users who'd rather click than scroll.
  const zoomBy = useCallback((factor: number) => {
    setViewport((prev) => {
      const cx = (prev.xMin + prev.xMax) / 2;
      const cl = (prev.levelMin + prev.levelMax) / 2;
      const xHalf = (prev.xMax - prev.xMin) * factor * 0.5;
      const lHalf = (prev.levelMax - prev.levelMin) * factor * 0.5;
      return {
        xMin: cx - xHalf,
        xMax: cx + xHalf,
        levelMin: cl - lHalf,
        levelMax: cl + lHalf,
      };
    });
  }, []);
  const zoomIn = useCallback(() => zoomBy(1 / WHEEL_ZOOM_FACTOR), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(WHEEL_ZOOM_FACTOR), [zoomBy]);

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
  const scrubBoundsRef = useRef<{ min: number; max: number }>({
    min: 0,
    max: 0,
  });
  const scrubTo = useCallback((centerX: number) => {
    setViewport((prev) => {
      const half = (prev.xMax - prev.xMin) / 2;
      const buffer = (prev.xMax - prev.xMin) * 0.05;
      const { min: dMin, max: dMax } = scrubBoundsRef.current;
      const minCentre = dMin + half - buffer;
      const maxCentre = dMax - half + buffer;
      let clamped: number;
      if (maxCentre < minCentre) {
        // Viewport is wider than the data — centre on the data
        // midpoint so both edges show equal margin.
        clamped = (dMin + dMax) / 2;
      } else {
        clamped = Math.max(minCentre, Math.min(maxCentre, centerX));
      }
      return { ...prev, xMin: clamped - half, xMax: clamped + half };
    });
  }, []);

  // ---- Tick generation -----------------------------------------------

  const xTicks = useMemo(
    () => ticks(viewport.xMin, viewport.xMax, 8),
    [viewport.xMin, viewport.xMax],
  );
  const levelTicks = useMemo(
    () => ticks(effLevelMin, effLevelMax, 6),
    [effLevelMin, effLevelMax],
  );

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
      return boreholes;
    }
    const excluded = new Set(excludedBoreholeIds);
    return boreholes.filter((b) => !excluded.has(b.id));
  }, [boreholes, excludedBoreholeIds]);

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
  } = useSectionData(section, cpts, includedBoreholes);

  // Channel-toggle commit: update the in-memory state optimistically
  // for an instant re-render, then PATCH the section row's
  // ``view_state.cpt_channels`` so the change survives section
  // reopens + .gmproj round-trips. Falls back to local-only when
  // ``onPatch`` is absent (test-render path).
  const handleChannelsChange = useCallback(
    (next: typeof cptChannels) => {
      setCptChannels(next);
      if (onPatch) {
        void onPatch({ view_state: { cpt_channels: next } });
      }
    },
    [setCptChannels, onPatch],
  );

  // Same shape for borehole interpretation toggles — optimistic
  // in-memory update + PATCH so the choice rides .gmproj saves.
  const handleBoreholeChannelsChange = useCallback(
    (next: typeof boreholeChannels) => {
      setBoreholeChannels(next);
      if (onPatch) {
        void onPatch({ view_state: { borehole_channels: next } });
      }
    },
    [setBoreholeChannels, onPatch],
  );

  const handleSnapToStratigraphyChange = useCallback(
    (next: boolean) => {
      setSnapToStratigraphy(next);
      if (onPatch) {
        void onPatch({ view_state: { snap_to_stratigraphy: next } });
      }
    },
    [setSnapToStratigraphy, onPatch],
  );

  // Spacing-slider commit. Same shape as channels — optimistic local
  // update for instant feedback while the user drags, server-side
  // PATCH on release so the chosen spacing rides the .gmproj bundle.
  // SectionHeader calls ``setColumnSpacing`` on every input change
  // (smooth visual update) and ``handleSpacingCommit`` on release.
  const handleSpacingCommit = useCallback(
    (next: number) => {
      if (onPatch) {
        void onPatch({ view_state: { column_spacing: next } });
      }
    },
    [onPatch],
  );

  // REVIEW-FLAG "!" markers removed 2026-09-04 (owner: "I don't know why the attention marker is
  // there"). The amber litho-axis markers + their "Keep separate" dismissal are gone; the persisted
  // ``view_state.review_flags`` field is left intact for backwards-compat (``reviewFlagPrefs`` still
  // reads/writes it), just no longer wired to any rendered surface.

  // Band half-width scales with horizontal zoom — at low zoom keep
  // columns compact, at high zoom let curves breathe. The wheel-zoom
  // handler accounts for the spacing-dependent cumulative-width
  // offset when computing the cursor anchor, so growing bands no
  // longer cause column drift at spacing < 1.
  const bandHalfWidth = useMemo(() => cptBandHalfWidth(scaleH), [scaleH]);

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
  );

  // Ghost-rail footprint per column when the Virtuele Boring
  // overlay is showing on this pane. Each column carries this extra
  // width into the nudge pass so neighbouring columns don't sit on
  // top of the ghosts to their right. Reads as 0 when the overlay
  // is off — keeps the no-overlay layout pixel-identical to before.
  const virtueleBoringActiveModelsForLayout = useMemo<readonly string[]>(
    () => (virtueleBoringActiveModels ?? []).slice(0, 2),
    [virtueleBoringActiveModels],
  );
  const ghostFootprintForLayout =
    virtueleBoringShowOnSection &&
    virtueleBoringActiveModelsForLayout.length > 0
      ? virtueleBoringGhostRailWidth(virtueleBoringActiveModelsForLayout.length)
      : 0;

  // Anchors that render a litho suggestion ghost on this section. Their band
  // is drawn ``2 * bandHalfWidth`` wide regardless of whether the CPT data
  // band is shown, so the column-nudge footprint must reserve that width or
  // adjacent litho bands overlap into an unreadable smear for closely-spaced
  // tests (#28 dogfeed 2026-05-29).
  const lithoGhostAnchorIds = useMemo(() => {
    const ids = new Set<string>();
    if (lithoGhostState != null) ids.add(lithoGhostState.investigationId);
    if (bulkLithoGhostState != null) {
      for (const anchorId of bulkLithoGhostState.anchorGhosts.keys())
        ids.add(anchorId);
    }
    return ids;
  }, [lithoGhostState, bulkLithoGhostState]);

  // Edge-aware pair gap (dogfeed 2026-05-31): two adjacent columns connected by
  // a correlation edge get CORRELATED_PAIR_EDGE_GAP_PX of clear space so the
  // ribbon between them has room to render. Unconnected pairs keep the base
  // 4 px floor so unrelated columns don't sprawl at the most-packed spacing
  // setting. Pair keys are canonical ``min(invA, invB)|max(invA, invB)`` so
  // order does not matter.
  //
  // Hoisted out of the layout memo because the wheel zoom re-runs the SAME
  // layout at the post-zoom scale and needs the same gaps — a gap it did not
  // know about is a pixel of drift on every wheel notch.
  const correlatedInvPairs = useMemo<Set<string>>(() => {
    const investigationByContactId = new Map<string, string>();
    for (const c of contacts) {
      const inv = c.cpt_id ?? c.borehole_id;
      if (inv) investigationByContactId.set(c.id, inv);
    }
    // The correlation edges reference ``litho_layer`` ids (a layer's id keys its
    // top contact), so also map every layer id → its investigation. ``contacts``
    // (above) is the axis CONTACT set, whose ids do NOT match the edge endpoints
    // (which are layer ids) — without this layer-id mapping the edge→investigation
    // lookup below finds nothing, no correlated pairs are detected, and the columns
    // pack to the 4 px floor instead of getting the widened correlated-pair gap.
    // That was the geotech "vertical sliver" bug (2026-06-24). Both ``lithoLayers``
    // and ``contactEdges`` are axis-consistent: on the litho axis they are the litho
    // model's; on the geotech axis (Task 3 swap) they are the geotech model's, so
    // the geotech layer ids here match the geotech edge endpoints.
    for (const layer of lithoLayers ?? []) {
      const inv = layer.cpt_id ?? layer.borehole_id;
      if (inv) investigationByContactId.set(layer.id, inv);
    }
    const pairs = new Set<string>();
    for (const edge of contactEdges ?? []) {
      const invA = investigationByContactId.get(edge.layer_a_id);
      const invB = investigationByContactId.get(edge.layer_b_id);
      if (!invA || !invB || invA === invB) continue;
      const lo = invA < invB ? invA : invB;
      const hi = invA < invB ? invB : invA;
      pairs.add(`${lo}|${hi}`);
    }
    return pairs;
  }, [contacts, lithoLayers, contactEdges]);

  const gapForPair = useCallback(
    (a: string, b: string): number =>
      correlatedInvPairs.has(a < b ? `${a}|${b}` : `${b}|${a}`)
        ? CORRELATED_PAIR_EDGE_GAP_PX
        : COLUMN_EDGE_GAP_PX,
    [correlatedInvPairs],
  );

  // What horizontal room each column claims, split into the part that is fixed
  // and the part that scales with the band half-width. The split is what lets
  // the wheel zoom re-derive the post-zoom widths without re-reading any toggle
  // state (see ``wheelZoomAnchor.ts``).
  //
  // The ghost rail extends to the right of each column's data band. Adding the
  // same footprint to every column means the nudge pass guarantees
  // ``column[i+1].left_edge >= column[i].band_right + ghostFootprint +
  // edgeGap``, which is the condition for the ghosts NOT to overlap
  // column[i+1]'s band. Litho band footprint (#28): a suggestion ghost draws
  // ``2 * bandHalfWidth`` wide even when the data band is off, so reserve at
  // least that or adjacent litho bands overlap into a smear.
  const columnFootprints = useMemo<
    (
      | {
          kind: "cpt";
          proj: ProjectedInvestigation<CptListItem>;
          spec: ZoomLayoutColumn;
        }
      | {
          kind: "borehole";
          proj: ProjectedInvestigation<BoreholeListItem>;
          spec: ZoomLayoutColumn;
        }
    )[]
  >(
    () => [
      ...projectedCpts.map((proj) => ({
        kind: "cpt" as const,
        proj,
        spec: zoomLayoutColumn(
          proj.item.id,
          proj.along,
          // ``cptBandFullWidth`` at a unit half-width IS the multiple (2 or 0),
          // so the applicable-channel rule stays in exactly one place.
          cptPlots?.has(proj.item.id)
            ? cptBandFullWidth(proj.item.cpt_type, cptChannels, 1)
            : 0,
          lithoGhostAnchorIds.has(proj.item.id),
          ghostFootprintForLayout,
        ),
      })),
      ...projectedBoreholes.map((proj) => ({
        kind: "borehole" as const,
        proj,
        spec: zoomLayoutColumn(
          proj.item.id,
          proj.along,
          boreholeDetails?.has(proj.item.id) ? enabledBhChannels * 2 : 0,
          lithoGhostAnchorIds.has(proj.item.id),
          ghostFootprintForLayout,
        ),
      })),
    ],
    [
      projectedCpts,
      projectedBoreholes,
      cptPlots,
      boreholeDetails,
      cptChannels,
      enabledBhChannels,
      ghostFootprintForLayout,
      lithoGhostAnchorIds,
    ],
  );

  // Column collision handling — when multiple investigations project near the
  // same along-distance their columns would overlap into an unreadable stack.
  //
  // ``columnSpacing`` lerps between two collision-safe layouts:
  //
  //   spacing = 1.0 → TRUTH layout: each column sits at its projected
  //     along-distance; the nudge only displaces columns that would overlap.
  //   spacing = 0.0 → PACKED layout: columns are placed edge-to-edge in
  //     projection order from the leftmost, however far apart they really are.
  //
  // The pass itself lives in ``wheelZoomAnchor.ts`` because the wheel zoom runs
  // it too, at a viewport it has not rendered yet.
  const placedColumns = useMemo<PlacedColumn[]>(() => {
    const byId = new Map(columnFootprints.map((c) => [c.spec.id, c]));
    return layoutColumnsHorizontally({
      columns: columnFootprints.map((c) => c.spec),
      xMin: viewport.xMin,
      scaleH,
      bandHalfWidth,
      columnSpacing,
      marginLeft: MARGIN.left,
      edgeGapPx: COLUMN_EDGE_GAP_PX,
      gapForPair,
    }).map((p) => {
      const src = byId.get(p.id) as NonNullable<ReturnType<typeof byId.get>>;
      const common = {
        trueX: p.trueX,
        nudgedX: p.nudgedX,
        width: p.width,
        displaced: p.displaced,
      };
      // Branch on kind so the (kind, proj) pair stays correlated — a single
      // literal-object return widens to a non-discriminated union and tsc
      // loses the narrowing (debt #28).
      return src.kind === "cpt"
        ? { kind: "cpt" as const, proj: src.proj, ...common }
        : { kind: "borehole" as const, proj: src.proj, ...common };
    });
  }, [
    columnFootprints,
    viewport.xMin,
    scaleH,
    bandHalfWidth,
    columnSpacing,
    gapForPair,
  ]);

  // Scrub-bar outer bounds: the WARP-EFFECTIVE leftmost / rightmost
  // along-section position (world m). The track represents the RENDERED
  // extent of the columns — NOT 0..sectionLength, and NOT the raw
  // ``proj.along`` span. At low ``column_spacing`` the columns pack left
  // (``nudgedX`` lands left of ``xToScreen(rawAlong)``); bounding the
  // scrub to the raw along would let the handle scroll the viewport far
  // past the packed columns into empty space (dogfeed 2026-06-06).
  // ``computeScrubBounds`` maps each column's rendered ``nudgedX`` back
  // through ``screenXToAlong`` to its effective along and takes the
  // extremes — pan-independent (``nudgedX`` embeds ``viewport.xMin``,
  // which ``screenXToAlong`` adds back, so they cancel). Falls back to
  // [0, lengthM] when no columns are placed yet (fresh section before
  // projection lands), so the bar stays grab-able. Recomputes on every
  // change to placedColumns (zoom-driven layout changes, spacing slider,
  // new investigation imported) or the viewport transform
  // (``screenXToAlong``).
  const { scrubDataMinM, scrubDataMaxM } = useMemo(() => {
    const { min, max } = computeScrubBounds(placedColumns, screenXToAlong, {
      min: 0,
      max: lengthM,
    });
    return { scrubDataMinM: min, scrubDataMaxM: max };
  }, [placedColumns, lengthM, screenXToAlong]);

  // Feed the latest data bounds into the ref that ``scrubTo``
  // (declared above ``placedColumns``) consumes. The ref dodges the
  // TDZ that would otherwise hit if scrubTo's useCallback closed over
  // scrubDataMinM/MaxM directly.
  useEffect(() => {
    scrubBoundsRef.current = { min: scrubDataMinM, max: scrubDataMaxM };
  }, [scrubDataMinM, scrubDataMaxM]);

  // Same TDZ-dodging pattern for handleWheel's spacing-aware cursor
  // anchor: mirror the live ``columnSpacing`` into the ref the wheel
  // handler reads.
  useEffect(() => {
    columnSpacingRef.current = columnSpacing;
  }, [columnSpacing]);

  // Virtuele Boring overlay — index the predictions by
  // investigation_id once per prop change so the SVG render walks a
  // single Map lookup per column. Truncate active models to two; the
  // UI only exposes two dropdown slots so anything beyond would
  // overflow the ghost-column rail (each slot owns its own ghost).
  const virtueleBoringActiveModelsClamped = useMemo<readonly string[]>(
    () => (virtueleBoringActiveModels ?? []).slice(0, 2),
    [virtueleBoringActiveModels],
  );
  const virtueleBoringPredictionsByInvestigationId = useMemo(() => {
    const map = new Map<string, VirtueleBoringInvestigationPrediction>();
    for (const pred of virtueleBoringPredictions ?? []) {
      map.set(pred.investigation_id, pred);
    }
    return map;
  }, [virtueleBoringPredictions]);

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
  const focusedContactsLastRef = useRef<readonly string[] | null>(null);
  useEffect(() => {
    if (!focusedContactIds || focusedContactIds.length === 0) {
      focusedContactsLastRef.current = null;
      return;
    }
    if (focusedContactsLastRef.current === focusedContactIds) return;

    // NB: the lock-ref is set at the BOTTOM of this effect, only after
    // we actually changed the viewport.  An earlier version set it
    // here, before the data-availability checks below — which meant
    // that if ``contacts`` or ``placedColumns`` weren't loaded yet
    // on the first render after a Geology → Sections deep-link, the
    // effect bailed AND locked, so subsequent re-renders with the
    // populated data never re-ran the zoom.  Banner-click from the
    // Geology stage looked broken (always landed on the default-fit
    // viewport).

    const focusedSet = new Set(focusedContactIds);
    interface ColumnFit {
      along: number;
      nudgedX: number;
      topZ: number;
      bottomZ: number;
    }
    const fits: ColumnFit[] = [];
    log.debug(
      "section-zoom",
      `focusedContactIds.length=${focusedContactIds.length} focusableContacts=${focusableContacts?.length ?? "undef"} contacts=${contacts.length} placedColumns=${placedColumns.length}`,
    );
    // Use the UNFILTERED axis contacts when supplied — the crossings
    // banner's contact_ids are global to the geological model and
    // routinely span contacts not in this section's
    // ``seeded_formation_contact_ids`` (the explicit-content
    // invariant). Falling back to ``contacts`` (the seeded subset)
    // preserves behaviour for callers that don't supply the full
    // list.
    const lookupContacts = focusableContacts ?? contacts;
    for (const contact of lookupContacts) {
      if (!focusedSet.has(contact.id)) continue;
      const anchorId = contact.borehole_id ?? contact.cpt_id ?? null;
      if (!anchorId) continue;
      const col = placedColumns.find((c) => c.proj.item.id === anchorId);
      if (!col) continue;
      const elevation = col.proj.item.elevation_m;
      if (elevation === null || elevation === undefined) continue;

      // Deepest data point — drives the bottom of the vertical fit.
      // CPT: last sample of the loaded plot. Borehole: total_depth_m
      // off the detail map. If neither loaded yet, fall back to a
      // typical 20 m so the fit still has a sensible vertical span.
      let depthBottom: number | null = null;
      if (col.kind === "cpt") {
        const plot = cptPlots?.get(anchorId);
        if (plot && plot.depths_m.length > 0) {
          depthBottom = plot.depths_m[plot.depths_m.length - 1];
        }
      } else {
        const detail = boreholeDetails?.get(anchorId);
        if (detail && detail.total_depth_m !== null) {
          depthBottom = detail.total_depth_m;
        }
      }
      if (depthBottom === null) depthBottom = 20;
      fits.push({
        along: col.proj.along,
        nudgedX: col.nudgedX,
        topZ: elevation,
        bottomZ: elevation - depthBottom,
      });
    }
    if (fits.length === 0) {
      log.debug(
        "section-zoom",
        `BAIL fits.length=0 — no offending contact's anchor was found in placedColumns. focusedContactIds=${focusedContactIds.length} lookupContacts=${(focusableContacts ?? contacts).length}`,
      );
      return;
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
    const dedup = new Map<number, (typeof fits)[number]>();
    for (const f of fits) {
      if (!dedup.has(f.along)) dedup.set(f.along, f);
    }
    const distinctCols = [...dedup.values()].sort((a, b) => a.along - b.along);

    const alongsAll = distinctCols.map((f) => f.along);
    const fullMinAlong = Math.min(...alongsAll);
    const fullMaxAlong = Math.max(...alongsAll);
    const FIT_ALL_HORIZONTAL_THRESHOLD_M = 200;

    let activeCols: typeof distinctCols;
    if (fullMaxAlong - fullMinAlong > FIT_ALL_HORIZONTAL_THRESHOLD_M) {
      // Too spread (e.g. a system-wide formation crossing) — zoom to
      // the FIRST affected column only. The amber-pulse highlight
      // still fires on every contact, so the engineer sees the full
      // extent of the issue while landing tightly on a specific
      // problem location. They can scrub to the others.
      activeCols = [distinctCols[0]];
    } else {
      activeCols = distinctCols;
    }

    const alongs = activeCols.map((f) => f.along);
    const minAlong = Math.min(...alongs);
    const maxAlong = Math.max(...alongs);
    const topZ = Math.max(...activeCols.map((f) => f.topZ));
    const bottomZ = Math.min(...activeCols.map((f) => f.bottomZ));

    // Bail early if the plot hasn't been measured yet (SectionPanel's
    // first render before ResizeObserver fires sets plotWidth = 0,
    // which would NaN out the spacing<1 math). DON'T lock the ref —
    // the effect re-fires once placedColumns recomputes with real
    // dimensions, and we want that re-fire to succeed.
    if (plotWidth <= 0 || scaleH <= 0) {
      log.debug(
        "section-zoom",
        `BAIL plotWidth=${plotWidth} scaleH=${scaleH} — layout not ready yet, will retry`,
      );
      return;
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
    const TARGET_XRANGE_M = 100;
    let xMin: number;
    let xMax: number;
    if (columnSpacing >= 1.0) {
      if (minAlong === maxAlong) {
        xMin = minAlong - 50;
        xMax = maxAlong + 50;
      } else {
        const xRange = maxAlong - minAlong;
        const margin = Math.max(15, xRange * 0.3);
        xMin = minAlong - margin;
        xMax = maxAlong + margin;
      }
    } else {
      // Packed layout: SIMULATE the post-zoom column layout exactly
      // instead of estimating with a per-column ratio. We re-walk
      // every column at the new bandHalfWidth and sum the cumulative
      // offset to the target column. No estimation, no compounding
      // error on the first click, no "needs two clicks" pattern.
      const newScaleH = plotWidth / TARGET_XRANGE_M;
      const newBandHalfWidth = cptBandHalfWidth(newScaleH);

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
      const newVisualWidth = (col: (typeof placedColumns)[number]): number =>
        columnLayoutWidthPx(
          zoomLayoutColumn(
            col.proj.item.id,
            col.proj.along,
            col.kind === "cpt"
              ? cptBandFullWidth(col.proj.item.cpt_type, cptChannels, 1)
              : enabledBhChannels * 2,
            lithoGhostAnchorIds.has(col.proj.item.id),
            ghostFootprintForLayout,
          ),
          newBandHalfWidth,
        );

      // Sort placedColumns by along (the packing order).
      const sortedCols = [...placedColumns].sort(
        (a, b) => a.proj.along - b.proj.along,
      );
      // Find the target column's index. activeCols[0] is the leftmost
      // focused column (we sorted distinctCols ASC).
      const targetAlong = activeCols[0].along;
      const targetIdx = sortedCols.findIndex(
        (c) => c.proj.along === targetAlong,
      );
      if (targetIdx < 0) {
        log.debug(
          "section-zoom",
          `BAIL packed branch: target along=${targetAlong} not in placedColumns`,
        );
        return;
      }

      // Walk 0..targetIdx and sum cumulative offset from packedX_0.
      // packedX_i = packedX_{i-1} + halfW_{i-1} + halfW_i + edgeGap
      // (the placedColumns useMemo packs edge-to-edge with edge gap).
      let cumulativeOffsetPx = 0;
      for (let i = 1; i <= targetIdx; i += 1) {
        const prevHalf = newVisualWidth(sortedCols[i - 1]) / 2;
        const currHalf = newVisualWidth(sortedCols[i]) / 2;
        cumulativeOffsetPx += prevHalf + currHalf + COLUMN_EDGE_GAP_PX;
      }

      const leftmostAlong = sortedCols[0].proj.along;
      const plotCentre = MARGIN.left + plotWidth / 2;
      // Want target's POST-ZOOM nudgedX = plotCentre:
      //   plotCentre = MARGIN.left + (leftmostAlong - newXMin) * newScaleH
      //              + cumulativeOffsetPx
      // → newXMin = leftmostAlong - (plotCentre - MARGIN.left - cumulativeOffsetPx) / newScaleH
      xMin =
        leftmostAlong -
        (plotCentre - MARGIN.left - cumulativeOffsetPx) / newScaleH;
      xMax = xMin + TARGET_XRANGE_M;
      log.debug(
        "section-zoom",
        `PACKED targetIdx=${targetIdx}/${sortedCols.length} cumOff=${cumulativeOffsetPx.toFixed(0)} newBHW=${newBandHalfWidth} newScaleH=${newScaleH.toFixed(2)} leftmostAlong=${leftmostAlong} xMin=${xMin.toFixed(1)} xMax=${xMax.toFixed(1)}`,
      );
    }

    // Vertical: maximum extent ("top of test, bottom of test, fill
    // the screen"). Tight to the data span with a small ±5% margin
    // so the surface tick + deepest sample don't kiss the plot
    // edges.
    const zRange = topZ - bottomZ;
    const zMargin = Math.max(0.5, zRange * 0.05);
    const levelMin = bottomZ - zMargin;
    const levelMax = topZ + zMargin;

    log.debug(
      "section-zoom",
      `APPLY fits=${fits.length} distinct=${distinctCols.length} activeCols=${activeCols.length} xMin=${xMin.toFixed(1)} xMax=${xMax.toFixed(1)} levelMin=${levelMin.toFixed(1)} levelMax=${levelMax.toFixed(1)}`,
    );
    setViewport((prev) => ({
      ...prev,
      xMin,
      xMax,
      levelMin,
      levelMax,
    }));
    focusedContactsLastRef.current = focusedContactIds;
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
  ]);

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
  } = useContactPicker(onCreateContact);

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
  );

  // Lift focusedColumn to the shell so SectionsToolbar can gate the
  // litho-axis "Suggest litho" button on the section-local focus
  // (not the global map/data selection). The callback is optional so
  // the test-render path can mount without a seam.
  useEffect(() => {
    onFocusedColumnChange?.(focusedColumn);
  }, [focusedColumn, onFocusedColumnChange]);

  // Filter the layout pass to just the focused column when active, and
  // re-anchor it to its TRUE projected X so it renders dead-centre at
  // any columnSpacing. Downstream warpAnchors, showLabelsByCptId,
  // hideStickIds all read through this.
  const visibleColumns = useMemo(() => {
    if (focusedColumn === null) return placedColumns;
    return placedColumns
      .filter(
        (c) =>
          c.kind === focusedColumn.kind && c.proj.item.id === focusedColumn.id,
      )
      .map((c) => {
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
        const sx = xToScreen(c.proj.along);
        return { ...c, trueX: sx, nudgedX: sx, displaced: false };
      });
  }, [placedColumns, focusedColumn, xToScreen]);

  // The placed columns as the find bar needs them. Reads visibleColumns (not
  // placedColumns) so column-focus mode offers only what is actually drawn,
  // and nudgedX so a jump centres the RENDERED position at any spacing.
  const findEntries = useMemo<ColumnFindEntry[]>(
    () =>
      visibleColumns.map((col) => ({
        id: col.proj.item.id,
        name: col.proj.item.name,
        along: col.proj.along,
        nudgedX: col.nudgedX,
      })),
    [visibleColumns],
  );

  const handleFindJump = useCallback(
    (target: ColumnFindEntry) => {
      // One-shot pan: a viewport shift moves every column by the same pixel
      // delta, so the target lands at centre exactly, packed or not.
      setViewport((prev) =>
        panViewportToScreenX(
          prev,
          target.nudgedX,
          MARGIN.left + plotWidth / 2,
          scaleH,
        ),
      );
      setFindFlashId(target.id);
      if (findFlashTimer.current !== null) clearTimeout(findFlashTimer.current);
      findFlashTimer.current = setTimeout(
        () => setFindFlashId(null),
        FLASH_HIGHLIGHT_MS,
      );
    },
    [plotWidth, scaleH],
  );

  // Centre the gap holding the next crossing-tie conflict (owner ask
  // 2026-08-23: *"make that clickable so it zooms to the first one, and then
  // when it is resolved it takes the second one"*). The chip cycles; this only
  // pans, reusing the same one-shot slide the column find uses so the jump
  // keeps whatever zoom the engineer set.
  //
  // The overlay hands over a resolved SCREEN X rather than the conflict's gap
  // index, because on the geotech axis that index lives on the litho frame's
  // column list, not on ``visibleColumns`` — see PartitionFillOverlay's
  // ``onJumpToConflictGap`` doc.
  const handleConflictJump = useCallback(
    (screenX: number) => {
      setViewport((prev) =>
        panViewportToScreenX(
          prev,
          screenX,
          MARGIN.left + plotWidth / 2,
          scaleH,
        ),
      );
    },
    [plotWidth, scaleH],
  );

  // Bring a named pair of columns on screen and flash the tie between them —
  // what the geotech "N pending here" chip presses (owner ask 2026-08-25:
  // *"Why don't we make that clickable so it highlights the tie?"*).
  //
  // The caller names INVESTIGATIONS, never a position: this panel is the only
  // surface that knows where — or whether — a column is drawn, and handing an
  // index or an X across that boundary is what already cost a bug on the
  // crossing chip. It resolves both ends through ``visibleColumns``, the same
  // list the overlays draw from, so it cannot claim a reveal the canvas did not
  // perform. Reuses the one-shot slide the Ctrl+F find uses, so the jump keeps
  // whatever zoom the engineer had set.
  const revealColumns = useCallback<SectionColumnRevealFn>(
    ({
      investigationIds,
      flashEdgeId: edgeId,
      flashColumnId,
      flashGapInvestigationIds,
    }) => {
      const { centreX, missingInvestigationIds } = resolveColumnReveal(
        investigationIds,
        visibleColumns.map((c) => ({ id: c.proj.item.id, nudgedX: c.nudgedX })),
      );
      if (centreX === null) return { revealed: false, missingInvestigationIds };
      setViewport((prev) =>
        panViewportToScreenX(
          prev,
          centreX,
          MARGIN.left + plotWidth / 2,
          scaleH,
        ),
      );
      if (edgeId !== undefined) {
        setFlashEdgeId(edgeId);
        if (flashEdgeTimer.current !== null)
          clearTimeout(flashEdgeTimer.current);
        flashEdgeTimer.current = setTimeout(
          () => setFlashEdgeId(null),
          FLASH_HIGHLIGHT_MS,
        );
      }
      // A reveal that is about ONE test has no tie to mark, so it lands with the
      // column pulse instead — the very same one-shot flash Ctrl+F uses, so the
      // section view never grows a second "here it is" idiom.
      if (flashColumnId !== undefined) {
        setFindFlashId(flashColumnId);
        if (findFlashTimer.current !== null)
          clearTimeout(findFlashTimer.current);
        findFlashTimer.current = setTimeout(
          () => setFindFlashId(null),
          FLASH_HIGHLIGHT_MS,
        );
      }
      if (flashGapInvestigationIds !== undefined) {
        flashGap(flashGapInvestigationIds);
      }
      return { revealed: true, missingInvestigationIds };
    },
    [visibleColumns, plotWidth, scaleH, flashGap],
  );

  // Publish it into the caller's slot. A ref, not a callback prop: this
  // identity changes on every pan and zoom (it closes over the live column
  // layout), and a state-setting publisher would loop.
  useEffect(() => {
    if (!columnRevealRef) return;
    columnRevealRef.current = revealColumns;
    return () => {
      columnRevealRef.current = null;
    };
  }, [columnRevealRef, revealColumns]);

  // Mirror the layout state the wheel handler needs into ``layoutStateRef``.
  // handleWheel is declared far above these memos, so it can't close over them
  // directly; the ref lets it re-run the SAME horizontal layout at the
  // post-zoom scale and land the cursor's world point back on the cursor pixel.
  //
  // It reads ``visibleColumns``, not ``placedColumns``: in column focus the
  // panel draws ONE re-anchored column, and the simulation has to match what is
  // drawn or the zoom anchors on a layout nobody can see.
  useEffect(() => {
    layoutStateRef.current = {
      placedColumns: visibleColumns,
      cptPlots,
      boreholeDetails,
      cptChannels,
      enabledBhChannels,
      ghostFootprintForLayout,
      lithoGhostAnchorIds,
      gapForPair,
    };
  }, [
    visibleColumns,
    cptPlots,
    boreholeDetails,
    cptChannels,
    enabledBhChannels,
    ghostFootprintForLayout,
    lithoGhostAnchorIds,
    gapForPair,
  ]);

  // Right-click context menu state + handlers — both the
  // ColumnGlyph hit-box handler and the SVG-level catch-all
  // fallback live in this hook (debt #30).
  const {
    contextMenu,
    handleColumnContextMenu,
    handleSvgContextMenu,
    dismiss: dismissContextMenu,
  } = useColumnContextMenu(visibleColumns, containerRef);

  // Body context menu state — opened by right-clicking a body wedge
  // in BodyExtentOverlay.  Closed by the menu's own onClose or by the
  // section-wide Esc handler below.
  const [bodyCtxMenu, setBodyCtxMenu] = useState<{
    body: BodyListItem;
    svgX: number;
    svgY: number;
    // The clicked region's own layers (debt #278 R5) — the source of the
    // Separate arm's anchor. Absent on a right-click that carried no region
    // context (older callers), which simply cannot arm a Separate.
    layerIds?: readonly string[];
  } | null>(null);
  // D2 (owner 2026-09-01): while the body menu is open, hovering an "Ontkoppelen"
  // item highlights the OTHER body it refers to — the layer position that tells two
  // same-labelled un-join options apart. Cleared on leave and on dismiss.
  const [hoverUnjoinLayerId, setHoverUnjoinLayerId] = useState<string | null>(
    null,
  );
  const dismissBodyCtxMenu = useCallback(() => {
    setBodyCtxMenu(null);
    setHoverUnjoinLayerId(null);
  }, []);

  const handleBodyContextMenu = useCallback(
    (
      body: BodyListItem,
      svgX: number,
      svgY: number,
      layerIds?: readonly string[],
    ): void => {
      setBodyCtxMenu({ body, svgX, svgY, layerIds });
      // Defensively clear any leftover un-join spotlight so a freshly-opened menu
      // never inherits a stale highlight — correctness must not depend on the
      // context-menu backdrop's stacking order (ux-reviewer).
      setHoverUnjoinLayerId(null);
    },
    [],
  );

  // The body menu's "Unit statistics…" jump routes to the ACTIVE axis's stats
  // handler — the GEOTECH one on the geotech axis (piece B, owner 2026-08-31),
  // the litho one otherwise. Mirrors the overlay's ``unitStatsHandlerForAxis``:
  // a geotech body reports a geotech unit, never the litho jump.
  const bodyMenuUnitStats =
    axisMode === "geotechnical"
      ? onShowGeotechUnitStatistics
      : onShowLithoUnitStatistics;

  // The live "Separate" arm (debt #278 R5) + its automatic-retire lifecycle
  // (axis change / correlate mode / vanished anchor) — extracted to
  // ``usePairArm`` so those rules are unit-testable off this god-component.
  // The arm/pick GESTURE handlers stay here (they need the body-resolution map
  // and the notice/commit callbacks).
  const { pairArm, setPairArm, clearPairArm } = usePairArm({
    axisMode,
    correlateMode: Boolean(contactGestureState?.contactCorrelateMode),
    armBodyIdByLayerId,
  });

  // "Voeg samen met…" (Join) ARMS the pick-the-other-body gesture rather than
  // committing (mirrors the geotech band-edit "Split band…" arm). The anchor is
  // the first clicked-region layer stamped to this body — deterministic, so the
  // same body always joins through the same anchor. (Owner ruling 2026-09-01: the
  // body verbs are stripped to Join + Ontkoppelen; Separate / Rejoin are gone, so
  // this is the only arm.)
  const handleArmJoin = useCallback(
    (
      bodyId: string,
      layerIds: readonly string[] | undefined,
      label: string,
    ): void => {
      const anchorLayerId = firstLayerStampedToBody(
        layerIds,
        bodyId,
        armBodyIdByLayerId,
      );
      if (anchorLayerId === null) {
        // No anchor resolvable (fallback paint / unstamped) — nothing to join
        // FROM, so tell the engineer rather than arm a gesture that cannot commit.
        onJoinNotice?.({ kind: "unresolvable" });
        return;
      }
      setPairArm({ bodyId, anchorLayerId, label });
    },
    [armBodyIdByLayerId, onJoinNotice, setPairArm],
  );

  // The armed Join left-click's outcome, resolved in PartitionFillOverlay: a
  // distinct SAME-class body commits (and disarms); same / unresolvable /
  // cross-class keep the arm live and only advise. A cross-class advisory names
  // both classes; the backend 422 is the ultimate authority on a commit.
  const handleJoinPick = useCallback(
    (pick: JoinPick): void => {
      if (pick.kind === "commit") {
        onJoinBodies?.(pick.anchorLayerId, pick.targetAnchorLayerId);
        setPairArm(null);
        return;
      }
      onJoinNotice?.(pick);
    },
    [onJoinBodies, onJoinNotice, setPairArm],
  );

  // Remove-from-section handler — appends the column's id to the
  // section's excluded_{cpt,borehole}_ids list and PATCHes. The
  // backend's section projection already filters by these arrays,
  // so the column disappears on the next render. Reversible (the
  // test stays in the project + on the map); per UX rules no
  // confirmation dialog. Returns the next list shape locally to
  // avoid a refetch round-trip — App's PATCH handler replaces the
  // section state with the server's response anyway.
  const handleRemoveFromSection = useCallback(
    async (kind: "cpt" | "borehole", id: string): Promise<void> => {
      if (!onPatch) return;
      // Closure-captured pre-remove list — see the helper's docstring.
      const { firstApply, undoCmd } = buildRemoveFromSectionCommand(
        kind,
        id,
        {
          excluded_cpt_ids: section.excluded_cpt_ids,
          excluded_borehole_ids: section.excluded_borehole_ids,
        },
        onPatch,
      );
      await firstApply();
      undoStack?.push(undoCmd);
    },
    [
      onPatch,
      section.excluded_cpt_ids,
      section.excluded_borehole_ids,
      undoStack,
    ],
  );

  // The column verbs for one test, handed to ContactsLayer so its litho menu
  // can head itself with them (owner dogfeed 2026-09-11: one right-click on a
  // test, one menu). Built from the SAME shared builder ColumnContextMenu uses,
  // so the two surfaces cannot offer different verbs for the same column.
  // "Clear subdivision" is deliberately not passed: it is a geotech-axis verb
  // and this menu only ever opens on the litho axis.
  const lithoMenuColumnVerbs = useCallback(
    (anchor: { kind: "cpt" | "borehole"; id: string; name: string }) =>
      buildColumnMenuVerbs(t, {
        onFocus: () => enterFocus(anchor),
        onOpenDetail:
          anchor.kind === "cpt"
            ? onSelectCpt
              ? () => onSelectCpt(anchor.id)
              : undefined
            : onSelectBorehole
              ? () => onSelectBorehole(anchor.id)
              : undefined,
        onRemoveFromSection: onPatch
          ? () => {
              void handleRemoveFromSection(anchor.kind, anchor.id);
            }
          : undefined,
      }),
    [
      t,
      enterFocus,
      onSelectCpt,
      onSelectBorehole,
      onPatch,
      handleRemoveFromSection,
    ],
  );

  // Esc peel cascade — extracted to ``useSectionKeyboardShortcuts``
  // (debt #201 Move 4). Lives after the useColumnContextMenu / focus
  // hooks because it consumes contextMenu + focusedColumn; the open/
  // focus states are passed as booleans so the hook stays decoupled
  // from the menu shapes.
  // S4/S5: geotech body selection — reactive read drives the Esc cascade and
  // the axis-switch clear effect below.
  const selectedGeotechBodyId = useSelectedGeotechBodyId();

  useSectionKeyboardShortcuts({
    // #278: an armed Join pick peels first — Esc cancels the pick-the-other-body
    // gesture, not the section. One arm at a time, so ``pairArm`` drives the peel.
    pairArmed: pairArm !== null,
    clearPairArm,
    bodyMenuOpen: bodyCtxMenu !== null,
    columnMenuOpen: contextMenu !== null,
    columnFocused: focusedColumn !== null,
    dismissBodyCtxMenu,
    dismissContextMenu,
    exitFocus,
    onClose,
    // S4: Esc clears a geotech body selection before peeling to column focus
    // or section close, so one Esc dismisses the highlight without losing the
    // section context.
    geotechBodySelected: selectedGeotechBodyId !== null,
    clearGeotechBody: () => selectGeotechBody(null),
  });

  // S5: switching away from the geotech axis clears a stale body selection so
  // the sample-dot highlight doesn't bleed into the litho / geology axes.
  // reason: axisMode is the only dep — we intentionally run only when it
  // changes, not on every re-render, and selectGeotechBody is a stable module
  // function (not a closure over component state).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (axisMode !== "geotechnical") {
      selectGeotechBody(null);
    }
  }, [axisMode]);

  // (The pair arm's axis / correlate / stale-anchor retire rules moved to
  // ``usePairArm`` above.)

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
      const plot = cptPlots?.get(cptId);
      if (!plot) return null;
      return {
        qc: lookupCptValueAtDepth(plot.depths_m, plot.qc_mpa, depthM),
        rf: lookupCptValueAtDepth(plot.depths_m, plot.rf_pct ?? [], depthM),
      };
    },
    [cptPlots],
  );

  // Debt #136 — snap candidates now combine borehole stratigraphy (the
  // original source) with the section's committed contacts on the same
  // anchor.  Tagging each contact-sourced candidate with its contactId
  // lets ContactsLayer's drag handler exclude the dragger's own row, so
  // a small drag doesn't pull back to its starting depth (self-snap
  // suppression).  Both sources gate on ``snapToStratigraphy``: one
  // toggle covers all snap behaviour, matching the user mental model of
  // "do I want snap or not".
  const snapDepthsByAnchorId = useMemo(() => {
    const out = new Map<string, readonly SnapCandidate[]>();
    if (!snapToStratigraphy) return out;
    const acc = new Map<string, SnapCandidate[]>();
    if (boreholeDetails !== null) {
      for (const [id, detail] of boreholeDetails) {
        const stratDepths = collectSnapDepths(detail);
        if (stratDepths.length > 0) {
          acc.set(
            id,
            stratDepths.map((d) => ({ depth: d })),
          );
        }
      }
    }
    if (contacts) {
      for (const c of contacts) {
        const anchorId = c.borehole_id ?? c.cpt_id;
        if (!anchorId) continue;
        const list = acc.get(anchorId) ?? [];
        list.push({ depth: c.depth_top_m, contactId: c.id });
        acc.set(anchorId, list);
      }
    }
    // Third source, geotech axis only: the CPT's own packing boundaries.
    //
    // The cone resistance is the best reading of where the ground changes on
    // this column, and on finely interbedded ground it resolves the boundary
    // 3-4x finer than the driller's 0.5 m log grid did.  Offering those
    // boundaries as snap targets lets a contact drag land on the evidence
    // rather than near it.  ``packingSnapCandidates`` excludes borehole
    // columns (their bands were extrapolated from neighbouring CPTs, not
    // measured here) and each column's own top and base (where the cone
    // started and stopped, not a place the ground was observed to change).
    if (axisMode === "geotechnical" && geotechModel !== undefined) {
      for (const [cptId, packing] of packingSnapCandidates(
        geotechModel.geotechLayers,
      )) {
        const list = acc.get(cptId) ?? [];
        list.push(...packing);
        acc.set(cptId, list);
      }
    }
    for (const [k, v] of acc) out.set(k, v);
    return out;
  }, [snapToStratigraphy, boreholeDetails, contacts, axisMode, geotechModel]);

  // Which of the drawn geotech boundaries are LOCKED litho contacts, so the LINE can
  // say which kind it is (heavy solid vs thin dashed) rather than a mark beside the
  // column saying it for them. Built from the same two layer sets the band-edit overlay
  // is handed below, and from the same predicate, so the two can never disagree about
  // the same boundary.
  const restatingBoundaryIds = useMemo(
    () =>
      axisMode === "geotechnical" && geotechModel !== undefined
        ? restatingContactIds(geotechModel.geotechLayers, lithoLayers ?? [])
        : undefined,
    [axisMode, geotechModel, lithoLayers],
  );

  // Stop a live contact drag at the next boundary it crosses (design §4c — one drag
  // consumes one boundary). Evaluated on every frame, so the line shows the landing it
  // will actually commit to instead of trailing the cursor and jumping back.
  //
  // Which boundary may be LANDED on is the other half of the rule, and it is why the
  // restating set is passed in: a packing boundary may (that is the drag-merge), a
  // boundary restating a litho contact may not (it would delete the unit between the
  // two contacts). ``clampContactDrag`` holds both.
  const clampGeotechDragToBoundary = useMemo(() => {
    if (axisMode !== "geotechnical" || geotechModel === undefined)
      return undefined;
    const candidatesByColumn = packingSnapCandidates(
      geotechModel.geotechLayers,
    );
    const restating = restatingBoundaryIds ?? new Set<string>();
    return (
      contactId: string,
      rawDepthM: number,
    ): { depthM: number; atLimit: boolean; release: ContactDragRelease } => {
      // Keyed by the GEOTECH band, not the litho row: on this axis the drawn contact
      // IS a band's top, and the litho row it restates is resolved later, by depth.
      const dragged = geotechModel.geotechLayers.find(
        (l) => l.id === contactId,
      );
      const anchorId = dragged?.cpt_id ?? dragged?.borehole_id ?? null;
      const startDepthM = dragged?.depth_top_m;
      if (anchorId === null || startDepthM === undefined) {
        return { depthM: rawDepthM, atLimit: false, release: "move" as const };
      }
      const candidates = (candidatesByColumn.get(anchorId) ?? []).filter(
        (c) => c.contactId !== contactId,
      );
      return clampContactDrag(
        startDepthM,
        rawDepthM,
        candidates,
        restating,
        CONTACT_DRAG_MIN_THICKNESS_M,
      );
    };
  }, [axisMode, geotechModel, lithoLayers, restatingBoundaryIds]);

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
    const LABEL_MIN_SPACING_PX = 50;
    const cptCols = visibleColumns.filter((c) => c.kind === "cpt");
    const m = new Map<string, boolean>();
    for (const col of cptCols) {
      let minDist = Infinity;
      for (const other of cptCols) {
        if (other === col) continue;
        const d = Math.abs(col.nudgedX - other.nudgedX);
        if (d < minDist) minDist = d;
      }
      m.set(col.proj.item.id, minDist >= LABEL_MIN_SPACING_PX);
    }
    return m;
  }, [visibleColumns]);

  // Column-label level-of-detail. At dense column spacings the three-line
  // header stack collides into an unreadable mess. ``selectVisibleLabels``
  // decides per column whether to render the full header, a rotated id, or
  // nothing. Selected (focusedColumn) and hovered columns always get full.
  // Recomputes when the layout changes (zoom / pan / spacing) or when
  // hover/focus changes.
  const { labelModeById, calloutIds } = useMemo(() => {
    const lodInputs = visibleColumns.map((col) => ({
      id: col.proj.item.id,
      nudgedX: col.nudgedX,
      selected: focusedColumn !== null && col.proj.item.id === focusedColumn.id,
      hovered: col.proj.item.id === hoveredColumnId,
    }));
    const results = selectVisibleLabels(lodInputs);
    const modeMap = new Map<string, ColumnLabelMode>(
      results.map((r) => [r.id, r.mode]),
    );
    const callout = new Set<string>(
      results.filter((r) => r.callout).map((r) => r.id),
    );
    return { labelModeById: modeMap, calloutIds: callout };
  }, [visibleColumns, focusedColumn, hoveredColumnId]);

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
      .map((col) => ({ along: col.proj.along, effX: col.nudgedX }))
      .sort((a, b) => a.along - b.along);
  }, [visibleColumns]);

  // Feed the latest anchors to the wheel-zoom handler's ref (it is declared
  // above this memo, so it cannot close over ``warpAnchors`` directly).
  useEffect(() => {
    warpAnchorsRef.current = warpAnchors;
  }, [warpAnchors]);

  const warpedXToScreen = useCallback(
    (along: number): number =>
      warpedAlongToScreenX(along, warpAnchors, scaleH, xToScreen(along)),
    [warpAnchors, xToScreen, scaleH],
  );

  // The ACCEPTED litho layer + clicked depth under an open body context menu
  // (installer #21) — the target of the litho-axis "Edit composition…" /
  // "Split here" verbs. Litho axis only; null unless a single accepted layer
  // resolves under the right-click. Columns come from the projected
  // investigations; the vertical inverse (screenToLevel) gives the depth, and
  // the column is picked by warped screen-X so it follows column-spacing nudging.
  const clickedLithoLayer = useMemo(() => {
    if (
      bodyCtxMenu === null ||
      axisMode === "geotechnical" ||
      !onEditLithoComposition
    ) {
      return null;
    }
    // Half the rendered strip width per column — the "Split here" / "Edit
    // composition" verbs act on the accepted unit AT THE TEST, so
    // resolveLithoLayerAtClick refuses a click farther than this from the
    // column's screen-X (the gap fill between columns is not a column). Owner
    // ruling, installer #26 2026-09-08.
    const halfWidthById = new Map<string, number>(
      placedColumns.map((c) => [c.proj.item.id, c.width / 2]),
    );
    const columns = [
      ...projectedCpts.map((p) => ({
        investigationId: p.item.id,
        alongM: p.along,
        surfaceElevM: p.item.elevation_m,
        halfWidthPx: halfWidthById.get(p.item.id),
      })),
      ...projectedBoreholes.map((p) => ({
        investigationId: p.item.id,
        alongM: p.along,
        surfaceElevM: p.item.elevation_m,
        halfWidthPx: halfWidthById.get(p.item.id),
      })),
    ];
    return resolveLithoLayerAtClick({
      columns,
      layers: lithoLayers ?? [],
      svgX: bodyCtxMenu.svgX,
      svgY: bodyCtxMenu.svgY,
      alongToScreenX: warpedXToScreen,
      screenToLevelM: screenToLevel,
    });
  }, [
    bodyCtxMenu,
    axisMode,
    onEditLithoComposition,
    projectedCpts,
    projectedBoreholes,
    placedColumns,
    lithoLayers,
    warpedXToScreen,
    screenToLevel,
  ]);

  // Bed-override clip (owner ruling 2026-09-07 — the canal cut-out): where the
  // section crosses a bed polygon, the partition fill is clipped to the section's
  // ground+bed DEM line so nothing lithological is drawn above the dredged bed.
  // Built from the SAME demSamples the surface line draws (the bed is already
  // applied server-side) and the SAME warp/level transforms the fill uses, so the
  // cut lines up with the fill pixel-for-pixel. The pure builder returns null —
  // no clip, byte-identical render — when the section crosses no bed polygon;
  // suppressed in focus mode too (a single standalone column, same gate the DEM
  // line uses).
  const bedClipPathD = useMemo(() => {
    if (demSamples === null || focusedColumn !== null) return null;
    return buildBedClipPath({
      samples: demSamples,
      sectionStartX: section.start_x,
      sectionStartY: section.start_y,
      sectionEndX: section.end_x,
      sectionEndY: section.end_y,
      polygons: bedOverridePolygons ?? [],
      alongToScreenX: warpedXToScreen,
      levelToScreen,
      plotLeft: MARGIN.left,
      plotRight: MARGIN.left + plotWidth,
      plotTop: MARGIN.top,
      plotBottom: MARGIN.top + plotHeight,
    });
  }, [
    demSamples,
    focusedColumn,
    section.start_x,
    section.start_y,
    section.end_x,
    section.end_y,
    bedOverridePolygons,
    warpedXToScreen,
    levelToScreen,
    plotWidth,
    plotHeight,
  ]);
  // Stable per-section clip id so it never collides across mounted section SVGs.
  const bedClipId = `bed-clip-${section.id}`;
  const bedClipUrl = bedClipPathD !== null ? `url(#${bedClipId})` : undefined;

  // Warp-aware screen→along inverse for BodyExtentOverlay (dogfeed
  // 2026-05-31 follow-up).  Earlier version lived above ``warpAnchors``
  // and read ``warpAnchorsRef.current``, but React updates refs in a
  // ``useEffect`` AFTER the render that built them — so on the render
  // following a zoom, the inverse saw STALE anchors while the forward
  // (``warpedXToScreen``) closed over the NEW ones via useCallback
  // deps.  The lens wedge endpoints round-tripped through inconsistent
  // anchor sets and landed offset; a follow-up pan triggered a re-render
  // by which time the ref had caught up, so the wedge "snapped back".
  // Defining the inverse here lets it close over ``warpAnchors``
  // directly (via the useCallback deps), so forward + inverse always
  // see the same anchor state inside one render.
  const warpedScreenXToAlongCb = useCallback(
    (x: number): number => {
      const linear = (x - MARGIN.left) / scaleH + viewport.xMin;
      return warpedScreenXToAlong(x, warpAnchors, scaleH, linear);
    },
    [viewport.xMin, scaleH, warpAnchors],
  );

  // Section-wide qc full scale in MPa. Default 40 (DOV CPT-graph
  // convention); steps up to 60/80/100/150/200/+50 when any CPT in
  // the section shows ≥ 20 consecutive qc samples above the current
  // step — i.e. a real thick high-qc layer, not a transient spike.
  // Passed verbatim to every CptDataColumn so every column reads on
  // the same axis (DOV cross-comparison rule).
  const qcFullScaleMpa = useMemo(() => {
    if (cptPlots === null) return 40;
    const arr: { qc_mpa: ReadonlyArray<number | null | undefined> | null }[] =
      [];
    for (const plot of cptPlots.values()) arr.push({ qc_mpa: plot.qc_mpa });
    return pickQcFullScaleMpa(arr);
  }, [cptPlots]);

  // IDs of investigations that already have a data band rendered —
  // CPTs with loaded plot data + boreholes with loaded detail — and
  // a known elevation. For these the ColumnGlyph cap + body line is
  // redundant ("you can see where the test sits, that's the band"),
  // so we suppress the stick visual but keep the name + elevation
  // labels above the band as the identifier.
  const hideStickIds = useMemo(() => {
    const s = new Set<string>();
    if (cptPlots !== null) {
      for (const col of visibleColumns) {
        if (col.kind !== "cpt") continue;
        const item = col.proj.item;
        if (cptPlots.has(item.id) && item.elevation_m !== null) s.add(item.id);
      }
    }
    if (boreholeDetails !== null && enabledBhChannels > 0) {
      // Borehole stick only gets hidden when at least one
      // interpretation strip is actually showing. With zero channels
      // enabled BoreholeColumn renders nothing and the stick stays
      // as the column's only visual.
      for (const col of visibleColumns) {
        if (col.kind !== "borehole") continue;
        const item = col.proj.item;
        if (boreholeDetails.has(item.id) && item.elevation_m !== null)
          s.add(item.id);
      }
    }
    return s;
  }, [visibleColumns, cptPlots, boreholeDetails, enabledBhChannels]);

  // CM fix (dogfeed 2026-05-25): filter contacts passed to CorrelationEdgesOverlay
  // so correlate gesture rects are not drawn at depths covered by active PENDING
  // ghost layers. Old committed contacts from a prior suggest+accept cycle remain
  // in the DB (backend Phase 1 limitation in accept_litho_suggestions.py) and
  // produce clickable correlate zones even when the ghost has been re-merged into
  // a different shape. Only PENDING layers shadow contacts — accepted layers ARE
  // the committed contacts (correct DB state); rejected layers are dismissed.
  const correlateContacts = useMemo((): readonly FormationContactResponse[] => {
    if (!contactGestureState?.contactCorrelateMode || !contacts)
      return contacts ?? [];

    // Build combined investigation → ghost map (focused anchor + bulk anchors).
    type GhostEntry = {
      suggestions: readonly LithoLayerSuggestion[];
      accepted: ReadonlySet<number>;
      rejected: ReadonlySet<number>;
      edits: ReadonlyMap<
        number,
        { depth_top_m?: number; depth_base_m?: number }
      >;
    };
    const ghostMap = new Map<string, GhostEntry>();

    if (bulkLithoGhostState != null) {
      for (const [anchorId, ghost] of bulkLithoGhostState.anchorGhosts) {
        ghostMap.set(anchorId, {
          suggestions: ghost.suggestions,
          accepted: ghost.accepted,
          rejected: ghost.rejected,
          edits: ghost.edits,
        });
      }
    }
    if (lithoGhostState != null) {
      // Focused anchor overwrites the bulk entry so the most specific state wins.
      ghostMap.set(lithoGhostState.investigationId, {
        suggestions: lithoGhostState.suggestions,
        accepted: lithoGhostState.acceptedIndices,
        rejected: lithoGhostState.rejectedIndices,
        edits: lithoGhostState.edits ?? new Map(),
      });
    }
    if (ghostMap.size === 0) return contacts;

    return contacts.filter((c) => {
      const anchorId = c.cpt_id ?? c.borehole_id;
      if (!anchorId) return true;
      const ghost = ghostMap.get(anchorId);
      if (!ghost || ghost.suggestions.length === 0) return true;
      // Remove contacts whose depth_top_m falls inside any PENDING ghost layer.
      // Pending = not accepted and not rejected.
      const isShadowed = ghost.suggestions.some((s, idx) => {
        if (ghost.accepted.has(idx) || ghost.rejected.has(idx)) return false;
        const topM = ghost.edits.get(idx)?.depth_top_m ?? s.depth_top_m;
        const baseM = ghost.edits.get(idx)?.depth_base_m ?? s.depth_base_m;
        return c.depth_top_m >= topM && c.depth_top_m < baseM;
      });
      return !isShadowed;
    });
  }, [contacts, contactGestureState, lithoGhostState, bulkLithoGhostState]);

  // Debt #151 dogfeed refinement 2026-05-27 — per-anchor pending
  // ghost depth ranges fed into ContactsLayer so it can SPLIT the
  // accepted band around an inserted ghost.  Pending only (accepted
  // ghosts don't render anyway, rejected shouldn't carve).
  const pendingGhostRangesByAnchorId = useMemo(() => {
    const out = new Map<
      string,
      { depth_top_m: number; depth_base_m: number }[]
    >();
    const pushRanges = (
      anchorId: string,
      suggestions: readonly LithoLayerSuggestion[],
      accepted: ReadonlySet<number>,
      rejected: ReadonlySet<number>,
      edits: ReadonlyMap<
        number,
        { depth_top_m?: number; depth_base_m?: number }
      >,
    ) => {
      const ranges = suggestions
        .map((s, idx) => ({ s, idx }))
        .filter(({ idx }) => !accepted.has(idx) && !rejected.has(idx))
        .map(({ s, idx }) => ({
          depth_top_m: edits.get(idx)?.depth_top_m ?? s.depth_top_m,
          depth_base_m: edits.get(idx)?.depth_base_m ?? s.depth_base_m,
        }));
      if (ranges.length > 0) out.set(anchorId, ranges);
    };
    if (bulkLithoGhostState != null) {
      for (const [anchorId, ghost] of bulkLithoGhostState.anchorGhosts) {
        pushRanges(
          anchorId,
          ghost.suggestions,
          ghost.accepted,
          ghost.rejected,
          ghost.edits,
        );
      }
    }
    if (lithoGhostState != null) {
      pushRanges(
        lithoGhostState.investigationId,
        lithoGhostState.suggestions,
        lithoGhostState.acceptedIndices,
        lithoGhostState.rejectedIndices,
        lithoGhostState.edits ?? new Map(),
      );
    }
    return out;
  }, [lithoGhostState, bulkLithoGhostState]);

  // ---- 3-D model fill (litho + geotech axes) -------------------------

  // Build the ModelFillOverlay data from the prebuilt body solids.
  // The computation is intentionally kept out of SectionPanel's render JSX to
  // keep the god-component lean (debt #201); the mapping logic lives in the
  // pure buildModelFillMeshes helper.
  //
  // Why sectionFillAtSectionLine lives as a prop not a store read:
  //   SectionsCanvas already reads readLithoSegmenterPrefs(project.view_state)
  //   for every other pref (lithoSnapToleranceM, openExtentLengthM).  Following
  //   the same pattern avoids adding a shell dependency inside SectionPanel.
  // The solid meshes are zoom-INVARIANT (they depend only on the built solids +
  // formation colours), so memoise them once and reuse across the two fill modes.
  // WHY no axis test here: SectionsCanvas already resolves which model's solids
  // this axis shows (and withholds them entirely on the geological axis), and
  // ``formationColorById`` is already the ACTIVE axis's palette — NAD-class
  // colours on the geotech axis, lithology colours on the litho one. Repeating
  // the axis decision would be a second place for the two to disagree.
  const modelFillMeshes = useMemo<SolidMesh[]>(() => {
    if (!modelSolids || modelSolids.length === 0) return [];
    return buildModelFillMeshes(
      modelSolids,
      (fid) => formationColorById.get(fid) ?? "#a3a3a3",
    );
  }, [modelSolids, formationColorById]);

  // ZOOM-INVARIANT test positions for the zigzag (Mode A) fill: the projected
  // investigations (map x/y + along-section distance), ordered by along. Derived
  // from ``projectedCpts`` / ``projectedBoreholes`` — the SAME zoom-invariant
  // projections ``placedColumns`` maps over — so this memo (and the zigzag slice
  // keyed on it) never rebuilds on zoom/pan. Deliberately NOT derived from
  // ``placedColumns`` / ``visibleColumns``, which close over ``xToScreen`` and
  // rebuild on every viewport change (the d6691b323 slow-zoom regression class).
  const zigzagTests = useMemo<ZigzagTest[]>(() => {
    const tests: ZigzagTest[] = [
      ...projectedCpts.map((proj) => ({
        x: proj.item.location_x,
        y: proj.item.location_y,
        alongM: proj.along,
      })),
      ...projectedBoreholes.map((proj) => ({
        x: proj.item.location_x,
        y: proj.item.location_y,
        alongM: proj.along,
      })),
    ];
    // The zigzag threads test→test in along-section order.
    return tests.sort((a, b) => a.alongM - b.alongM);
  }, [projectedCpts, projectedBoreholes]);

  // The section model fill. PERF-CRITICAL: both branches slice every body mesh
  // AND run the jsts boolean resolver, so this MUST NOT depend on the viewport
  // transform. Keyed on the solids + (Mode B) the section line / (Mode A) the
  // zoom-invariant zigzag tests only — never ``visibleColumns`` / ``placedColumns``
  // (rebuilt on every zoom/pan via ``xToScreen``); lumping those in re-sliced
  // 871k triangles + re-ran jsts on every zoom (the "terribly slow zoom"
  // regression, d6691b323).
  //
  //   Mode B (sectionFillAtSectionLine true): plane-slice the STRAIGHT section
  //     line — the fill lands exactly on the 3-D fence builder's cut surface.
  //   Mode A (false): "run through columns" — a CONTINUOUS zigzag that threads
  //     borehole→borehole through the actual test positions, so the fill runs
  //     through every column with NO gaps between them.
  //
  // sliceSolidsAtPlaneRobust (not the raw slicer): a real section line at a
  // metre-scale voxel grid routinely coincides with mesh faces, and the raw
  // slicer drops plane-coincident edges → whole bodies vanish. resolveModelFillPolys
  // then clips the raw slices into a deterministic, non-overlapping partition:
  // the 3D bodies ARE mutually exclusive (verified — 0 volumetric overlap), but
  // sliceSolidsAtPlane emits an ENCLOSING body's hole-loop as a solid polygon, so
  // without the resolver a thin clay band paints behind broad sand and translucent
  // fills stack darker. Ownership is geometry-derived (thinner on top). The zigzag
  // legs occupy disjoint along-section ranges, so a single resolve over the whole
  // set is correct (no cross-segment overlap to introduce).
  const modelFillPolys = useMemo<SectionPoly[] | undefined>(() => {
    if (modelFillMeshes.length === 0) return undefined;
    if (sectionFillAtSectionLine) {
      const sectionLine: SectionPlaneLine = {
        ax: section.start_x,
        ay: section.start_y,
        bx: section.end_x,
        by: section.end_y,
      };
      return resolveModelFillPolys(
        sliceSolidsAtPlaneRobust(modelFillMeshes, sectionLine),
      );
    }
    if (zigzagTests.length < 2) return undefined;
    // Resolve PER LEG (passed into the zigzag) so the jsts "claimed" union stays
    // small per disjoint along-range — resolving the whole concatenated set grew
    // it to cover the section and froze the app ~18 s. Legs are disjoint, so this
    // yields equivalent output, ~1 s.
    return sliceSolidsAlongZigzag(
      modelFillMeshes,
      zigzagTests,
      resolveModelFillPolys,
    );
  }, [
    sectionFillAtSectionLine,
    modelFillMeshes,
    section.start_x,
    section.start_y,
    section.end_x,
    section.end_y,
    zigzagTests,
  ]);

  const modelFillData = useMemo<{ polys?: SectionPoly[] }>(
    () => ({ polys: modelFillPolys }),
    [modelFillPolys],
  );

  // Along-section positions of every placed investigation — the distance metric
  // for the model-fill confidence fade (fill far from any test reads faint).
  const modelFillColumnAlongMs = useMemo<number[]>(
    () => placedColumns.map((c) => c.proj.along),
    [placedColumns],
  );

  // ---- Render --------------------------------------------------------

  const datumShort = verticalDatumShort(zEpsg);
  const yAxisLabel = datumShort ? `Level (${datumShort})` : "Level (m)";

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
            ? (next) => void onPatch({ vertical_exaggeration: next })
            : undefined
        }
        onBufferCommit={
          onPatch
            ? (next) => void onPatch({ projection_buffer_m: next })
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
        style={{ cursor: isPanning ? "grabbing" : "grab" }}
      >
        {size && (
          <svg
            width={size.width}
            height={size.height}
            viewBox={`0 0 ${size.width} ${size.height}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={(e) => {
              handleMouseUp(e);
              setCursorLevelM(null);
            }}
            onContextMenu={(e) => {
              // Swallow the contextmenu that fires when the right
              // button is released at the end of a both-button pan.
              if (bothBtnPanRef.current) {
                e.preventDefault();
                bothBtnPanRef.current = false;
                return;
              }
              handleSvgContextMenu(e);
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
              {/* Bed-override clip (owner ruling 2026-09-07 — the canal cut-out):
                  the region the partition fill is kept within where the section
                  crosses a bed polygon. Absent — no clip — when it crosses none,
                  so the fill renders byte-identically. */}
              {bedClipPathD !== null && (
                <clipPath id={bedClipId} clipPathUnits="userSpaceOnUse">
                  <path d={bedClipPathD} />
                </clipPath>
              )}
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

            {/* Static plot backdrop — gridlines + axis ticks. Extracted
                to ``SectionGrid`` (debt #201 Move 4); render-only, no
                interaction state. The x-axis uses ``warpedXToScreen`` so
                gridlines track the packed test positions at low spacing. */}
            <SectionGrid
              xTicks={xTicks}
              levelTicks={levelTicks}
              warpedXToScreen={warpedXToScreen}
              levelToScreen={levelToScreen}
              plotWidth={plotWidth}
              plotHeight={plotHeight}
            />

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
              visibleColumns.map((col) => {
                if (col.kind !== "cpt") return null;
                const item = col.proj.item;
                const plot = cptPlots.get(item.id);
                if (!plot || item.elevation_m === null) return null;
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
                    // While a fill paints through the cards, the white track
                    // steps back to a veil — otherwise the same band reads
                    // brighter here than in the gap and the fill looks like it
                    // stops at the column edge. With the fill hidden the card
                    // keeps its original look (owner 2026-08-14: "the opacity
                    // of the columns is changed").
                    cardVeilOpacity={columnCardVeilOpacity(
                      axisMode,
                      fillSelection.showBands,
                    )}
                  />
                );
              })}

            {/* Borehole lithology strips — DOV lengteprofiel
                convention, patterned coloured rectangles per
                coded_lithology layer. Renders ONLY for boreholes
                whose detail finished loading AND that have a known
                elevation; bare cap-only columns render fine without
                a strip. Drawn before InvestigationColumns so the
                cap + name label overlays on top. */}
            {boreholeDetails !== null &&
              visibleColumns.map((col) => {
                if (col.kind !== "borehole") return null;
                const item = col.proj.item;
                const detail = boreholeDetails.get(item.id);
                if (!detail || item.elevation_m === null) return null;
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
                    onCommitDepth={
                      onCreateContact ? handlePickBorehole : undefined
                    }
                    snapToStratigraphy={snapToStratigraphy}
                    showHoverReadout={focusedColumn !== null}
                    onDoubleClickOpen={
                      onSelectBorehole
                        ? () => onSelectBorehole(item.id)
                        : undefined
                    }
                    // Same reason as the CPT card's veil: an opaque DOV log
                    // under a translucent interpretation band composites
                    // brighter than the gap. The log in full detail is the
                    // borelog panel's job; here it is reference.
                    logFillOpacity={boreholeLogFillOpacity(
                      axisMode,
                      fillSelection.showBands,
                    )}
                  />
                );
              })}

            {/* CPT contact-pick affordance. Renders an invisible
                hover-capture overlay over each CPT's data band; on
                mouse-move shows a ghost depth line + readout
                (qc / Rf / depth / mTAW), on click commits the depth
                via ``handlePickCpt`` which opens the formation
                picker. Skipped when no contact-create callback is
                wired (read-only test view). */}
            {cptPlots !== null &&
              (onCreateContact || focusedColumn !== null) &&
              visibleColumns.map((col) => {
                if (col.kind !== "cpt") return null;
                const item = col.proj.item;
                const plot = cptPlots.get(item.id);
                if (!plot || item.elevation_m === null) return null;
                // Re-derive the cap-clamped data extent the
                // CptDataColumn uses so the pick area matches the
                // band the user sees.
                const surfaceY = levelToScreen(item.elevation_m);
                const bottomDepth =
                  plot.depths_m.length > 0
                    ? plot.depths_m[plot.depths_m.length - 1]
                    : 0;
                const dataBottomY = levelToScreen(
                  item.elevation_m - bottomDepth,
                );
                const bgTopY = Math.max(
                  MARGIN.top,
                  Math.min(MARGIN.top + plotHeight, surfaceY),
                );
                const bgBottomY = Math.max(
                  MARGIN.top,
                  Math.min(MARGIN.top + plotHeight, dataBottomY),
                );
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
                );
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

            {/* Debt #266 — mark the columns whose packing bands were derived
                from a lithology that has since been edited. Drawn after the
                columns so the mark sits over the column head, and only on the
                geotech axis: on the litho axis the layers ARE the edit, so
                there is nothing downstream of them to be out of date. */}
            {axisMode === "geotechnical" && geotechModel !== undefined && (
              <StaleColumnMarkers
                columns={visibleColumns}
                staleColumnIds={geotechModel.staleColumnIds}
                plotTop={MARGIN.top}
              />
            )}

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
                predictionsByInvestigationId={
                  virtueleBoringPredictionsByInvestigationId
                }
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
              restatingContactIds={restatingBoundaryIds}
              clampDragToBoundary={clampGeotechDragToBoundary}
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
              // Geotech mirrors litho: no cross-column auto-join either.
              renderFormationSurfaces={
                axisMode !== "lithostratigraphic" && axisMode !== "geotechnical"
              }
              // Debt #142 follow-up — the post-accept hide of litho
              // suggestion ghosts removed the bold colour fill the user
              // previously read as "this band is a SAND / SILT / CLAY
              // unit".  Bump the band opacity on the litho axis so
              // lithology colours stand on their own against the
              // underlying CPT trace.  Geological axis keeps the
              // original 0.18 (light backdrop where bands would
              // otherwise compete with contact lines + labels).
              // Geotech mirrors litho (same contact/band rendering).
              // Owner dogfeed 2026-08-14 ("same transparency everywhere plz"):
              // on the interpretation axes this is the SAME number the
              // partition fill uses in the gaps, so a band crossing a column
              // edge does not change tone. The geological axis keeps its
              // lighter backdrop. See utils/sectionFillOpacity.ts.
              bandFillOpacity={columnStackFillOpacity(
                axisMode,
                fillSelection.showBands,
              )}
              // …and the colour follows the fill that is actually painted, so
              // the geotech axis's "Show litho fill" swap carries the columns
              // with it instead of leaving them NAD-coloured.
              columnBandDisplayAxis={
                fillSelection.showLithoFillInstead
                  ? "lithostratigraphic"
                  : axisMode
              }
              // Cross-column TIN-derived formationFillBands need a
              // built litho surface to produce geometry; on a typical
              // litho-axis CPT column with no surface the band cell is
              // empty.  perColumnBandsFromContacts paints a coloured
              // rect between adjacent committed contacts on every
              // column directly — independent of any TIN — so the
              // user always sees the lithology stack.
              // Geotech mirrors litho for the same reason.
              perColumnBandsFromContacts={
                axisMode === "lithostratigraphic" || axisMode === "geotechnical"
              }
              // Litho-fill view toggle (litho/geotech axis) — hides the
              // formationFillBands: litho/geotech axes OFF; geological axis ON.
              showFormationFill={axisMode === "geological"}
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
              //
              // The geotech axis is unclamped too, for the opposite reason
              // to the geological one: its contact drag may ONLY land on a
              // packing boundary the cone resistance resolved (owner ruling
              // 2026-08-08, ``geotechContactDrag``). The peers this clamp
              // measures against on that axis ARE those boundaries, so the
              // 10 cm floor holds the drag short of the only destinations it
              // has and the landing is lost.
              //
              // Not at every zoom, and the exact edge matters because it is
              // where the engineer works. The clamp runs BEFORE ``snapDepth``,
              // whose window is SNAP_TOLERANCE_PX = 8, so the 10 cm shortfall
              // is pulled back onto the boundary while 0.1 m stays under 8 px
              // — i.e. below ~80 px/m. It bites when zoomed past that (thin
              // interbeds, the case this feature exists for), and at ANY zoom
              // when the snap toggle is off, since then there is no candidate
              // set to snap back to and ``snap_to_stratigraphy`` defaults off.
              // Pinned as behaviour in ContactsLayer.geotechDragClamp.test.tsx
              // (DC1-DC4); the landing rule is the floor here instead.
              contactDragClampMinThicknessM={
                axisMode === "lithostratigraphic"
                  ? CONTACT_DRAG_MIN_THICKNESS_M
                  : undefined
              }
              // Debt #134-B — pre-release "↦ snap on release" hint in
              // the drag readout.  Only meaningful on the litho axis;
              // ContactsLayer also guards on ``referenceContacts``
              // being non-empty, so passing the tolerance unconditionally
              // on the litho axis is safe.  The caller (SectionsCanvas)
              // is expected to pass ``geoSnapToleranceM`` through.
              geoSnapToleranceM={
                axisMode === "lithostratigraphic"
                  ? geoSnapToleranceM
                  : undefined
              }
              // Debt #151 — right-click on empty litho column → "Add
              // new suggestion" routes through the existing picker
              // (useContactPicker's handlePickCpt / handlePickBorehole
              // sets pickContext, which opens the
              // LithoCompositionPickerDialog mounted below).  Litho
              // axis only — geological axis already has its own
              // create-contact flows via ContactPickBar / BoreholeColumn.
              onRequestAddLithoSuggestion={
                axisMode === "lithostratigraphic"
                  ? (kind, anchorId, depth_m, anchorName, elevationM) => {
                      if (kind === "cpt") {
                        handlePickCpt({
                          kind: "cpt",
                          cptId: anchorId,
                          cptName: anchorName,
                          depth_m,
                          elevationM,
                          snapped: false,
                        });
                      } else {
                        handlePickBorehole({
                          kind: "borehole",
                          boreholeId: anchorId,
                          boreholeName: anchorName,
                          depth_m,
                          elevationM,
                          snapped: false,
                        });
                      }
                    }
                  : undefined
              }
              // R1 (2026-08-27): the litho band menu's statistics jump. Litho
              // axis only — the geotech axis's jump lives on its own overlay,
              // and an unconditional handler here would swallow right-clicks
              // over packing bands (the documented #151 gate).
              onShowLithoUnitStatistics={
                axisMode === "lithostratigraphic"
                  ? onShowLithoUnitStatistics
                  : undefined
              }
              // Edit composition / Split here on the ACCEPTED litho unit's own
              // right-click menu (owner ruling 2026-09-07). Litho axis only — same
              // gate as the statistics jump, and the same handlers the body menu
              // uses, so the two menus stay in step. The band names its own layer,
              // so no resolveLithoLayerAtClick is needed here.
              onEditLithoComposition={
                axisMode === "lithostratigraphic"
                  ? onEditLithoComposition
                  : undefined
              }
              onSplitLithoLayer={
                axisMode === "lithostratigraphic"
                  ? onSplitLithoLayer
                  : undefined
              }
              // Name body… / Dissolve body on the accepted unit's own menu
              // (owner ruling 13, 2026-09-12: "add it to the column menu too").
              // Litho axis only, and the SAME handlers the fill's BodyContextMenu
              // below uses, so the two menus act on the body identically. The
              // menu closes itself, so these pass straight through.
              onNameBody={
                axisMode === "lithostratigraphic" ? onNameBody : undefined
              }
              onDissolveBody={
                axisMode === "lithostratigraphic" ? onDissolveBody : undefined
              }
              // ONE menu per right-click (owner dogfeed 2026-09-11). The litho
              // axis's bands + per-column capture rect cover the whole card, so
              // they — not the section's own catch-all — are what a right-click
              // on a test reaches. Handing the column verbs down is what keeps
              // "Focus this test" / "Open detail" / "Remove from this section"
              // reachable there instead of hiding behind a second right-click.
              // Litho axis only: the geotech + geological axes never open this
              // menu, and the ColumnContextMenu still answers them unchanged.
              columnMenuVerbs={
                axisMode === "lithostratigraphic"
                  ? lithoMenuColumnVerbs
                  : undefined
              }
              lithoBodyIdByLayerId={lithoBodyIdByLayerId}
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
              onBatchUpdateContacts={onBatchUpdateContacts}
              onBatchCreateContacts={onBatchCreateContacts}
              marquee={marquee}
              onSetMarquee={setMarquee}
              selectionResetSignal={selectionResetCounter}
              snapDepthsByAnchorId={snapDepthsByAnchorId}
              getCptValuesAtDepth={getCptValuesAtDepth}
              surfacesByFormationId={surfacesByFormationId}
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
              sectionLine={{
                startX: section.start_x,
                startY: section.start_y,
                endX: section.end_x,
                endY: section.end_y,
              }}
              alongMToScreenX={warpedXToScreen}
              onEditInGeologyStage={onEditInGeologyStage}
              // Owner directive 2026-06-05 (litho declutter): pass the axis
              // so ContactsLayer can gate per-contact amber dots on it.
              axisMode={axisMode}
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
                onExtendToNearest={lithoGhostState.onExtendToNearest}
                committedContactsForAnchor={
                  lithoGhostState.committedContactsForAnchor
                }
                contactIdsByAcceptedIdx={
                  lithoGhostState.contactIdsByAcceptedIdx
                }
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
                    onAccept={(idx) => {
                      void bulkLithoGhostState.onAccept(anchorId, idx);
                    }}
                    onReject={(idx) => {
                      bulkLithoGhostState.onReject(anchorId, idx);
                    }}
                    formations={formations}
                    edits={ghost.edits}
                    onEdit={(idx, edit) => {
                      bulkLithoGhostState.onEdit(anchorId, idx, edit);
                    }}
                    onCrossColumnPaste={bulkLithoGhostState.onCrossColumnPaste}
                    onInsertLayer={
                      bulkLithoGhostState.onInsertLayer !== undefined
                        ? (afterIdx, composition) => {
                            bulkLithoGhostState.onInsertLayer!(
                              anchorId,
                              afterIdx,
                              composition,
                            );
                          }
                        : undefined
                    }
                    onSplitLayer={
                      bulkLithoGhostState.onSplitLayer !== undefined
                        ? (idx) => {
                            bulkLithoGhostState.onSplitLayer!(anchorId, idx);
                          }
                        : undefined
                    }
                    onMergeLayers={
                      bulkLithoGhostState.onMergeLayers !== undefined
                        ? (upperIdx) => {
                            bulkLithoGhostState.onMergeLayers!(
                              anchorId,
                              upperIdx,
                            );
                          }
                        : undefined
                    }
                    onExtendToNearest={
                      bulkLithoGhostState.onExtendToNearest !== undefined
                        ? (idx) => {
                            return bulkLithoGhostState.onExtendToNearest!(
                              anchorId,
                              idx,
                            );
                          }
                        : undefined
                    }
                    cptPlotByAnchorId={cptPlots ?? undefined}
                  />
                ),
              )}

            {/* Partition fill — every point belongs to exactly one body, no
                overlaps + no gaps (owner directive 2026-06-05; the 2D section
                defines the 3D model). Renders the tiled partition + labels +
                open-end stubs when Fill bands is on.
                On the litho axis: bands coloured by lithology colour.
                On the geotech axis: the GEOTECH model's OWN partition (owner
                  ruling 2026-08-13) — the same engine over the geotech columns
                  and packing ties the 3-D build arm consumes, coloured by
                  geotechUnitColor (the engineer's pick, else the NAD class
                  colour); an unpicked formation with nad_class === null
                  renders in neutral grey. The litho envelopes draw on top and
                  unpacked litho regions keep their lithology colour, via
                  ``lithoFrame``.
                Geotech axis is view-only (no drag handles wired). */}
            {(axisMode === "lithostratigraphic" ||
              axisMode === "geotechnical") &&
              lenses !== undefined && (
                // Bed-override clip: the fill + its seam strokes are cut to the
                // ground+bed line where the section crosses a bed polygon; a no-op
                // group (clipPath undefined) when it crosses none.
                <g clipPath={bedClipUrl}>
                  <PartitionFillOverlay
                    // Layers and edges move TOGETHER (the edges reference layer
                    // ids): the litho model on the litho axis, the geotech model on
                    // the geotech axis — unless "Show litho fill" swaps it back.
                    lithoLayers={partitionLayerSource(
                      axisMode,
                      lithoLayers,
                      geotechModel?.geotechLayers,
                      fillSelection.showLithoFillInstead,
                    )}
                    contactEdges={partitionEdgeSource(
                      axisMode,
                      contactEdges,
                      geotechCorrelationEdges,
                      fillSelection.showLithoFillInstead,
                    )}
                    lithoFrame={geotechLithoFrame}
                    // The active axis's "Separate" rulings, as canonical pairs — the geotech
                    // hierarchical fill honours them as a cannot-link so a split shows its seam
                    // (debt #278 R5). Inert off the geotech axis (the litho paint path does not
                    // yet consume them — see PartitionFillOverlay).
                    separatedPairs={separatedPairs}
                    placedColumns={visibleColumns}
                    // The palette travels with the partition's model: NAD colours
                    // for the packing bands, lithology colours when "Show litho
                    // fill" swaps the litho model back in (``formationColorById``
                    // is keyed by GEOTECH formation id on this axis, so the litho
                    // regions would otherwise all paint the neutral fallback grey).
                    formationColorById={partitionColorSource(
                      axisMode,
                      formationColorById,
                      geotechModel?.lithoFormationColorById,
                      fillSelection.showLithoFillInstead,
                    )}
                    formationLabelById={formationLabelById}
                    showBands={showBands}
                    levelToScreen={levelToScreen}
                    plotTop={MARGIN.top}
                    plotBottom={MARGIN.top + plotHeight}
                    plotLeft={MARGIN.left}
                    plotRight={MARGIN.left + plotWidth}
                    // Stored hand-drawn nodes shape the fill ONLY while freedraw is
                    // enabled (owner ruling 2026-08-07): with the handles suppressed
                    // a stored shape would warp the geometry with no visible way to
                    // see or remove it. The voxel build gates on the same flag.
                    boundariesByBodyId={
                      FREEDRAW_EDIT_ENABLED
                        ? (lensBoundaries ?? EMPTY_LENS_BOUNDARIES)
                        : EMPTY_LENS_BOUNDARIES
                    }
                    alongToScreenX={warpedXToScreen}
                    screenXToAlong={warpedScreenXToAlongCb}
                    screenToLevel={screenToLevel}
                    onSaveBoundary={
                      FREEDRAW_EDIT_ENABLED ? onSaveLensShape : undefined
                    }
                    onCorrelateBoundary={
                      FREEDRAW_EDIT_ENABLED ? onCorrelateBoundary : undefined
                    }
                    axisMode={axisMode}
                    onJumpToConflictGap={handleConflictJump}
                    onConflictEdgeKeysChange={setConflictEdgeKeys}
                    openExtentLengthM={openExtentLengthM}
                    bodies={lenses}
                    onBodyContextMenu={
                      (onNameBody ?? onDissolveBody ?? onJoinBodies)
                        ? handleBodyContextMenu
                        : undefined
                    }
                    // Join arm (debt #278): the armed Join makes the fill regions
                    // left-clickable so the engineer picks the other body; the overlay
                    // resolves the target (reading ``classByLayerId`` for the
                    // cross-class guard) and reports the outcome up. (The Separate arm
                    // was removed in the body-verb simplification, owner 2026-09-01.)
                    joinArm={
                      pairArm !== null
                        ? {
                            bodyId: pairArm.bodyId,
                            anchorLayerId: pairArm.anchorLayerId,
                          }
                        : null
                    }
                    onJoinPick={onJoinBodies ? handleJoinPick : undefined}
                    classByLayerId={classByLayerId}
                    soilByLayerId={soilByLayerId}
                    bodiesLoaded={bodiesLoaded}
                    // In correlate mode, drop the partition fill's interactive
                    // handles so clicks reach the correlate gesture targets beneath
                    // (esp. the bottom-of-test handles at the floor) — dogfeed
                    // 2026-06-19: the floor add-strips intercepted bottom-marker clicks.
                    correlateMode={Boolean(
                      contactGestureState?.contactCorrelateMode,
                    )}
                    // S1: fade non-matching bodies when a sample dot is selected.
                    // Only meaningful on the geotech axis; harmless (null) on litho.
                    selectedBodyId={
                      axisMode === "geotechnical" ? selectedGeotechBodyId : null
                    }
                    // D2: spotlight the region carrying the hovered "Ontkoppelen"
                    // item's OTHER anchor, so two same-labelled un-join options are
                    // told apart. Geotech-only (where Join / un-join live); null off it.
                    highlightLayerId={
                      axisMode === "geotechnical" ? hoverUnjoinLayerId : null
                    }
                    // R2 (2026-08-27): right-click a geotech fill region between
                    // columns → "Unit statistics…". The overlay gates on its own
                    // viewOnly flag; passing unconditionally here would also arm
                    // the litho axis, whose regions belong to the body menu.
                    onShowGeotechUnitStatistics={
                      axisMode === "geotechnical"
                        ? onShowGeotechUnitStatistics
                        : undefined
                    }
                    // S7b (2026-08-27): "in the litho stage i should be able to
                    // click the litho fill too" — body-less litho regions jump as
                    // litho units. Litho axis ONLY: on the geotech axis the litho
                    // frame stays inert (S7a), which the axis gate here enforces
                    // alongside the overlay's own axis routing.
                    onShowLithoUnitStatistics={
                      axisMode === "lithostratigraphic"
                        ? onShowLithoUnitStatistics
                        : undefined
                    }
                  />
                </g>
              )}

            {/* Hand split / merge of packing sub-bands — geotech axis only, and the ONLY
                editing allowed there (owner spec 2026-08-01, docs/debt.md #227). Mounted
                above the partition fill so its hit targets receive the clicks, and
                suspended while correlate mode owns the canvas, exactly as the fill's own
                handles are. Renders nothing at all when the two handlers are absent, so
                the axis stays view-only wherever they are not wired. */}
            {axisMode === "geotechnical" && geotechModel !== undefined && (
              <GeotechBandEditOverlay
                geotechLayers={geotechModel.geotechLayers}
                lithoLayers={lithoLayers ?? []}
                placedColumns={visibleColumns}
                levelToScreen={levelToScreen}
                plotTop={MARGIN.top}
                plotBottom={MARGIN.top + plotHeight}
                onRequestSplit={onRequestGeotechSplitBand}
                onRequestMerge={onRequestGeotechMergeBands}
                onRequestMoveBoundary={onRequestGeotechMoveBoundary}
                onRequestAbsorbLens={onRequestGeotechAbsorbLens}
                onRequestSetClass={onRequestGeotechSetBandClass}
                nadClassByFormationId={geotechNadClassByFormationId}
                soilCodeByFormationId={geotechSoilCodeByFormationId}
                smallLensThicknessM={geotechSmallLensThicknessM}
                suspended={Boolean(contactGestureState?.contactCorrelateMode)}
                onShowUnitStatistics={onShowGeotechUnitStatistics}
                // Body Join / Ontkoppelen ON A COLUMN (owner "Both", 2026-09-01):
                // the armed Join's second click may land on a band, and the band
                // menu can START a Join or un-join a group. Same handlers as the
                // fill-region path — a column click is the exact equivalent.
                joinArm={
                  pairArm !== null
                    ? {
                        bodyId: pairArm.bodyId,
                        anchorLayerId: pairArm.anchorLayerId,
                      }
                    : null
                }
                onJoinPick={onJoinBodies ? handleJoinPick : undefined}
                bodyIdByLayerId={armBodyIdByLayerId}
                classByLayerId={classByLayerId}
                soilByLayerId={soilByLayerId}
                onArmJoinBody={
                  onJoinBodies
                    ? (bodyId, anchorLayerId, formationId) =>
                        handleArmJoin(
                          bodyId,
                          [anchorLayerId],
                          formationLabelById.get(formationId) || "this body",
                        )
                    : undefined
                }
                unjoinOptionsForBody={(bodyId) =>
                  buildDisjoinOptions(bodyId, unions, (fid) =>
                    fid ? formationLabelById.get(fid) : undefined,
                  )
                }
                onUnjoinBody={onDisjoinBody}
                // D2: same hover spotlight the body-wedge menu got, so the band
                // menu's "Ontkoppelen" items are disambiguated too (the reported bug
                // reaches this surface via the same unions list).
                onUnjoinHover={(opt) =>
                  setHoverUnjoinLayerId(opt?.otherLayerId ?? null)
                }
              />
            )}

            {/* Ghost packing bands over boreholes that have not been divided —
                geotech axis only.  "Subdivide all bodies" leaves every borehole
                column blank here (its borehole-mediated edges are deferred to
                "Divide boreholes"), so without these the engineer cannot see
                what packing a borehole would get until after pressing a verb
                that rebuilds them all (owner dogfeed 2026-08-04).

                Drawn from the server's dry run of the SAME planner the verb
                commits, so the ghosts are a promise the button keeps.  No
                gesture of its own — the only verb is the toolbar's — but the
                band rect IS hit-testable, because an SVG `<title>` under a
                `pointer-events:none` ancestor never shows and that tooltip is
                the channel naming the evidence behind each class.  So a click
                landing on a ghost is swallowed rather than reaching the fill
                beneath it; that is accepted, since a ghosted column is an
                undivided borehole with nothing to click underneath.  Mounted
                after the fill and before the sample dots.  A column with
                committed bands drops its ghosts inside the component. */}
            {axisMode === "geotechnical" &&
              geotechBoreholePreview !== undefined && (
                <GeotechBoreholePreviewGhosts
                  previewColumns={geotechBoreholePreview}
                  geotechLayers={geotechModel?.geotechLayers ?? []}
                  geotechLayersLoaded={geotechLayersLoaded}
                  placedColumns={visibleColumns}
                  levelToScreen={levelToScreen}
                  plotTop={MARGIN.top}
                  plotBottom={MARGIN.top + plotHeight}
                  onAcceptColumn={onDivideBoreholeFromPreview}
                />
              )}

            {/* Lab sample markers — litho AND geotech axes.  One capsule per
                sample spanning its own top/base depths on the borehole column;
                a sample the subdivision has not reached draws neutral.  The
                body-selection click stays geotech-only (``bodyClickEnabled``),
                so on litho the markers are read-only lab evidence.  Rendered
                above the partition fill so the markers are always clickable.
                Uses warpedXToScreen so they follow column spacing nudging. */}
            {(axisMode === "geotechnical" ||
              axisMode === "lithostratigraphic") &&
              showSampleMarkers && (
                <SampleGeotechOverlay
                  boreholePlacedColumns={visibleColumns.filter(
                    (
                      c,
                    ): c is (typeof visibleColumns)[number] & {
                      kind: "borehole";
                    } => c.kind === "borehole",
                  )}
                  boreholeDetails={boreholeDetails}
                  warpedXToScreen={warpedXToScreen}
                  levelToScreen={levelToScreen}
                  plotTop={MARGIN.top}
                  plotBottom={MARGIN.top + plotHeight}
                  bodyClickEnabled={axisMode === "geotechnical"}
                  // Always wired, with only the CARD gated on the toggle below.
                  // Withholding the handler while the preview is off would also
                  // withhold mouse-LEAVE, so the last hovered sample would still
                  // be in state and the card would pop back on the next P press
                  // with the cursor nowhere near it.
                  onSampleHover={setHoveredSample}
                />
              )}

            {/* 3-D model fill — renders the geometric body fill derived from the
                prebuilt solid meshes of THIS axis's own build (litho build on
                the litho axis, geotech build on the geotech axis; the
                geological axis has none), beneath interactive overlays
                (pointerEvents="none" on every element inside). BOTH
                modes now emit resolved ``polys`` (ModelFillOverlay Mode B path):
                Mode A (default): CONTINUOUS zigzag sliced borehole→borehole
                through the actual test positions (gap-free "run through columns").
                Mode B (sectionFillAtSectionLine): plane-sliced through the
                straight section line, matching the 3-D fence builder's cut
                surface. */}
            {showModelFill && modelFillData.polys != null && (
              <ModelFillOverlay
                polys={modelFillData.polys}
                // Confidence fade is a 3D-only concern (owner directive
                // 2026-06-17): the 2D model fill renders solid, never dimmed by
                // distance-to-investigation. Fading it washed low-confidence
                // spans out to ~0.14 opacity and read as missing fill.
                confidenceFade={false}
                columnAlongMs={modelFillColumnAlongMs}
                alongMToScreenX={warpedXToScreen}
                levelToScreen={levelToScreen}
                opacity={0.55}
                // S6 (owner 2026-08-27): the model fill offers the same
                // "Unit statistics…" right-click as the computed fill, on
                // BOTH axes with the axis's OWN scope kind — the solids here
                // are this axis's own build, so their formation ids already
                // live in the right model.
                onShowUnitStatistics={
                  axisMode === "geotechnical"
                    ? onShowGeotechUnitStatistics
                    : axisMode === "lithostratigraphic"
                      ? onShowLithoUnitStatistics
                      : undefined
                }
              />
            )}

            {/* P4 (dogfeed 2026-05-30) — second pass of CptDataColumn in
                ``overlayMode`` so the qc/Rf reference gridlines + value
                labels (2 / 10 MPa, 2 / 4 %) render ON TOP of the litho
                band fills. The first pass paints them behind the bands
                (correct for the track background); the overlay layer here
                picks them out separately and renders them last with stronger
                stroke + pointerEvents:none so the underlying drag surfaces
                stay clickable.
                Extended 2026-08-14: the qc + Rf CURVES ride along. Once the
                card's white backing dropped to a veil so the column would read
                at the same transparency as the gaps, a trace left in the first
                pass alone showed through the band only faintly — and the qc
                curve is what the engineer reads the column for. */}
            {cptPlots !== null &&
              visibleColumns.map((col) => {
                if (col.kind !== "cpt") return null;
                const item = col.proj.item;
                const plot = cptPlots.get(item.id);
                if (!plot || item.elevation_m === null) return null;
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
                );
              })}

            {/* PAINT ORDER (fix 2026-08-02): this overlay used to be mounted
                BEFORE the fill overlays, and SVG paints in document order with no
                z-index to appeal to — so PartitionFillOverlay's 0.62-opacity bands
                painted straight over it. The violet review-flag badge came out
                tinted to near-invisibility and the edge context menu (which lives
                inside this component) was occluded outright, which made "Confirm
                tie" undiscoverable on the geotech axis. It now sits above every
                fill, alongside BodyContextMenu below.

                POINTER PRECEDENCE — this move DOES change hit-testing outside
                correlate mode, and the new order is the intended one: where they
                overlap, the interaction layer wins over the fill's own gestures.
                Four surfaces in CorrelationEdgesOverlay re-enable pointer events
                unconditionally and now sit on top of PartitionFillOverlay's
                per-region path (which is interactive whenever correlate mode is
                OFF): the ``edge-hit-<id>`` polygon (a ~14 px band riding each
                approved seam between two columns), the ``edge-grab-a/b`` strokes
                on pending edges, ``EdgeReviewBadge``, and ``BodyChip``. So a
                right-click ON or within ~7 px of a seam opens the EDGE menu
                rather than the band's BodyContextMenu, and a right-click on a
                body chip opens the chip menu.

                That is the whole point of the finding: under the fill, the
                review badge and the edge menu were unreachable — "Confirm tie"
                could not be clicked at all — while the band right-click is
                available across the entire rest of the region. A gesture that
                yields on a 14 px seam is a trade; a gesture that cannot be
                performed anywhere is a bug. No fill gesture became fully
                unreachable: every region is far larger than the seam band it
                touches.

                OWNER'S EYES (no unit test settles it): whether losing the band
                right-click within ~7 px of a seam is acceptable in practice, and
                whether the violet badge reads legibly over a 0.62-opacity fill.
                Per CLAUDE.local.md the badges appear only after re-running
                Subdivide. */}
            {/* Correlation overlay: body chips, contact-level edges, and
                contact gesture hit-targets (#133 Phase 1 + #135; geotech
                Phase 1 2026-06-25).
                Mounted on the litho AND geotech axes; absent on the geological
                axis so the overlay never intercepts geological-axis
                interactions. On the geotech axis it draws the "Correlate
                packing" gesture surface + ribbons, fed the SEPARATE
                geotechCorrelationEdges list (the litho-framed contactEdges still
                drive the partition — never mix the two; commit 7329738b). Litho-
                only features (lens inspect, admixture propagation, crossing
                pinch-outs) are suppressed on the geotech axis.
                pointerEvents=none at the group level — the component
                enables pointer-events only for gesture rects when
                contactCorrelateMode is active. Kept mounted while correlate
                mode is on even if correlations are hidden — the overlay also
                hosts the correlate-gesture hit-targets, so unmounting it would
                silently break correlate clicks. */}
            {shouldMountCorrelationOverlay(
              axisMode,
              showCorrelations,
              contactGestureState?.contactCorrelateMode,
            ) && (
              <CorrelationEdgesOverlay
                contacts={correlateContacts}
                crossingPinchOuts={
                  axisMode === "geotechnical" ? [] : crossingPinchOuts
                }
                formations={formations}
                placedColumns={visibleColumns}
                levelToScreen={levelToScreen}
                plotTop={MARGIN.top}
                plotBottom={MARGIN.top + plotHeight}
                pulsingFormationIds={pulsingFormationIds}
                onInspectLensBody={
                  axisMode === "geotechnical" ? undefined : onInspectLensBody
                }
                onPropagateAdmixtures={
                  axisMode === "geotechnical"
                    ? undefined
                    : onPropagateAdmixtures
                }
                contactEdges={overlayEdgeSource(
                  axisMode,
                  contactEdges,
                  geotechCorrelationEdges,
                )}
                conflictEdgeKeys={conflictEdgeKeys}
                contactGestureState={contactGestureState}
                onUnapprovedDragStart={onUnapprovedDragStart}
                unapprovedEdgeDrag={unapprovedEdgeDrag}
                onRequestDeleteEdge={onRequestDeleteEdge}
                onRequestAcceptEdge={onRequestAcceptEdge}
                acceptEdgeLabel={acceptEdgeLabel}
                onRequestConfirmEdgeReview={onRequestConfirmEdgeReview}
                flashEdgeId={flashEdgeId}
              />
            )}

            {/* Axis labels. */}
            <text
              x={MARGIN.left + plotWidth / 2}
              y={MARGIN.top + plotHeight + 28}
              fontSize={11}
              fill="var(--section-axis-title)"
              textAnchor="middle"
            >
              {t("sections.axisLabel.alongM")}
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

            {/* Body context menu — portal="svg" renders inside the SVG
                via foreignObject.  Opened by right-clicking a body band
                in PartitionFillOverlay (onBodyContextMenu handler above). */}
            {bodyCtxMenu !== null && (
              <BodyContextMenu
                x={bodyCtxMenu.svgX}
                y={bodyCtxMenu.svgY}
                body={bodyCtxMenu.body}
                // The header reads the body's UNIFIED label (owner dogfeed
                // 2026-09-01): on the geotech axis "SILT · SF #0" (soil + packing
                // + ordinal — the same vocabulary the Parameters pane + scope
                // header use, so one body reads identically everywhere), else the
                // engineer's name; the litho axis keeps its formation-name label.
                displayLabel={
                  bodyCtxMenu.body.name?.trim() ||
                  (axisMode === "geotechnical"
                    ? (() => {
                        const nadClass = geotechNadClassByFormationId?.get(
                          bodyCtxMenu.body.formation_id,
                        );
                        return nadClass != null
                          ? geotechBodyAutoLabel(
                              nadClass,
                              bodyCtxMenu.body.body_ordinal,
                            )
                          : undefined;
                      })()
                    : undefined) ||
                  formationLabelById.get(bodyCtxMenu.body.formation_id) ||
                  undefined
                }
                onNameBody={(bodyId) => {
                  onNameBody?.(bodyId);
                  dismissBodyCtxMenu();
                }}
                // Accepted-layer verbs (installer #21) — offered only when a single
                // accepted litho layer resolved under the click (litho axis only).
                onEditComposition={
                  clickedLithoLayer && onEditLithoComposition
                    ? () => {
                        onEditLithoComposition(clickedLithoLayer.layerId);
                        dismissBodyCtxMenu();
                      }
                    : undefined
                }
                onSplitLayer={
                  clickedLithoLayer && onSplitLithoLayer
                    ? () => {
                        onSplitLithoLayer(
                          clickedLithoLayer.layerId,
                          clickedLithoLayer.depthM,
                        );
                        dismissBodyCtxMenu();
                      }
                    : undefined
                }
                // Dissolve is withheld (no item) where its handler is absent —
                // the geotech axis (Dissolve stays litho-only, R5).
                onDissolveBody={
                  onDissolveBody
                    ? (bodyId) => {
                        onDissolveBody(bodyId);
                        dismissBodyCtxMenu();
                      }
                    : undefined
                }
                // R1 (2026-08-27): the between-columns jump — the region carries
                // the body, the body names the formation. Routed to the ACTIVE
                // axis's stats handler (piece B): geotech on the geotech axis.
                onShowUnitStatistics={
                  bodyMenuUnitStats
                    ? (formationId, bodyId) => {
                        bodyMenuUnitStats(formationId, bodyId);
                        dismissBodyCtxMenu();
                      }
                    : undefined
                }
                // Voeg samen met… (Join, debt #278) ARMS the pick-the-other-body
                // gesture; the Ontkoppelen items lift a standing group. Both
                // offered only when wired (the no-affordance rule keeps Join
                // geotech-only). Separate / Rejoin were removed (owner 2026-09-01).
                onJoinBody={
                  onJoinBodies
                    ? (bodyId) => {
                        handleArmJoin(
                          bodyId,
                          bodyCtxMenu.layerIds,
                          bodyCtxMenu.body.name?.trim() ||
                            formationLabelById.get(
                              bodyCtxMenu.body.formation_id,
                            ) ||
                            "this body",
                        );
                        dismissBodyCtxMenu();
                      }
                    : undefined
                }
                unions={buildDisjoinOptions(
                  bodyCtxMenu.body.id,
                  unions,
                  (fid) => (fid ? formationLabelById.get(fid) : undefined),
                )}
                onDisjoinBody={
                  onDisjoinBody
                    ? (unionId) => {
                        onDisjoinBody(unionId);
                        dismissBodyCtxMenu();
                      }
                    : undefined
                }
                // D2: highlight the other body of the hovered un-join option — its
                // layer position is what disambiguates two same-labelled items.
                onUnjoinHover={(opt) =>
                  setHoverUnjoinLayerId(opt?.otherLayerId ?? null)
                }
                onClose={dismissBodyCtxMenu}
              />
            )}

            {/* Ctrl+F landing flash — a brief amber band over the found
                column so the eye lands with the camera. Looked up by id so
                it draws at the POST-pan position; pointer-events-none so it
                can never eat the next gesture. */}
            {findFlashId !== null &&
              (() => {
                const hit = visibleColumns.find(
                  (c) => c.proj.item.id === findFlashId,
                );
                if (!hit) return null;
                return (
                  <rect
                    data-testid="column-find-flash"
                    x={hit.nudgedX - 22}
                    y={MARGIN.top}
                    width={44}
                    height={plotHeight}
                    fill="rgb(245 158 11 / 0.28)"
                    className="animate-pulse"
                    pointerEvents="none"
                  />
                );
              })()}
            <GapRevealFlash
              investigationIds={gapFlashInvestigationIds}
              placedColumns={visibleColumns}
              plotTop={MARGIN.top}
              plotHeight={plotHeight}
            />
          </svg>
        )}
        {!size && (
          <div className="flex items-center justify-center h-full text-xs text-gray-400">
            {t("sections.sizingCanvas")}
          </div>
        )}
        {findOpen && (
          <ColumnFindBar
            columns={findEntries}
            onJump={handleFindJump}
            onClose={() => {
              setFindOpen(false);
              setFindFlashId(null);
            }}
          />
        )}
        {/* Join-arm hint (debt #278): while a Join is armed the fill regions
            become clickable, so a top-centre pill names the gesture and its Esc
            escape — mirrors the geotech band-edit "click to place, Esc to cancel"
            readout. pointer-events-none so it never eats the pick. (Separate was
            removed, owner 2026-09-01 — Join is the only arm.) */}
        {pairArm !== null && (
          <div
            data-testid="join-arm-hint"
            className="absolute top-2 left-1/2 -translate-x-1/2 rounded bg-slate-800/95 px-3 py-1 text-xs font-medium text-slate-100 shadow-lg ring-1 ring-sky-400/50 pointer-events-none select-none"
          >
            {t("sections.join.armHint", { label: pairArm.label })}
          </div>
        )}
        {/* Cursor elevation readout (dogfeed 2026-06-19): the mTAW height under
            the pointer, bottom-right, so the user can call out exact elevations.
            pointer-events-none so it never intercepts canvas gestures. */}
        {size && cursorLevelM !== null && (
          <div
            data-testid="cursor-elevation-readout"
            className="absolute bottom-2 right-2 rounded bg-slate-800/90 px-2 py-1 text-xs font-mono text-slate-100 pointer-events-none select-none"
          >
            {/* i18n-exempt: mTAW is a unit symbol (m TAW) — domain-canon carve-out */}
            {cursorLevelM.toFixed(2)} mTAW
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
              contextMenu.kind === "cpt"
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
                    void handleRemoveFromSection(
                      contextMenu.kind,
                      contextMenu.id,
                    );
                  }
                : undefined
            }
            onClearSubdivision={
              axisMode === "geotechnical" &&
              onRequestGeotechClearColumn !== undefined &&
              geotechModel !== undefined &&
              geotechModel.geotechLayers.some(
                (l) =>
                  l.cpt_id === contextMenu.id ||
                  l.borehole_id === contextMenu.id,
              )
                ? () =>
                    onRequestGeotechClearColumn(
                      contextMenu.id,
                      contextMenu.name,
                    )
                : undefined
            }
            onClose={dismissContextMenu}
          />
        )}

        {focusedColumn !== null && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-purple-600 text-white text-xs px-3 py-1.5 rounded-full shadow">
            <span>
              {t("sections.focusLabel", { name: focusedColumn.name })}
            </span>
            <button
              type="button"
              className="hover:text-purple-200"
              onClick={exitFocus}
              title={t("sections.exitFocusHint")}
              aria-label={t("sections.exitFocus")}
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
              title={t("sections.noFormationContacts")}
              hint={
                onAutoPopulateFromStratigraphy
                  ? t("sections.emptyContacts.hintSeed")
                  : t("sections.emptyContacts.hintDefine")
              }
            />
          </div>
        )}
        {/* Grain-size hover card.  Container-local coordinates match the SVG's
            because the viewBox is 1:1 with the pixel size.  pointer-events-none
            inside, so it never intercepts a canvas gesture. */}
        {psdPreviewOn && hoveredSample && size && (
          <SamplePsdPopover
            sample={hoveredSample.sample}
            boreholeName={hoveredSample.boreholeName}
            anchorX={hoveredSample.x}
            anchorY={hoveredSample.y}
            containerWidth={size.width}
            containerHeight={size.height}
            bodyClickable={hoveredSample.bodyClickable}
          />
        )}
        <CanvasHints
          axisMode={axisMode}
          correlateBlocked={
            contactGestureState?.contactCorrelateMode === true &&
            correlateContacts.length === 0
          }
          geotechNotReconciled={geotechNotReconciled}
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
        section.excluded_cpt_ids.length + section.excluded_borehole_ids.length >
          0 && (
          <div
            className="flex items-center justify-between px-3 py-1 text-[11px] text-gray-500 bg-gray-50 border-t border-gray-200"
            data-testid="section-hidden-footer"
          >
            <span>
              {t("sections.hiddenFooter.count", {
                n:
                  section.excluded_cpt_ids.length +
                  section.excluded_borehole_ids.length,
              })}
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
              title={t("sections.restoreHidden")}
            >
              {t("sections.hiddenFooter.restoreAll")}
            </button>
          </div>
        )}

      {/* Formation picker — branches on axisMode.
          - geological / geotechnical axis: FormationPickerDialog (unchanged).
          - lithostratigraphic axis: LithoCompositionPickerDialog (Phase-1.5).
          Opens whenever a child fires ``onCommitDepth``. */}
      {axisMode === "lithostratigraphic" ? (
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
            if (!pickContext) return null;
            const anchor = pickContext.anchorId;
            const onAnchor = (referenceContacts ?? [])
              .filter((c) => (c.borehole_id ?? c.cpt_id) === anchor)
              .slice()
              .sort((a, b) => a.depth_top_m - b.depth_top_m);
            if (onAnchor.length === 0) return null;
            let chosen: (typeof onAnchor)[number] | null = null;
            for (const c of onAnchor) {
              if (c.depth_top_m <= pickContext.depth_m) chosen = c;
              else break;
            }
            return chosen?.formation_id ?? null;
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
            if (!pickContext || !onLithoExistingUnitPick) return;
            await onLithoExistingUnitPick(
              pickContext.kind,
              pickContext.anchorId,
              pickContext.depth_m,
              formationId,
            );
            cancelPicker();
          }}
          onCreateLithoUnit={async (mainCode, admixtures) => {
            if (!pickContext || !onManualLithoUnitCreate) return null;
            return onManualLithoUnitCreate(
              mainCode,
              admixtures,
              pickContext.kind,
              pickContext.anchorId,
              pickContext.depth_m,
            );
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
          onCreateFormation={async (payload) => {
            if (!onCreateFormation) return null;
            return onCreateFormation(payload);
          }}
          onCancel={cancelPicker}
        />
      )}
    </div>
  );
}
