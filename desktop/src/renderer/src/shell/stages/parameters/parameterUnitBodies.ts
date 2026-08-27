// The body level of the Parameters unit scope — pure arithmetic, no React.
//
// Owner ruling 2026-08-27, verbatim: "a body is only a body if it is
// geometrically connected or if the users says, this body is the same as that
// body." A Parameters unit row is a (soil, NAD-class, geo-label) FORMATION
// row that lumps many resolver bodies (32 rows carried 175 bodies on the live
// model); the resolver's connected components — geometric connection plus
// user-accepted ties — already implement his body definition, so this module
// only READS the ``body_id`` the resolver stamped. It never resolves anything
// itself.
//
// Three things live here, shared by the unit list (the two-level tree), the
// statistics header (the honest label) and nothing else:
//
//   * ``unitBodyRows`` — which bodies a unit row lumps, with per-body counts;
//   * ``bodyLabelOf`` — the body's stable label, named the way the 3-D legend
//     names bodies (the engineer's name, else ``#<ordinal>``);
//   * the two header composers — the pooled view SAYS it pools ("pooled
//     across N bodies" is the ruling's point), the body view names its body.

/** The roster fields a body label reads — a reduced ``BodyListItem``. */
export interface BodyRosterEntry {
  /** The engineer's name for the body, or ``null``. */
  name: string | null
  /** The body's ordinal within its formation's naming group (0-based). */
  body_ordinal: number
}

/** One body row under a unit row in the Parameters list. */
export interface ParameterUnitBodyRow {
  /** The resolver body (``BodyOrm.id``). */
  bodyId: string
  /** Stable display label — see {@link bodyLabelOf}. */
  label: string
  /** Accepted bands of the unit stamped with this body, either anchor. */
  bandCount: number
  /** Distinct CPTs among those bands (boreholes carry no cone). */
  cptCount: number
}

/** The layer fields the body grouping reads. */
interface BodyLayerRef {
  formation_id: string
  cpt_id: string | null
  status: string
  body_id?: string | null
}

/**
 * A body's display label, the way the 3-D legend names bodies.
 *
 * The engineer's trimmed name wins; else the legend's ``#<ordinal>``; a body
 * the roster does not know (stale stamp, roster still loading) keeps a stable
 * 8-character id prefix — the ``BodyContextMenu`` header precedent — so the
 * row is never blank and never lies about being resolved.
 *
 * Parameters
 * ----------
 * bodyId
 *     The resolver body id.
 * roster
 *     ``body id → roster entry`` from ``GET .../bodies``, or ``null`` while
 *     the roster has not landed.
 *
 * Returns
 * -------
 * str
 *     The label.
 */
export function bodyLabelOf(
  bodyId: string,
  roster: ReadonlyMap<string, BodyRosterEntry> | null,
): string {
  const entry = roster?.get(bodyId)
  if (entry === undefined) return bodyId.slice(0, 8)
  const name = entry.name?.trim()
  return name ? name : `#${entry.body_ordinal}`
}

/**
 * The bodies one unit row lumps, with per-body band + CPT counts.
 *
 * Accepted layers only (a pending proposal is not ground — the standing rule
 * everywhere bands are counted), grouped by the resolver's ``body_id``. An
 * unstamped layer (``body_id`` null) belongs to NO body: it pools in the
 * lumped view but forms no row here.
 *
 * Order: roster ordinal ascending (the legend's order), bodies the roster
 * does not know after, tied groups by label then id so the order is total.
 *
 * Parameters
 * ----------
 * layers
 *     Every layer of the scoped model, any status.
 * unitId
 *     The formation whose bodies are wanted.
 * roster
 *     The body roster for labels + order, or ``null`` while loading.
 *
 * Returns
 * -------
 * ParameterUnitBodyRow[]
 *     One row per stamped body with at least one accepted band.
 */
export function unitBodyRows(
  layers: readonly BodyLayerRef[],
  unitId: string,
  roster: ReadonlyMap<string, BodyRosterEntry> | null,
): ParameterUnitBodyRow[] {
  const byBody = new Map<string, { bandCount: number; cptIds: Set<string> }>()
  for (const layer of layers) {
    if (layer.formation_id !== unitId) continue
    if (layer.status !== 'accepted') continue
    const bodyId = layer.body_id ?? null
    if (bodyId === null) continue
    let bucket = byBody.get(bodyId)
    if (bucket === undefined) {
      bucket = { bandCount: 0, cptIds: new Set() }
      byBody.set(bodyId, bucket)
    }
    bucket.bandCount += 1
    if (layer.cpt_id !== null) bucket.cptIds.add(layer.cpt_id)
  }

  const rows: ParameterUnitBodyRow[] = []
  for (const [bodyId, bucket] of byBody) {
    rows.push({
      bodyId,
      label: bodyLabelOf(bodyId, roster),
      bandCount: bucket.bandCount,
      cptCount: bucket.cptIds.size,
    })
  }
  const ordinalOf = (bodyId: string): number =>
    roster?.get(bodyId)?.body_ordinal ?? Number.MAX_SAFE_INTEGER
  rows.sort(
    (a, b) =>
      ordinalOf(a.bodyId) - ordinalOf(b.bodyId) ||
      a.label.localeCompare(b.label) ||
      (a.bodyId < b.bodyId ? -1 : a.bodyId > b.bodyId ? 1 : 0),
  )
  return rows
}

/**
 * How many DISTINCT resolver bodies a unit row lumps.
 *
 * Counts stamped bodies among the row's accepted layers — the ``N`` of the
 * honest header. Unstamped layers say nothing about connectivity and add no
 * body.
 *
 * Parameters
 * ----------
 * layers
 *     Every layer of the scoped model, any status.
 * unitId
 *     The formation to count for.
 *
 * Returns
 * -------
 * int
 *     The distinct stamped-body count.
 */
export function unitBodyCount(layers: readonly BodyLayerRef[], unitId: string): number {
  const bodies = new Set<string>()
  for (const layer of layers) {
    if (layer.formation_id !== unitId) continue
    if (layer.status !== 'accepted') continue
    const bodyId = layer.body_id ?? null
    if (bodyId !== null) bodies.add(bodyId)
  }
  return bodies.size
}

/**
 * The pooled view's header — the honest label the ruling asks for.
 *
 * ``"<base> — pooled across N bodies"``; with zero stamped bodies there is
 * nothing to pool across (the resolver has not run), so the base label
 * stands rather than claiming a pooling that does not exist.
 *
 * Parameters
 * ----------
 * base
 *     The unit's own label (kind-specific — the caller owns it).
 * bodyCount
 *     Distinct stamped bodies among the row's accepted layers.
 *
 * Returns
 * -------
 * str
 *     The header label.
 */
export function pooledHeaderLabel(base: string, bodyCount: number): string {
  if (bodyCount === 0) return base
  return `${base} — pooled across ${bodyCount} ${bodyCount === 1 ? 'body' : 'bodies'}`
}

/**
 * The body-scoped view's header: ``"<unit name> — body <label>"``.
 *
 * Parameters
 * ----------
 * unitName
 *     The unit's own name (kind-specific — the caller owns it).
 * bodyId
 *     The scoped resolver body.
 * roster
 *     The body roster for the label, or ``null`` while loading.
 *
 * Returns
 * -------
 * str
 *     The header label.
 */
export function bodyScopedHeaderLabel(
  unitName: string,
  bodyId: string,
  roster: ReadonlyMap<string, BodyRosterEntry> | null,
): string {
  return `${unitName} — body ${bodyLabelOf(bodyId, roster)}`
}
