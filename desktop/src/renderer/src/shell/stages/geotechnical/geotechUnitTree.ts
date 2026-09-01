/**
 * Pure builder for the Geotech-units pane tree: soil ▸ litho body ▸ packing body.
 *
 * The shape the owner named
 * -------------------------
 * Owner ruling 2026-08-31 (walk interview), verbatim: "main litho is first
 * level, one down is all litho bodies that are geometrically disconnected, one
 * down is all disconnected packing bodies. Then if you group they get like a
 * group 1 in parentheses behind." So the axis is three levels:
 *
 *   L1  main litho (soil)                       — SILT
 *   L2  geometrically-disconnected litho bodies — SILT · #0, SILT · #1
 *   L3  disconnected packing bodies             — SILT · SF #0, SILT · FF #1
 *
 * A packing (geotech) body homes under its PARENT litho body
 * (``parent_litho_body_id``, debt #278 D1): the geometrically-disconnected litho
 * mass it was carved out of. A body whose parent is not yet stamped is NOT
 * dropped — it falls into an "ungrouped" L2 bucket (``lithoBodyId: null``) under
 * its soil, so nothing the model holds goes invisible.
 *
 * Why the tree is BODY-driven
 * ---------------------------
 * The previous pane grouped by (soil, NAD class); the owner replaced the middle
 * level with the litho body. Identity now reads from the resolver bodies the
 * engineer looks at on the section, not from the formation rows — so the pane,
 * the fence, the 3-D build and the CS body-menu all name the same masses.
 *
 * All the arithmetic (grouping, band-count roll-up, per-body badges, ordering,
 * the group tag) lives here rather than in the component so it is testable
 * without a DOM.
 */

import type { LithoLayerConfidence } from '../../../api/client'
import { geotechBodyAutoLabel, nadSoilPackingLabel } from '../../../utils/geotechBodyLabel'
import { geotechUnitSoil, nadClassColor } from '../../../utils/nadClasses'
import { lithoBodyLabel } from '../parameters/parameterScopeLabels'
import type { BodyRosterEntry } from '../parameters/parameterUnitBodies'

// ---------------------------------------------------------------------------
// Badge severity — the ONE place the "worst wins" order is stated
// ---------------------------------------------------------------------------

/** Where a unit's NAD class came from, for the provenance badge. */
export type ClassProvenance = 'cpt' | 'partial' | 'none'

/**
 * Severity rank of each provenance value — HIGHER IS WORSE.
 *
 * * ``cpt`` — every band came from a real qc window.
 * * ``partial`` — some did; at least one took the weakest class seen in its body.
 * * ``none`` — no cone behind the class at all (or no bands).
 */
const PROVENANCE_SEVERITY: Readonly<Record<ClassProvenance, number>> = {
  cpt: 0,
  partial: 1,
  none: 2,
}

/** Companion ladder for the confidence badge — same "higher is worse" rule. */
const CONFIDENCE_SEVERITY: Readonly<Record<LithoLayerConfidence, number>> = {
  high: 0,
  medium: 1,
  low: 2,
}

/** Pick the worse of two provenance values (for the L2 collapsed roll-up). */
function worseProvenance(a: ClassProvenance, b: ClassProvenance): ClassProvenance {
  return PROVENANCE_SEVERITY[b] > PROVENANCE_SEVERITY[a] ? b : a
}

/**
 * Pick the worse of two confidence values, treating ``null`` as "says nothing".
 *
 * A layer set with no opinion (empty) must not drag a body down — it has no
 * opinion about the packing class, which is different from having a weak one.
 */
function worseConfidence(
  a: LithoLayerConfidence | null,
  b: LithoLayerConfidence | null,
): LithoLayerConfidence | null {
  if (a === null) return b
  if (b === null) return a
  return CONFIDENCE_SEVERITY[b] > CONFIDENCE_SEVERITY[a] ? b : a
}

// ---------------------------------------------------------------------------
// Input / output shapes
// ---------------------------------------------------------------------------

/** The fields of a geotech formation the tree reads. */
export interface GeotechUnitRef {
  id: string
  nad_class: number | null
  litho_main_soil_code?: string | null
  name?: string | null
  display_order: number
  source_litho_formation_id?: string | null
  /** The colour the engineer picked for this unit; null when nobody has. */
  color_override?: string | null
}

/** The field of an accepted geotech contact the tree reads (the header count). */
export interface GeotechContactRef {
  formation_id: string
}

/** The fields of a geotech layer the tree reads for the leaf band counts + badges. */
export interface GeotechLayerRef {
  formation_id: string
  confidence: LithoLayerConfidence
  /** The resolver body this layer belongs to — for the per-body band count. */
  body_id?: string | null
  /** Layer status; only ``'accepted'`` layers count toward a body's bands. */
  status?: string
}

/** The fields of a geotech (packing) body the tree reads for its leaf rows. */
export interface GeotechBodyRef {
  /** The resolver body id — the selection currency. */
  id: string
  /** The geotech formation (unit) the body homes to — its class + soil + colour. */
  formation_id: string
  /** The body's ordinal within its formation's naming group (0-based). */
  body_ordinal: number
  /** The engineer's name for the body, or null. */
  name?: string | null
  /**
   * The LITHO body this packing body was carved out of (debt #278 D1) — its L2
   * home. ``null`` (or absent) → the ungrouped bucket.
   */
  parentLithoBodyId?: string | null
  /** The geological formations this body crosses, shallowest first (R2). */
  geoFormations?: readonly string[]
}

/** Everything the builder needs. */
export interface GeotechUnitTreeInput {
  /** Geotech formations to display (pre-filtered to ``isGeotechUnit``). */
  units: readonly GeotechUnitRef[]
  /** Accepted contacts in the active geotech model — the header count. */
  contacts: readonly GeotechContactRef[]
  /** All geotech layers in the active model — the leaf band counts + badges. */
  layers: readonly GeotechLayerRef[]
  /**
   * The geotech model's bodies — the leaves of the tree. Absent/empty → no soil
   * groups (the tree is body-driven; before the resolver stamps bodies there is
   * nothing to show).
   */
  bodies?: readonly GeotechBodyRef[]
  /**
   * The LITHO model's bodies keyed by id — the L2 nodes. Reused ``BodyRosterEntry``
   * so the L2 label goes through the SAME ``lithoBodyLabel`` the CS jump uses.
   */
  lithoBodies?: ReadonlyMap<string, BodyRosterEntry>
  /** Litho unit id → display name, for composing the L2 litho-body label. */
  lithoUnitNameById?: ReadonlyMap<string, string>
  /**
   * Geotech body id → manual-group number (debt #278 D4). A body in a
   * multi-member "Join with…" group carries "(group N)"; absent → no tag.
   */
  groupByBodyId?: ReadonlyMap<string, number>
}

/** One selectable packing (geotech) body — the L3 leaf. */
export interface GeotechPackingBody {
  /** The resolver body id — what a click on this row selects. */
  bodyId: string
  /** Unified label — the engineer's name, else "SILT · SF #0" (soil+packing+ordinal). */
  label: string
  /** The NAD class the body's ground carries; drives the provenance badge. */
  nadClass: number | null
  /** Accepted bands stamped to this body. */
  bandCount: number
  /** Where this body's class came from — the worst of its layers. */
  provenance: ClassProvenance
  /** Confidence of this body's assignment; null when it has no layers. */
  confidence: LithoLayerConfidence | null
  /** The geological formations this body crosses, shallowest first; may be empty. */
  geoFormations: readonly string[]
  /** The home geotech unit — the row a colour edit writes to. */
  unitId: string
  /**
   * The CLASS-level label of the home unit — soil + packing, NO ordinal ("SILT ·
   * SF"). The colour swatch edits the whole unit, so its accessible name must
   * name the unit, not this one body ("SILT · SF #0") — that would imply a
   * per-body edit the write does not make (ux-reviewer 2026-09-01).
   */
  unitLabel: string
  /** What to draw the swatch in: the picked colour, else the NAD colour. */
  color: string
  /** The picked colour when one is in force, else null (drives the reset control). */
  colorOverride: string | null
  /** The manual-group number (D4), or null when in no multi-member group. */
  groupNumber: number | null
}

/** One geometrically-disconnected litho body — the L2 node. */
export interface GeotechLithoBodyNode {
  /** The litho body id, or ``null`` for the ungrouped bucket. */
  lithoBodyId: string | null
  /** Stable identity for React keys + expand state: ``"{SOIL}|{lithoBodyId|ungrouped}"``. */
  key: string
  /** "SILT · #0" (the way a litho body reads everywhere), or '' for the ungrouped bucket. */
  label: string
  /** Bands summed across this litho body's packing bodies. */
  bandCount: number
  /**
   * Worst provenance across this node's packing bodies — the collapsed roll-up,
   * so the "No CPT" exception badge stays visible when the node is collapsed
   * (ux-reviewer 2026-09-01: collapsing must not hide the data-correctness signal).
   */
  provenance: ClassProvenance
  /** Worst confidence across this node's packing bodies; null when none classed. */
  confidence: LithoLayerConfidence | null
  /**
   * A representative non-null NAD class among the node's bodies, or null when
   * none is classed — drives whether the roll-up provenance badge shows (the
   * badge is suppressed for an unclassified row).
   */
  nadClass: number | null
  /** The packing bodies under this litho body, in ordinal order. */
  packingBodies: GeotechPackingBody[]
}

/** One soil header with its litho bodies — the L1 group. */
export interface GeotechSoilGroup {
  soil: string
  /** Bands summed across every litho body in this soil. */
  bandCount: number
  lithoBodies: GeotechLithoBodyNode[]
}

/** The whole tree plus the header counters. */
export interface GeotechUnitTree {
  groups: GeotechSoilGroup[]
  /** Units that describe something in this model — the "N with bands" figure. */
  unitCount: number
  /** Total accepted contacts across the units on the roster. */
  bandCount: number
}

// ---------------------------------------------------------------------------
// Per-body aggregation
// ---------------------------------------------------------------------------

/**
 * Classify where one packing body's NAD class came from, from its layers.
 *
 * The confidence a band persists IS its provenance: the cone fill writes
 * 'medium' / 'high' from a real qc window, the borehole fallbacks write 'low'.
 * A body with cone bands AND a fallback is 'partial' — labelling it "No CPT"
 * would be as untrue as stamping "CPT est." on a pure fallback.
 */
function bodyProvenance(confidences: readonly LithoLayerConfidence[]): ClassProvenance {
  if (confidences.length === 0) return 'none'
  const fromCone = confidences.some(c => c === 'high' || c === 'medium')
  if (!fromCone) return 'none'
  return confidences.some(c => c === 'low') ? 'partial' : 'cpt'
}

/** Worst confidence across one body's layers; null when it has none. */
function bodyConfidence(
  confidences: readonly LithoLayerConfidence[],
): LithoLayerConfidence | null {
  return confidences.reduce<LithoLayerConfidence | null>(
    (acc, c) => worseConfidence(acc, c),
    null,
  )
}

/** Total string compare — a stable, locale-independent id tiebreak. */
function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/** L2 key for the ungrouped (no litho parent) bucket — sorts after every real body. */
const UNGROUPED_KEY = ' ungrouped'
/** Litho ordinal sentinel for the ungrouped bucket — sorts it last within its soil. */
const UNGROUPED_SORT_ORDINAL = Number.MAX_SAFE_INTEGER

/**
 * Build the soil ▸ litho body ▸ packing body tree for the Geotech-units pane.
 *
 * Order
 * -----
 * * Soil groups by the lowest ``display_order`` among the units whose bodies
 *   land there — the stratigraphic order lifted to the group.
 * * Litho bodies by their litho ``body_ordinal``, the ungrouped bucket LAST.
 * * Packing bodies by their own ``body_ordinal`` (the way the 3-D legend
 *   numbers them), ties broken by id.
 *
 * The tree is BODY-driven: only geotech bodies produce nodes. The header
 * counters still describe the geotech UNITS (a unit with no bands and no layers
 * is not counted), so "N with bands" reads the same as before.
 *
 * Parameters
 * ----------
 * input
 *     Units, contacts, layers, the two body rosters, and the group map.
 *
 * Returns
 * -------
 * GeotechUnitTree
 *     Groups plus the two header counters. Never throws; an empty ``units`` or
 *     ``bodies`` yields an empty tree.
 */
export function buildGeotechUnitTree(input: GeotechUnitTreeInput): GeotechUnitTree {
  const { units, contacts, layers, bodies, lithoBodies, lithoUnitNameById, groupByBodyId } = input

  // --- Header counters (describe the geotech UNITS, unchanged semantics) ---
  const bandCountByUnit = new Map<string, number>()
  for (const c of contacts) {
    bandCountByUnit.set(c.formation_id, (bandCountByUnit.get(c.formation_id) ?? 0) + 1)
  }
  const layerCountByUnit = new Map<string, number>()
  for (const l of layers) {
    layerCountByUnit.set(l.formation_id, (layerCountByUnit.get(l.formation_id) ?? 0) + 1)
  }
  // "Empty" is the frontend twin of the backend orphan predicate (no layer, no
  // contact) — a unit that describes nothing is not counted.
  const describesNothing = (u: GeotechUnitRef): boolean =>
    (bandCountByUnit.get(u.id) ?? 0) === 0 && (layerCountByUnit.get(u.id) ?? 0) === 0
  const visibleUnits = units.filter(u => !describesNothing(u))
  let bandCount = 0
  for (const u of visibleUnits) bandCount += bandCountByUnit.get(u.id) ?? 0
  const unitCount = visibleUnits.length

  // --- Per-body aggregates: accepted band count + all confidences (for badges) ---
  const acceptedBandByBody = new Map<string, number>()
  const confidencesByBody = new Map<string, LithoLayerConfidence[]>()
  for (const l of layers) {
    const bid = l.body_id ?? null
    if (bid === null) continue
    const arr = confidencesByBody.get(bid)
    if (arr === undefined) confidencesByBody.set(bid, [l.confidence])
    else arr.push(l.confidence)
    if ((l.status ?? 'accepted') === 'accepted') {
      acceptedBandByBody.set(bid, (acceptedBandByBody.get(bid) ?? 0) + 1)
    }
  }

  const unitById = new Map(units.map(u => [u.id, u]))

  // --- Bucket raw bodies: soil → litho-body key → bodies ---
  interface L2Bucket {
    lithoBodyId: string | null
    bodies: GeotechBodyRef[]
  }
  interface L1Bucket {
    soil: string
    l2: Map<string, L2Bucket>
  }
  const soilBuckets = new Map<string, L1Bucket>()
  const soilMinOrder = new Map<string, number>()

  for (const b of bodies ?? []) {
    const home = unitById.get(b.formation_id)
    if (home === undefined) continue // orphan body — its home unit is not on the roster
    const soil = geotechUnitSoil(home)
    const lithoBodyId = b.parentLithoBodyId ?? null

    let l1 = soilBuckets.get(soil)
    if (l1 === undefined) {
      l1 = { soil, l2: new Map() }
      soilBuckets.set(soil, l1)
    }
    const l2key = lithoBodyId ?? UNGROUPED_KEY
    let l2 = l1.l2.get(l2key)
    if (l2 === undefined) {
      l2 = { lithoBodyId, bodies: [] }
      l1.l2.set(l2key, l2)
    }
    l2.bodies.push(b)

    const prev = soilMinOrder.get(soil)
    if (prev === undefined || home.display_order < prev) soilMinOrder.set(soil, home.display_order)
  }

  /** Map one raw geotech body to its L3 leaf. */
  const toPacking = (b: GeotechBodyRef, home: GeotechUnitRef): GeotechPackingBody => {
    const nadClass = home.nad_class
    const confidences = confidencesByBody.get(b.id) ?? []
    const name = b.name?.trim()
    const override = home.color_override ?? null
    return {
      bodyId: b.id,
      label: name
        ? name
        : nadClass !== null
          ? geotechBodyAutoLabel(nadClass, b.body_ordinal)
          : `#${b.body_ordinal}`,
      nadClass,
      bandCount: acceptedBandByBody.get(b.id) ?? 0,
      provenance: bodyProvenance(confidences),
      confidence: bodyConfidence(confidences),
      geoFormations: b.geoFormations ?? [],
      unitId: home.id,
      unitLabel: nadClass !== null ? nadSoilPackingLabel(nadClass) : geotechUnitSoil(home),
      color: override ?? nadClassColor(nadClass),
      colorOverride: override,
      groupNumber: groupByBodyId?.get(b.id) ?? null,
    }
  }

  // --- Materialise the sorted tree ---
  const groups: GeotechSoilGroup[] = [...soilBuckets.values()].map(l1 => {
    const lithoNodes: GeotechLithoBodyNode[] = [...l1.l2.values()].map(l2 => {
      // The leaf label hides the ordinal, so sort the raw bodies by their
      // geotech ``body_ordinal`` (ties broken by id) BEFORE mapping to leaves.
      const packingBodies = [...l2.bodies]
        .sort((a, b) => a.body_ordinal - b.body_ordinal || compareId(a.id, b.id))
        .map(b => toPacking(b, unitById.get(b.formation_id) as GeotechUnitRef))

      const bandCountL2 = packingBodies.reduce((sum, p) => sum + p.bandCount, 0)
      // Worst-wins roll-up so a collapsed node still shows the "No CPT" exception
      // (ux-reviewer 2026-09-01). The representative class lets the badge decide
      // whether to draw (it is suppressed for an unclassified row).
      const provenance = packingBodies.reduce<ClassProvenance>(
        (acc, p) => worseProvenance(acc, p.provenance),
        'cpt',
      )
      const confidence = packingBodies.reduce<LithoLayerConfidence | null>(
        (acc, p) => worseConfidence(acc, p.confidence),
        null,
      )
      const nadClass = packingBodies.find(p => p.nadClass !== null)?.nadClass ?? null
      const lithoEntry = l2.lithoBodyId === null ? undefined : lithoBodies?.get(l2.lithoBodyId)
      const unitName =
        lithoEntry?.formation_id != null
          ? (lithoUnitNameById?.get(lithoEntry.formation_id) ?? l1.soil)
          : l1.soil
      return {
        lithoBodyId: l2.lithoBodyId,
        key: `${l1.soil}|${l2.lithoBodyId ?? 'ungrouped'}`,
        label:
          l2.lithoBodyId === null
            ? ''
            : lithoBodyLabel(l2.lithoBodyId, unitName, lithoBodies ?? new Map()),
        bandCount: bandCountL2,
        provenance,
        confidence,
        nadClass,
        packingBodies,
      }
    })

    // Litho bodies by their litho ordinal, the ungrouped bucket last.
    lithoNodes.sort((a, b) => {
      const oa = a.lithoBodyId === null ? UNGROUPED_SORT_ORDINAL : (lithoBodies?.get(a.lithoBodyId)?.body_ordinal ?? UNGROUPED_SORT_ORDINAL)
      const ob = b.lithoBodyId === null ? UNGROUPED_SORT_ORDINAL : (lithoBodies?.get(b.lithoBodyId)?.body_ordinal ?? UNGROUPED_SORT_ORDINAL)
      return oa - ob || compareId(a.key, b.key)
    })

    return {
      soil: l1.soil,
      bandCount: lithoNodes.reduce((sum, n) => sum + n.bandCount, 0),
      lithoBodies: lithoNodes,
    }
  })

  groups.sort(
    (a, b) =>
      (soilMinOrder.get(a.soil) ?? 0) - (soilMinOrder.get(b.soil) ?? 0) ||
      compareId(a.soil, b.soil),
  )

  return { groups, unitCount, bandCount }
}
