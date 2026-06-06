/**
 * Formation-contact overlay for the cross-section.
 *
 * Two render layers on top of each other:
 *
 *   1. **Per-column layer geometry.** For each anchor (CPT or
 *      borehole) we group its contacts by depth, then for each
 *      contact compute the layer it defines:
 *
 *         top    = contact.depth_top_m
 *         bottom = next-deeper contact's top at the same anchor,
 *                  OR the investigation's bottom depth (CPT
 *                  ``max_depth_m`` / borehole ``total_depth_m``),
 *                  OR fall through to plotBottom when neither is
 *                  known so the deepest layer still renders.
 *
 *      We render a HORIZONTAL line segment at the top across the
 *      column's visual band width and a FORMATION NAME label
 *      centred vertically inside the layer. Replaces the old
 *      "dot at each contact" affordance — engineers think in
 *      layer slabs, not in point picks.
 *
 *   2. **Cross-column surface polyline.** Same as before: one
 *      polyline per formation through the (column X, contact Y)
 *      vertices of every anchor that carries that formation,
 *      ordered left-to-right. This is the formation SURFACE — the
 *      thing a downstream Plaxis exporter actually wants to see —
 *      and is the value-add of the section view over isolated
 *      borelogs.
 *
 * Investigations without a contact for a given formation aren't
 * traversed by that formation's polyline (gap-filled by the line
 * connecting the surrounding columns).
 *
 * Deferred to later slices:
 *
 *   * Drag a layer top to change depth → PATCH contact.
 *   * Click on a layer to inspect / edit.
 *   * Different stroke per ``confidence`` (high / medium / low).
 *   * Cross-formation gap-filling rules (overlapping picks across
 *     boreholes that disagree).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { log } from '../../utils/log'

import type {
  BoreholeListItem,
  CptListItem,
  FormationContactBatchUpdateEntry,
  FormationContactResponse,
  FormationSurfaceResponse,
  GeologicalFormationResponse,
} from '../../api/client'
import { sliceTin, type SectionLine2D } from '../../utils/sliceTin'
import {
  computeTriangleConfidence,
  confidenceToAlphaMultiplier,
} from '../../utils/tinConfidence'
import { SNAP_TOLERANCE_PX } from './cptChannels'
import DeleteContactConfirmDialog from '../DeleteContactConfirmDialog'
import HoverReadoutCard from './HoverReadoutCard'
import ContactContextMenu from './ContactContextMenu'
import { buildFillBand, columnsBetween, type PlacedColumn } from './utils'
import { findGeoSnapCandidates } from '../../utils/lithoGeoSnap'
import {
  clamp,
  columnUnderCursor,
  computeSlabsAndPolylines,
  isTypingTarget,
  surfaceYForColumn,
  truncateToWidth,
  type LayerSlabData,
  type PolylineDataLine,
  type PolylineVertex,
  type PolylineVertexData,
  type RenderedLayer,
} from './contactsLayerGeometry'

interface Props {
  contacts: readonly FormationContactResponse[]
  /**
   * P1b (dogfeed 2026-05-30) — live depth override for cross-store
   * suggestion-drag preview. When set, the matching contact renders
   * at ``depthM`` instead of its committed ``depth_top_m``, so the
   * boundary follows the live pending-drag (in
   * ``LithoSuggestionGhostColumns``). Cleared by the parent on
   * mouseup; ContactsLayer then renders at the committed depth (which
   * the PATCH refetch has updated). Null when no override is active.
   */
  liveContactDepthOverride?: { contactId: string; depthM: number } | null
  formations: readonly GeologicalFormationResponse[]
  /** Every CPT and borehole placed on the section, in projection
   * order. The component looks up each contact's anchor by id to
   * pull screen X + surface elevation + visual band width. */
  placedColumns: readonly PlacedColumn[]
  /** Borehole IDs the active model excludes from contact rendering.
   * Mirrors ``GeologicalModel.excluded_borehole_ids`` — contacts
   * whose ``borehole_id`` is in this set get skipped at render
   * time. The DB rows persist; re-including the borehole brings the
   * polyline + per-column layers back without a refetch. */
  excludedBoreholeIds?: ReadonlySet<string>
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
  /** Fires on the drag's mouseup with the contact id and its new
   * depth_top_m. Caller PATCHes the contact and refreshes its local
   * contacts state. When absent the per-contact hit-strip stays
   * unmounted — the lines are non-interactive in read-only mode.
   *
   * ``snapped`` reports whether the final depth landed on a snap
   * candidate (only relevant on borehole anchors with stratigraphy
   * observations). Drives the contact's source / confidence
   * update — debt #22/#23. */
  onUpdateContactDepth?: (
    contactId: string,
    newDepthM: number,
    snapped: boolean,
  ) => Promise<void>
  /** Right-click → small context menu → confirm → delete the contact.
   * DB delete is irreversible per CLAUDE.md UX conventions; the native
   * confirm dialog is the user-facing safety rail. When absent the
   * contact's hit-strip falls back to its drag-only behaviour. */
  onDeleteContact?: (contactId: string) => Promise<void>
  /**
   * Right-click → "Unlink from geology" menu item — fires only when the
   * contact's ``parent_geo_contact_id`` is non-null.  Nulls the coupling
   * without moving / deleting either contact.  When absent the item is
   * hidden.
   */
  onUnlinkLithoFromGeo?: (contactId: string) => Promise<void>
  /**
   * Right-click → "Link to geology" menu item — fires only when the
   * contact's ``parent_geo_contact_id`` is null (i.e. the contact is NOT
   * yet coupled).  Establishes the coupling to the nearest geological
   * contact within snap tolerance.  When absent the item is hidden.
   */
  onLinkLithoToGeo?: (contactId: string) => Promise<void>
  /**
   * Right-click → "Extrapolate pinch-out…" menu item.
   *
   * Fires with the id, formation id, anchor kind, and anchor id of the
   * right-clicked contact so the caller can open the formation + direction
   * picker and call the backend's dry_run path.  When absent the menu item
   * is hidden.
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
  /** Open-end this litho layer toward ``side`` — claims an ``open`` body
   *  extent (the lens band runs to the section boundary), TIN-free. Replaces
   *  the retired "Extrapolate pinch-out…" contact gesture (its backend tool
   *  was removed in the body-with-extent refactor). ``formationId`` is the
   *  right-clicked contact's litho formation; ``investigationId`` its CPT /
   *  borehole anchor; ``contactId`` the right-clicked litho contact id (shares
   *  the UUID of the litho layer at its top boundary — the caller resolves the
   *  body via ``litho_layer.body_id``, disambiguating stacked same-formation
   *  instances). Absent → the item is hidden. */
  onOpenEndLayer?: (
    contactId: string,
    formationId: string,
    investigationId: string,
    side: 'left' | 'right',
  ) => void
  /** Fired when the user picks "Pinch out layer →/←" — claims a
   *  ``pinch_out_halfway`` body extent toward ``side`` (the body wedges out to
   *  the neighbouring column). When absent the items are hidden. */
  onPinchOutLayer?: (
    contactId: string,
    formationId: string,
    investigationId: string,
    side: 'left' | 'right',
  ) => void
  /** All-or-nothing batch UPDATE commit. Used for:
   *
   * * Same-column multi-drag (every selected contact's depth shifts
   *   by the primary's Δm).
   * * Cross-column drag WITH the Alt key held — the explicit MOVE
   *   (re-anchor) variant. Without Alt, cross-column drag goes
   *   through ``onBatchCreateContacts`` instead (COPY by default).
   *
   * When absent, cross-column drag is disabled and multi-selection
   * drag falls back to N individual depth-only commits via
   * ``onUpdateContactDepth``. */
  onBatchUpdateContacts?: (
    updates: readonly FormationContactBatchUpdateEntry[],
  ) => Promise<void>
  /** COPY commit. Fired when the user drags one or more contacts
   * across to a different column WITHOUT holding Alt. Each entry
   * gets POSTed as a new contact at the target anchor; the source
   * contacts stay where they were. Matches the "stamp my known-
   * good interpretation onto a thin nearby CPT" workflow that
   * dogfooding revealed as the dominant cross-column use case.
   * When absent, cross-column plain-drag falls back to the MOVE
   * (update) path so the feature degrades gracefully. */
  onBatchCreateContacts?: (
    creates: readonly ContactCopyPayload[],
  ) => Promise<void>
  /** Plot area X extents in SVG coords. Kept on the prop list for
   * historical reasons + test backward-compat. The marquee
   * background rect itself lives in SectionPanel now (paint-order
   * fix: it must render BEFORE the columns or it steals their
   * clicks) — these props are unused at runtime. */
  plotLeft?: number
  plotRight?: number
  /** Marquee (box-select) state — controlled from SectionPanel so
   * the background-capture rect can paint before the column glyphs
   * without inheriting their click events. ``null`` ⇒ no active
   * marquee. ContactsLayer renders the dashed preview rectangle
   * from this state and, on mouseup, walks its layer index for
   * hit-tests, then commits selections via ``onSetMarquee(null)``. */
  marquee?: MarqueeState | null
  onSetMarquee?: (next: MarqueeState | null) => void
  /** Reset signal — when this number increases, ContactsLayer
   * clears its selection. SectionPanel bumps it on a plain (no-
   * shift) click on the section background so the user can deselect
   * with one click. The integer value is opaque; only the change is
   * meaningful (see useEffect below). */
  selectionResetSignal?: number
  /** Snap-target depths per anchor id, used by the drag interaction
   * to mirror BoreholeColumn's snap-to-stratigraphy behaviour: when a
   * borehole anchor has candidates here, the dragged depth snaps to
   * the nearest one within ``SNAP_TOLERANCE_PX``. Empty map / absent
   * entry → free drag.
   *
   * Each candidate is ``{ depth, contactId? }`` so the snap fn can
   * exclude the dragged contact's own depth from its candidate set
   * (debt #136 self-snap suppression — otherwise small drags pull
   * back to the start and the user cannot budge the contact). Pure
   * stratigraphy depths leave ``contactId`` undefined. */
  snapDepthsByAnchorId?: ReadonlyMap<string, readonly SnapCandidate[]>
  /** Looks up qc + Rf at a given depth for a CPT anchor. Used to
   * decorate the drag readout with the same depth-series values
   * ContactPickBar surfaces on hover — engineers want to see what
   * the cone reported at the depth they're picking. Returning null
   * (or the values being null) drops the qc / Rf lines from the
   * readout but still shows depth + mTAW. */
  getCptValuesAtDepth?: (
    cptId: string,
    depthM: number,
  ) => { qc: number | null; rf: number | null } | null
  /** Cached TIN surfaces keyed by formation id. When a formation has
   * a surface with at least one triangle, the polyline render uses a
   * slice-of-TIN against the section line — off-line picks contribute
   * via their triangle, which the connect-the-dots fallback can't do.
   * Formations without a surface (or with empty triangles when their
   * picks are all collinear) keep the existing connect-the-dots
   * render — gives the user something to look at while the geology
   * is sparse. */
  surfacesByFormationId?: ReadonlyMap<string, FormationSurfaceResponse>
  /**
   * Reference formation vocabulary for the geological backdrop.
   *
   * On the lithostratigraphic axis, the caller may pass the parent
   * geological model's formations here so the backdrop polylines can
   * be coloured with the correct formation colour.  Uses the same
   * project-scoped formation rows — no refetch needed.  Stale-id-
   * tolerant: a formation absent from this list simply renders
   * nothing (the backdrop silently omits unknown ids).  When absent,
   * no backdrop is painted (geological axis: always absent).
   */
  referenceFormations?: readonly GeologicalFormationResponse[]
  /**
   * Cached TIN surfaces for the REFERENCE (geological) model.
   *
   * Keyed by formation id of the geological model.  When provided
   * together with ``referenceFormations``, the component slices each
   * surface against the section line and paints a subordinate
   * read-only backdrop BEFORE the active litho contacts so the
   * geological context is always visible underneath.
   *
   * Visual register is intentionally subordinate to the editable
   * litho layer:
   *   fresh surface  → strokeOpacity 0.25, no dash
   *   stale surface  → strokeOpacity 0.12, dash "8 4"
   *
   * ``pointerEvents="none"`` — the backdrop is never hit-tested and
   * never routed through seeded_formation_contact_ids (it is surface
   * geometry, not a contact — exempt from the explicit-content
   * invariant).  No writes, no .gmproj / bundle change, no migration.
   */
  referenceSurfacesByFormationId?: ReadonlyMap<string, FormationSurfaceResponse>
  /**
   * Snap-to-contact backdrop. Geological contacts forwarded so the
   * backdrop polyline draws a straight chord through the contact's
   * (anchor_x, contact_elevation) at every column with a pick, instead
   * of slicing the TIN. The TIN slice would render the formation
   * surface at the section line's (x, y), but investigations project
   * onto the section from offset positions — the slice's elevation at
   * the projected_x silently diverges from the actual contact depth.
   * This contact-anchored backdrop honours the user's intent
   * ("I placed this pick at this depth") perfectly.
   *
   * On litho axis these are the geological-model contacts (the strato
   * picks). When omitted, the TIN-slice backdrop above renders as
   * before — zero regression on the geological axis or pre-Sync state.
   */
  referenceContacts?: readonly FormationContactResponse[]
  /** Whether to draw the ACTIVE model's cross-column formation surfaces —
   *  the TIN-slice polylines (`formation-surface-*`) and the connect-the-dots
   *  fallback (`formation-polyline-*`).  Both group contacts BY FORMATION and
   *  auto-join every same-formation contact across columns, ignoring the
   *  explicit contact-correlation graph.  That is correct on the geological
   *  axis (formations are laterally continuous) but wrong on the litho axis,
   *  where cross-column connectivity is the user's explicit correlations, not
   *  an auto-join-by-lithology (#159-followup, owner dogfeed 2026-05-29 —
   *  confirmed via the dashed-inventory diagnostic: 13 spurious connect-the-
   *  dots lines on a litho section).  Defaults to true (geological axis
   *  unchanged); SectionPanel passes false on the litho axis. */
  renderFormationSurfaces?: boolean
  /** Render the active formation surface as a polyline through the
   *  on-section investigations' PLACED contacts (a chord through each
   *  pick) instead of slicing the cached TIN against the section line.
   *
   *  Why: investigations are projected onto the section from their
   *  perpendicular offset, but a TIN slice samples the surface AT the
   *  section line — so for an off-line investigation the slice elevation
   *  at the projected X diverges from the user's actual contact depth
   *  (≈1 m for a 17 m-off borehole on a dipping surface; dogfeed
   *  2026-05-29).  The user's placed boundaries are the single source of
   *  truth on the section, so the line must pass exactly through them.
   *
   *  Implementation: when true, ``slicedPolylines`` returns empty, which
   *  cascades correctly — the slice line is not drawn, the connect-the-
   *  dots skip-range is empty (so the contact polyline draws through
   *  every pick), and ``formationFillBands`` falls back to the anchor
   *  geometry while still reading staleness from ``surfacesByFormationId``
   *  (the faded-stale fill cue survives).  The contact polyline is
   *  restyled by surface state so a BUILT model still reads as solid,
   *  not as the dashed "unbuilt" fallback.  Defaults to false (legacy
   *  TIN-slice render); SectionPanel passes true for the active surface. */
  surfaceThroughPicks?: boolean
  /** Correlate mode is active (dogfeed 2026-05-29).  When true the depth-drag
   *  hit-strip is suppressed so it can't intercept or compete with the
   *  CorrelationEdgesOverlay's boundary-select clicks — in correlate mode the
   *  user is selecting boundaries, not editing depths.  Depth-drag is a
   *  normal-mode gesture. */
  correlateMode?: boolean
  /**
   * Axis mode the section panel is currently displaying (owner directive
   * 2026-06-05 litho-declutter).  Controls per-contact visual noise:
   *
   * - ``'geological'``        — full contact-marker set (default).
   * - ``'lithostratigraphic'`` — coupling-glyph circles are hidden unless
   *                             ``correlateMode`` is also true, because the
   *                             partition fill + freedraw handles are the
   *                             primary interaction surface on the litho axis
   *                             and the per-contact amber dots add visual
   *                             clutter without functional value outside the
   *                             correlate gesture.
   */
  axisMode?: 'geological' | 'lithostratigraphic'
  /** Opacity of the filled formation-fill bands between adjacent
   *  contact polylines.  Defaults to 0.18 — the right value on the
   *  geological axis where the bands sit on top of a clean canvas and
   *  too much saturation competes with the contact lines + labels.
   *  Callers on the litho axis pass a higher value (~0.55) because
   *  the post-#142 hide of accepted ghosts removed the bold colour
   *  fill the user previously read as "this is a SAND / SILT / CLAY
   *  unit" — the formation fill is now the only colour cue and needs
   *  to be visible against CPT traces. */
  bandFillOpacity?: number
  /** Render a coloured fill between adjacent committed contacts on
   *  EACH column (not the cross-column TIN slice).  Used on the
   *  litho axis where the TIN-based ``formationFillBands`` are
   *  typically absent (no built litho surface) and CPT columns
   *  would otherwise show no lithology colour between contacts
   *  (dogfeed 2026-05-27).  Each band's colour comes from the
   *  shallower contact's ``formation_id`` looked up in
   *  ``formations``.  Bands paint underneath every other section
   *  element (contact lines, traces, labels) so the user reads
   *  "colour fill = lithology, line = boundary". */
  perColumnBandsFromContacts?: boolean
  /** Pending-ghost depth ranges per anchor.  When a litho suggestion
   *  ghost is pending at a depth covered by an accepted band, the
   *  band's per-column rect is SPLIT around the ghost so the ghost
   *  is visible (and clickable on its own drag handles) instead of
   *  being obscured by the same-anchor accepted band below.  Owner
   *  directive 2026-05-27 dogfeed refinement: "you must split the
   *  accepted litho ofcourse and the entry point of the suggestion
   *  and ofcourse the new suggestion/acception contacts must be
   *  draggable". */
  pendingGhostRangesByAnchorId?: ReadonlyMap<
    string,
    readonly { depth_top_m: number; depth_base_m: number }[]
  >
  /** Minimum thickness (in metres) the drag will preserve from peer
   *  contacts on the same anchor.  When set, a contact drag clamps at
   *  ``next.depth_top_m - minThickness`` (below-bound) and
   *  ``prev.depth_top_m + minThickness`` (above-bound).  Hard floor —
   *  zero-thickness slivers become impossible, the user must
   *  right-click → Delete an adjacent contact first.  Owner directive
   *  2026-05-27 (debt #152), companion to the litho cross-merge
   *  disable.  Leave undefined on the geological axis (cross-merge
   *  there absorbs the dragger; clamping would prevent that working). */
  contactDragClampMinThicknessM?: number
  /** Litho ↔ geological snap tolerance (m) for the in-flight drag
   *  indicator (debt #134-B).  When a litho contact is being dragged
   *  AND the current depth lands within ±this distance of any
   *  ``referenceContacts`` entry on the same anchor, the drag readout
   *  gets a small "snap on release" badge so the user can predict
   *  the post-release prompt.  Leave undefined on the geological axis
   *  (and on the litho axis when ``referenceContacts`` are absent —
   *  no Sync-geology yet → no candidates to indicate). */
  geoSnapToleranceM?: number
  /** Right-click on empty column space on the litho axis (the
   *  ``perColumnBandsFromContacts`` capture rect's "Add" menu item)
   *  fires this callback.  Wires through to the existing
   *  ``LithoCompositionPickerDialog`` flow: caller opens the picker
   *  with the right anchor + initial depth so the user can pick the
   *  lithology + admixtures for a manual suggestion ghost.  Debt #151. */
  onRequestAddLithoSuggestion?: (
    anchorKind: 'cpt' | 'borehole',
    anchorId: string,
    depth_m: number,
    anchorName: string,
    elevationM: number,
  ) => void
  /** Contact ids to visually highlight with a transient ring +
   * pulse — driven by the crossings-banner click intent (debt #9).
   * Each matching contact in the per-column layer band gets an
   * additional amber ring rendered on top of its segment line so the
   * user can spot the offending pick without hunting. Undefined or
   * empty → no highlight. Parent (App.tsx) clears the set after a
   * short timer so the visual is transient. */
  focusedContactIds?: ReadonlySet<string>
  /**
   * Deep-link to the Geology stage from the litho section view.
   *
   * When wired (litho axis only), a right-click on any **reference**
   * (geological backdrop) contact hit-strip adds an "Edit in Geology
   * stage" context-menu item.  Clicking that item calls this callback
   * with the geological contact's id and formation id, which the caller
   * (SectionsCanvas) forwards to the coordinator's ``geoDeepLinkTarget``
   * so AppShell switches to the Geology stage on the right section.
   *
   * When absent (geological axis, or litho axis before the user has
   * synced the geological reference), no hit-strips are added to the
   * backdrop contacts and the menu item never appears.
   *
   * Parameters
   * ----------
   * contactId
   *     ID of the right-clicked geological contact.
   * formationId
   *     Formation the contact belongs to.
   */
  onEditInGeologyStage?: (contactId: string, formationId: string) => void
  /**
   * Per-project "show confidence fade" toggle (debt #94 follow-up).
   * When true (default), low-confidence segments render at the reduced
   * ``LOW_CONFIDENCE_ALPHA_MULTIPLIER``.  When false, the multiplier
   * is 1.0 — high/low are visually identical, the fade is disabled.
   */
  showConfidenceFade?: boolean
  /** Section-line endpoints in the project's horizontal CRS. The
   * slice projects each TIN vertex against this line, so its
   * coordinate frame must match the surface vertices' frame. Both
   * sides today use the project's default horizontal EPSG (Lambert72
   * / RDNew). When absent the slice render is skipped (graceful
   * degradation; falls back to connect-the-dots everywhere). */
  sectionLine?: SectionLine2D
  /** Maps an along-section distance in metres to screen X. The
   * SectionPanel-owned ``warpedXToScreen`` is the typical caller; a
   * raw ``xToScreen`` works too for tests. The slice's ``alongM`` is
   * in the same metric frame as ``PlacedColumn.proj.along``, so the
   * same transform applies. */
  alongMToScreenX?: (alongM: number) => number
}

interface DragContact {
  contactId: string
  /** Formation the contact belongs to. Carried so the COPY path
   * (cross-column plain drag) can POST new contacts with the
   * correct formation_id without re-querying the contacts list. */
  formationId: string
  anchorId: string
  anchorKind: 'cpt' | 'borehole'
  originalDepthM: number
  /** Source column's surfaceY in SVG coords — needed to derive Δm
   * from the cursor delta when this contact wasn't the explicitly
   * clicked one. */
  sourceSurfaceY: number
  sourcePxPerMetre: number
  color: string
  formationName: string
}

/** Payload shape for one new contact in a copy-drag commit. Mirrors
 * ``FormationContactCreatePayload`` minus the formation_id-required
 * field. Caller (App.tsx) translates to N parallel POSTs and patches
 * local contacts state with the returned rows. */
/** One candidate depth in the snap set for an anchor.  ``contactId``
 *  carries the originating contact id (when the candidate came from a
 *  committed contact rather than borehole stratigraphy) so the drag
 *  interaction can suppress self-snap by excluding the dragged
 *  contact's own row from its candidate list (debt #136). */
export interface SnapCandidate {
  depth: number
  contactId?: string
}

export interface ContactCopyPayload {
  formation_id: string
  depth_top_m: number
  borehole_id: string | null
  cpt_id: string | null
  source: 'borehole_observation' | 'manual_pick' | 'interpolated'
  confidence: 'high' | 'medium' | 'low'
}

interface DragState {
  /** The contact whose hit-strip received the mousedown. Drives the
   * floating readout + the "primary" cursor-anchor point for the
   * drag. Other selected contacts follow its Δm (and same target
   * column when cross-column). */
  contactId: string
  anchorId: string
  anchorKind: 'cpt' | 'borehole'
  surfaceElevationM: number
  pxPerMetre: number
  surfaceY: number
  startClientY: number
  startClientX: number
  startSegY: number
  /** SVG element's left edge in client coords, cached at drag start
   * so the per-frame mousemove handler doesn't re-walk DOM. Used to
   * map cursor clientX → SVG-coord X for column hit-testing. */
  svgLeft: number
  /** Latest drag-derived depth on the PRIMARY contact (the one
   * grabbed by the mousedown). When ``currentTargetCol`` is non-null
   * the depth is computed against that column's surface; otherwise
   * against the source column's surface. */
  currentDepthM: number
  /** Whether the latest currentDepthM came from a snap candidate.
   * Drives the contact's source / confidence on commit
   * (debt #22/#23). */
  currentSnapped: boolean
  /** Latest cursor X/Y in client coords — drives the position of the
   *  clamp popup (debt #152).  Mid-drag mousemove updates these. */
  currentClientX: number
  currentClientY: number
  /** Direction the clamp is engaging (``'up'`` when the cursor wants
   *  to go shallower than the above-neighbour bound, ``'down'`` for
   *  the deeper-than-below-neighbour case).  ``null`` when the drag
   *  is within bounds.  Drives the popup. */
  currentClamped: 'up' | 'down' | null
  /** Target column when the cursor has crossed unambiguously into
   * another column's attraction band. ``null`` ⇒ stay on source.
   * Drives both the cross-column commit + the live preview render. */
  currentTargetCol: PlacedColumn | null
  /** Every contact carried by this drag (always includes the
   * primary; size>1 only when the user grabbed a contact that was
   * part of an existing multi-selection). Each non-primary contact
   * follows the primary's Δm and target-column choice on commit. */
  contactsInDrag: readonly DragContact[]
  /** Shift modifier captured at mousedown. Two interpretations:
   * (a) no mouse movement before mouseup → user actually meant
   *     shift+click → fire the deferred range-select on the source
   *     contact; (b) drag traversed multiple columns → paint-through:
   *     duplicate the source contact's depth onto every intermediate
   *     column from source to drop. */
  shiftHeld: boolean
  /** Cached display info for the primary contact's floating
   * readout — unchanged across the drag. */
  color: string
  formationName: string
  segLeftX: number
  segRightX: number
  labelX: number
  plotTop: number
  plotBottom: number
}

/** Marquee (box-select) state. clientX/Y captured at start; current
 * follows the mouse. Render derives the SVG-coord rect from these
 * plus the cached svgLeft / plotTop offset. ``additive`` is true
 * when the user held Shift / Ctrl on the initial mousedown — the
 * existing selection is preserved and the marquee adds to it.
 *
 * Exported so SectionPanel can own the state (the background-
 * capture rect must paint before the column glyphs for SVG hit-test
 * order, which means it lives in SectionPanel, not here). */
export interface MarqueeState {
  startClientX: number
  startClientY: number
  currentClientX: number
  currentClientY: number
  svgLeft: number
  svgTop: number
  additive: boolean
}

// Below this height (px) the layer is too small for a middle label
// to read — skip rendering the text but still draw the top segment.
const LAYER_LABEL_MIN_HEIGHT_PX = 14
// Vertical hit-strip half-height (px) around each top segment — wide
// enough that the line is grabbable without precision aiming, narrow
// enough that adjacent layers don't fight for the same pointer.
const DRAG_HIT_HALF_HEIGHT_PX = 5
// Depth window (m) within which a geological reference contact is treated as
// COINCIDENT with a litho contact on the same anchor (#159).  The litho-geo
// snap dialog ("Snap litho" / "Move geo") leaves the two boundaries at the
// SAME depth without setting ``parent_geo_contact_id`` — so they are
// coincident but not coupled.  When that happens the reference hit-strip is
// suppressed (same as the coupled case) so it can't sit on top of the litho
// drag-strip and eat its hover + mousedown.  Tight (1 cm) so it targets the
// snap-produced exact coincidence only, never a legitimately-distinct geo
// boundary that merely sits near a litho one.
const REFERENCE_COINCIDENCE_EPSILON_M = 0.01
// Litho contact boundary line colour (#143). A litho band is filled with
// its lithology colour; drawing the boundary in that same colour made the
// accepted contact vanish into the band. Near-black reads against every
// lithology pastel. SVG hex literal — NOT a Tailwind token (this file
// renders SVG attributes directly).
const LITHO_CONTACT_LINE_COLOR = '#0f172a'
// Light halo painted behind the litho contact line so it also reads on the
// dark bands (KLEI blue-grey #6b7280, VEEN dark brown #92400e) where the
// near-black line alone would muddy. Slightly wider than the line.
const LITHO_CONTACT_HALO_COLOR = '#f8fafc'
// Below this drag distance the marquee / drag is treated as a click —
// no commit, no state change. Mirrors the existing "zero-delta release"
// no-op rule on the depth-only drag.
const CLICK_TO_DRAG_THRESHOLD_PX = 3

// ---------------------------------------------------------------------------
// computeSlabsAndPolylines re-exported from contactsLayerGeometry.ts so
// callers that import from './ContactsLayer' continue to work unchanged.
// The implementation now lives in contactsLayerGeometry.ts.
// ---------------------------------------------------------------------------
export { computeSlabsAndPolylines }

export default function ContactsLayer({
  contacts: rawContacts,
  liveContactDepthOverride,
  formations,
  placedColumns,
  excludedBoreholeIds,
  levelToScreen,
  plotTop,
  plotBottom,
  onUpdateContactDepth,
  onDeleteContact,
  onUnlinkLithoFromGeo,
  onLinkLithoToGeo,
  onOpenEndLayer,
  onPinchOutLayer,
  onBatchUpdateContacts,
  onBatchCreateContacts,
  marquee,
  onSetMarquee,
  selectionResetSignal,
  snapDepthsByAnchorId,
  getCptValuesAtDepth,
  surfacesByFormationId,
  referenceFormations,
  referenceSurfacesByFormationId,
  referenceContacts,
  renderFormationSurfaces = true,
  surfaceThroughPicks = false,
  correlateMode = false,
  axisMode = 'geological',
  bandFillOpacity = 0.18,
  perColumnBandsFromContacts = false,
  pendingGhostRangesByAnchorId,
  contactDragClampMinThicknessM,
  geoSnapToleranceM,
  onRequestAddLithoSuggestion,
  sectionLine,
  alongMToScreenX,
  plotLeft,
  plotRight,
  focusedContactIds,
  showConfidenceFade = true,
  onEditInGeologyStage,
}: Props): JSX.Element | null {
  // P1b — apply the live cross-store-drag preview override to the
  // contacts list before anything else reads them. When a sibling
  // ``LithoSuggestionGhostColumns`` is dragging a pending edge across
  // an accepted neighbour, ``liveContactDepthOverride`` carries the
  // committed contact's id + the live cursor depth; we swap that
  // contact's ``depth_top_m`` in-place so every downstream read
  // (line segments, drag strips, fill bands) renders at the live
  // depth. Cleared by the parent on mouseup; the next render picks
  // up the PATCH'd contact at the new persisted depth.
  const contacts = useMemo(() => {
    if (!liveContactDepthOverride) return rawContacts
    const { contactId, depthM } = liveContactDepthOverride
    let touched = false
    const out = rawContacts.map(c => {
      if (c.id !== contactId) return c
      touched = true
      return { ...c, depth_top_m: depthM }
    })
    return touched ? out : rawContacts
  }, [rawContacts, liveContactDepthOverride])

  // ---- Contact context-menu state --------------------------------
  // Small two-item menu triggered by right-click on a contact
  // hit-strip.  Replaces the naked window.confirm approach so both
  // "Delete" and "Extrapolate pinch-out…" can live in the same menu.
  // Rendered via a portal to document.body with position:fixed using
  // the event's clientX/Y — avoids nesting a <div> inside the SVG.
  const [contactMenu, setContactMenu] = useState<{
    /** Viewport-fixed X (clientX from the right-click event). */
    clientX: number
    /** Viewport-fixed Y (clientY from the right-click event). */
    clientY: number
    contactId: string
    formationId: string
    formationName: string
    anchorKind: 'cpt' | 'borehole'
    anchorId: string
    /** True when the right-clicked contact is a REFERENCE (geological
     * backdrop) contact on the litho axis.  Gates which menu items
     * appear: reference contacts show only "Edit in Geology stage"
     * and suppress Delete / Pinch-out (those actions belong on the
     * geological axis, not the litho view). */
    isReferenceContact?: boolean
    /** Geological contact id for the parent geological formation of this
     * litho contact.  Present when the right-clicked litho contact's
     * formation has a ``parent_formation_id`` AND a matching geological
     * contact exists at the same anchor in ``referenceContacts``.  Used
     * to offer "Edit in Geology stage" on the litho axis even for
     * non-topmost formation boundaries (which don't have a dedicated
     * reference hit-strip because they are litho-litho boundaries, not
     * geological boundaries — see Bug 1 dogfeed 2026-05-26). */
    parentGeoContactId?: string | null
    /** True when the contact carries a ``parent_geo_contact_id`` — i.e. it is
     * directly coupled to a geological contact via the litho↔geo coupling
     * (#162).  Gates the "Unlink from geology" menu item. */
    isCoupledToGeo?: boolean
  } | null>(null)

  // Pending-delete confirmation state (debt #62 item 1). Set when the
  // user picks "Delete contact" from the context menu; the dialog
  // renders while non-null. Replaces the prior naked window.confirm
  // which couldn't default-focus Cancel or name its action button.
  const [deletePending, setDeletePending] = useState<{
    contactId: string
    formationName: string
  } | null>(null)

  // Debt #151 — litho-axis right-click menu.  Two modes share one
  // surface: ``remove`` (right-click on an accepted band) carries the
  // band's contact id; ``add`` (right-click on empty column space —
  // the fallback when the user deleted enough units that no band
  // remains, owner directive 2026-05-27 dogfeed refinement) carries
  // the click depth + anchor info.  Insert is ALSO available via
  // left-click on a band (separate gesture, no menu).
  const [lithoBandMenu, setLithoBandMenu] = useState<
    | {
        clientX: number
        clientY: number
        mode: 'remove'
        contactId: string
        formationName: string
      }
    | {
        clientX: number
        clientY: number
        mode: 'add'
        anchorKind: 'cpt' | 'borehole'
        anchorId: string
        anchorName: string
        elevationM: number
        depth_m: number
      }
    | null
  >(null)

  // Debt #151 dogfeed refinement 2026-05-27 — merge popup.  After a
  // delete removes a contact between two same-lithology neighbours,
  // a follow-up confirm offers to also delete the deeper-neighbour
  // (collapsing the now-redundant boundary into one continuous
  // same-lithology band).  Pre-computed at delete time from the
  // PRE-deletion contact snapshot — the deferred onDeleteContact
  // call may not have rewritten state yet when the popup opens.
  const [lithoMergePending, setLithoMergePending] = useState<{
    redundantContactId: string
    lithoCode: string
  } | null>(null)

  // Debt #151 dogfeed refinement 2026-05-27 — auto-dismiss the
  // litho band/empty-space context menu on any wheel-zoom or Esc.
  // Without this the menu's ``position: fixed`` keeps it pinned to
  // its original screen coords while the user scrolls/zooms; the
  // menu detaches from the underlying section content and reads as
  // a "random" floating menu (owner: "sometimes i get this random
  // add new suggestion here box when zooming or so").
  useEffect(() => {
    if (lithoBandMenu === null) return
    const dismiss = (): void => setLithoBandMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismiss()
    }
    document.addEventListener('wheel', dismiss, { capture: true })
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('wheel', dismiss, { capture: true })
      document.removeEventListener('keydown', onKey)
    }
  }, [lithoBandMenu])

  // ---- Selection model -------------------------------------------
  // Component-local — selection is transient UI state, not a
  // persisted decision. Resets on section close / unmount.
  const [selection, setSelection] = useState<ReadonlySet<string>>(
    new Set<string>(),
  )
  // Last contact that received a non-modified click — anchor for
  // Shift-range selection within the same column.
  const [lastSelectionContactId, setLastSelectionContactId] = useState<
    string | null
  >(null)
  // setMarquee shim — calls the controlled prop when wired, no-ops
  // otherwise so callers that don't wire box-select stay safe.
  const setMarquee = useCallback(
    (next: MarqueeState | null): void => {
      onSetMarquee?.(next)
    },
    [onSetMarquee],
  )
  // Selection reset signal — SectionPanel bumps the integer to ask
  // ContactsLayer to clear its current selection (e.g. on a plain-
  // click on the section background). The integer's value is
  // opaque; only the change matters. ``undefined`` (caller not
  // wired) → no resets ever fire.
  useEffect(() => {
    if (selectionResetSignal === undefined) return
    setSelection(new Set())
    setLastSelectionContactId(null)
  }, [selectionResetSignal])
  // Stage A — data-classification pass. Delegated to the module-level
  // ``computeSlabsAndPolylines`` pure function so it is unit-testable
  // without mounting the component. Crucially excludes
  // ``levelToScreen`` / ``plotTop`` / ``plotBottom`` from the deps so
  // vertical pan / zoom keeps this memo cached. Debt #29.
  const { slabs, polylineData } = useMemo(
    () =>
      computeSlabsAndPolylines(
        contacts,
        formations,
        placedColumns,
        excludedBoreholeIds,
        sectionLine,
        alongMToScreenX,
      ),
    [contacts, formations, placedColumns, excludedBoreholeIds, sectionLine, alongMToScreenX],
  )

  // Stage B — cheap screen-space projection. O(N) per render with no
  // allocation beyond the output arrays; runs on every pan / zoom but
  // does no data classification work. Memoised on the vertical-axis
  // inputs so React's reconciliation skips it when the data pass
  // produced the same slabs and the viewport hasn't changed.
  const { layers, polylines } = useMemo(() => {
    const layersOut: RenderedLayer[] = []
    for (const slab of slabs) {
      const topLevel = slab.surfaceElevationM - slab.topDepthM
      const segY = levelToScreen(topLevel)
      const bodyTopY = clamp(segY, plotTop, plotBottom)
      const bodyBottomY =
        slab.bottomDepthM === null
          ? plotBottom
          : clamp(
              levelToScreen(slab.surfaceElevationM - slab.bottomDepthM),
              plotTop,
              plotBottom,
            )
      if (bodyBottomY < bodyTopY) continue
      // px-per-metre derived from levelToScreen — deeper points map
      // to larger Y in the flipped section transform. Needed both at
      // render time (to draw the segment after a drag override) and
      // in the drag move handler.
      const surfaceY = levelToScreen(slab.surfaceElevationM)
      const pxPerMetre =
        levelToScreen(slab.surfaceElevationM - 1) - surfaceY
      layersOut.push({
        key: `${slab.anchorId}-${slab.contactId}`,
        contactId: slab.contactId,
        anchorId: slab.anchorId,
        anchorKind: slab.anchorKind,
        formationId: slab.formationId,
        formationName: slab.formationName,
        color: slab.color,
        segLeftX: slab.segLeftX,
        segRightX: slab.segRightX,
        segY,
        bodyTopY,
        bodyBottomY,
        labelX: slab.labelX,
        surfaceElevationM: slab.surfaceElevationM,
        pxPerMetre,
        surfaceY,
        originalDepthM: slab.topDepthM,
      })
    }

    const polylinesOut: {
      formationId: string
      color: string
      name: string
      vertices: PolylineVertex[]
    }[] = []
    for (const line of polylineData) {
      const projected: PolylineVertex[] = []
      for (const v of line.vertices) {
        const screenY = levelToScreen(v.surfaceElevationM - v.topDepthM)
        if (screenY < plotTop || screenY > plotBottom) continue
        projected.push({
          contactId: v.contactId,
          screenX: v.screenX,
          screenY,
          sortKey: v.sortKey,
        })
      }
      if (projected.length === 0) continue
      polylinesOut.push({
        formationId: line.formationId,
        color: line.color,
        name: line.name,
        vertices: projected,
      })
    }

    return { layers: layersOut, polylines: polylinesOut }
  }, [slabs, polylineData, levelToScreen, plotTop, plotBottom])

  // Slice-of-TIN polylines. One per formation that (a) has a cached
  // surface with triangles and (b) the caller has wired both
  // ``sectionLine`` and ``alongMToScreenX``. Off-line picks contribute
  // via their triangle's intersection with the section plane, so a
  // borehole 50 m off-section still shapes the surface line — the
  // payoff vs. the connect-the-dots fallback (which only "knew" about
  // picks projected straight-down onto the line).
  //
  // Formations rendered here are EXCLUDED from the connect-the-dots
  // polylines render below to avoid double-painting. Drag previews
  // intentionally don't redraw the slice live — surfaces auto-
  // recompute on commit, so the slice snaps into place as soon as the
  // PATCH lands. The connect-the-dots fallback retains the live
  // preview because that's the only render available for sparse data.
  const slicedPolylines = useMemo(() => {
    // surfaceThroughPicks short-circuits the whole slice subsystem: an
    // empty result cascades through every consumer — the slice line isn't
    // drawn, slicedXRangeByFormationId is empty (so the contact polyline
    // draws through every pick), and formationFillBands falls back to the
    // anchor geometry. surfacesByFormationId stays wired so the fill's
    // stale cue + the polyline restyle below still read surface state.
    if (surfaceThroughPicks || !surfacesByFormationId || !sectionLine || !alongMToScreenX) {
      return [] as {
        formationId: string
        color: string
        name: string
        // Per-segment list: each entry is one M-L pair with its own
        // opacity (continuous gradient via per-vertex confidence,
        // debt #28 follow-up 2026-05-21).
        segments: readonly { d: string; opacity: number }[]
        // Concatenated single-path fallback for the toggle-off path
        // (no fade → uniform opacity).  Same shape as the legacy
        // dHigh string but for ALL segments at base opacity.
        dUniform: string
        screenPoints: readonly { x: number; y: number }[]
        isStale: boolean
      }[]
    }
    const out: {
      formationId: string
      color: string
      name: string
      segments: readonly { d: string; opacity: number }[]
      dUniform: string
      screenPoints: readonly { x: number; y: number }[]
      isStale: boolean
    }[] = []
    // Iterate ``polylineData`` rather than the ``surfacesByFormationId``
    // Map — polylineData is already sorted by stratigraphic order
    // (display_order ASC), so older formations land first in ``out``
    // and younger ones paint on top. Iterating the Map directly would
    // give us insertion order from the API response, which doesn't
    // respect the age axis.
    for (const line of polylineData) {
      const surface = surfacesByFormationId.get(line.formationId)
      if (!surface || surface.triangles.length === 0) continue
      const points = sliceTin(surface, sectionLine)
      if (points.length < 2) continue
      const meta = { color: line.color, name: line.name }
      const formationId = line.formationId
      // Debt #28 follow-up (2026-05-21): per-segment opacity for a
      // true gradient on the section view.  Each segment between two
      // consecutive slice points sits inside ONE triangle, so the
      // segment's confidence is the triangle's; we map that confidence
      // to a continuous alpha multiplier via ``confidenceToAlphaMultiplier``
      // and emit one ``<path>`` per segment.  Across the polyline, the
      // opacity varies smoothly — same continuous distance-to-data
      // signal the 3D viewer uses.
      const confidence = computeTriangleConfidence(surface.vertices, surface.triangles)
      // Project each (alongM, elevationM) into screen space; clip
      // segments that leave the plot area in Y. Raw screen points are
      // retained for the formation-fill band builder downstream.
      const screenPoints: { x: number; y: number }[] = []
      const segments: { d: string; opacity: number }[] = []
      let dUniform = ''
      let prevX: number | null = null
      let prevY: number | null = null
      let prevTriIdx: number | undefined = undefined
      for (const p of points) {
        const x = alongMToScreenX(p.alongM)
        const y = levelToScreen(p.elevationM)
        if (y < plotTop || y > plotBottom) {
          prevX = null
          prevY = null
          prevTriIdx = undefined
          continue
        }
        screenPoints.push({ x, y })
        if (prevX === null || prevY === null) {
          prevX = x
          prevY = y
          prevTriIdx = p.triangleIdx
          continue
        }
        const tri = p.triangleIdx ?? prevTriIdx
        const segConfidence = tri !== undefined ? confidence[tri] : 1.0
        const opacity = confidenceToAlphaMultiplier(segConfidence)
        const seg = `M ${prevX.toFixed(2)} ${prevY.toFixed(2)} L ${x.toFixed(2)} ${y.toFixed(2)}`
        segments.push({ d: seg, opacity })
        dUniform += seg + ' '
        prevX = x
        prevY = y
        prevTriIdx = p.triangleIdx
      }
      if (segments.length === 0) continue
      out.push({
        formationId,
        color: meta.color,
        name: meta.name,
        segments,
        dUniform,
        screenPoints,
        isStale: surface.is_stale === true,
      })
    }
    return out
  }, [
    surfaceThroughPicks,
    surfacesByFormationId,
    sectionLine,
    alongMToScreenX,
    polylineData,
    levelToScreen,
    plotTop,
    plotBottom,
  ])

  // For each formation that has a TIN slice, the screen-X extent the
  // slice actually covers. Used in the connect-the-dots render below
  // to draw extrapolation segments only where they reach BEYOND the
  // slice — anchors outside the TIN's hull (typically the leftmost or
  // rightmost columns when the slice ends before them) keep their
  // contact line connected. A single [min, max] range is a deliberate
  // simplification: a slice with internal gaps (path 'M' breaks
  // because the section line exits the plot box vertically) is treated
  // as continuous between its endpoints, so we never extrapolate
  // INSIDE that span. Refine if dogfeed shows wrong gaps.
  const slicedXRangeByFormationId = useMemo(() => {
    const out = new Map<string, { minX: number; maxX: number }>()
    for (const line of slicedPolylines) {
      if (line.screenPoints.length === 0) continue
      let minX = Infinity
      let maxX = -Infinity
      for (const p of line.screenPoints) {
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
      }
      out.set(line.formationId, { minX, maxX })
    }
    return out
  }, [slicedPolylines])

  // Geological backdrop — read-only slice-of-TIN for the REFERENCE
  // (geological) model rendered under the active litho contacts.
  //
  // Mirroring the ``slicedPolylines`` memo above: iterates
  // ``referenceSurfacesByFormationId`` in the order imposed by
  // ``referenceFormations`` (ascending display_order = older first,
  // so older formations paint first and younger paint on top —
  // geological superposition rule).  Gated entirely on the two
  // optional props; produces an empty array on the geological axis
  // (where neither prop is passed) so there is zero regression for
  // that code path.
  //
  // The backdrop is subordinate to the editable litho layer:
  //   fresh surface → strokeOpacity 0.25, no dash
  //   stale surface → strokeOpacity 0.12, dash "8 4"
  //
  // ``pointerEvents="none"`` on every element — the backdrop is
  // never hit-tested and never mixed into the contacts / selection
  // flow.  Exempt from the explicit-content invariant (it is surface
  // geometry, not a contact).
  const backdropPolylines = useMemo(() => {
    if (
      !referenceFormations ||
      referenceFormations.length === 0 ||
      !referenceSurfacesByFormationId ||
      !sectionLine ||
      !alongMToScreenX
    ) {
      return [] as {
        formationId: string
        color: string
        d: string
        isStale: boolean
      }[]
    }
    // Build a formation-color index keyed by id so the render step
    // can look up the color in O(1).  Stale-id-tolerant: a formation
    // id from the surface map that is absent from referenceFormations
    // simply isn't rendered (the loop skips it naturally).
    const colorById = new Map<string, string>()
    // Ascending display_order = older paints first (geological
    // superposition rule — same convention as the active-contacts
    // slicedPolylines above).
    const sortedFormations = [...referenceFormations].sort(
      (a, b) => a.display_order - b.display_order,
    )
    for (const f of sortedFormations) colorById.set(f.id, f.color)

    const out: { formationId: string; color: string; d: string; isStale: boolean }[] = []
    for (const f of sortedFormations) {
      const surface = referenceSurfacesByFormationId.get(f.id)
      if (!surface || surface.triangles.length === 0) continue
      const points = sliceTin(surface, sectionLine)
      if (points.length < 2) continue
      let path = ''
      let pendingMove = true
      for (const p of points) {
        const x = alongMToScreenX(p.alongM)
        const y = levelToScreen(p.elevationM)
        if (y < plotTop || y > plotBottom) {
          pendingMove = true
          continue
        }
        path += `${pendingMove ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)} `
        pendingMove = false
      }
      if (path === '') continue
      const color = colorById.get(f.id) ?? '#888888'
      out.push({
        formationId: f.id,
        color,
        d: path,
        isStale: surface.is_stale === true,
      })
    }
    return out
  }, [
    referenceFormations,
    referenceSurfacesByFormationId,
    sectionLine,
    alongMToScreenX,
    levelToScreen,
    plotTop,
    plotBottom,
  ])

  // Snap-to-contact backdrop — geological contact polylines drawn
  // through every column with a pick. The TIN slice (above) gives the
  // formation surface AT the section line's (x, y), which diverges
  // from the user's actual contact depth for any investigation that
  // is projected onto the section from an offset position (3D → 2D
  // projection error). This backdrop pins the rendered surface to the
  // contact depths directly: at each column with a referenceContact
  // for the formation, the line passes EXACTLY through
  // (anchor.nudgedX, surfaceElevationM - contact.depth_top_m).
  //
  // Rendered ABOVE the TIN-slice backdrop in the JSX so the contact-
  // anchored line wins visually where both exist. The TIN backdrop is
  // preserved underneath as a hint of the smooth surface between
  // contacts. Gated entirely on referenceContacts being supplied;
  // empty when on the geological axis (no regression).
  const backdropContactPolylines = useMemo(() => {
    if (
      !referenceFormations ||
      referenceFormations.length === 0 ||
      !referenceContacts ||
      referenceContacts.length === 0
    ) {
      return [] as { formationId: string; color: string; d: string }[]
    }
    const formationColorById = new Map<string, string>()
    const sortedFormations = [...referenceFormations].sort(
      (a, b) => a.display_order - b.display_order,
    )
    for (const f of sortedFormations) formationColorById.set(f.id, f.color)

    // Pre-index reference contacts by anchor id (matches the active-set
    // logic in slabs/polylineData above). O(K) per column.
    const refContactsByAnchorId = new Map<string, FormationContactResponse[]>()
    for (const c of referenceContacts) {
      const anchorId = c.borehole_id ?? c.cpt_id
      if (!anchorId) continue
      if (c.borehole_id && excludedBoreholeIds?.has(c.borehole_id)) continue
      const bucket = refContactsByAnchorId.get(anchorId)
      if (bucket) bucket.push(c)
      else refContactsByAnchorId.set(anchorId, [c])
    }

    // Per-formation vertex accumulator.
    const byFormation = new Map<string, { x: number; y: number }[]>()
    for (const col of placedColumns) {
      const item = col.proj.item as { id: string; elevation_m: number | null }
      if (item.elevation_m === null) continue
      const colContacts = refContactsByAnchorId.get(item.id)
      if (!colContacts || colContacts.length === 0) continue
      const surfaceElev = item.elevation_m
      for (const c of colContacts) {
        if (!formationColorById.has(c.formation_id)) continue
        const elev = surfaceElev - c.depth_top_m
        const y = levelToScreen(elev)
        if (y < plotTop || y > plotBottom) continue
        const acc = byFormation.get(c.formation_id) ?? []
        acc.push({ x: col.nudgedX, y })
        byFormation.set(c.formation_id, acc)
      }
    }

    const out: { formationId: string; color: string; d: string }[] = []
    for (const f of sortedFormations) {
      const verts = byFormation.get(f.id)
      if (!verts || verts.length < 2) continue
      verts.sort((a, b) => a.x - b.x)
      let path = ''
      for (let i = 0; i < verts.length; i += 1) {
        const v = verts[i]
        path += `${i === 0 ? 'M' : 'L'} ${v.x.toFixed(2)} ${v.y.toFixed(2)} `
      }
      out.push({
        formationId: f.id,
        color: formationColorById.get(f.id) ?? '#888888',
        d: path,
      })
    }
    return out
  }, [
    referenceFormations,
    referenceContacts,
    placedColumns,
    excludedBoreholeIds,
    levelToScreen,
    plotTop,
    plotBottom,
  ])

  // Deepest investigation-bottom screen-Y in the section's projected
  // columns — used as the FLOOR for the oldest formation's fill (and
  // the fallback when an intermediate formation has pinched out and
  // no older covers an X position). Filling down to plotBottom is
  // misleading because it visualises model data where we don't have
  // any; clipping to the deepest CPT / borehole bottom keeps the
  // band honest about what the section actually knows.
  const dataExtentFloor = useMemo(() => {
    let deepest = -Infinity
    for (const col of placedColumns) {
      const item = col.proj.item
      const elev = item.elevation_m
      if (elev == null) continue
      const bottomDepth =
        col.kind === 'cpt'
          ? (item as CptListItem).max_depth_m
          : (item as BoreholeListItem).total_depth_m
      if (bottomDepth == null) continue
      const bottomElev = elev - bottomDepth
      const y = levelToScreen(bottomElev)
      if (y > deepest) deepest = y
    }
    // Fall back to plotBottom only if no column has depth data —
    // otherwise that floor is the worst case (full plot height).
    // Cap at plotBottom so a clipped projection doesn't push the
    // floor below the visible plot.
    return deepest === -Infinity ? plotBottom : Math.min(deepest, plotBottom)
  }, [placedColumns, levelToScreen, plotBottom])

  // Filled coloured bands between adjacent formation tops, giving
  // the section the classic geological-column read: each rock unit
  // shaded with its formation colour between its top and the next-
  // older formation's top. Age order is data-derived (mean surface
  // elevation; lower = older) — same axis the crossings validator
  // uses — so the bands stay correct even when display_order is
  // inverted from convention.
  //
  // Geometry source = per-contact polyline (``polylines.vertices``),
  // NOT the TIN slice (``slicedPolylines``). The TIN slice's
  // X-extent is bounded by the formation's convex hull in (x, y),
  // so on a section that runs out toward boreholes near the hull
  // edge the slice may end before the section's last column —
  // leaving the outer columns without a fill even though they have
  // a contact for the formation. The contact polyline visits EVERY
  // column with a contact regardless of TIN hull, so the fill
  // covers them all. Visual cost: between contacts the fill uses
  // straight-line interpolation rather than Delaunay-smooth, which
  // is geologically honest (we don't really know the surface
  // between picks). The crisp TIN slice line still paints on top.
  //
  // Pinch-out handling: when the immediate-next-older formation
  // has no data at some X — e.g. KoAa pinches out east of
  // borehole BH-5 — the band's bottom at that X falls through to
  // the NEXT older formation (KoRo). The fallback chain walks the
  // full age-sorted older list before dropping to the data-extent
  // floor. Without this, the Quartair band would truncate at KoAa's
  // eastern edge and leave a visual gap where Quartair geologically
  // continues onto KoRo.
  //
  // The oldest formation's fill stops at ``dataExtentFloor`` — the
  // deepest CPT or borehole bottom — not at the visible plot floor.
  // Above the youngest top there's no fill (nothing geological to
  // draw — that's open air / un-modelled).
  //
  // Opacity is intentionally low (0.18 fresh / 0.08 stale) so the
  // qc curves + per-column glyphs underneath remain legible. The
  // top polylines paint on top at full opacity for crisp boundaries.
  // ±20 m along-axis buffer applied to each formation's outer
  // contact when building the fill band. Lets the coloured region
  // "breathe" beyond the leftmost / rightmost test instead of
  // clipping flush to the column glyphs — matches how a geologist
  // would sketch a section by hand, where the unit clearly
  // continues just past the last borehole.
  const fillBufferPx = useMemo(() => {
    if (!alongMToScreenX) return 0
    return Math.abs(alongMToScreenX(20) - alongMToScreenX(0))
  }, [alongMToScreenX])

  // Debt #142 follow-up — per-column litho band geometry.  For each
  // column on the litho axis (when ``perColumnBandsFromContacts`` is
  // on), compute coloured rects between adjacent committed contacts.
  // Independent of any TIN slice — the per-column visual is the
  // litho stack you'd read off the column itself, not an
  // interpolation across investigations (litho varies laterally;
  // cross-column interpolation is not meaningful for litho data).
  const perColumnLithoBands = useMemo(() => {
    type LithoBand = {
      key: string
      x: number
      y: number
      width: number
      height: number
      color: string
      // Debt #151 — the contact id the band's TOP belongs to.  When
      // the user right-clicks a band → Remove, this is the id passed
      // to ``onDeleteContact``.  For the bottom-extension band the
      // contact is the deepest one on the anchor (its formation
      // extends to test bottom).
      contactId: string
      formationName: string
      // Debt #151 dogfeed refinement 2026-05-27: left-click on a band
      // opens the picker for "Insert new layer here".  These fields
      // let the click handler compute the click depth + pass the
      // right anchor info to ``onRequestAddLithoSuggestion`` without
      // a second placedColumns lookup.
      anchorKind: 'cpt' | 'borehole'
      anchorId: string
      anchorName: string
      anchorElevationM: number
      anchorSurfaceY: number
      anchorPxPerMetre: number
    }
    if (!perColumnBandsFromContacts) {
      return [] as LithoBand[]
    }
    // Litho formations carry their lithology colour in the stored
    // ``color`` (stamped at create + backfilled, #145); geological
    // formations carry the user-chosen colour. Both read directly.
    const colorById = new Map(formations.map(f => [f.id, f.color]))
    const nameById = new Map(formations.map(f => [f.id, f.name]))
    // Subtract pending-ghost depth ranges from a band's [top, base]
    // interval, producing zero or more sub-bands (debt #151 dogfeed
    // refinement 2026-05-27 — split the accepted band where a ghost
    // is being inserted so the ghost is visible on top).
    const subtractGhosts = (
      bandTopM: number,
      bandBaseM: number,
      holes: readonly { depth_top_m: number; depth_base_m: number }[],
    ): Array<{ topM: number; baseM: number }> => {
      let pieces: Array<{ topM: number; baseM: number }> = [
        { topM: bandTopM, baseM: bandBaseM },
      ]
      for (const hole of holes) {
        pieces = pieces.flatMap(p => {
          if (hole.depth_base_m <= p.topM || hole.depth_top_m >= p.baseM) {
            return [p]
          }
          const out: Array<{ topM: number; baseM: number }> = []
          if (hole.depth_top_m > p.topM) {
            out.push({ topM: p.topM, baseM: hole.depth_top_m })
          }
          if (hole.depth_base_m < p.baseM) {
            out.push({ topM: hole.depth_base_m, baseM: p.baseM })
          }
          return out
        })
      }
      return pieces
    }
    const out: LithoBand[] = []
    for (const col of placedColumns) {
      const item = col.proj.item as { id: string; name: string; elevation_m: number | null }
      if (item.elevation_m === null) continue
      const surfaceLevel = item.elevation_m
      const anchorId = item.id
      const colContacts = contacts
        .filter(c => (c.borehole_id ?? c.cpt_id) === anchorId)
        .slice()
        .sort((a, b) => a.depth_top_m - b.depth_top_m)
      if (colContacts.length === 0) continue
      const ghostHoles = pendingGhostRangesByAnchorId?.get(anchorId) ?? []
      const halfW = col.width / 2
      const x = col.nudgedX - halfW
      const surfaceY = levelToScreen(surfaceLevel)
      const oneMetreDown = levelToScreen(surfaceLevel - 1)
      const pxPerMetre = oneMetreDown - surfaceY
      const anchorMeta = {
        anchorKind: col.kind,
        anchorId,
        anchorName: item.name,
        anchorElevationM: item.elevation_m as number,
        anchorSurfaceY: surfaceY,
        anchorPxPerMetre: pxPerMetre,
      } as const
      // Between-contact bands.
      for (let i = 0; i < colContacts.length - 1; i++) {
        const top = colContacts[i]
        const bot = colContacts[i + 1]
        const color = colorById.get(top.formation_id)
        if (!color) continue
        const pieces = subtractGhosts(top.depth_top_m, bot.depth_top_m, ghostHoles)
        for (let pi = 0; pi < pieces.length; pi++) {
          const piece = pieces[pi]
          const yTop = levelToScreen(surfaceLevel - piece.topM)
          const yBot = levelToScreen(surfaceLevel - piece.baseM)
          const yMin = Math.min(yTop, yBot)
          const height = Math.abs(yBot - yTop)
          if (height <= 0) continue
          out.push({
            key: `${anchorId}-${top.id}${pieces.length > 1 ? `-p${pi}` : ''}`,
            x,
            y: yMin,
            width: col.width,
            height,
            color,
            contactId: top.id,
            formationName: nameById.get(top.formation_id) ?? '',
            ...anchorMeta,
          })
        }
      }
      // Dogfeed 2026-05-27: the deepest contact's formation continues
      // from its ``depth_top_m`` down to the investigation's test
      // bottom (CPT ``max_depth_m`` / borehole ``total_depth_m``).
      // Without this the deepest litho unit had no rect — the user
      // reported "bottom layer not rendered".
      const last = colContacts[colContacts.length - 1]
      const lastColor = colorById.get(last.formation_id)
      const testBottomM =
        col.kind === 'cpt'
          ? col.proj.item.max_depth_m
          : (col.proj.item as { total_depth_m: number | null }).total_depth_m
      if (lastColor && testBottomM !== null && testBottomM > last.depth_top_m) {
        const pieces = subtractGhosts(last.depth_top_m, testBottomM, ghostHoles)
        for (let pi = 0; pi < pieces.length; pi++) {
          const piece = pieces[pi]
          const yTop = levelToScreen(surfaceLevel - piece.topM)
          const yBot = levelToScreen(surfaceLevel - piece.baseM)
          const yMin = Math.min(yTop, yBot)
          const height = Math.abs(yBot - yTop)
          if (height <= 0) continue
          out.push({
            key: `${anchorId}-${last.id}-bottom${pieces.length > 1 ? `-p${pi}` : ''}`,
            x,
            y: yMin,
            width: col.width,
            height,
            color: lastColor,
            contactId: last.id,
            formationName: nameById.get(last.formation_id) ?? '',
            ...anchorMeta,
          })
        }
      }
    }
    return out
  }, [perColumnBandsFromContacts, contacts, formations, placedColumns, levelToScreen, pendingGhostRangesByAnchorId])

  const formationFillBands = useMemo(() => {
    if (polylines.length === 0) {
      return [] as {
        formationId: string
        color: string
        d: string
        isStale: boolean
      }[]
    }
    // Prefer the TIN-slice polyline (which incorporates off-section
    // anchors via Delaunay triangulation) over the connect-the-dots
    // polyline for the fill-band geometry. Otherwise the rendered
    // surface line (TIN slice) and the fill bottom (connect-the-dots
    // through on-section picks only) diverge laterally — leaving an
    // unfilled wedge between a younger formation's fill bottom and the
    // older formation's visible surface where the TIN dips below the
    // straight inter-pick interpolation. Connect-the-dots stays as
    // the fallback when no cached surface is wired.
    const slicedByFormationId = new Map<
      string,
      readonly { x: number; y: number }[]
    >()
    for (const s of slicedPolylines) {
      slicedByFormationId.set(s.formationId, s.screenPoints)
    }
    // Project each per-formation polyline into the (x, y) screen
    // tuples buildFillBand expects, sorted ascending by X so the
    // helper can index into them safely. Pad ±fillBufferPx on the
    // outer endpoints so the fill extends past the last contact
    // (flat horizontal extrapolation — same Y as the endpoint).
    const projected = polylines
      .map(line => {
        const sliced = slicedByFormationId.get(line.formationId)
        const anchorPoints = line.vertices
          .map(v => ({ x: v.screenX, y: v.screenY }))
          .sort((a, b) => a.x - b.x)
        // Merge slice + anchors:
        //   * Slice points (smooth TIN curve) in the X range the TIN
        //     actually covers.
        //   * Anchor points OUTSIDE that range — so the fill reaches
        //     every column with a contact, even when alpha-trim has
        //     shaved the TIN inward from a real anchor (e.g. a long
        //     unobserved gap forces the trim and the rightmost anchor
        //     drops out of the slice's convex hull).
        // Without this merge, the fill ends at the slice edge and the
        // halfspace extension below propagates at the slice's edge
        // elevation, which silently misses any anchor sitting at a
        // different depth past the trim line — surfaces as a missing
        // band between the slice end and the outlying anchor.
        let points: { x: number; y: number }[]
        if (sliced && sliced.length >= 2) {
          const sortedSliced = [...sliced].sort((a, b) => a.x - b.x)
          const sliceMinX = sortedSliced[0].x
          const sliceMaxX = sortedSliced[sortedSliced.length - 1].x
          const leftAnchors = anchorPoints.filter(p => p.x < sliceMinX)
          const rightAnchors = anchorPoints.filter(p => p.x > sliceMaxX)
          points = [...leftAnchors, ...sortedSliced, ...rightAnchors]
        } else {
          points = anchorPoints
        }
        if (points.length >= 2) {
          // Halfspace extrapolation — extend the band laterally to the
          // section's plot bounds when those are available (gINT /
          // LeapFrog convention: formations are geologically
          // continuous, so the unit is presumed to extend past the
          // last anchor that has a contact). When plot bounds are not
          // wired we fall back to ±fillBufferPx (the legacy "breathe
          // past the last test" pad).
          const left = points[0]
          const right = points[points.length - 1]
          const leftTargetX =
            plotLeft !== undefined && plotLeft < left.x
              ? plotLeft
              : fillBufferPx > 0
                ? left.x - fillBufferPx
                : left.x
          const rightTargetX =
            plotRight !== undefined && plotRight > right.x
              ? plotRight
              : fillBufferPx > 0
                ? right.x + fillBufferPx
                : right.x
          if (leftTargetX < left.x) points.unshift({ x: leftTargetX, y: left.y })
          if (rightTargetX > right.x) points.push({ x: rightTargetX, y: right.y })
        }
        // 3-state fill contract (§10 on-click build):
        //   fresh surface (exists + !is_stale + triangles > 0) → solid 0.18
        //   stale surface (exists + is_stale)                   → faded 0.08
        //   no surface row (Fill ran but Build never fired)     → NO fill
        // hasSurface gates the outer render; isStale controls the opacity.
        const surface = surfacesByFormationId?.get(line.formationId)
        const hasSurface = surface !== undefined
        const isStale = surface?.is_stale === true
        const hasTriangles = (surface?.triangles.length ?? 0) > 0
        return {
          formationId: line.formationId,
          color: line.color,
          points,
          hasSurface,
          isStale,
          hasTriangles,
        }
      })
      .filter(p => p.points.length >= 2)
    // Sort youngest-first by mean screen-Y. Screen-Y is inverted
    // (smaller Y = higher elevation = younger), so ascending Y
    // gives youngest first.
    const annotated = projected
      .map(p => ({
        line: p,
        meanY: p.points.reduce((acc, pt) => acc + pt.y, 0) / p.points.length,
      }))
      .sort((a, b) => a.meanY - b.meanY)
    const out: {
      formationId: string
      color: string
      d: string
      isStale: boolean
    }[] = []
    for (let i = 0; i < annotated.length; i++) {
      const younger = annotated[i].line
      // Gate: no surface row → no fill. Fresh surface with empty triangles
      // (0-contact or all-NaN-elevation edge case) → no fill. Stale surface
      // → faded hint fill regardless of triangle count (prior build geometry
      // exists and the engineer should see "refresh needed").
      if (!younger.hasSurface) continue
      if (!younger.isStale && !younger.hasTriangles) continue
      // All formations older than this one, in age order
      // (immediate-next-older first) — fed to buildFillBand as the
      // pinch-out fallback chain.
      const olders = annotated.slice(i + 1).map(a => a.line.points)
      const d = buildFillBand(younger.points, olders, dataExtentFloor)
      if (d === '') continue
      out.push({
        formationId: younger.formationId,
        color: younger.color,
        d,
        isStale: younger.isStale,
      })
    }
    return out
  }, [
    polylines,
    slicedPolylines,
    surfacesByFormationId,
    dataExtentFloor,
    fillBufferPx,
    plotLeft,
    plotRight,
  ])

  // Drag state lives in the component so its update path is
  // explicit. Document-level mousemove + mouseup listeners attach
  // only while a drag is active.
  const [drag, setDrag] = useState<DragState | null>(null)

  // Apply snap-to-stratigraphy (matches the click path's behaviour
  // on borehole anchors). Falls through to the raw depth when there's
  // no snap candidate within ``SNAP_TOLERANCE_PX`` or the anchor has
  // no candidates registered.
  const snapDepth = useCallback(
    (
      rawDepth: number,
      anchorId: string,
      pxPerMetre: number,
      excludeContactId?: string,
    ): { depth: number; snapped: boolean } => {
      if (pxPerMetre === 0) return { depth: rawDepth, snapped: false }
      const candidates = snapDepthsByAnchorId?.get(anchorId)
      if (!candidates || candidates.length === 0) {
        return { depth: rawDepth, snapped: false }
      }
      let bestDepth = rawDepth
      let bestPxDistance = SNAP_TOLERANCE_PX + 1
      let bestSnapped = false
      for (const cand of candidates) {
        // Debt #136 — skip the dragged contact's own row so a small drag
        // doesn't pull back to its starting depth.  Stratigraphy depths
        // carry no contactId and always participate.
        if (excludeContactId !== undefined && cand.contactId === excludeContactId) continue
        const px = Math.abs((cand.depth - rawDepth) * pxPerMetre)
        if (px <= SNAP_TOLERANCE_PX && px < bestPxDistance) {
          bestPxDistance = px
          bestDepth = cand.depth
          bestSnapped = true
        }
      }
      return { depth: bestDepth, snapped: bestSnapped }
    },
    [snapDepthsByAnchorId],
  )

  // Shift-Click selects the depth-range between the LAST-clicked
  // contact and this one, scoped to the same anchor. Range across
  // anchors is ambiguous (whose depth order wins?) so we silently
  // fall back to a plain replacement select when the anchors differ.
  // Hoisted above the drag useEffect so the shift+click-without-
  // movement path inside handleUp can fire range-select on commit
  // — see the shiftHeld branch in that handler.
  const handleRangeSelection = useCallback(
    (layer: RenderedLayer) => {
      const anchorContacts = layers
        .filter(l => l.anchorId === layer.anchorId)
        .sort((a, b) => a.originalDepthM - b.originalDepthM)
      const last = lastSelectionContactId
        ? anchorContacts.find(l => l.contactId === lastSelectionContactId)
        : null
      if (!last) {
        // No prior anchor on this column → just select this one.
        setSelection(new Set([layer.contactId]))
        setLastSelectionContactId(layer.contactId)
        return
      }
      const startIdx = anchorContacts.findIndex(
        l => l.contactId === last.contactId,
      )
      const endIdx = anchorContacts.findIndex(
        l => l.contactId === layer.contactId,
      )
      if (startIdx === -1 || endIdx === -1) return
      const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
      const rangeIds = anchorContacts.slice(lo, hi + 1).map(l => l.contactId)
      setSelection(prev => {
        const next = new Set(prev)
        for (const id of rangeIds) next.add(id)
        return next
      })
      // Do NOT update lastSelectionContactId — shift-clicking again
      // should re-anchor against the ORIGINAL last-click, the standard
      // file-explorer / Finder pattern.
    },
    [layers, lastSelectionContactId],
  )

  // Document-level move/up while a drag is active. clientY delta
  // converts to a Y delta in SVG space (the SVG is in a relative
  // container; absolute scale is 1:1 so we don't need to walk the
  // bounding rect). Recomputing depth from start values keeps the
  // math drift-free as the cursor wanders far from the line.
  //
  // Cross-column behaviour: handleMove walks ``placedColumns`` for the
  // column under cursor X (with ``COLUMN_ATTRACTION_PX`` hysteresis)
  // and stamps ``currentTargetCol`` in the drag state. Depth math
  // switches to the target column's surfaceY / pxPerMetre — the cursor
  // Y in SVG coords is reinterpreted against the new column's surface.
  // On commit, the use case is decided by what changed:
  //   * single contact, no anchor change   → ``onUpdateContactDepth``
  //   * anything else (multi or re-anchor) → ``onBatchUpdateContacts``
  //
  // Three defensive cancel paths cover the case where the user
  // releases the mouse OUTSIDE the browser viewport (``mouseup``
  // never reaches our document listener):
  //   1. ``e.buttons === 0`` at the top of handleMove — when the
  //      cursor comes back into the window with no button held,
  //      we know the release happened off-screen.
  //   2. ``window.blur`` — if the user switches apps mid-drag the
  //      window loses focus; cancel without committing.
  //   3. ``pxPerMetre === 0`` guard — pathological collapsed
  //      viewport (VEX edge case); prevents Infinity from ever
  //      reaching the commit path.
  useEffect(() => {
    if (drag === null) return
    function cancel(): void {
      setDrag(null)
    }
    function handleMove(e: MouseEvent): void {
      if (e.buttons === 0) {
        cancel()
        return
      }
      const d = drag!
      if (d.pxPerMetre === 0) return
      const cursorSvgX = e.clientX - d.svgLeft
      // Walk placedColumns for the column under cursor X — null = the
      // cursor's in dead space; keep the last known target (or source
      // if we never moved off it). Re-anchor only fires when the cursor
      // is unambiguously inside a different column's attraction band.
      const hovered = columnUnderCursor(cursorSvgX, placedColumns)
      const nextTargetCol =
        hovered === null
          ? d.currentTargetCol
          : hovered.proj.item.id === d.anchorId
            ? null
            : hovered
      // Per-column depth math. When re-anchoring, depth is computed
      // against the target column's surface so the contact lands at
      // the cursor's true SVG-Y position relative to that column.
      let surfaceY = d.surfaceY
      let pxPerMetre = d.pxPerMetre
      let depthAnchorId = d.anchorId
      if (nextTargetCol !== null) {
        const target = surfaceYForColumn(nextTargetCol, levelToScreen)
        if (target.surfaceElevationM !== null && target.pxPerMetre !== 0) {
          surfaceY = target.surfaceY
          pxPerMetre = target.pxPerMetre
          depthAnchorId = nextTargetCol.proj.item.id
        }
      }
      const draggedSegY = d.startSegY + (e.clientY - d.startClientY)
      const rawDepth = (draggedSegY - surfaceY) / pxPerMetre
      const surfaceClamped = Math.max(0, rawDepth)

      // Debt #152 — clamp at ±min-thickness from peer contacts on the
      // target anchor when the prop is set (litho axis only).  Soft
      // bounds: the dragger's STARTING depth is honoured even if it's
      // already inside the clamp zone (legacy overlapping contacts),
      // so the drag isn't auto-jerked on mousedown.
      let clamped = surfaceClamped
      let clampedDirection: 'up' | 'down' | null = null
      if (contactDragClampMinThicknessM !== undefined) {
        const dragger = contacts.find(c => c.id === d.contactId)
        const startDepth = dragger?.depth_top_m ?? surfaceClamped
        const referenceDepth =
          depthAnchorId === d.anchorId ? startDepth : surfaceClamped
        const peers = contacts
          .filter(
            c =>
              (c.borehole_id ?? c.cpt_id) === depthAnchorId
              && c.id !== d.contactId,
          )
          .sort((a, b) => a.depth_top_m - b.depth_top_m)
        const above = peers
          .filter(c => c.depth_top_m < referenceDepth)
          .at(-1)
        const below = peers.find(c => c.depth_top_m > referenceDepth)
        const minThk = contactDragClampMinThicknessM
        const rawAboveBound = above ? above.depth_top_m + minThk : 0
        const rawBelowBound = below ? below.depth_top_m - minThk : Number.POSITIVE_INFINITY
        // Soft bounds — never tighter than the dragger's own starting
        // depth (legacy overlaps stay where they are).
        const aboveBound = Math.min(rawAboveBound, startDepth)
        const belowBound = Math.max(rawBelowBound, startDepth)
        if (surfaceClamped < aboveBound) {
          clamped = aboveBound
          clampedDirection = 'up'
        } else if (surfaceClamped > belowBound) {
          clamped = belowBound
          clampedDirection = 'down'
        }
      }

      // Pass d.contactId so the snap fn can suppress self-snap on the
      // dragger's own depth (debt #136).  On a cross-column drag
      // (depthAnchorId !== d.anchorId) the dragger's id won't appear
      // in the target's candidate list anyway, so the exclusion is a
      // safe no-op there.
      const { depth, snapped } = snapDepth(clamped, depthAnchorId, pxPerMetre, d.contactId)
      setDrag(prev =>
        prev === null
          ? null
          : {
              ...prev,
              currentDepthM: depth,
              currentSnapped: snapped,
              currentTargetCol: nextTargetCol,
              currentClientX: e.clientX,
              currentClientY: e.clientY,
              currentClamped: clampedDirection,
            },
      )
    }
    function handleUp(e: MouseEvent): void {
      const final = drag
      setDrag(null)
      if (!final) return
      if (final.pxPerMetre === 0) return
      // No-op commit when nothing changed — neither depth nor anchor.
      const startDepth =
        (final.startSegY - final.surfaceY) / final.pxPerMetre
      const depthUnchanged = Math.abs(final.currentDepthM - startDepth) < 1e-6
      const noAnchorChange = final.currentTargetCol === null

      // Shift+mousedown without any movement = the user actually
      // meant the existing shift+click range-select gesture; fire it
      // now that we know the press wasn't a drag.
      if (final.shiftHeld && depthUnchanged && noAnchorChange) {
        const sourceLayer = layers.find(l => l.contactId === final.contactId)
        if (sourceLayer) handleRangeSelection(sourceLayer)
        return
      }
      if (depthUnchanged && noAnchorChange && final.contactsInDrag.length === 1) {
        return
      }

      // Commit dispatch — three lanes, decided by anchor change +
      // selection size + Alt key:
      //   * Single contact, same column          → onUpdateContactDepth (PATCH)
      //   * Same column, multi-contact           → onBatchUpdateContacts (depth shift)
      //   * Cross-column, no Alt                 → onBatchCreateContacts (COPY — default)
      //   * Cross-column, Alt held               → onBatchUpdateContacts (MOVE — opt-in)
      // The Alt fallback to MOVE is the original behaviour from the
      // first cross-column ship; COPY is the new default because
      // dogfooding showed "stamp interpretation onto a nearby test"
      // is the dominant cross-column workflow.
      const deltaM = final.currentDepthM - startDepth
      const single = final.contactsInDrag.length === 1
      const target = final.currentTargetCol
      const altMove = e.altKey

      // Shift+drag cross-column = PAINT-THROUGH: duplicate each
      // dragged contact at its ORIGINAL depth onto every column
      // between the source and the drop (drop included, source
      // excluded — source already carries the contact). Drop Y is
      // intentionally ignored: the gesture says "stamp this contact
      // on every test the cursor crossed", not "move it to a new
      // depth". Existing 409→PATCH path in handleBatchCreateContacts
      // means colliding (formation, anchor) tuples get overwritten,
      // matching the user's-will-is-absolute semantic.
      if (final.shiftHeld && target !== null) {
        if (!onBatchCreateContacts) return
        const sourceCol = placedColumns.find(
          c =>
            c.proj.item.id === final.anchorId && c.kind === final.anchorKind,
        )
        if (!sourceCol) return
        const stamps = columnsBetween(
          sourceCol.trueX,
          target.trueX,
          placedColumns,
        )
        const creates: ContactCopyPayload[] = []
        for (const col of stamps) {
          const isBorehole = col.kind === 'borehole'
          for (const c of final.contactsInDrag) {
            creates.push({
              formation_id: c.formationId,
              depth_top_m: c.originalDepthM,
              borehole_id: isBorehole ? col.proj.item.id : null,
              cpt_id: isBorehole ? null : col.proj.item.id,
              source: 'manual_pick',
              confidence: 'medium',
            })
          }
        }
        if (creates.length > 0) {
          log.debug('contacts', '[drag-commit] shift-paint-through', {
            count: creates.length,
            stampColumns: stamps.length,
          })
          void onBatchCreateContacts(creates)
        }
        return
      }

      if (single && noAnchorChange) {
        if (!onUpdateContactDepth) return
        // Diagnostic: drag-up cross-merge regression repro (2026-05-26).
        // Captures original vs new depth + direction at the FE commit
        // boundary so the user can paste a console dump showing exactly
        // what FE sent on a buggy drag.
        const original = final.contactsInDrag.find(c => c.contactId === final.contactId)?.originalDepthM
        log.debug('contacts', '[drag-commit] single-no-anchor', {
          contactId: final.contactId,
          originalDepthM: original,
          newDepthM: final.currentDepthM,
          delta: (original ?? 0) - final.currentDepthM,
          direction: final.currentDepthM < (original ?? 0) ? 'UP' : 'DOWN',
          snapped: final.currentSnapped,
        })
        void onUpdateContactDepth(
          final.contactId,
          final.currentDepthM,
          final.currentSnapped,
        )
        return
      }

      // Same-column multi-drag — depth shift only, MOVE semantic
      // (each contact's existing row gets a new depth).
      if (target === null) {
        if (!onBatchUpdateContacts) return
        const updates: FormationContactBatchUpdateEntry[] =
          final.contactsInDrag.map(c => ({
            contact_id: c.contactId,
            depth_top_m: Math.max(0, c.originalDepthM + deltaM),
            source:
              c.contactId === final.contactId && final.currentSnapped
                ? 'borehole_observation'
                : 'manual_pick',
            confidence:
              c.contactId === final.contactId && final.currentSnapped
                ? 'high'
                : 'medium',
          }))
        log.debug('contacts', '[drag-commit] batch-same-column', {
          deltaM,
          direction: deltaM < 0 ? 'UP' : 'DOWN',
          count: updates.length,
          updates: updates.map(u => ({ id: u.contact_id, depth: u.depth_top_m })),
        })
        void onBatchUpdateContacts(updates)
        return
      }

      // Cross-column commit. Both COPY and MOVE land on the SAME
      // target anchor for every selected contact (multi-source-anchor
      // selections collapse to one target — v1 simplification).
      const targetIsBorehole = target.kind === 'borehole'
      const newAnchorBoreholeId = targetIsBorehole ? target.proj.item.id : null
      const newAnchorCptId = targetIsBorehole ? null : target.proj.item.id

      if (altMove) {
        // ALT held → re-anchor the existing rows in place.
        if (!onBatchUpdateContacts) return
        const updates: FormationContactBatchUpdateEntry[] =
          final.contactsInDrag.map(c => ({
            contact_id: c.contactId,
            depth_top_m: Math.max(0, c.originalDepthM + deltaM),
            borehole_id: newAnchorBoreholeId,
            cpt_id: newAnchorCptId,
            source:
              c.contactId === final.contactId && final.currentSnapped
                ? 'borehole_observation'
                : 'manual_pick',
            confidence:
              c.contactId === final.contactId && final.currentSnapped
                ? 'high'
                : 'medium',
          }))
        log.debug('contacts', '[drag-commit] cross-column-alt-move', {
          deltaM,
          direction: deltaM < 0 ? 'UP' : 'DOWN',
          count: updates.length,
          newAnchorBoreholeId,
          newAnchorCptId,
        })
        void onBatchUpdateContacts(updates)
        return
      }

      // Default cross-column = COPY. Originals stay; new contacts
      // POST'd at the target anchor with translated depths.
      if (!onBatchCreateContacts) {
        // Caller didn't wire COPY but DID wire MOVE — degrade
        // gracefully to MOVE so the drag isn't a silent no-op.
        if (!onBatchUpdateContacts) return
        const updates: FormationContactBatchUpdateEntry[] =
          final.contactsInDrag.map(c => ({
            contact_id: c.contactId,
            depth_top_m: Math.max(0, c.originalDepthM + deltaM),
            borehole_id: newAnchorBoreholeId,
            cpt_id: newAnchorCptId,
            source: 'manual_pick',
            confidence: 'medium',
          }))
        void onBatchUpdateContacts(updates)
        return
      }
      const creates: ContactCopyPayload[] = final.contactsInDrag.map(c => ({
        formation_id: c.formationId,
        depth_top_m: Math.max(0, c.originalDepthM + deltaM),
        borehole_id: newAnchorBoreholeId,
        cpt_id: newAnchorCptId,
        source:
          c.contactId === final.contactId && final.currentSnapped
            ? 'borehole_observation'
            : 'manual_pick',
        confidence:
          c.contactId === final.contactId && final.currentSnapped
            ? 'high'
            : 'medium',
      }))
      log.debug('contacts', '[drag-commit] cross-column-copy', {
        deltaM,
        direction: deltaM < 0 ? 'UP' : 'DOWN',
        count: creates.length,
        newAnchorBoreholeId,
        newAnchorCptId,
      })
      void onBatchCreateContacts(creates)
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    window.addEventListener('blur', cancel)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      window.removeEventListener('blur', cancel)
    }
  }, [
    drag,
    snapDepth,
    onUpdateContactDepth,
    onBatchUpdateContacts,
    onBatchCreateContacts,
    placedColumns,
    levelToScreen,
    layers,
    handleRangeSelection,
  ])

  // Indexed lookup of every rendered layer by contact id — used by
  // startDrag to expand a multi-selection click into the full
  // ``contactsInDrag`` set with each contact's source-column data.
  const layerByContactId = useMemo(() => {
    const out = new Map<string, RenderedLayer>()
    for (const l of layers) out.set(l.contactId, l)
    return out
  }, [layers])

  const startDrag = useCallback(
    (
      layer: RenderedLayer,
      e: React.MouseEvent<SVGRectElement>,
      shiftHeld: boolean,
    ) => {
      if (!onUpdateContactDepth) return
      // Only the left button starts a drag — right-click is reserved
      // for the section's column context menu.
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const svgEl = e.currentTarget.ownerSVGElement
      const svgLeft = svgEl?.getBoundingClientRect().left ?? 0
      // Build the drag set. If the clicked contact is part of an
      // existing multi-selection, drag the whole selection. Otherwise
      // drag just the clicked contact AND replace selection with it.
      const inSelection = selection.has(layer.contactId)
      const targetIds = inSelection
        ? Array.from(selection)
        : [layer.contactId]
      // Shift gestures (range-select OR paint-through) must NOT
      // mutate selection here — range-select needs the pre-existing
      // anchor to compute the range, paint-through doesn't care about
      // selection at all. Both fire from handleUp once the click vs
      // drag intent is resolved.
      if (!inSelection && !shiftHeld) {
        setSelection(new Set([layer.contactId]))
        setLastSelectionContactId(layer.contactId)
      }
      const contactsInDrag: DragContact[] = []
      for (const id of targetIds) {
        const found = layerByContactId.get(id)
        if (!found) continue
        contactsInDrag.push({
          contactId: found.contactId,
          formationId: found.formationId,
          anchorId: found.anchorId,
          anchorKind: found.anchorKind,
          originalDepthM: found.originalDepthM,
          sourceSurfaceY: found.surfaceY,
          sourcePxPerMetre: found.pxPerMetre,
          color: found.color,
          formationName: found.formationName,
        })
      }
      setDrag({
        contactId: layer.contactId,
        anchorId: layer.anchorId,
        anchorKind: layer.anchorKind,
        surfaceElevationM: layer.surfaceElevationM,
        pxPerMetre: layer.pxPerMetre,
        surfaceY: layer.surfaceY,
        startClientY: e.clientY,
        startClientX: e.clientX,
        startSegY: layer.segY,
        svgLeft,
        currentDepthM: layer.originalDepthM,
        currentSnapped: false,
        currentTargetCol: null,
        currentClientX: e.clientX,
        currentClientY: e.clientY,
        currentClamped: null,
        contactsInDrag,
        shiftHeld,
        color: layer.color,
        formationName: layer.formationName,
        segLeftX: layer.segLeftX,
        segRightX: layer.segRightX,
        labelX: layer.labelX,
        plotTop,
        plotBottom,
      })
    },
    [
      onUpdateContactDepth,
      plotTop,
      plotBottom,
      selection,
      layerByContactId,
    ],
  )

  // ---- Modifier-click handlers (toggle / range select; no drag) -
  // Ctrl/Cmd-Click toggles the clicked contact in/out of the
  // selection. Does not start a drag — the contract is "modifier
  // means update selection only" so a user can lasso a stack of
  // contacts in one anchor without accidentally moving them.
  const handleToggleSelection = useCallback(
    (contactId: string) => {
      setSelection(prev => {
        const next = new Set(prev)
        if (next.has(contactId)) next.delete(contactId)
        else next.add(contactId)
        return next
      })
      setLastSelectionContactId(contactId)
    },
    [],
  )


  // Dispatch on the hit-strip mousedown. Modifier-clicks update
  // selection only; plain clicks start a drag (which may carry the
  // whole selection if the clicked contact was already in it).
  const handleStripMouseDown = useCallback(
    (layer: RenderedLayer, e: React.MouseEvent<SVGRectElement>) => {
      if (e.button !== 0) return
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        handleToggleSelection(layer.contactId)
        return
      }
      if (e.shiftKey) {
        // Defer the click-vs-drag decision: start a tentative drag
        // with shiftHeld=true so handleUp can route by what actually
        // happened — no movement = shift+click range-select, movement
        // across columns = paint-through duplicate of the source
        // contact onto every column passed over. Both gestures live
        // on the same modifier; the threshold check inside handleUp
        // (depthUnchanged && noAnchorChange) disambiguates.
        startDrag(layer, e, true)
        return
      }
      // Plain click — the drag handler stops propagation + updates
      // selection (or preserves the existing multi-selection if the
      // clicked contact is part of it).
      startDrag(layer, e, false)
    },
    [handleToggleSelection, startDrag],
  )

  // ESC: cancel the active interaction. Priority order — drag,
  // marquee, selection. Each ESC press peels one layer back.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      if (isTypingTarget(e.target)) return
      if (drag !== null) {
        setDrag(null)
        return
      }
      if (marquee) {
        setMarquee(null)
        return
      }
      if (selection.size > 0) {
        setSelection(new Set())
        setLastSelectionContactId(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drag, marquee, selection])

  // ---- Marquee (box-select) effect --------------------------------
  // Document-level mousemove/mouseup while the marquee is active.
  // Mouseup picks every hit-strip whose centre falls inside the
  // marquee rect and updates the selection (additive when the user
  // held Shift/Ctrl on the initial mousedown, otherwise replace).
  // Below-threshold movement counts as a plain background click and
  // clears the selection. SectionPanel owns the marquee STATE; we
  // own the hit-testing + selection update.
  useEffect(() => {
    if (!marquee) return
    function cancel(): void {
      setMarquee(null)
    }
    function handleMove(e: MouseEvent): void {
      if (e.buttons === 0) {
        cancel()
        return
      }
      if (!marquee) return
      setMarquee({
        ...marquee,
        currentClientX: e.clientX,
        currentClientY: e.clientY,
      })
    }
    function handleUp(): void {
      const m = marquee
      setMarquee(null)
      if (!m) return
      const dx = Math.abs(m.currentClientX - m.startClientX)
      const dy = Math.abs(m.currentClientY - m.startClientY)
      if (dx < CLICK_TO_DRAG_THRESHOLD_PX && dy < CLICK_TO_DRAG_THRESHOLD_PX) {
        // Plain click — clear selection (additive click preserves).
        if (!m.additive) {
          setSelection(new Set())
          setLastSelectionContactId(null)
        }
        return
      }
      // Convert client coords → SVG coords by subtracting the cached
      // SVG bounding-rect offsets captured at mousedown.
      const x1 = Math.min(m.startClientX, m.currentClientX) - m.svgLeft
      const x2 = Math.max(m.startClientX, m.currentClientX) - m.svgLeft
      const y1 = Math.min(m.startClientY, m.currentClientY) - m.svgTop
      const y2 = Math.max(m.startClientY, m.currentClientY) - m.svgTop
      const hits: string[] = []
      for (const layer of layers) {
        const layerLeft = layer.segLeftX
        const layerRight = layer.segRightX
        const layerTop = layer.segY - DRAG_HIT_HALF_HEIGHT_PX
        const layerBottom = layer.segY + DRAG_HIT_HALF_HEIGHT_PX
        if (
          layerRight >= x1 &&
          layerLeft <= x2 &&
          layerBottom >= y1 &&
          layerTop <= y2
        ) {
          hits.push(layer.contactId)
        }
      }
      setSelection(prev => {
        const next = m.additive ? new Set(prev) : new Set<string>()
        for (const id of hits) next.add(id)
        return next
      })
      if (hits.length > 0) setLastSelectionContactId(hits[hits.length - 1])
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
    window.addEventListener('blur', cancel)
    return () => {
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      window.removeEventListener('blur', cancel)
    }
  }, [marquee, layers, setMarquee])

  // Reference-contact hit-strips — invisible rects placed at each
  // geological (reference) contact's depth position when
  // ``onEditInGeologyStage`` is wired (litho axis only).  Right-clicking
  // one opens a minimal context menu with a single "Edit in Geology stage"
  // item so the user can navigate directly to the relevant geological
  // contact for editing.
  //
  // The strip is the same height as the active-contact hit-strip
  // (2 × DRAG_HIT_HALF_HEIGHT_PX) and as wide as the column band.
  // ``pointerEvents`` is explicitly "all" (overriding the parent <g>'s
  // backdrop pointerEvents="none") so only these strips are clickable.
  const referenceContactHitStrips = useMemo(() => {
    if (!onEditInGeologyStage || !referenceContacts || referenceContacts.length === 0) {
      return [] as {
        key: string
        contactId: string
        formationId: string
        formationName: string
        segLeftX: number
        segRightX: number
        segY: number
      }[]
    }
    // Build a set of geo contact ids that a litho contact is currently coupled
    // to (#162).  A coupled litho contact is coincident with its geo contact
    // (the accept flow snaps them together) so the reference strip would sit
    // exactly on top of the litho drag-strip — it would eat the mousedown
    // (no drag) and the right-click (shows the geo menu instead of the litho
    // menu with "Unlink from geology").  Suppressing the strip loses nothing:
    // the litho contact's own strip already handles drag AND its context menu
    // already offers both "Edit in Geology stage" and "Unlink from geology".
    const coupledGeoIds = new Set<string>()
    // Litho contact depths grouped by anchor — used to detect a reference
    // contact that is COINCIDENT with a litho contact (same anchor + depth)
    // but not coupled (#159).  A coincident reference strip is suppressed for
    // the same reason as a coupled one: it would sit on top of the litho
    // drag-strip and eat its hover + mousedown, locking the litho contact.
    const lithoDepthsByAnchor = new Map<string, number[]>()
    for (const c of contacts) {
      if (c.parent_geo_contact_id != null) {
        coupledGeoIds.add(c.parent_geo_contact_id)
      }
      const lithoAnchorId = c.borehole_id ?? c.cpt_id
      if (lithoAnchorId != null) {
        const depths = lithoDepthsByAnchor.get(lithoAnchorId)
        if (depths) depths.push(c.depth_top_m)
        else lithoDepthsByAnchor.set(lithoAnchorId, [c.depth_top_m])
      }
    }
    // Pre-index placed columns by anchor id for O(1) lookup.
    const colByAnchorId = new Map<string, PlacedColumn>()
    for (const col of placedColumns) {
      const item = col.proj.item as { id: string }
      colByAnchorId.set(item.id, col)
    }
    // Pre-index reference formations by id so we can look up names.
    const refFormationById = new Map<string, { id: string; name: string; regional_ref: string | null; color: string; litho_main_soil_code?: string | null; litho_admixtures?: unknown }>()
    if (referenceFormations) {
      for (const f of referenceFormations) {
        refFormationById.set(f.id, f)
      }
    }
    const out: {
      key: string
      contactId: string
      formationId: string
      formationName: string
      segLeftX: number
      segRightX: number
      segY: number
    }[] = []
    for (const c of referenceContacts) {
      // Suppress the strip when a litho contact is coupled to this geo contact
      // — the litho contact's drag-strip already covers drag + the full menu.
      if (coupledGeoIds.has(c.id)) continue
      // Only anchor-backed contacts — synthetic lens tips have no column.
      const anchorId = c.borehole_id ?? c.cpt_id
      if (!anchorId) continue
      // Suppress the strip when a litho contact on the same anchor sits at the
      // same depth (#159 — coincident-but-not-coupled, e.g. after the snap
      // dialog).  Same rationale as the coupled case: the litho contact's own
      // drag-strip handles drag and its menu still offers "Edit in Geology
      // stage", so the reference strip would only steal the litho contact's
      // pointer events.
      const lithoDepths = lithoDepthsByAnchor.get(anchorId)
      if (
        lithoDepths?.some(
          d => Math.abs(d - c.depth_top_m) <= REFERENCE_COINCIDENCE_EPSILON_M,
        )
      ) {
        continue
      }
      const col = colByAnchorId.get(anchorId)
      if (!col) continue
      const item = col.proj.item as { elevation_m: number | null }
      if (item.elevation_m === null) continue
      const segY = levelToScreen(item.elevation_m - c.depth_top_m)
      if (segY < plotTop - DRAG_HIT_HALF_HEIGHT_PX || segY > plotBottom + DRAG_HIT_HALF_HEIGHT_PX) {
        continue
      }
      const halfW = col.width / 2
      const formation = refFormationById.get(c.formation_id)
      const formationName = formation?.name ?? formation?.regional_ref ?? c.formation_id
      out.push({
        key: `ref-strip-${c.id}`,
        contactId: c.id,
        formationId: c.formation_id,
        formationName,
        segLeftX: col.nudgedX - halfW,
        segRightX: col.nudgedX + halfW,
        segY,
      })
    }
    return out
  }, [
    contacts,
    onEditInGeologyStage,
    referenceContacts,
    referenceFormations,
    placedColumns,
    levelToScreen,
    plotTop,
    plotBottom,
  ])

  // Geo-contact lookup index for the "Edit parent geological formation"
  // context-menu item on litho contacts (Bug 1 dogfeed 2026-05-26).
  //
  // WHY: the reference hit-strips (above) only cover geological formation
  // tops — i.e. one strip per geological formation per anchor.  A litho
  // section typically has MANY litho contacts per anchor (one per litho
  // unit), and most of those contacts are LITHO-LITHO boundaries within
  // a single geological formation — they have no reference strip.  But
  // the user still wants to right-click any litho contact and navigate
  // to the geology stage to edit the parent formation.
  //
  // The index maps: anchorId → geoFormationId → geologicalContactId.
  // Built from referenceContacts (the geological contacts forwarded on
  // the litho axis).  O(1) lookup per litho contact right-click.
  const refGeoContactByAnchorAndFormation = useMemo(() => {
    const out = new Map<string, Map<string, string>>()
    if (!referenceContacts) return out
    for (const c of referenceContacts) {
      const anchorId = c.borehole_id ?? c.cpt_id
      if (!anchorId) continue
      let inner = out.get(anchorId)
      if (!inner) {
        inner = new Map()
        out.set(anchorId, inner)
      }
      inner.set(c.formation_id, c.id)
    }
    return out
  }, [referenceContacts])

  // Formation-by-id index for the same context-menu lookup.  Keyed by
  // litho formation id; value holds ``parent_formation_id`` (null for
  // geological / geotechnical formations that have no parent).
  const lithoFormationById = useMemo(() => {
    const m = new Map<string, GeologicalFormationResponse>()
    for (const f of formations) m.set(f.id, f)
    return m
  }, [formations])

  // Return null only when there is genuinely nothing to paint —
  // EITHER backdrop source counts as "something to paint" so the
  // snap-to-contact backdrop (referenceContacts) still renders on a
  // pre-pick litho section.
  if (
    layers.length === 0 &&
    polylines.length === 0 &&
    backdropPolylines.length === 0 &&
    backdropContactPolylines.length === 0 &&
    referenceContactHitStrips.length === 0
  ) {
    return null
  }

  // Per-render override: when a layer is part of the drag, replace
  // its segY + (when re-anchoring) segLeftX/Right/labelX with the
  // drag's live target. Each non-primary contact follows the
  // primary's Δm and the primary's target column.
  function applyDragOverride(layer: RenderedLayer): RenderedLayer {
    if (drag === null) return layer
    const inDrag = drag.contactsInDrag.find(c => c.contactId === layer.contactId)
    if (!inDrag) return layer
    const isPrimary = layer.contactId === drag.contactId
    // The primary contact's new depth is read straight from the drag
    // state. Non-primary contacts follow the same Δm.
    const startDepth = (drag.startSegY - drag.surfaceY) / drag.pxPerMetre
    const deltaM = drag.currentDepthM - startDepth
    const newDepthM = isPrimary
      ? drag.currentDepthM
      : Math.max(0, inDrag.originalDepthM + deltaM)
    // Y coordinate: when re-anchoring, project against the target
    // column's surface; otherwise project against this contact's
    // source surface.
    const target = drag.currentTargetCol
    let newSurfaceY = inDrag.sourceSurfaceY
    let newPxPerMetre = inDrag.sourcePxPerMetre
    let newSegLeftX = layer.segLeftX
    let newSegRightX = layer.segRightX
    let newLabelX = layer.labelX
    if (target !== null) {
      const targetProj = surfaceYForColumn(target, levelToScreen)
      if (
        targetProj.surfaceElevationM !== null &&
        targetProj.pxPerMetre !== 0
      ) {
        newSurfaceY = targetProj.surfaceY
        newPxPerMetre = targetProj.pxPerMetre
        const halfW = target.width / 2
        newSegLeftX = target.nudgedX - halfW
        newSegRightX = target.nudgedX + halfW
        newLabelX = target.nudgedX
      }
    }
    const newSegY = newSurfaceY + newDepthM * newPxPerMetre
    return {
      ...layer,
      segY: newSegY,
      bodyTopY: clamp(newSegY, plotTop, plotBottom),
      // bodyBottom is conceptually less meaningful during the drag
      // (the "next-deeper contact" may also be moving) — clamp to
      // plotBottom so the ghost slab doesn't blow off the edge.
      bodyBottomY: layer.bodyBottomY,
      segLeftX: newSegLeftX,
      segRightX: newSegRightX,
      labelX: newLabelX,
    }
  }

  return (
    <>
    <g>
      {/* ---- Geological backdrop (litho axis only) ----------------
          Read-only slice-of-TIN for the reference geological model,
          rendered BEFORE the active litho layer so the geological
          context sits visually underneath.  Fresh surfaces render at
          strokeOpacity 0.25 (solid); stale surfaces at 0.12 (dashed
          "8 4").  pointerEvents="none" — never hit-tested. */}
      {backdropPolylines.map(line => (
        <path
          key={`backdrop-${line.formationId}`}
          d={line.d}
          stroke={line.color}
          strokeWidth={1}
          strokeOpacity={line.isStale ? 0.12 : 0.25}
          strokeDasharray={line.isStale ? '8 4' : undefined}
          fill="none"
          pointerEvents="none"
          data-testid={`backdrop-surface-${line.formationId}`}
          data-stale={line.isStale ? 'true' : undefined}
        />
      ))}
      {/* Snap-to-contact backdrop — polyline straight through every
          column with a geological contact for the formation. Painted
          AFTER the TIN-slice backdrop above so the contact-anchored
          line wins where they overlap. Solid stroke + higher opacity
          than the TIN backdrop because the contact picks are the
          user's intent — they're authoritative truth.

          Bug A fix (dogfeed 2026-05-26): when ``onEditInGeologyStage``
          is wired (litho axis), each backdrop line also carries a fat
          transparent hit-path (strokeWidth=10, pointerEvents="stroke")
          so right-clicking anywhere on or near the line — including in
          the gutters between columns — opens the geology contact menu.
          The nearest column by horizontal distance resolves which
          geological contact to navigate to; ties break in favour of the
          left-most anchor (stable, deterministic). */}
      {backdropContactPolylines.map(line => (
        <g key={`backdrop-contact-${line.formationId}`}>
          {/* Visible line — thin, subordinate opacity, non-interactive. */}
          <path
            d={line.d}
            stroke={line.color}
            strokeWidth={1.25}
            strokeOpacity={0.55}
            fill="none"
            pointerEvents="none"
            data-testid={`backdrop-contact-${line.formationId}`}
          />
          {/* Fat invisible hit-path — absorbs right-clicks anywhere along
              the backdrop line (including the gutter between columns)
              when the geology deep-link is wired.  ``pointerEvents="stroke"``
              keeps the fill area non-interactive so only clicks near the
              stroke register.  Left-clicks are not intercepted (no
              onClick) so pan + marquee gestures pass through unchanged. */}
          {onEditInGeologyStage && (
            <path
              d={line.d}
              stroke="transparent"
              strokeWidth={10}
              fill="none"
              style={{ cursor: 'context-menu' }}
              pointerEvents="stroke"
              onContextMenu={e => {
                e.preventDefault()
                // Resolve nearest column by horizontal SVG-coord distance.
                // SVG coordinates: clientX minus the SVG element's left edge.
                const svgEl = (e.target as Element).closest('svg')
                const svgLeft = svgEl?.getBoundingClientRect().left ?? 0
                const clickX = e.clientX - svgLeft
                let nearestAnchorId: string | null = null
                let nearestDist = Infinity
                for (const col of placedColumns) {
                  const dist = Math.abs(col.nudgedX - clickX)
                  if (dist < nearestDist) {
                    nearestDist = dist
                    nearestAnchorId = (col.proj.item as { id: string }).id
                  }
                }
                if (!nearestAnchorId) return
                // Look up the geological contact for this formation + anchor.
                const geoContactId = refGeoContactByAnchorAndFormation
                  .get(nearestAnchorId)
                  ?.get(line.formationId) ?? null
                if (!geoContactId) return
                // Find formation name for the context menu header.
                const refFormation = referenceFormations?.find(f => f.id === line.formationId)
                const formationName = refFormation?.name ?? refFormation?.regional_ref ?? line.formationId
                setContactMenu({
                  clientX: e.clientX,
                  clientY: e.clientY,
                  contactId: geoContactId,
                  formationId: line.formationId,
                  formationName,
                  anchorKind: 'borehole',
                  anchorId: nearestAnchorId,
                  isReferenceContact: true,
                })
              }}
            />
          )}
        </g>
      ))}
      {/* Debt #151 — per-column right-click capture rect (litho axis
          only).  Spans the full plot area BEHIND the litho bands so
          the band's own contextmenu handler fires first when the
          click lands on a band; right-clicks on empty space fall
          through to this rect's contextmenu in ``add`` mode.  This
          is the fallback when the user has deleted enough units that
          no band remains on the column (owner directive 2026-05-27
          dogfeed refinement).  Insert via LEFT-click on a band stays
          as the primary entry — this is just the no-band escape. */}
      {perColumnBandsFromContacts
        && placedColumns.map(col => {
          const item = col.proj.item as {
            id: string
            name: string
            elevation_m: number | null
          }
          if (item.elevation_m === null) return null
          const surface = surfaceYForColumn(col, levelToScreen)
          if (surface.surfaceElevationM === null || surface.pxPerMetre === 0) return null
          const halfW = col.width / 2
          return (
            <rect
              key={`pc-rclick-${item.id}`}
              data-testid={`per-column-rclick-capture-${item.id}`}
              x={col.nudgedX - halfW}
              y={plotTop}
              width={col.width}
              height={plotBottom - plotTop}
              fill="transparent"
              pointerEvents="all"
              onContextMenu={e => {
                e.preventDefault()
                e.stopPropagation()
                const rect = e.currentTarget.getBoundingClientRect()
                const svgY = plotTop + (e.clientY - rect.top)
                const depth = (svgY - surface.surfaceY) / surface.pxPerMetre
                if (depth < 0) return
                setLithoBandMenu({
                  clientX: e.clientX,
                  clientY: e.clientY,
                  mode: 'add',
                  anchorKind: col.kind,
                  anchorId: item.id,
                  anchorName: item.name,
                  elevationM: item.elevation_m as number,
                  depth_m: depth,
                })
              }}
            />
          )
        })}
      {/* Debt #142 follow-up — per-column litho bands.  Drawn even
          earlier than the cross-column formationFillBands so on the
          litho axis the user reads a per-column lithology stack
          underneath everything else.
          Debt #151 dogfeed refinement 2026-05-27: bands are the
          PRIMARY click surface for Add — LEFT-click opens the picker
          at the click depth.  Right-click still opens the remove
          menu.  Empty-space right-click also opens an Add menu as a
          fallback (via the capture rect rendered above this block). */}
      {perColumnLithoBands.map(band => (
        <rect
          key={`pc-litho-${band.key}`}
          data-testid={`per-column-litho-band-${band.key}`}
          x={band.x}
          y={band.y}
          width={band.width}
          height={band.height}
          fill={band.color}
          fillOpacity={bandFillOpacity}
          stroke="none"
          pointerEvents="auto"
          style={onRequestAddLithoSuggestion ? { cursor: 'pointer' } : undefined}
          onContextMenu={e => {
            e.preventDefault()
            e.stopPropagation()
            setLithoBandMenu({
              clientX: e.clientX,
              clientY: e.clientY,
              mode: 'remove',
              contactId: band.contactId,
              formationName: band.formationName,
            })
          }}
          onClick={
            onRequestAddLithoSuggestion
              ? e => {
                  e.stopPropagation()
                  if (band.anchorElevationM === null) return
                  // Use ownerSVGElement's bounding rect to map clientY
                  // into svg-coords — works in both real browser and
                  // jsdom (which returns 0 for everything).  Depth =
                  // (svg-Y - surfaceY) / pxPerMetre, mirroring the
                  // drag handler's depth math.
                  const svg = e.currentTarget.ownerSVGElement
                  if (!svg) return
                  const svgRect = svg.getBoundingClientRect()
                  const svgY = e.clientY - svgRect.top
                  const depth = (svgY - band.anchorSurfaceY) / band.anchorPxPerMetre
                  if (depth < 0) return
                  onRequestAddLithoSuggestion(
                    band.anchorKind,
                    band.anchorId,
                    depth,
                    band.anchorName,
                    band.anchorElevationM,
                  )
                }
              : undefined
          }
        >
          {onRequestAddLithoSuggestion && (
            <title>Click to insert new layer here · right-click to remove</title>
          )}
        </rect>
      ))}
      {/* Filled coloured bands between adjacent formation tops.
          Drawn FIRST so every other section element (CPT curves,
          column glyphs, contact lines, labels) paints on top. The
          band's colour matches its formation's top-polyline colour;
          low opacity keeps the underlying curves legible. */}
      {formationFillBands.map(band => (
        <path
          key={`fill-${band.formationId}`}
          d={band.d}
          fill={band.color}
          fillOpacity={band.isStale ? 0.08 : bandFillOpacity}
          stroke="none"
          pointerEvents="none"
          data-testid={`formation-fill-${band.formationId}`}
        />
      ))}
      {/* Slice-of-TIN polylines. Drawn first (under everything else)
          so the per-column tops + name labels paint on top. Solid
          stroke distinguishes them from the dashed connect-the-dots
          fallback — the user sees at a glance which formations have a
          full surface vs. which are still 2-pick tie-lines. */}
      {renderFormationSurfaces && slicedPolylines.map(line => {
        // On-click build pivot: stale TINs render dashed + faded so
        // the engineer can see "this is your last build, refresh to
        // update". Distinct from the connect-the-dots fallback (also
        // dashed but with a longer pattern + different opacity).
        //
        // Debt #28 follow-up (2026-05-21): true per-segment gradient.
        // Each segment renders as its own ``<path>`` with continuous
        // strokeOpacity derived from the underlying triangle confidence.
        // When the confidence-fade toggle is OFF, fall back to a single
        // concatenated path with uniform opacity (zero rendering cost
        // overhead vs the gradient path, and visually disables the fade).
        const baseOpacity = line.isStale ? 0.35 : 0.7
        const dash = line.isStale ? '6 3' : undefined
        return (
          <g
            key={`slice-${line.formationId}`}
            data-testid={`formation-surface-${line.formationId}`}
            data-stale={line.isStale ? 'true' : undefined}
          >
            {showConfidenceFade ? (
              line.segments.map((seg, i) => (
                <path
                  key={i}
                  d={seg.d}
                  stroke={line.color}
                  strokeWidth={1.25}
                  strokeOpacity={baseOpacity * seg.opacity}
                  strokeDasharray={dash}
                  fill="none"
                  pointerEvents="none"
                />
              ))
            ) : (
              <path
                d={line.dUniform}
                stroke={line.color}
                strokeWidth={1.25}
                strokeOpacity={baseOpacity}
                strokeDasharray={dash}
                fill="none"
                pointerEvents="none"
              />
            )}
          </g>
        )
      })}
      {/* Cross-column polylines (formation surfaces).
          Two roles in one renderer:
          1. No TIN slice for the formation → render every segment
             (legacy connect-the-dots fallback).
          2. TIN slice exists → render only the segments that REACH
             BEYOND the slice's screen-X coverage. The TIN slice
             stops at its hull; anchors outside that hull keep their
             contact line via these extrapolation segments. Segments
             fully inside the slice's X span are skipped so the slice
             paints alone in its covered region (no visible chord
             under a curving slice). The user's "lines should draw
             through" requirement is satisfied by these segments. */}
      {renderFormationSurfaces && polylines.map(line => {
        if (line.vertices.length < 2) return null
        const sliceRange = slicedXRangeByFormationId.get(line.formationId)
        // Project each vertex with the same drag-override logic as
        // before so multi-drag previews stay coherent.
        const projected = line.vertices.map(v => {
          let y = v.screenY
          if (drag !== null) {
            const inDrag = drag.contactsInDrag.find(
              c => c.contactId === v.contactId,
            )
            if (inDrag) {
              const startDepth =
                (drag.startSegY - drag.surfaceY) / drag.pxPerMetre
              const deltaM = drag.currentDepthM - startDepth
              const newDepthM =
                v.contactId === drag.contactId
                  ? drag.currentDepthM
                  : Math.max(0, inDrag.originalDepthM + deltaM)
              const target = drag.currentTargetCol
              if (target !== null) {
                const tProj = surfaceYForColumn(target, levelToScreen)
                if (
                  tProj.surfaceElevationM !== null &&
                  tProj.pxPerMetre !== 0
                ) {
                  y = tProj.surfaceY + newDepthM * tProj.pxPerMetre
                }
              } else {
                y = inDrag.sourceSurfaceY + newDepthM * inDrag.sourcePxPerMetre
              }
            }
          }
          return { x: v.screenX, y }
        })
        // Halfspace extrapolation — prepend / append synthetic vertices
        // at the section's plot bounds with the leftmost / rightmost
        // real vertex's Y, so the formation line extends LATERALLY
        // past the last anchor that has a contact (gINT / LeapFrog
        // convention: formations are presumed continuous). Synthetic
        // vertices fall well outside any slice's X range so they
        // always render (segment to/from them is "outside slice").
        // Guarded by both plotLeft/plotRight being wired and the
        // synthetic point being strictly outside the real range so
        // we don't insert a duplicate at the same X.
        if (projected.length > 0) {
          const leftmost = projected[0]
          const rightmost = projected[projected.length - 1]
          if (plotLeft !== undefined && plotLeft < leftmost.x) {
            projected.unshift({ x: plotLeft, y: leftmost.y })
          }
          if (plotRight !== undefined && plotRight > rightmost.x) {
            projected.push({ x: plotRight, y: rightmost.y })
          }
        }
        // Build the path with M/L commands, emitting `M` (start a new
        // sub-path) when the previous segment was skipped. A segment
        // is skipped only when BOTH endpoints fall inside the slice's
        // X span — anything that reaches outside renders, so a vertex
        // at the slice's edge connects to the next outside vertex.
        let path = ''
        let prevDrawn = false
        for (let i = 0; i < projected.length; i += 1) {
          const cur = projected[i]
          if (i === 0) {
            path += `M ${cur.x.toFixed(2)} ${cur.y.toFixed(2)} `
            prevDrawn = true
            continue
          }
          const prev = projected[i - 1]
          const segmentInsideSlice =
            sliceRange !== undefined &&
            prev.x >= sliceRange.minX &&
            prev.x <= sliceRange.maxX &&
            cur.x >= sliceRange.minX &&
            cur.x <= sliceRange.maxX
          if (segmentInsideSlice) {
            // Skip this segment — slice covers it. Next vertex needs
            // a fresh M so any subsequent drawn segment doesn't drag
            // a line back into the slice region.
            path += `M ${cur.x.toFixed(2)} ${cur.y.toFixed(2)} `
            prevDrawn = false
          } else {
            path += `L ${cur.x.toFixed(2)} ${cur.y.toFixed(2)} `
            prevDrawn = true
          }
        }
        // If every segment was skipped (entire range inside slice),
        // there's nothing to draw — the path is just `M` moves and
        // SVG would render nothing anyway, but emitting null is
        // cleaner and saves the DOM node.
        if (!prevDrawn && sliceRange !== undefined) {
          // Walked through and every segment was inside the slice.
          // (prevDrawn === false here can also mean only the final
          // segment was skipped; the `M` would have set it false but
          // earlier `L`s might have set it true. Cheap check: did we
          // emit any `L`?)
          if (!path.includes('L')) return null
        }
        // In surfaceThroughPicks mode this polyline IS the surface line
        // (the slice render is suppressed), so it must carry the slice's
        // built/stale semantics: a built surface reads solid like the old
        // slice (0.7, no dash), a stale one dashed + faded (0.35, '6 3').
        // Without a surface row it stays the dashed connect-the-dots
        // fallback (0.55, '4 3'). When surfaceThroughPicks is false the
        // styling is unchanged (legacy fallback) so existing behaviour and
        // the slice render are untouched.
        const polySurface = surfaceThroughPicks
          ? surfacesByFormationId?.get(line.formationId)
          : undefined
        const polyBuilt = polySurface !== undefined && polySurface.triangles.length > 0
        const polyStale = polySurface?.is_stale === true
        const polyStrokeWidth = polyBuilt ? 1.25 : 1
        const polyStrokeOpacity = polyBuilt ? (polyStale ? 0.35 : 0.7) : 0.55
        const polyDash = polyBuilt ? (polyStale ? '6 3' : undefined) : '4 3'
        return (
          <path
            key={`poly-${line.formationId}`}
            d={path}
            stroke={line.color}
            strokeWidth={polyStrokeWidth}
            strokeOpacity={polyStrokeOpacity}
            strokeDasharray={polyDash}
            fill="none"
            pointerEvents="none"
            data-testid={`formation-polyline-${line.formationId}`}
          />
        )
      })}

      {/* Per-column horizontal segments at each contact top + name
          label in the layer's vertical middle. Each layer is one
          formation slab at one column. The drag hit-strip sits on
          top of the segment and the visible line + label paint
          underneath. */}
      {layers.map(rawLayer => {
        const layer = applyDragOverride(rawLayer)
        // Debt #151 dogfeed refinement 2026-05-27 — when a pending
        // ghost overlaps the slab's depth range, shift the label to
        // the LARGEST visible (non-ghost) sub-piece so the user sees
        // the original formation's name on the piece it actually
        // covers, not floating over the ghost.  Subtract the ghost
        // ranges in depth space, convert each surviving piece to
        // screen y-coords, pick the tallest.
        const ghostHoles = pendingGhostRangesByAnchorId?.get(layer.anchorId) ?? []
        let labelY = (layer.bodyTopY + layer.bodyBottomY) / 2
        let labelPieceHeight = layer.bodyBottomY - layer.bodyTopY
        if (ghostHoles.length > 0) {
          // Convert the slab's bodyTopY / bodyBottomY back to depth in
          // metres (the geometric inverse of levelToScreen) so we can
          // subtract ghost holes in depth-space, then convert each
          // surviving piece back to screen y.
          const topDepthM = (layer.bodyTopY - layer.surfaceY) / layer.pxPerMetre
          const baseDepthM = (layer.bodyBottomY - layer.surfaceY) / layer.pxPerMetre
          let pieces: Array<{ topM: number; baseM: number }> = [
            { topM: topDepthM, baseM: baseDepthM },
          ]
          for (const hole of ghostHoles) {
            pieces = pieces.flatMap(p => {
              if (hole.depth_base_m <= p.topM || hole.depth_top_m >= p.baseM) return [p]
              const out: Array<{ topM: number; baseM: number }> = []
              if (hole.depth_top_m > p.topM) out.push({ topM: p.topM, baseM: hole.depth_top_m })
              if (hole.depth_base_m < p.baseM) out.push({ topM: hole.depth_base_m, baseM: p.baseM })
              return out
            })
          }
          if (pieces.length > 0) {
            // Pick the tallest surviving piece.
            const best = pieces.reduce((a, b) =>
              b.baseM - b.topM > a.baseM - a.topM ? b : a,
            )
            const yTop = layer.surfaceY + best.topM * layer.pxPerMetre
            const yBot = layer.surfaceY + best.baseM * layer.pxPerMetre
            labelY = (yTop + yBot) / 2
            labelPieceHeight = Math.abs(yBot - yTop)
          } else {
            // Entire slab eaten by a ghost — hide the label.
            labelPieceHeight = 0
          }
        }
        const showLabel = labelPieceHeight >= LAYER_LABEL_MIN_HEIGHT_PX
        const labelWidth = layer.segRightX - layer.segLeftX
        const display = showLabel ? truncateToWidth(layer.formationName, labelWidth) : ''
        const isDragged = drag !== null && drag.contactId === layer.contactId
        const isSelected = selection.has(layer.contactId)
        const isFocused = focusedContactIds?.has(layer.contactId) ?? false
        // #143 — litho contacts get a high-contrast boundary (near-black +
        // light halo) so the accepted contact reads against its own band;
        // geological contacts keep the formation-coloured line.
        const isLithoContact =
          lithoFormationById.get(layer.formationId)?.litho_main_soil_code != null
        const lineWidth = isDragged ? 2.5 : 1.75
        return (
          <g key={layer.key}>
            {/* Selection halo — drawn under the top segment so the
                segment colour stays unambiguous. Slate-blue accent
                per CLAUDE.md Primer-mapped tokens. */}
            {isSelected &&
              layer.segY >= plotTop &&
              layer.segY <= plotBottom && (
                <line
                  x1={layer.segLeftX - 2}
                  x2={layer.segRightX + 2}
                  y1={layer.segY}
                  y2={layer.segY}
                  stroke="#2563eb"
                  strokeWidth={4}
                  strokeOpacity={0.35}
                  pointerEvents="none"
                />
              )}
            {/* Focus ring + pulse — fired by the crossings banner
                click intent (debt #9). Amber, matching the banner
                colour, so the visual association is obvious. The
                inner static ring marks the offending pick; the
                concentric SMIL-animated circle pulses outward to
                draw the eye. Cleared after the parent's timeout. */}
            {isFocused &&
              layer.segY >= plotTop &&
              layer.segY <= plotBottom && (
                <g pointerEvents="none" data-testid="contact-focus-ring">
                  <line
                    x1={layer.segLeftX - 3}
                    x2={layer.segRightX + 3}
                    y1={layer.segY}
                    y2={layer.segY}
                    stroke="#d97706"
                    strokeWidth={5}
                    strokeOpacity={0.4}
                  />
                  <circle
                    cx={layer.labelX}
                    cy={layer.segY}
                    r={6}
                    fill="none"
                    stroke="#d97706"
                    strokeWidth={2}
                  />
                  <circle
                    cx={layer.labelX}
                    cy={layer.segY}
                    r={6}
                    fill="none"
                    stroke="#d97706"
                    strokeWidth={2}
                    opacity={0.7}
                  >
                    <animate
                      attributeName="r"
                      from="6"
                      to="18"
                      dur="1.2s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      from="0.7"
                      to="0"
                      dur="1.2s"
                      repeatCount="indefinite"
                    />
                  </circle>
                </g>
              )}
            {/* Top segment — only when the top sits inside the plot
                area, otherwise the layer extends off the top edge
                and the segment would draw on the chrome. Litho contacts
                (#143) paint a light halo first, then a near-black line on
                top, so the boundary reads against its own band fill. */}
            {layer.segY >= plotTop && layer.segY <= plotBottom && (
              <>
                {isLithoContact && (
                  <line
                    data-testid={`contact-line-halo-${layer.contactId}`}
                    x1={layer.segLeftX}
                    x2={layer.segRightX}
                    y1={layer.segY}
                    y2={layer.segY}
                    stroke={LITHO_CONTACT_HALO_COLOR}
                    strokeWidth={lineWidth + 2}
                    strokeOpacity={0.6}
                    pointerEvents="none"
                  />
                )}
                <line
                  data-testid={`contact-line-${layer.contactId}`}
                  x1={layer.segLeftX}
                  x2={layer.segRightX}
                  y1={layer.segY}
                  y2={layer.segY}
                  stroke={isLithoContact ? LITHO_CONTACT_LINE_COLOR : layer.color}
                  strokeWidth={lineWidth}
                  strokeOpacity={0.95}
                  pointerEvents="none"
                />
              </>
            )}
            {showLabel && (
              // The label truncates to the (often narrow) band width,
              // so long formation names ("Paleogeen: Formatie van
              // Kortrijk - Lid van Aalbeke") lose the distinguishing
              // tail. The <title> child gives a native hover tooltip
              // with the full, untruncated name. pointerEvents is
              // intentionally NOT "none" so the tooltip is reachable;
              // this is safe because SectionPanel.handleMouseDown reads
              // e.currentTarget (the SVG), never e.target, and the text
              // has no mousedown handler — the event still bubbles, so
              // pan / marquee / shift-select are unaffected.
              <text
                x={layer.labelX}
                y={labelY}
                fontSize={9}
                fill={layer.color}
                fontWeight={500}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ cursor: 'help' }}
              >
                <title>{layer.formationName}</title>
                {display}
              </text>
            )}
            {/* Litho↔geo coupling glyph (#162) — a small chain-link icon
                at the right edge of the contact line.  Shown only when the
                contact carries a parent_geo_contact_id so the user can see
                at a glance which accepted contacts are bound to the
                geological surface.  pointerEvents="none" so it doesn't
                interfere with drag / context-menu hit-testing.
                Owner directive 2026-06-05 (litho declutter): hidden on the
                litho axis unless correlate mode is active — the per-contact
                amber dots are noise when the partition fill is the primary
                interaction surface; correlate mode restores them so the user
                can click contacts for the correlate gesture. */}
            {(axisMode !== 'lithostratigraphic' || correlateMode) &&
              contacts.find(c => c.id === layer.contactId)?.parent_geo_contact_id != null &&
              layer.segY >= plotTop &&
              layer.segY <= plotBottom && (
                <g
                  transform={`translate(${layer.segRightX - 14}, ${layer.segY - 5})`}
                  pointerEvents="none"
                  data-testid={`coupling-glyph-${layer.contactId}`}
                >
                  {/* Chain-link icon: two rings joined by a bar — communicates
                      "linked to geology" without text. Amber matches the
                      litho accept colour palette. */}
                  <rect x={0} y={3} width={14} height={4} rx={2} fill="#f59e0b" opacity={0.85} />
                  <circle cx={3} cy={5} r={3} fill="none" stroke="#f59e0b" strokeWidth={1.5} opacity={0.85} />
                  <circle cx={11} cy={5} r={3} fill="none" stroke="#f59e0b" strokeWidth={1.5} opacity={0.85} />
                  <title>Coupled to geological contact — right-click to unlink</title>
                </g>
              )}
            {/* Transparent hit-strip — wider than the visible line so
                the user can grab without precision aiming. Rendered
                whenever either an edit OR a delete OR a pinch-out
                handler is wired so the lines participate in pointer
                events; without all three they stay fully
                non-interactive. */}
            {!correlateMode &&
              (onUpdateContactDepth || onDeleteContact || onUnlinkLithoFromGeo || onLinkLithoToGeo || onOpenEndLayer) &&
              layer.segY >= plotTop - DRAG_HIT_HALF_HEIGHT_PX &&
              layer.segY <= plotBottom + DRAG_HIT_HALF_HEIGHT_PX && (
                <rect
                  x={layer.segLeftX}
                  y={layer.segY - DRAG_HIT_HALF_HEIGHT_PX}
                  width={layer.segRightX - layer.segLeftX}
                  height={DRAG_HIT_HALF_HEIGHT_PX * 2}
                  fill="transparent"
                  style={{ cursor: isDragged ? 'grabbing' : 'ns-resize' }}
                  onMouseDown={
                    onUpdateContactDepth
                      ? e => handleStripMouseDown(rawLayer, e)
                      : undefined
                  }
                  onContextMenu={
                    onDeleteContact || onUnlinkLithoFromGeo || onLinkLithoToGeo || onOpenEndLayer || onEditInGeologyStage
                      ? e => {
                          e.preventDefault()
                          // Resolve the parent geological contact id so the
                          // menu can offer "Edit in Geology stage" for any
                          // litho contact whose formation has a parent
                          // geological formation (Bug 1 dogfeed 2026-05-26).
                          const lithoFormation = lithoFormationById.get(layer.formationId)
                          const parentFormationId = lithoFormation?.parent_formation_id ?? null
                          const parentGeoContactId =
                            onEditInGeologyStage && parentFormationId
                              ? (refGeoContactByAnchorAndFormation
                                  .get(layer.anchorId)
                                  ?.get(parentFormationId) ?? null)
                              : null
                          // Portal-rendered menu uses position:fixed with
                          // viewport clientX/Y so no container-rect math.
                          // Coupling check: look up the contact to see if it
                          // has a parent_geo_contact_id (litho↔geo coupling
                          // #162) so the "Unlink from geology" item can be
                          // conditional without adding the field to LayerSlabData.
                          const isCoupledToGeo =
                            (contacts.find(c => c.id === layer.contactId)
                              ?.parent_geo_contact_id ?? null) != null
                          setContactMenu({
                            clientX: e.clientX,
                            clientY: e.clientY,
                            contactId: layer.contactId,
                            formationId: layer.formationId,
                            formationName: layer.formationName,
                            anchorKind: layer.anchorKind,
                            anchorId: layer.anchorId,
                            parentGeoContactId,
                            isCoupledToGeo,
                          })
                        }
                      : undefined
                  }
                  data-contact-id={layer.contactId}
                  data-testid="contact-drag-strip"
                >
                  {/* Same full-name tooltip on the grab-strip so the
                      formation is identifiable by hovering the contact
                      line itself — also covers short slabs where the
                      middle label is suppressed (showLabel === false). */}
                  <title>{layer.formationName}</title>
                </rect>
              )}
          </g>
        )
      })}

      {/* Reference-contact hit-strips (litho axis, deep-link enabled).
          Invisible rects placed at each geological (reference) contact's
          depth position; right-click → "Edit in Geology stage" menu item.
          WHY rendered AFTER the active-litho layers block: SVG paint order
          determines pointer-event priority — later elements sit on top.
          Moving these strips here ensures right-click on a geological
          formation band wins over any overlapping litho contact hit-strip
          at the same depth (dogfeed 2026-05-25 Slice D fix). */}
      {referenceContactHitStrips.map(strip => (
        <rect
          key={strip.key}
          x={strip.segLeftX}
          y={strip.segY - DRAG_HIT_HALF_HEIGHT_PX}
          width={strip.segRightX - strip.segLeftX}
          height={DRAG_HIT_HALF_HEIGHT_PX * 2}
          fill="transparent"
          style={{ cursor: 'context-menu', pointerEvents: 'all' }}
          onContextMenu={e => {
            e.preventDefault()
            setContactMenu({
              clientX: e.clientX,
              clientY: e.clientY,
              contactId: strip.contactId,
              formationId: strip.formationId,
              formationName: strip.formationName,
              anchorKind: 'borehole',
              anchorId: '',
              isReferenceContact: true,
            })
          }}
          data-testid="ref-contact-drag-strip"
          data-contact-id={strip.contactId}
        >
          <title>{strip.formationName} — right-click to edit in Geology stage</title>
        </rect>
      ))}

      {/* Drag readout — depth + mTAW always, plus qc + Rf when the
          contact is anchored at a CPT (mirrors ContactPickBar so the
          drag flow surfaces the same depth-series values as the
          hover-pick flow). Same card shape used elsewhere.

          Debt #134-B: when the litho axis supplies a snap tolerance +
          referenceContacts (the geological backdrop), the readout
          gains a "↦ snap on release: 12.34 m" line whenever the
          current drag depth falls within ±tolerance of a geo contact
          on the same anchor — telegraphing that the post-release
          prompt will fire so the user can re-aim BEFORE letting go. */}
      {drag !== null && (() => {
        const elevation = drag.surfaceElevationM - drag.currentDepthM
        const lines: { text: string; color: string }[] = [
          { text: `depth ${drag.currentDepthM.toFixed(2)} m`, color: drag.color },
          {
            text: `${elevation >= 0 ? '+' : ''}${elevation.toFixed(2)} m TAW`,
            color: drag.color,
          },
        ]
        if (drag.anchorKind === 'cpt' && getCptValuesAtDepth) {
          const v = getCptValuesAtDepth(drag.anchorId, drag.currentDepthM)
          if (v) {
            lines.push({
              text: `qc ${v.qc === null ? '—' : `${v.qc.toFixed(2)} MPa`}`,
              color: '#111827',
            })
            lines.push({
              text: `Rf ${v.rf === null ? '—' : `${v.rf.toFixed(2)} %`}`,
              color: '#b45309',
            })
          }
        }
        // Debt #134-B: pre-release snap-zone hint.  Only fires when
        // the parent has provided a geo-snap tolerance AND a non-empty
        // referenceContacts set (geological backdrop on the litho
        // axis).  Picks the nearest candidate so the readout reflects
        // exactly which depth the prompt would offer first.
        let geoSnapHintText: string | null = null
        if (
          geoSnapToleranceM !== undefined &&
          referenceContacts !== undefined &&
          referenceContacts.length > 0
        ) {
          const cands = findGeoSnapCandidates(
            drag.currentDepthM,
            drag.anchorId,
            referenceContacts,
            geoSnapToleranceM,
          )
          if (cands.length > 0) {
            geoSnapHintText = `↦ snap on release: ${cands[0].depth_top_m.toFixed(2)} m`
          }
        }
        if (geoSnapHintText !== null) {
          // ``status-amber``-equivalent hex so the badge reads as
          // "telegraph, not yet committed" — same family of cue the
          // amber tints elsewhere use for in-progress / about-to-fire.
          lines.push({ text: geoSnapHintText, color: '#b45309' })
        }
        return (
          <g pointerEvents="none" data-testid="contact-drag-readout">
            <HoverReadoutCard
              x={drag.segRightX + 8}
              y={drag.surfaceY + drag.currentDepthM * drag.pxPerMetre}
              plotTop={drag.plotTop}
              plotBottom={drag.plotBottom}
              lines={lines}
            />
            {geoSnapHintText !== null && (
              <rect
                data-testid="geo-snap-indicator"
                x={drag.segRightX + 4}
                y={drag.surfaceY + drag.currentDepthM * drag.pxPerMetre - 1}
                width={3}
                height={3}
                fill="#b45309"
                pointerEvents="none"
              />
            )}
          </g>
        )
      })()}

      {/* Live marquee preview — drawn only when the user has moved
          past the click-threshold so a plain background click never
          flashes a rect. Dashed slate-blue stroke matches the
          selection halo colour for visual coherence. */}
      {marquee &&
        (() => {
          const dx = Math.abs(marquee.currentClientX - marquee.startClientX)
          const dy = Math.abs(marquee.currentClientY - marquee.startClientY)
          if (
            dx < CLICK_TO_DRAG_THRESHOLD_PX &&
            dy < CLICK_TO_DRAG_THRESHOLD_PX
          ) {
            return null
          }
          const x1 =
            Math.min(marquee.startClientX, marquee.currentClientX) -
            marquee.svgLeft
          const x2 =
            Math.max(marquee.startClientX, marquee.currentClientX) -
            marquee.svgLeft
          const y1 =
            Math.min(marquee.startClientY, marquee.currentClientY) -
            marquee.svgTop
          const y2 =
            Math.max(marquee.startClientY, marquee.currentClientY) -
            marquee.svgTop
          return (
            <rect
              x={x1}
              y={y1}
              width={x2 - x1}
              height={y2 - y1}
              fill="#2563eb"
              fillOpacity={0.08}
              stroke="#2563eb"
              strokeWidth={1}
              strokeOpacity={0.7}
              strokeDasharray="4 3"
              pointerEvents="none"
              data-testid="contacts-marquee-preview"
            />
          )
        })()}
    </g>

    {/* Debt #151 — litho band right-click menu (Remove only).
        Portalled to document.body so it sits above all section
        chrome.  Add gesture moved to LEFT-click on the band itself
        (dogfeed refinement 2026-05-27). */}
    {lithoBandMenu
      && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 2147483646 }}
            onClick={() => setLithoBandMenu(null)}
            onContextMenu={e => {
              e.preventDefault()
              setLithoBandMenu(null)
            }}
          />
          <div
            data-testid="litho-band-context-menu"
            style={{
              position: 'fixed',
              left: lithoBandMenu.clientX,
              top: lithoBandMenu.clientY,
              zIndex: 2147483647,
              background: 'var(--color-surface-overlay, #1e293b)',
              border: '1px solid var(--color-border-default, #334155)',
              borderRadius: 6,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              minWidth: 200,
            }}
          >
            {lithoBandMenu.mode === 'remove' ? (
              <button
                type="button"
                data-testid="litho-band-remove"
                onClick={() => {
                  if (lithoBandMenu.mode !== 'remove') return
                  setDeletePending({
                    contactId: lithoBandMenu.contactId,
                    formationName: lithoBandMenu.formationName,
                  })
                  setLithoBandMenu(null)
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '6px 12px',
                  textAlign: 'left',
                  fontSize: 12,
                  color: 'var(--color-text-danger, #f87171)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Remove this litho unit
              </button>
            ) : (
              <button
                type="button"
                data-testid="litho-band-add"
                onClick={() => {
                  if (lithoBandMenu.mode !== 'add') return
                  onRequestAddLithoSuggestion?.(
                    lithoBandMenu.anchorKind,
                    lithoBandMenu.anchorId,
                    lithoBandMenu.depth_m,
                    lithoBandMenu.anchorName,
                    lithoBandMenu.elevationM,
                  )
                  setLithoBandMenu(null)
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '6px 12px',
                  textAlign: 'left',
                  fontSize: 12,
                  color: 'var(--color-text-primary, #e2e8f0)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Add new suggestion here
              </button>
            )}
          </div>
        </>,
        document.body,
      )}

    {/* Debt #151 dogfeed refinement 2026-05-27 — same-lithology merge
        prompt.  Fires after a delete completes when the resulting
        adjacency leaves two contacts that share a ``litho_main_soil_code``
        on the same anchor.  Confirming triggers a SECOND
        onDeleteContact on the redundant below-neighbour. */}
    {lithoMergePending && onDeleteContact
      && createPortal(
        <div
          data-testid="litho-merge-confirm-dialog"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2147483647,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              background: 'var(--color-surface-overlay, #1e293b)',
              border: '1px solid var(--color-border-default, #334155)',
              borderRadius: 6,
              padding: 20,
              minWidth: 360,
              color: 'var(--color-text-primary, #e2e8f0)',
            }}
          >
            <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              Merge adjacent {lithoMergePending.lithoCode} layers?
            </h2>
            <p style={{ fontSize: 12, lineHeight: 1.4, marginBottom: 16, color: 'var(--color-text-secondary, #94a3b8)' }}>
              Removing that contact left two {lithoMergePending.lithoCode}{' '}
              units adjacent.  Merging deletes the now-redundant
              boundary so they read as one continuous {lithoMergePending.lithoCode}{' '}
              band.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                data-testid="litho-merge-cancel"
                onClick={() => setLithoMergePending(null)}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  borderRadius: 4,
                  background: 'var(--color-surface-page, #0f172a)',
                  border: '1px solid var(--color-border-default, #334155)',
                  color: 'var(--color-text-primary, #e2e8f0)',
                  cursor: 'pointer',
                }}
              >
                Keep separate
              </button>
              <button
                type="button"
                data-testid="litho-merge-confirm"
                onClick={() => {
                  const redundantId = lithoMergePending.redundantContactId
                  setLithoMergePending(null)
                  void onDeleteContact(redundantId)
                }}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  borderRadius: 4,
                  background: 'var(--color-accent, #2563eb)',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Merge layers
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

    {/* Debt #152 — clamp popup.  Portalled to document.body so it can
        be a positioned <div> hovering above the section, near the
        cursor, while the drag is at the min-thickness clamp.  Fires
        only when ``contactDragClampMinThicknessM`` is set (litho
        axis) AND the cursor would commit past a peer's near-edge. */}
    {drag !== null
      && drag.currentClamped !== null
      && createPortal(
        <div
          data-testid="contact-drag-clamp-popup"
          style={{
            position: 'fixed',
            left: drag.currentClientX + 14,
            top: drag.currentClientY + 14,
            zIndex: 2147483647,
            pointerEvents: 'none',
            background: 'var(--color-surface-overlay, #1e293b)',
            border: '1px solid var(--color-border-default, #334155)',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 11,
            lineHeight: 1.35,
            color: 'var(--color-text-primary, #e2e8f0)',
            maxWidth: 240,
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}
        >
          Can&apos;t move further — right-click and delete the adjacent
          layer first, then drag to the next boundary.
        </div>,
        document.body,
      )}

    {/* Contact context menu — portalled to document.body so it can be a
        <div> without being nested inside the SVG element. */}
    {contactMenu &&
      createPortal(
        <ContactContextMenu
          clientX={contactMenu.clientX}
          clientY={contactMenu.clientY}
          formationName={contactMenu.formationName}
          // Reference contacts (geological backdrop on the litho axis)
          // only show "Edit in Geology stage".  Delete + pinch-out
          // belong on the geological axis, not the litho view.
          onEditInGeologyStage={
            onEditInGeologyStage &&
            (contactMenu.isReferenceContact ||
              contactMenu.parentGeoContactId != null)
              ? () => {
                  // Reference contact: the contactId IS the geological contact.
                  // Litho contact with a resolved parent: use the parent geo
                  // contact id so GeologyInspector focuses the right pick.
                  const geoContactId = contactMenu.isReferenceContact
                    ? contactMenu.contactId
                    : (contactMenu.parentGeoContactId ?? contactMenu.contactId)
                  const { formationId } = contactMenu
                  setContactMenu(null)
                  onEditInGeologyStage(geoContactId, formationId)
                }
              : undefined
          }
          onDelete={
            !contactMenu.isReferenceContact && onDeleteContact
              ? () => {
                  // Open the styled confirm dialog (debt #62 item 1).
                  // ContactContextMenu closes itself; we stash the
                  // pending-delete intent and the dialog drives the
                  // confirm-or-cancel branch.
                  setDeletePending({
                    contactId: contactMenu.contactId,
                    formationName: contactMenu.formationName,
                  })
                  setContactMenu(null)
                }
              : undefined
          }
          onUnlinkLithoFromGeo={
            !contactMenu.isReferenceContact &&
            contactMenu.isCoupledToGeo &&
            onUnlinkLithoFromGeo
              ? () => {
                  const { contactId } = contactMenu
                  setContactMenu(null)
                  void onUnlinkLithoFromGeo(contactId)
                }
              : undefined
          }
          onLinkLithoToGeo={
            !contactMenu.isReferenceContact &&
            !contactMenu.isCoupledToGeo &&
            onLinkLithoToGeo
              ? () => {
                  const { contactId } = contactMenu
                  setContactMenu(null)
                  void onLinkLithoToGeo(contactId)
                }
              : undefined
          }
          onOpenEnd={
            !contactMenu.isReferenceContact && onOpenEndLayer
              ? side => {
                  const { contactId, formationId, anchorId } = contactMenu
                  setContactMenu(null)
                  onOpenEndLayer(contactId, formationId, anchorId, side)
                }
              : undefined
          }
          onPinchOut={
            !contactMenu.isReferenceContact && onPinchOutLayer
              ? side => {
                  const { contactId, formationId, anchorId } = contactMenu
                  setContactMenu(null)
                  onPinchOutLayer(contactId, formationId, anchorId, side)
                }
              : undefined
          }
          onClose={() => setContactMenu(null)}
        />,
        document.body,
      )}
    {/* Delete-contact confirmation dialog (debt #62 item 1). Replaces
        the prior window.confirm with a Modal that default-focuses
        Cancel and labels its destructive button "Delete contact". */}
    {deletePending && onDeleteContact && (
      <DeleteContactConfirmDialog
        open
        formationName={deletePending.formationName}
        onConfirm={() => {
          const id = deletePending.contactId
          // Debt #151 dogfeed refinement 2026-05-27 — detect
          // same-lithology adjacency on the PRE-deletion snapshot so
          // the popup can fire immediately after the delete fires.
          // The redundant boundary is the deeper of the two
          // matching-litho neighbours; deleting it collapses the
          // pair into one continuous band.
          const pre = contacts.find(c => c.id === id)
          let mergeCandidate: {
            redundantContactId: string
            lithoCode: string
          } | null = null
          if (pre) {
            const anchor = pre.borehole_id ?? pre.cpt_id
            if (anchor) {
              const lithoByFormation = new Map(
                formations.map(f => [f.id, f.litho_main_soil_code ?? null]),
              )
              const peers = contacts
                .filter(c => (c.borehole_id ?? c.cpt_id) === anchor && c.id !== id)
                .slice()
                .sort((a, b) => a.depth_top_m - b.depth_top_m)
              const above = peers
                .filter(c => c.depth_top_m < pre.depth_top_m)
                .at(-1)
              const below = peers.find(c => c.depth_top_m > pre.depth_top_m)
              if (above && below) {
                const aboveLitho = lithoByFormation.get(above.formation_id)
                const belowLitho = lithoByFormation.get(below.formation_id)
                if (
                  aboveLitho !== null
                  && aboveLitho !== undefined
                  && aboveLitho === belowLitho
                ) {
                  mergeCandidate = {
                    redundantContactId: below.id,
                    lithoCode: aboveLitho,
                  }
                }
              }
            }
          }
          setDeletePending(null)
          void onDeleteContact(id)
          if (mergeCandidate) setLithoMergePending(mergeCandidate)
        }}
        onCancel={() => setDeletePending(null)}
      />
    )}
    </>
  )
}

// ContactContextMenu is defined in ./ContactContextMenu.tsx and imported above.
