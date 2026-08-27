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
  /**
   * The body's HOME formation (``BodyOrm.formation_id``) — the one unit row
   * the body renders under (F1). Optional so label-only fixtures stay valid;
   * a roster entry without it degrades to per-layer attribution.
   */
  formation_id?: string
}

/** One body row under a unit row in the Parameters list. */
export interface ParameterUnitBodyRow {
  /** The resolver body (``BodyOrm.id``). */
  bodyId: string
  /** Stable display label — see {@link bodyLabelOf}. */
  label: string
  /** Accepted bands of this body, either anchor. */
  bandCount: number
  /** How many of those bands are CPT-anchored — bands the cone pool reads. */
  cptBandCount: number
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
 * **One body = one row (F1).** A resolver body can span TWO duplicate
 * formation rows (same name/class/soil, different derived geo-label — 32 of
 * 175 bodies on the live model), and grouping by the LAYER's ``formation_id``
 * rendered such a body as two half-counted rows ("1 band · 0 CPTs" beside
 * "7 bands · 4 CPTs"). The body renders under its HOME formation — the
 * roster's ``formation_id`` — counting ALL its accepted layers, twins
 * included. Only a body the roster does not know (stale stamp, roster still
 * loading, label-only fixture) falls back to per-layer attribution.
 *
 * Order: roster ordinal ascending (the legend's order), bodies the roster
 * does not know after, tied groups by label then id so the order is total.
 *
 * Parameters
 * ----------
 * layers
 *     Every layer of the scoped model, any status — INCLUDING other units'
 *     layers, which is what lets a homed body count its twin-row bands.
 * unitId
 *     The formation whose bodies are wanted.
 * roster
 *     The body roster for homes, labels + order, or ``null`` while loading.
 *
 * Returns
 * -------
 * ParameterUnitBodyRow[]
 *     One row per stamped body with at least one accepted band that this
 *     unit row owns.
 */
export function unitBodyRows(
  layers: readonly BodyLayerRef[],
  unitId: string,
  roster: ReadonlyMap<string, BodyRosterEntry> | null,
): ParameterUnitBodyRow[] {
  const byBody = new Map<
    string,
    { bandCount: number; cptBandCount: number; cptIds: Set<string> }
  >()
  for (const layer of layers) {
    if (layer.status !== 'accepted') continue
    const bodyId = layer.body_id ?? null
    if (bodyId === null) continue
    const home = roster?.get(bodyId)?.formation_id ?? null
    // A homed body belongs to exactly one unit row and counts ALL its layers;
    // a roster-less body keeps today's per-layer attribution (no guessed home).
    if (home !== null ? home !== unitId : layer.formation_id !== unitId) continue
    let bucket = byBody.get(bodyId)
    if (bucket === undefined) {
      bucket = { bandCount: 0, cptBandCount: 0, cptIds: new Set() }
      byBody.set(bodyId, bucket)
    }
    bucket.bandCount += 1
    if (layer.cpt_id !== null) {
      bucket.cptBandCount += 1
      bucket.cptIds.add(layer.cpt_id)
    }
  }

  const rows: ParameterUnitBodyRow[] = []
  for (const [bodyId, bucket] of byBody) {
    rows.push({
      bodyId,
      label: bodyLabelOf(bodyId, roster),
      bandCount: bucket.bandCount,
      cptBandCount: bucket.cptBandCount,
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
 * How many DISTINCT resolver bodies CONTRIBUTE to a unit's pooled statistics.
 *
 * The ``N`` of the honest header (F7). Contributing means at least one band
 * the cone pool actually reads: accepted, CPT-anchored, on a member hole —
 * the same filters ``unitCptBands`` applies to the pooled (formation) scope.
 * A borehole-only body or one whose CPTs are off the member set adds nothing
 * to the pool, so it is not counted (the live case said "16 bodies" where
 * only 9 contributed).
 *
 * Parameters
 * ----------
 * layers
 *     Every layer of the scoped model, any status.
 * unitId
 *     The formation to count for (the pooled scope is formation-filtered).
 * memberInvestigationIds
 *     The pooling population, or ``null`` to skip the membership filter.
 *
 * Returns
 * -------
 * int
 *     The distinct contributing-body count.
 */
export function pooledBodyCount(
  layers: readonly BodyLayerRef[],
  unitId: string,
  memberInvestigationIds: ReadonlySet<string> | null,
): number {
  const bodies = new Set<string>()
  for (const layer of layers) {
    if (layer.formation_id !== unitId) continue
    if (layer.status !== 'accepted') continue
    if (layer.cpt_id === null) continue
    if (memberInvestigationIds !== null && !memberInvestigationIds.has(layer.cpt_id)) continue
    const bodyId = layer.body_id ?? null
    if (bodyId !== null) bodies.add(bodyId)
  }
  return bodies.size
}

/**
 * The unit a body-resolved jump reports (F10) — the body's HOME formation.
 *
 * The fill overlays report a region's formation LABEL beside a
 * layers-resolved body; the label can be a twin row (or, on the geotech
 * axis, a litho-frame id) while the body's row lives under its home. When a
 * body resolved, the home wins; with no body, or a body the roster does not
 * know, the label stands.
 *
 * Parameters
 * ----------
 * unitId
 *     The formation id the clicked surface reported (the label).
 * bodyId
 *     The resolved body, or ``null``/``undefined`` for a formation-level jump.
 * roster
 *     The body roster (the same one the pane groups by), or ``null``.
 *
 * Returns
 * -------
 * str
 *     The unit id the jump should report.
 */
export function bodyHomeUnitId(
  unitId: string,
  bodyId: string | null | undefined,
  roster: ReadonlyMap<string, BodyRosterEntry> | null,
): string {
  if (bodyId == null) return unitId
  return roster?.get(bodyId)?.formation_id ?? unitId
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
