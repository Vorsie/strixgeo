/**
 * Prop contract for {@link SectionPanel}.
 *
 * Extracted verbatim from ``SectionPanel.tsx`` (debt #178 / #201 / #275,
 * KonMari slice SP-S1) so the 59-prop interface no longer bloats the
 * orchestrator file. Pure type module: no runtime code and no import of the
 * component itself. ``SectionPanel.tsx`` imports this back as ``Props``.
 */
import type { MutableRefObject } from "react";
import type {
  AdmixtureItem,
  BodyBoundaryNode,
  BodyRenderStyle,
  BodyUnionListItem,
  CrossSectionResponse,
  FormationContactBatchUpdateEntry,
  FormationContactResponse,
  GeologicalFormationCreatePayload,
  LithoContactCorrelationEdge,
  LithoLayerSuggestion,
} from "../api/client";
import type { ContactCopyPayload } from "./sections/ContactsLayer";
import type { ContactGestureState } from "./sections/CorrelationEdgesOverlay";
import type { JoinNotice } from "./sections/joinPick";
import type { BedClipPolygon } from "./sections/sectionBedClip";
import type { SectionColumnRevealFn } from "./sections/sectionColumnReveal";

export interface SectionPanelProps {
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
   * Split a BOREHOLE band at the right-click depth (owner #35). A borehole split
   * keeps the class, so it commits directly rather than arming a placement. Pure
   * pass-through to ``GeotechBandEditOverlay``'s ``onRequestSplitHere``. Absent →
   * borehole bands are not splittable.
   */
  onRequestGeotechSplitHere?: (bandId: string, depthM: number) => void;
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
  // (The panel's "Export DXF" header action was retired with the Export hub —
  // installer #35: every export lives on the Export stage. The prop was already
  // dead here; removed with its wiring in SectionsCanvas.)
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
    /** Installer #42: Shift-drag a ghost boundary from this column onto another
     *  test → give that test a ghost column with the same units. */
    onCopyGhostContactToColumn?: (params: {
      sourceInvestigationId: string;
      targetInvestigationId: string;
      targetKind: "cpt" | "borehole";
    }) => void;
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
    /** Installer #42: Shift-drag a ghost boundary from one bulk column onto
     *  another test → give that test a ghost column with the same units. */
    onCopyGhostContactToColumn?: (params: {
      sourceInvestigationId: string;
      targetInvestigationId: string;
      targetKind: "cpt" | "borehole";
    }) => void;
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
   * (reference) contact strip shows an "Edit in Stratigraphy stage" menu
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
   * Copy accepted litho boundaries onto another test (installer #35; multi-boundary
   * in installer #40). Fired by ContactsLayer on a Shift + cross-column drag of one
   * or more selected litho contacts; the handler creates the copied stack on an
   * empty target, or splits at each boundary + recomposes the units between on a
   * target with layers. Litho axis only — SectionPanel forwards it to ContactsLayer
   * only in that mode.
   */
  onCopyLithoContactToColumn?: (params: {
    sourceInvestigationId: string;
    contactDepthsM: number[];
    targetInvestigationId: string;
    targetKind: "cpt" | "borehole";
  }) => void;
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
