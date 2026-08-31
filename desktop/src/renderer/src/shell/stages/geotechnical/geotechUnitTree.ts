/**
 * Pure builder for the Geotech-units pane tree: soil ▸ NAD class ▸ instances.
 *
 * Why a tree at all
 * -----------------
 * The pane was a flat roster — one row per geotech formation. On the owner's
 * project that is ~94 rows in which the same soil repeats dozens of times, the
 * same packing class appears once per unit instance, and rows with no bands sit
 * between rows with 647 bands between them. The shape the owner approved
 * (2026-08-26, ``blend_viewer/geotech_ui_tidy_ideas.html`` panel 2) collapses it
 * to a soil header per ground, one row per NAD class beneath it with the bands
 * SUMMED across the unit instances carrying that class, and the instances
 * themselves only when a class actually has more than one.
 *
 * All the arithmetic lives here rather than in the component so the grouping,
 * the sums, the badge roll-up and the empty-row filter are testable without a
 * DOM.
 *
 * What "band" counts
 * ------------------
 * A band is an ACCEPTED contact in the active geotech model — the same quantity
 * the flat roster showed per row (``geotechContacts`` is
 * ``lithoLayersToContacts(geotechLayers)``, accepted-only). Grouping changes how
 * the number is presented, never what it counts, so the tree's totals still
 * reconcile with what the engineer read yesterday.
 */

import type { LithoLayerConfidence } from '../../../api/client'
import { geotechRowColorOverride } from '../../../utils/geotechRowColorOverride'
import {
  geotechUnitLabel,
  geotechUnitSoil,
  nadClassColor,
  nadClassQualifier,
} from '../../../utils/nadClasses'

// ---------------------------------------------------------------------------
// Badge severity — the ONE place the "worst wins" order is stated
// ---------------------------------------------------------------------------

/** Where a unit's NAD class came from, for the provenance badge. */
export type ClassProvenance = 'cpt' | 'partial' | 'none'

/**
 * Severity rank of each badge value — HIGHER IS WORSE, and the worst value in a
 * group is what the group row shows.
 *
 * Owner's rule for the collapsed row: "provenance collapses to the worst badge
 * in the group (partial/low bubbles up — that is the one you need to see)". A
 * class row that averaged its instances, or showed the best of them, would let
 * one uncontrolled instance hide inside a row that reads healthy.
 *
 * Both ladders are declared here, together, because they are the same rule
 * applied to two badges; splitting them across the two aggregation functions is
 * how they drift apart.
 *
 * * ``cpt`` — every band came from a real qc window.
 * * ``partial`` — some did; at least one took the weakest class seen in its body.
 * * ``none`` — no cone behind the class at all (or no bands).
 *
 * * ``high`` / ``medium`` — the packing class was read off a qc window.
 * * ``low`` — the borehole fill wrote it from ``body_min`` / ``absolute_min``.
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

/** Pick the worse of two provenance values. */
function worseProvenance(a: ClassProvenance, b: ClassProvenance): ClassProvenance {
  return PROVENANCE_SEVERITY[b] > PROVENANCE_SEVERITY[a] ? b : a
}

/**
 * Pick the worse of two confidence values, treating ``null`` as "says nothing".
 *
 * An instance with no layers must not drag a class row down — it has no opinion
 * about the packing class, which is different from having a weak one.
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

/** The field of an accepted geotech contact the tree reads. */
export interface GeotechContactRef {
  formation_id: string
}

/** The fields of a geotech layer the tree reads for the badges. */
export interface GeotechLayerRef {
  formation_id: string
  confidence: LithoLayerConfidence
}

/** Everything the builder needs. */
export interface GeotechUnitTreeInput {
  /** Geotech formations to display (pre-filtered to ``isGeotechUnit``). */
  units: readonly GeotechUnitRef[]
  /** Accepted contacts in the active geotech model — the band count. */
  contacts: readonly GeotechContactRef[]
  /** All geotech layers in the active model — the badge source. */
  layers: readonly GeotechLayerRef[]
  /**
   * ``source_litho_formation_id`` → the source litho unit's display name.
   * Used to tell same-class instances apart when a class carries several.
   */
  sourceLithoNameById?: ReadonlyMap<string, string>
  /**
   * Geotech unit id → the geological formations that unit's bodies cross,
   * shallowest first (debt #278, R2). Surfaced as a class-row subtitle. A class
   * row standing for several units unions their lists. Absent → no subtitle.
   */
  geoFormationNamesById?: ReadonlyMap<string, readonly string[]>
}

/** One unit instance under a NAD-class row. */
export interface GeotechUnitInstance {
  formationId: string
  /** Full display name, disambiguated when its class carries several. */
  label: string
  bandCount: number
  provenance: ClassProvenance
  confidence: LithoLayerConfidence | null
}

/** One NAD-class row under a soil header. */
export interface GeotechClassRow {
  /** Stable identity for React keys + expand state: ``"{SOIL}|{class}"``. */
  key: string
  soil: string
  nadClass: number | null
  /** Firmness / density word only — the soil sits in the header above. */
  label: string
  /** What to draw the swatch in: the picked colour, else the NAD colour. */
  color: string
  /**
   * The picked colour when one is in force across the whole row, else null.
   *
   * Separate from ``color`` because the row needs to know WHETHER a pick is in
   * force, not just what to draw — that is what its reset-to-automatic control
   * appears for, and a pick that happens to equal the NAD colour is still a
   * pick (see ``geotechUnitColor``).
   */
  colorOverride: string | null
  /** Bands summed across every instance carrying this class. */
  bandCount: number
  /** Worst provenance among the instances. */
  provenance: ClassProvenance
  /** Worst confidence among the instances; null when none has layers. */
  confidence: LithoLayerConfidence | null
  /**
   * The geological formations this row's units cross, shallowest first, unioned
   * across the units and deduped (debt #278, R2). Rendered as a subtitle;
   * empty when nothing crosses a formation or no map was supplied.
   */
  geoFormations: string[]
  /** Every instance, ordered. Render them only when there is more than one. */
  instances: GeotechUnitInstance[]
}

/** One soil header with its class rows. */
export interface GeotechSoilGroup {
  soil: string
  /** Bands summed across every class in this soil. */
  bandCount: number
  classes: GeotechClassRow[]
}

/** The whole tree plus the header counters. */
export interface GeotechUnitTree {
  groups: GeotechSoilGroup[]
  /** Units that describe something in this model — the "N with bands" figure. */
  unitCount: number
  /** Total bands across the units on the roster. */
  bandCount: number
}

// ---------------------------------------------------------------------------
// Per-unit aggregation
// ---------------------------------------------------------------------------

/**
 * Classify where one unit's NAD class came from, from its layers' confidences.
 *
 * The confidence a band persists IS its provenance: ``subdivide_all_bodies`` and
 * the ``cpt_interpolated`` borehole fill write 'medium' / 'high' from a real qc
 * window, while the borehole fallbacks (``body_min``, ``absolute_min`` — see
 * ``divide_boreholes._BOREHOLE_CONFIDENCE_MAP``) write 'low'.
 *
 * Deliberately NOT worst-wins at the unit level: a unit with 141 cone bands and
 * one fallback has emphatically had a cone in it, and labelling it "No CPT" is
 * as untrue as stamping "CPT est." on a pure fallback. The mixture gets its own
 * answer. Worst-wins applies one level UP, across the instances of a class row.
 */
function unitProvenance(confidences: readonly LithoLayerConfidence[]): ClassProvenance {
  if (confidences.length === 0) return 'none'
  const fromCone = confidences.some(c => c === 'high' || c === 'medium')
  if (!fromCone) return 'none'
  return confidences.some(c => c === 'low') ? 'partial' : 'cpt'
}

/** Worst confidence across one unit's layers; null when it has none. */
function unitConfidence(
  confidences: readonly LithoLayerConfidence[],
): LithoLayerConfidence | null {
  return confidences.reduce<LithoLayerConfidence | null>(
    (acc, c) => worseConfidence(acc, c),
    null,
  )
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/** Sentinel class key for the unclassified row — sorts after every real class. */
const UNCLASSIFIED_SORT_KEY = Number.MAX_SAFE_INTEGER

/**
 * Build the soil ▸ NAD class ▸ instances tree for the Geotech-units pane.
 *
 * Order
 * -----
 * * Soil groups by the lowest ``display_order`` among their units — the
 *   stratigraphic order the flat roster used, lifted to the group.
 * * Class rows by NAD class ascending (loosest first, the packing sequence),
 *   with the unclassified row LAST: it has no position in a density ramp, and
 *   putting it at the bottom keeps the classified reading uninterrupted.
 * * Instances by ``display_order``, then id, so the order is total.
 *
 * Empty rows are DROPPED, unconditionally
 * ---------------------------------------
 * "Empty" means the unit describes NOTHING in this model — no accepted bands
 * and no layers of any status. Such a unit is not listed and there is no lever
 * to list it. Owner ruling, dogfeed 2026-08-26: "The show empty is weird
 * though, if a bin is empty that means there is nothing in it and nothing
 * exists". The pane is a description of the ground the model holds; a row for
 * ground that is not there is nothing the engineer can act on, and the backend
 * orphan sweep deletes those units shortly in any case.
 *
 * "Empty" deliberately does NOT mean "no class": a unit with no packing class
 * but real bands is unclassified GROUND, the row the engineer most needs in
 * front of him, and it stays in the tree.
 *
 * The definition is the frontend twin of the backend's orphan predicate
 * (``OrphanFormationSweep``: no layer, no contact, no body). Keeping the two
 * aligned means the row the pane drops is the row the next verb sweeps away —
 * if the pane hid on band count alone it would drop a unit the backend still
 * considers live.
 *
 * Parameters
 * ----------
 * input
 *     Units, accepted contacts, layers, and the optional source-name map.
 *
 * Returns
 * -------
 * GeotechUnitTree
 *     Groups plus the two header counters. Never throws; an empty ``units``
 *     yields an empty tree.
 */
export function buildGeotechUnitTree(input: GeotechUnitTreeInput): GeotechUnitTree {
  const { units, contacts, layers, sourceLithoNameById, geoFormationNamesById } = input

  // One pass each over the two big arrays — the flat roster re-filtered both
  // per row, which is O(units x rows) on a project with ~650 bands.
  const bandCountByUnit = new Map<string, number>()
  for (const c of contacts) {
    bandCountByUnit.set(c.formation_id, (bandCountByUnit.get(c.formation_id) ?? 0) + 1)
  }
  const confidencesByUnit = new Map<string, LithoLayerConfidence[]>()
  for (const l of layers) {
    const arr = confidencesByUnit.get(l.formation_id)
    if (arr === undefined) confidencesByUnit.set(l.formation_id, [l.confidence])
    else arr.push(l.confidence)
  }

  /** True when the unit describes nothing in this model — see the module note. */
  const describesNothing = (u: GeotechUnitRef): boolean =>
    (bandCountByUnit.get(u.id) ?? 0) === 0 && (confidencesByUnit.get(u.id)?.length ?? 0) === 0

  // The counters describe what the pane SHOWS, so they count the same rows the
  // filter keeps — an empty unit contributes to neither.
  const visible = units.filter(u => !describesNothing(u))
  let bandCount = 0
  for (const u of visible) bandCount += bandCountByUnit.get(u.id) ?? 0
  const unitCount = visible.length

  // Bucket by (soil, class). Insertion order is irrelevant — every level is
  // sorted explicitly below.
  interface Bucket {
    soil: string
    nadClass: number | null
    units: GeotechUnitRef[]
  }
  const buckets = new Map<string, Bucket>()
  const groupMinOrder = new Map<string, number>()
  for (const u of visible) {
    const soil = geotechUnitSoil(u)
    const key = `${soil}|${u.nad_class ?? ''}`
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, { soil, nadClass: u.nad_class, units: [u] })
    else bucket.units.push(u)
    const prev = groupMinOrder.get(soil)
    if (prev === undefined || u.display_order < prev) groupMinOrder.set(soil, u.display_order)
  }

  const classRowsBySoil = new Map<string, GeotechClassRow[]>()
  for (const bucket of buckets.values()) {
    const ordered = [...bucket.units].sort(
      (a, b) => a.display_order - b.display_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    // A single instance has nothing to be told apart from, so it keeps the
    // plain label; several share one class row and need their source unit.
    const disambiguate = ordered.length > 1

    const instances: GeotechUnitInstance[] = ordered.map(u => {
      const confidences = confidencesByUnit.get(u.id) ?? []
      const sourceName =
        disambiguate && u.source_litho_formation_id != null
          ? (sourceLithoNameById?.get(u.source_litho_formation_id) ?? null)
          : null
      return {
        formationId: u.id,
        label: geotechUnitLabel(u, sourceName),
        bandCount: bandCountByUnit.get(u.id) ?? 0,
        provenance: unitProvenance(confidences),
        confidence: unitConfidence(confidences),
      }
    })

    // Shared with the 3-D legend so the two panes cannot disagree about the
    // same class — see ``geotechRowColorOverride`` for the rule.
    const colorOverride = geotechRowColorOverride(ordered)

    // R2: list every geological formation the row's units cross, unioned in the
    // units' own order (already sorted above) and deduped, so a class row that
    // stands for several units shows the whole crossing rather than one unit's.
    const geoFormations: string[] = []
    for (const u of ordered) {
      for (const name of geoFormationNamesById?.get(u.id) ?? []) {
        if (!geoFormations.includes(name)) geoFormations.push(name)
      }
    }

    const row: GeotechClassRow = {
      key: `${bucket.soil}|${bucket.nadClass ?? ''}`,
      soil: bucket.soil,
      nadClass: bucket.nadClass,
      label: nadClassQualifier(bucket.nadClass),
      color: colorOverride ?? nadClassColor(bucket.nadClass),
      colorOverride,
      bandCount: instances.reduce((sum, i) => sum + i.bandCount, 0),
      provenance: instances.reduce<ClassProvenance>(
        (acc, i) => worseProvenance(acc, i.provenance),
        'cpt',
      ),
      confidence: instances.reduce<LithoLayerConfidence | null>(
        (acc, i) => worseConfidence(acc, i.confidence),
        null,
      ),
      geoFormations,
      instances,
    }
    const rows = classRowsBySoil.get(bucket.soil)
    if (rows === undefined) classRowsBySoil.set(bucket.soil, [row])
    else rows.push(row)
  }

  const groups: GeotechSoilGroup[] = [...classRowsBySoil.entries()]
    .map(([soil, rows]) => {
      rows.sort(
        (a, b) => (a.nadClass ?? UNCLASSIFIED_SORT_KEY) - (b.nadClass ?? UNCLASSIFIED_SORT_KEY),
      )
      return {
        soil,
        bandCount: rows.reduce((sum, r) => sum + r.bandCount, 0),
        classes: rows,
      }
    })
    .sort(
      (a, b) =>
        (groupMinOrder.get(a.soil) ?? 0) - (groupMinOrder.get(b.soil) ?? 0) ||
        (a.soil < b.soil ? -1 : a.soil > b.soil ? 1 : 0),
    )

  return { groups, unitCount, bandCount }
}
