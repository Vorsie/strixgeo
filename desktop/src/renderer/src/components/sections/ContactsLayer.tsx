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

import type {
  FormationContactBatchUpdateEntry,
  FormationContactResponse,
  FormationSurfaceResponse,
  GeologicalFormationResponse,
} from '../../api/client'
import { sliceTin, type SectionLine2D } from '../../utils/sliceTin'
import { SNAP_TOLERANCE_PX } from './cptChannels'
import HoverReadoutCard from './HoverReadoutCard'
import type { PlacedColumn } from './utils'

interface Props {
  contacts: readonly FormationContactResponse[]
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
  /** Right-click → confirm → delete the contact. Called only after
   * the native confirm() returns true so the caller never has to
   * gate the destructive action itself. When absent the contact's
   * hit-strip falls back to its drag-only behaviour. DB delete is
   * irreversible per CLAUDE.md UX conventions; the native confirm
   * is the user-facing safety rail. */
  onDeleteContact?: (contactId: string) => Promise<void>
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
   * entry → free drag. */
  snapDepthsByAnchorId?: ReadonlyMap<string, readonly number[]>
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

/** Data-only slab — output of the data-classification pass. Holds
 * every fact needed to render a per-column layer block EXCEPT the
 * screen Y coordinates, which depend on the viewport's vertical
 * transform. Splitting the screen Y out lets the data memo stay
 * cached across vertical pan / zoom (only ``levelToScreen`` changes
 * there, not ``placedColumns`` or the data inputs) — see debt #29.
 *
 * ``bottomDepthM = null`` means "no known bottom" (deepest contact at
 * an anchor with no recorded ``max_depth_m`` / ``total_depth_m``);
 * the projection step renders that as "extends to ``plotBottom``".
 */
interface LayerSlabData {
  contactId: string
  anchorId: string
  anchorKind: 'cpt' | 'borehole'
  formationId: string
  formationName: string
  color: string
  topDepthM: number
  bottomDepthM: number | null
  surfaceElevationM: number
  /** Horizontal extent + label X — these depend on ``placedColumns``
   * (which itself can change on horizontal pan), so they live on the
   * slab; the cheap projection in the render pass copies them
   * through unchanged. */
  segLeftX: number
  segRightX: number
  labelX: number
}

/** Data-only polyline vertex — output of the data-classification
 * pass. Screen Y is computed in the projection step. */
interface PolylineVertexData {
  contactId: string
  formationId: string
  topDepthM: number
  surfaceElevationM: number
  screenX: number
  sortKey: number
}

interface PolylineDataLine {
  formationId: string
  color: string
  name: string
  vertices: PolylineVertexData[]
}

/** Projected (screen-space) layer — output of the cheap render-time
 * projection. Carries everything the renderer + drag handler need;
 * the drag handler reads ``pxPerMetre`` / ``surfaceY`` / ``segY`` to
 * compute live depth without re-walking ``placedColumns``. */
interface RenderedLayer {
  key: string
  contactId: string
  anchorId: string
  anchorKind: 'cpt' | 'borehole'
  formationId: string
  formationName: string
  color: string
  /** Horizontal segment extent + Y. */
  segLeftX: number
  segRightX: number
  segY: number
  /** Layer body vertical extent (clamped to plot area). */
  bodyTopY: number
  bodyBottomY: number
  /** Column anchor X for the name label. */
  labelX: number
  /** Anchor metadata needed by the drag handler — saved on the layer
   * so we don't re-walk placedColumns on every mousemove. */
  surfaceElevationM: number
  pxPerMetre: number
  surfaceY: number
  /** Original (un-dragged) depth, kept on the layer so the drag
   * commit can no-op when the user releases at the same depth. */
  originalDepthM: number
}

/** Projected polyline vertex — adds screen Y on top of the data form. */
interface PolylineVertex {
  contactId: string
  screenX: number
  screenY: number
  sortKey: number
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
  /** Target column when the cursor has crossed unambiguously into
   * another column's attraction band. ``null`` ⇒ stay on source.
   * Drives both the cross-column commit + the live preview render. */
  currentTargetCol: PlacedColumn | null
  /** Every contact carried by this drag (always includes the
   * primary; size>1 only when the user grabbed a contact that was
   * part of an existing multi-selection). Each non-primary contact
   * follows the primary's Δm and target-column choice on commit. */
  contactsInDrag: readonly DragContact[]
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
// Avg glyph width at fontSize=9 — used by the truncation budget.
const APPROX_GLYPH_WIDTH_PX = 5
// Vertical hit-strip half-height (px) around each top segment — wide
// enough that the line is grabbable without precision aiming, narrow
// enough that adjacent layers don't fight for the same pointer.
const DRAG_HIT_HALF_HEIGHT_PX = 5
// Cursor-X hysteresis (px) outside a column's visual band before the
// drag re-anchors onto a different column. Tight enough that crossing
// to a neighbouring column is intentional; loose enough that minor
// jitter at the band edge doesn't flicker the target. Tuned against
// typical column spacing on a real-world section (~30-80 px apart).
const COLUMN_ATTRACTION_PX = 15
// Below this drag distance the marquee / drag is treated as a click —
// no commit, no state change. Mirrors the existing "zero-delta release"
// no-op rule on the depth-only drag.
const CLICK_TO_DRAG_THRESHOLD_PX = 3

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function truncateToWidth(text: string, widthPx: number): string {
  // Reserve a couple of px on each side as padding inside the band.
  const usable = Math.max(0, widthPx - 4)
  const maxChars = Math.max(3, Math.floor(usable / APPROX_GLYPH_WIDTH_PX))
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`
}

function itemBottomDepth(col: PlacedColumn): number | null {
  // PlacedColumn is a discriminated union by ``kind`` — TypeScript
  // narrows col.proj.item to the right shape inside each branch,
  // no cast needed (debt #28).
  if (col.kind === 'cpt') {
    return col.proj.item.max_depth_m
  }
  return col.proj.item.total_depth_m
}

/** Find the column whose centre is closest to ``cursorSvgX``, but
 * only if within the column's half-width plus the attraction
 * hysteresis. ``null`` when the cursor is in dead space between
 * columns. Used by both the cross-column drag (current target) and
 * the marquee (no role — included for completeness). */
function columnUnderCursor(
  cursorSvgX: number,
  placedColumns: readonly PlacedColumn[],
): PlacedColumn | null {
  let best: PlacedColumn | null = null
  let bestDistance = Infinity
  for (const col of placedColumns) {
    const distance = Math.abs(cursorSvgX - col.nudgedX)
    const reach = col.width / 2 + COLUMN_ATTRACTION_PX
    if (distance <= reach && distance < bestDistance) {
      bestDistance = distance
      best = col
    }
  }
  return best
}

/** Helper for the snap math when the active target column has a
 * surface elevation. Mirrors the depth derivation in ``handleMove``
 * but factored out so the value can be precomputed at drag start
 * without duplicating the (cursorY - surfaceY) / pxPerMetre arithmetic. */
function surfaceYForColumn(
  col: PlacedColumn,
  levelToScreen: (level: number) => number,
): { surfaceY: number; pxPerMetre: number; surfaceElevationM: number | null } {
  const item = col.proj.item as { elevation_m: number | null }
  if (item.elevation_m === null) {
    return { surfaceY: 0, pxPerMetre: 0, surfaceElevationM: null }
  }
  const surfaceY = levelToScreen(item.elevation_m)
  // pxPerMetre derives from a 1m delta in level → screen Y.
  const oneMetreDown = levelToScreen(item.elevation_m - 1)
  const pxPerMetre = oneMetreDown - surfaceY
  return {
    surfaceY,
    pxPerMetre,
    surfaceElevationM: item.elevation_m,
  }
}

/** Returns true when the keydown target is a text-input-like element
 * — the section panel's selection shortcuts must not fight with the
 * formation rename input, the search box, etc. Mirrors the pattern in
 * Sidebar / BoreholeLog (CLAUDE.md notes that the three call sites
 * will collapse into a shared hook on the third copy; ContactsLayer
 * is now the third). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

export default function ContactsLayer({
  contacts,
  formations,
  placedColumns,
  excludedBoreholeIds,
  levelToScreen,
  plotTop,
  plotBottom,
  onUpdateContactDepth,
  onDeleteContact,
  onBatchUpdateContacts,
  onBatchCreateContacts,
  marquee,
  onSetMarquee,
  selectionResetSignal,
  snapDepthsByAnchorId,
  getCptValuesAtDepth,
  surfacesByFormationId,
  sectionLine,
  alongMToScreenX,
}: Props): JSX.Element | null {
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
  // Stage A — data-classification pass. Produces ``LayerSlabData[]``
  // and ``PolylineVertexData[]`` from data + horizontal layout only.
  // Crucially excludes ``levelToScreen`` / ``plotTop`` / ``plotBottom``
  // from the deps so vertical pan / zoom keeps this memo cached: only
  // a horizontal pan, a contact edit, an exclusion-set toggle, or a
  // formation rename invalidates the slab geometry. Debt #29.
  //
  // The previous implementation re-ran the full O(N×M) anchor match
  // on every pan frame because ``levelToScreen`` was in the dep
  // array. The new version (a) drops ``levelToScreen`` so vertical
  // pan doesn't invalidate, and (b) pre-indexes ``contacts`` by
  // anchor id so the inner loop is O(K) per column rather than O(M).
  const { slabs, polylineData } = useMemo(() => {
    if (contacts.length === 0) {
      return { slabs: [] as LayerSlabData[], polylineData: [] as PolylineDataLine[] }
    }

    const formationById = new Map<string, GeologicalFormationResponse>()
    for (const f of formations) formationById.set(f.id, f)

    // Pre-index contacts by anchor id so the per-column loop is O(K)
    // (K = contacts at this anchor) rather than O(M) (M = all
    // contacts in the project). On a 200-column / 500-contact project
    // this drops the inner work from ~100k iterations per pan to
    // ~500.
    const contactsByAnchorId = new Map<string, FormationContactResponse[]>()
    for (const c of contacts) {
      const anchorId = c.borehole_id ?? c.cpt_id
      if (!anchorId) continue
      if (c.borehole_id && excludedBoreholeIds?.has(c.borehole_id)) continue
      const bucket = contactsByAnchorId.get(anchorId)
      if (bucket) {
        bucket.push(c)
      } else {
        contactsByAnchorId.set(anchorId, [c])
      }
    }

    const slabsOut: LayerSlabData[] = []
    // Polyline accumulator keyed by formation id; each entry collects
    // vertices in any order, sorted left-to-right at the end.
    type PolyAcc = { color: string; name: string; vertices: PolylineVertexData[] }
    const byFormation = new Map<string, PolyAcc>()

    for (const col of placedColumns) {
      const item = col.proj.item as { id: string; elevation_m: number | null }
      if (item.elevation_m === null) continue
      const colContacts = contactsByAnchorId.get(item.id)
      if (!colContacts || colContacts.length === 0) continue
      // Sort ascending by depth — the per-column slab loop assumes
      // it; the polyline pass doesn't care but using the same order
      // keeps memory access patterns contiguous.
      const sorted = [...colContacts].sort((a, b) => a.depth_top_m - b.depth_top_m)
      const surfaceElevationM = item.elevation_m
      const bottomCap = itemBottomDepth(col)
      const halfW = col.width / 2

      for (let i = 0; i < sorted.length; i += 1) {
        const contact = sorted[i]
        const formation = formationById.get(contact.formation_id)
        if (!formation) continue
        const topDepth = contact.depth_top_m
        const nextDepth = sorted[i + 1]?.depth_top_m
        // bottomDepth: nearest-known lower bound. Fall-through order
        // matches geological convention — next pick wins, then the
        // investigation's recorded bottom, finally null (renders as
        // "extends to plotBottom" in the projection step).
        const bottomDepthM =
          nextDepth !== undefined ? nextDepth : bottomCap ?? null
        // Display label: prefer regional_ref (DOV formal stratigraphy
        // code, e.g. "HyEg - Lid van Egem") over name (informal
        // working name like "Boom Klei"). The formal code is more
        // standardized + cross-borehole consistent, which makes the
        // section view easier to scan when you're zoomed out and
        // labels overlap. Falls back to name when no formal code is
        // recorded (informal-only boreholes).
        const displayLabel = formation.regional_ref ?? formation.name
        slabsOut.push({
          contactId: contact.id,
          anchorId: item.id,
          anchorKind: col.kind,
          formationId: contact.formation_id,
          formationName: displayLabel,
          color: formation.color,
          topDepthM: topDepth,
          bottomDepthM,
          surfaceElevationM,
          segLeftX: col.nudgedX - halfW,
          segRightX: col.nudgedX + halfW,
          labelX: col.nudgedX,
        })

        // Same iteration also populates the polyline accumulator —
        // saves a second walk of the sorted list.
        const acc =
          byFormation.get(contact.formation_id) ??
          ({ color: formation.color, name: displayLabel, vertices: [] } as PolyAcc)
        acc.vertices.push({
          contactId: contact.id,
          formationId: contact.formation_id,
          topDepthM: topDepth,
          surfaceElevationM,
          screenX: col.nudgedX,
          sortKey: col.nudgedX,
        })
        byFormation.set(contact.formation_id, acc)
      }
    }

    const polylinesOut: PolylineDataLine[] = []
    for (const [formationId, acc] of byFormation) {
      acc.vertices.sort((a, b) => a.sortKey - b.sortKey)
      polylinesOut.push({
        formationId,
        color: acc.color,
        name: acc.name,
        vertices: acc.vertices,
      })
    }
    // Stratigraphic order = age axis. Lower display_order = older
    // formation; sort ASCENDING so older paints first and younger
    // formations render ON TOP. Ties + unknown formations sink to
    // the back (defensive — formationById should always have it).
    polylinesOut.sort(
      (a, b) =>
        (formationById.get(a.formationId)?.display_order ?? Number.MAX_SAFE_INTEGER) -
        (formationById.get(b.formationId)?.display_order ?? Number.MAX_SAFE_INTEGER),
    )

    return { slabs: slabsOut, polylineData: polylinesOut }
  }, [contacts, formations, placedColumns, excludedBoreholeIds])

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
    if (!surfacesByFormationId || !sectionLine || !alongMToScreenX) {
      return [] as {
        formationId: string
        color: string
        name: string
        d: string
      }[]
    }
    const out: {
      formationId: string
      color: string
      name: string
      d: string
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
      // Project each (alongM, elevationM) into screen space; clip
      // segments that leave the plot area in Y so we don't paint over
      // the chrome. We render as a single path with M/L commands;
      // out-of-range vertices break the path with a fresh M.
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
      out.push({ formationId, color: meta.color, name: meta.name, d: path })
    }
    return out
  }, [
    surfacesByFormationId,
    sectionLine,
    alongMToScreenX,
    polylineData,
    levelToScreen,
    plotTop,
    plotBottom,
  ])

  // Set of formation ids that have a slice rendered. The connect-the-
  // dots polylines render below skips these to avoid double-painting.
  const slicedFormationIds = useMemo(() => {
    const out = new Set<string>()
    for (const line of slicedPolylines) out.add(line.formationId)
    return out
  }, [slicedPolylines])

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
        const px = Math.abs((cand - rawDepth) * pxPerMetre)
        if (px <= SNAP_TOLERANCE_PX && px < bestPxDistance) {
          bestPxDistance = px
          bestDepth = cand
          bestSnapped = true
        }
      }
      return { depth: bestDepth, snapped: bestSnapped }
    },
    [snapDepthsByAnchorId],
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
      const clamped = Math.max(0, rawDepth)
      const { depth, snapped } = snapDepth(clamped, depthAnchorId, pxPerMetre)
      setDrag(prev =>
        prev === null
          ? null
          : {
              ...prev,
              currentDepthM: depth,
              currentSnapped: snapped,
              currentTargetCol: nextTargetCol,
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

      if (single && noAnchorChange) {
        if (!onUpdateContactDepth) return
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
    (layer: RenderedLayer, e: React.MouseEvent<SVGRectElement>) => {
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
      if (!inSelection) {
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
        contactsInDrag,
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

  // Shift-Click selects the depth-range between the LAST-clicked
  // contact and this one, scoped to the same anchor. Range across
  // anchors is ambiguous (whose depth order wins?) so we silently
  // fall back to a plain replacement select when the anchors differ.
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
        e.preventDefault()
        e.stopPropagation()
        handleRangeSelection(layer)
        return
      }
      // Plain click — the drag handler stops propagation + updates
      // selection (or preserves the existing multi-selection if the
      // clicked contact is part of it).
      startDrag(layer, e)
    },
    [handleToggleSelection, handleRangeSelection, startDrag],
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

  if (layers.length === 0 && polylines.length === 0) {
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
    <g>
      {/* Slice-of-TIN polylines. Drawn first (under everything else)
          so the per-column tops + name labels paint on top. Solid
          stroke distinguishes them from the dashed connect-the-dots
          fallback — the user sees at a glance which formations have a
          full surface vs. which are still 2-pick tie-lines. */}
      {slicedPolylines.map(line => (
        <path
          key={`slice-${line.formationId}`}
          d={line.d}
          stroke={line.color}
          strokeWidth={1.25}
          strokeOpacity={0.7}
          fill="none"
          pointerEvents="none"
          data-testid={`formation-surface-${line.formationId}`}
        />
      ))}
      {/* Cross-column polylines (formation surfaces). Drawn first so
          the per-column top segments + name labels paint on top. */}
      {polylines.map(line => {
        if (line.vertices.length < 2) return null
        if (slicedFormationIds.has(line.formationId)) return null
        const path = line.vertices
          .map((v, i) => {
            // Live-override the dragged vertex's Y so the surface
            // line tracks the drag instead of snapping at commit.
            // Works for every contact in the drag set, not just the
            // primary — multi-drag previews stay coherent.
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
            return `${i === 0 ? 'M' : 'L'} ${v.screenX.toFixed(2)} ${y.toFixed(2)}`
          })
          .join(' ')
        return (
          <path
            key={`poly-${line.formationId}`}
            d={path}
            stroke={line.color}
            strokeWidth={1}
            strokeOpacity={0.55}
            strokeDasharray="4 3"
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
        const labelY = (layer.bodyTopY + layer.bodyBottomY) / 2
        const layerHeight = layer.bodyBottomY - layer.bodyTopY
        const showLabel = layerHeight >= LAYER_LABEL_MIN_HEIGHT_PX
        const labelWidth = layer.segRightX - layer.segLeftX
        const display = showLabel ? truncateToWidth(layer.formationName, labelWidth) : ''
        const isDragged = drag !== null && drag.contactId === layer.contactId
        const isSelected = selection.has(layer.contactId)
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
            {/* Top segment — only when the top sits inside the plot
                area, otherwise the layer extends off the top edge
                and the segment would draw on the chrome. */}
            {layer.segY >= plotTop && layer.segY <= plotBottom && (
              <line
                x1={layer.segLeftX}
                x2={layer.segRightX}
                y1={layer.segY}
                y2={layer.segY}
                stroke={layer.color}
                strokeWidth={isDragged ? 2.5 : 1.75}
                strokeOpacity={0.95}
                pointerEvents="none"
              />
            )}
            {showLabel && (
              <text
                x={layer.labelX}
                y={labelY}
                fontSize={9}
                fill={layer.color}
                fontWeight={500}
                textAnchor="middle"
                dominantBaseline="middle"
                pointerEvents="none"
              >
                {display}
              </text>
            )}
            {/* Transparent hit-strip — wider than the visible line so
                the user can grab without precision aiming. Rendered
                whenever either an edit OR a delete handler is wired
                so the lines participate in pointer events; without
                both they stay fully non-interactive. */}
            {(onUpdateContactDepth || onDeleteContact) &&
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
                    onDeleteContact
                      ? e => {
                          e.preventDefault()
                          // Native confirm is the irreversible-action
                          // safety rail per CLAUDE.md UX. A re-pick is
                          // one click in the picker, so we deliberately
                          // skip a custom modal — confirm is enough.
                          if (
                            window.confirm(
                              `Delete contact at ${layer.formationName}? This cannot be undone.`,
                            )
                          ) {
                            void onDeleteContact(layer.contactId)
                          }
                        }
                      : undefined
                  }
                  data-contact-id={layer.contactId}
                  data-testid="contact-drag-strip"
                />
              )}
          </g>
        )
      })}

      {/* Drag readout — depth + mTAW always, plus qc + Rf when the
          contact is anchored at a CPT (mirrors ContactPickBar so the
          drag flow surfaces the same depth-series values as the
          hover-pick flow). Same card shape used elsewhere. */}
      {drag !== null && (() => {
        const elevation = drag.surfaceElevationM - drag.currentDepthM
        const lines = [
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
        return (
          <g pointerEvents="none">
            <HoverReadoutCard
              x={drag.segRightX + 8}
              y={drag.surfaceY + drag.currentDepthM * drag.pxPerMetre}
              plotTop={drag.plotTop}
              plotBottom={drag.plotBottom}
              lines={lines}
            />
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
  )
}
