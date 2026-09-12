/**
 * Section-scoped data context — the read-only data slices SectionsCanvas
 * derives per selected section, consumed by SectionPanel and (in later
 * phases) its leaf overlays directly (debt #201 round 2 / #178).
 *
 * Owner decision 2026-07-13: replaces 26 of SectionPanel's 69 threaded
 * props. Viewport/transform values (``levelToScreen`` et al.) deliberately
 * STAY props — the #168 investigation (2026-05-29) declined moving those.
 *
 * The provider value is intentionally NOT memoised in SectionsCanvas:
 * nothing under the provider is ``React.memo``, so a fresh object per
 * render changes no render behaviour, and skipping the ``useMemo`` removes
 * the stale-dep-array failure mode entirely. Revisit if memoisation ever
 * lands in the section tree.
 *
 * The context default is the all-absent scope, matching the old optional-
 * prop defaults — tests that mount SectionPanel without a provider get
 * exactly the prop-omitted behaviour.
 */
import { createContext, useContext } from 'react'

import type {
  BodyBoundaryResponse,
  BodyListItem,
  BoreholeListItem,
  CptListItem,
  CrossingPinchOut,
  DivideBoreholePreviewColumn,
  FormationContactResponse,
  FormationSurfaceResponse,
  GeologicalFormationResponse,
  LithoBodySolidResponse,
  LithoContactCorrelationEdge,
  LithoLayerResponse,
  VirtueleBoringInvestigationPrediction,
} from '../../api/client'
import type { GeotechAxisModel } from './geotechAxisModel'
import type { UndoCommand } from '../../hooks/useUndoStack'

/** Read-only per-section data slices provided by SectionsCanvas. */
export interface SectionScope {
  /** Project-level vertical EPSG used for the y-axis label.
   * ``null`` → the axis renders without a datum suffix (just
   * "Level (m)"). */
  zEpsg?: number | null
  /** All CPTs in the project. The panel filters down to those that
   * project within the section's buffer + endpoints. */
  cpts?: readonly CptListItem[]
  /** All boreholes in the project. Same filter as cpts. */
  boreholes?: readonly BoreholeListItem[]
  /** Active geological model's formation contacts — render as the
   * Phase 4 editor overlay (horizontal lines connecting picks per
   * formation across the projected investigations). Filtered by the
   * section's ``seeded_formation_contact_ids`` (the explicit-content
   * invariant), so it's a SUBSET of the active model's contacts. */
  contacts?: readonly FormationContactResponse[]
  /** Formation vocabulary — used to colour each contact polyline
   * with the formation's own colour. */
  formations?: readonly GeologicalFormationResponse[]
  /**
   * Which model axis is active on this section.  Defaults to
   * ``'geological'`` (existing behaviour — zero regression).
   *
   * When ``'lithostratigraphic'``, the formation-contact picker
   * renders ``LithoCompositionPickerDialog`` instead of
   * ``FormationPickerDialog``.  The geological + geotechnical axes
   * use the original dialog unchanged.
   *
   * When ``'geotechnical'``, contact and band rendering mirrors the
   * lithostratigraphic axis: ``PartitionFillOverlay`` renders bands
   * coloured by ``geotechUnitColor`` (the engineer's own pick where he
   * made one, else the NAD class colour), and the label shows the NAD
   * class name (via ``nadClassName``).  Litho-only
   * gestures (correlation, auto-correlate, lens detection) are
   * excluded — the geotech axis is view-only for F3.
   */
  axisMode?: 'geological' | 'lithostratigraphic' | 'geotechnical'
  /**
   * Geotech axis only — when true the geotech model for this section has
   * not yet been built, so the NAD subdivision suggestion flow is
   * unavailable.  Forwarded to ``CanvasHints`` to surface a discoverability
   * hint (``data-testid="geotech-not-built-hint"``).  No-op on other axes.
   */
  geotechNotReconciled?: boolean
  /**
   * Active lithostratigraphic model id.  Required for the lens-naming
   * context-menu gesture — passed through so the action always has a
   * valid model UUID even when no contacts have been seeded yet.
   * When absent (or when ``axisMode !== 'lithostratigraphic'``) the
   * lens-naming menu item is hidden.
   */
  activeLithoModelId?: string | null
  /** UNFILTERED active-axis contacts (NOT seeded-only). Used by the
   * crossings-banner zoom-to-detail effect to resolve focused
   * contact ids → anchor → column, because the offending crossing
   * contacts are global to the geological model and may not be in
   * this section's seeded set. Optional; falls back to ``contacts``
   * when omitted (older tests + integration sites that don't supply
   * the full list). */
  focusableContacts?: readonly FormationContactResponse[]
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
  /**
   * Undo stack push hook (dogfeed 2026-05-23). When present, the
   * "Remove from section" gesture (right-click a column → "Remove
   * from section") pushes an undo command so Ctrl+Z restores the
   * previous excluded_*_ids list. Optional so the test-render path
   * + read-only callers can mount without an undo seam.
   */
  undoStack?: {
    push: (cmd: UndoCommand) => void
  }
  /**
   * Inclusive snap tolerance (m) for the litho↔geological drag-
   * indicator (debt #134-B).  Threaded straight to ContactsLayer.
   * Only meaningful on the litho axis; the geological axis ignores
   * it.  When ``undefined`` on the litho axis the in-flight badge
   * is suppressed (still post-release behaviour via SectionsCanvas).
   */
  geoSnapToleranceM?: number
  /**
   * Fixed length (m, along-section) an ``open`` body extent draws past the
   * source test's column (litho axis). From litho-segmenter prefs; default
   * 3 m. Forwarded to BodyExtentOverlay.
   */
  openExtentLengthM?: number
  /**
   * 3-D body solids of the ACTIVE AXIS's built model (already built + fetched
   * by ``useLithoSolids``, which is model-agnostic — one instance per model).
   * When present, a ``ModelFillOverlay`` is rendered as a sibling of
   * ``PartitionFillOverlay`` showing the geometric solid fill cut out of the
   * 3-D build.
   *
   * SectionsCanvas resolves WHICH model's solids these are: the litho build on
   * the litho axis, the geotech build on the geotech axis. Deliberately not
   * named for either — handing one axis the other's solids would paint a
   * different model's bodies under this axis's colours, which reads as correct
   * and is not. Absent / undefined on the geological axis (it has no body
   * build of its own) and before anything has been built.
   */
  modelSolids?: readonly LithoBodySolidResponse[]
  /**
   * When ``true`` (default) the model-fill overlay uses Mode B (section-plane
   * slice of the body solids via ``sliceSolidsAtPlane``).  When ``false`` it
   * uses Mode A (per-test vertical strips sampled at each test's map position
   * via ``sampleSolidColumns``).
   *
   * Read from ``view_state.litho_segmenter.section_fill_at_section_line``
   * by SectionsCanvas and passed in as a pre-resolved boolean to avoid
   * introducing a shell dependency inside SectionPanel. One pref across both
   * model axes: it describes how a build is CUT, not which build it is.
   */
  sectionFillAtSectionLine?: boolean
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
   * The geotech model's packing-correlation edges (Phase 1, 2026-06-25).
   *
   * Drives the ``CorrelationEdgesOverlay`` ribbons + right-click targets on
   * the GEOTECH axis ONLY. This is a SEPARATE list from ``contactEdges``: on
   * the geotech axis ``contactEdges`` carries the LITHO model's edges, which
   * FRAME the partition fill (``computeSectionFill``) + the correlated-pair
   * column spacing and must NOT be repurposed for the geotech overlay (doing
   * so pinched every litho band to a lens — dogfeed/commit 7329738b). The
   * partition stays framed by ``contactEdges``; only the overlay ribbons read
   * this list. Absent / undefined on the litho + geological axes (zero
   * regression there — the overlay reads ``contactEdges``).
   */
  geotechCorrelationEdges?: readonly LithoContactCorrelationEdge[]
  /**
   * Auto-lens (2026-06-02): pinch-out lens candidates from the last
   * auto-correlate run — crossings dropped from persistence and surfaced as
   * lenses. Rendered as amber lens-candidate markers (litho axis only).
   */
  crossingPinchOuts?: readonly CrossingPinchOut[]
  /**
   * Detected body list for the active litho model (#163f Slice 6). When
   * present, rendered as shapeable wedges by ``BodyExtentOverlay``. Absent =
   * no body wedges.
   */
  lenses?: readonly BodyListItem[]
  /**
   * Accepted litho layers for the active model — each carries ``body_id``.
   * Forwarded to ``BodyExtentOverlay`` so committed bodies frame from their
   * own member layer (Bug C "body jump" fix). Absent / empty falls back to the
   * correlation-graph derivation.
   */
  lithoLayers?: readonly LithoLayerResponse[]
  /**
   * The active geotech model, assembled by SectionsCanvas. Set on the geotech
   * axis only; SectionPanel splits it across the partition fill (which
   * partitions ``geotechLayers`` directly since 2026-08-13), the band-edit
   * overlay, the borehole-preview ghosts and the snap gesture.
   * See ``GeotechAxisModel``.
   */
  geotechModel?: GeotechAxisModel
  /**
   * Ghost packing bands for boreholes that have not been divided yet (geotech
   * axis only). The server's dry run of ``Divide boreholes``, run through the
   * SAME planner the verb commits, so what is drawn is what the button writes.
   *
   * Exists because ``Subdivide all bodies`` leaves every borehole column blank
   * on this axis — the engineer could not see what packing a borehole would get
   * without first pressing the rebuild (owner dogfeed 2026-08-04). Absent /
   * empty → no ghosts, exactly as before.
   */
  geotechBoreholePreview?: readonly DivideBoreholePreviewColumn[]
  /**
   * Whether the committed geotech rows currently reflect the server.
   *
   * The bus clears them to ``[]`` before every refetch and on a failed load, so
   * the preview overlay cannot read emptiness as "no borehole is divided"
   * without this. Absent → treated as loaded (the pre-preview behaviour).
   */
  geotechLayersLoaded?: boolean
  /** Stored boundary shape per body id (render style + control nodes). */
  lensBoundaries?: ReadonlyMap<string, BodyBoundaryResponse>
  /**
   * Formation ids whose committed bands should pulse amber briefly —
   * the "your correlation succeeded" cue. Set transiently after a
   * successful correlate; cleared by the caller after PULSE_MS.
   * Passed through to CorrelationEdgesOverlay. Optional.
   */
  pulsingFormationIds?: ReadonlySet<string>
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
  virtueleBoringShowOnSection?: boolean}

/** All-absent scope — mirrors the old optional-prop defaults. */
export const EMPTY_SECTION_SCOPE: SectionScope = {}

export const SectionScopeContext = createContext<SectionScope>(EMPTY_SECTION_SCOPE)

/**
 * Read the section-scoped data slices.
 *
 * Returns
 * -------
 * SectionScope
 *     The nearest provider's scope, or the all-absent default outside a
 *     provider (test mounts).
 */
export function useSectionScope(): SectionScope {
  return useContext(SectionScopeContext)
}
