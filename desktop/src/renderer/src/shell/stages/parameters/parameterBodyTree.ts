// The Parameters body tree — the ONE authority for the owner-ruled four-level
// tree AND for "what does this node pool" (spec §1–§3, 2026-08-27).
//
// Owner rulings this module implements (verbatim):
//   * Q1, body identity: "uninterrupted fill is there because of the ties.
//     Ties -> form a bodies -> causes uninterrupted fill -> one body." Body
//     resolution does NOT change here — this module only READS the resolver's
//     ``body_id`` stamps.
//   * Tree shape: "it is best to geometrically split all litho bodies first.
//     That gives you the first depth of the tree, the geotech subsplit then
//     lives beneath that. So you can halve silt > silt 1 or silt 2 or silt 3 >
//     and under silt 3 you might have SF silt 1 and SF silt 2 (if they are
//     geometrically split) and then MF silt."
//   * Grouping variant B: a CLASS row sits between the litho body and its
//     geotech bodies.
//
// The four levels:
//   LITHO UNIT (formation, always listed) ▸ LITHO BODY (resolver body on the
//   litho model) ▸ CLASS ROW (one NAD class inside that litho body) ▸ GEOTECH
//   BODY (resolver body on the geotech model).
//
// ``bandsForScope`` is the single band-selection authority every consumer —
// statistics, populations, OKP/PSD, the cutout body set, the node counts —
// routes through. No consumer branches on the kind itself.

import type { GeologicalFormationResponse, LithoLayerResponse } from '../../../api/client'
import { nadClassName } from '../../../utils/nadClasses'
import type { ParameterUnitScope } from '../../ShellContext'
import type { BodyRosterEntry } from './parameterUnitBodies'
import { geotechBodyLabel, lithoBodyLabel } from './parameterScopeLabels'

/**
 * Everything the tree and ``bandsForScope`` read.
 *
 * Faithfully EXPANDS the plan's sketch: it adds ``geotechFormations`` (a class
 * row needs each geotech band's ``nad_class``) and types both body rosters as
 * the ``id → entry`` map ``useModelBodies`` returns, matching ``bodyLabelOf``
 * — the plan's ``BodyRosterEntry[]`` carries no id.
 */
export interface ParameterTreeInput {
  /** The litho model's formation rows (the tree's top level). */
  lithoFormations: readonly GeologicalFormationResponse[]
  /** The geotech model's formation rows — read for each band's ``nad_class``. */
  geotechFormations: readonly GeologicalFormationResponse[]
  /** Every litho-model layer (any status; the module filters to accepted). */
  lithoLayers: readonly LithoLayerResponse[]
  /** Every geotech-model layer (any status; the module filters to accepted). */
  geotechLayers: readonly LithoLayerResponse[]
  /** The litho body roster (``body id → entry``) for homes, labels + ordinals. */
  lithoBodies: ReadonlyMap<string, BodyRosterEntry>
  /** The geotech body roster (``body id → entry``) for labels + ordinals. */
  geotechBodies: ReadonlyMap<string, BodyRosterEntry>
  /**
   * Geotech body id → manual-group number (debt #278 D1). A body joined into a
   * multi-member "Join with…" group carries "(group N)" on its leaf; absent →
   * no tag. The group SET a scope pools is carried by the ``geotech-group``
   * scope itself (``bandsForScope``), never by this label-only map.
   */
  groupByBodyId?: ReadonlyMap<string, number>
}

/** One node in the Parameters body tree. */
export interface ParameterTreeNode {
  /** The scope a click on this row selects. */
  scope: ParameterUnitScope
  /** Display label — spec §1 (translate-at-presentation-boundary). */
  label: string
  /** N accepted bands the row's click pools (over ``bandsForScope``). */
  bandCount: number
  /** How many of those bands are CPT-anchored — the "M with cone" honesty. */
  coneBandCount: number
  /** Child rows; ``[]`` for a leaf or a single-child-collapsed parent. */
  children: ParameterTreeNode[]
  /**
   * Geotech bands sourced to this litho unit that have no covering litho band
   * (parent NULL) — the excluded orphans, counted once here (litho-unit level
   * only). ``undefined`` on every other kind.
   */
  orphanCount?: number
  /**
   * The manual-group number (debt #278 D1) on a GEOTECH-BODY leaf joined into a
   * multi-member group; ``null``/``undefined`` on every other node and on an
   * ungrouped body. Drives the "(group N)" leaf tag.
   */
  groupNumber?: number | null
  /**
   * The geotech body id this row's grouping checkbox toggles (owner finding
   * 2026-09-04: "i can't group loose sand in Zand #0 with loose Zand in Zand
   * #2"). Set on a GEOTECH-BODY leaf (its own id) AND on a CLASS row that
   * collapsed its lone geotech body into itself — so a single-body class row,
   * which reads as a leaf with no geotech-body child, still carries a checkbox
   * and can be grouped across litho parents. ``undefined`` on every non-groupable
   * row (a litho unit, a litho body, a multi-body class row that groups its
   * children individually). It is the CHECKBOX identity only — the row's own
   * ``scope`` (what a click POOLS) is never re-pointed by it.
   */
  groupableBodyId?: string
  /**
   * The owning litho body's label, set ONLY on a collapsed SOLE-body class row
   * (ux-reviewer 2026-09-04). Such a row's own ``label`` is the packing class
   * alone (e.g. "SAND, loose"), identical for the same class under two litho
   * bodies, so its checkbox's accessible name needs the parent to tell "loose
   * sand under Zand #0" from "loose sand under Zand #2" apart — for AT and for a
   * user scrolled away from the ancestor header. ``undefined`` on a geotech-body
   * leaf (its own label is already unique) and every non-groupable row.
   */
  groupableBodyParentLabel?: string
}

// ---------------------------------------------------------------------------
// bandsForScope — the single band-selection authority
// ---------------------------------------------------------------------------

/** Accepted-only predicate — the standing "a pending proposal is not ground". */
export function isAccepted(layer: LithoLayerResponse): boolean {
  return layer.status === 'accepted'
}

/** ``litho_layer id → layer`` over the litho model — for parent-band lookup. */
export function lithoLayerIndex(
  lithoLayers: readonly LithoLayerResponse[],
): ReadonlyMap<string, LithoLayerResponse> {
  const out = new Map<string, LithoLayerResponse>()
  for (const l of lithoLayers) out.set(l.id, l)
  return out
}

/** ``geotech formation id → nad_class`` — a geotech band's class. */
export function nadClassIndex(
  geotechFormations: readonly GeologicalFormationResponse[],
): ReadonlyMap<string, number | null> {
  const out = new Map<string, number | null>()
  for (const f of geotechFormations) out.set(f.id, f.nad_class)
  return out
}

/**
 * The litho BODY a geotech band belongs to — its covering litho band's body,
 * read live through the parent-band FK (never stored on the geotech band, so
 * it never goes stale when the litho resolver re-mints body ids).
 *
 * Returns ``null`` for an orphan geotech band (no covering litho band) or one
 * whose covering litho band the resolver has not stamped yet.
 */
export function lithoBodyOfGeotechBand(
  band: LithoLayerResponse,
  lithoById: ReadonlyMap<string, LithoLayerResponse>,
): string | null {
  const parentId = band.parent_litho_layer_id ?? null
  if (parentId === null) return null
  return lithoById.get(parentId)?.body_id ?? null
}

/**
 * The accepted bands one scope's click pools — the SINGLE authority.
 *
 * Population filters (canonical section membership, hidden/removed excluded)
 * stay with the CONSUMERS (spec §3): this answers only "which bands are this
 * node's ground", already narrowed to accepted.
 *
 * | Node | bands |
 * |---|---|
 * | litho-unit | the unit's accepted litho bands |
 * | litho-body | the litho body's accepted bands (body IS the scope — no formation filter, F2) |
 * | geotech-class | accepted geotech bands of that nadClass whose litho parent band belongs to the litho body |
 * | geotech-body | the geotech body's accepted bands (F2 body authority) |
 * | geotech-unit | the geotech formation row's accepted bands (fallback) |
 *
 * Parameters
 * ----------
 * scope
 *     Any scope in the five-kind union.
 * input
 *     The tree input — the layer lists + geotech formations for class lookup.
 *
 * Returns
 * -------
 * LithoLayerResponse[]
 *     The scope's accepted bands, both anchors, in layer-list order.
 */
export function bandsForScope(
  scope: ParameterUnitScope,
  input: ParameterTreeInput,
): LithoLayerResponse[] {
  switch (scope.kind) {
    case 'litho-unit':
      return input.lithoLayers.filter(l => isAccepted(l) && l.formation_id === scope.unitId)
    case 'litho-body':
      // The body IS the scope (F2): a body can span twin formation rows, so the
      // formation filter would hide half its bands.
      return input.lithoLayers.filter(l => isAccepted(l) && (l.body_id ?? null) === scope.bodyId)
    case 'geotech-body':
      return input.geotechLayers.filter(l => isAccepted(l) && (l.body_id ?? null) === scope.bodyId)
    case 'geotech-group': {
      // The manual group pools EVERY member body's accepted bands (owner ruling
      // 2026-09-02: grouping gives more data). Members keep their own body ids,
      // so the pool is the union of their bands.
      const memberIds = new Set(scope.memberBodyIds)
      return input.geotechLayers.filter(
        l => isAccepted(l) && l.body_id != null && memberIds.has(l.body_id),
      )
    }
    case 'geotech-unit':
      return input.geotechLayers.filter(l => isAccepted(l) && l.formation_id === scope.unitId)
    case 'geotech-class': {
      const lithoById = lithoLayerIndex(input.lithoLayers)
      const classByFormation = nadClassIndex(input.geotechFormations)
      return input.geotechLayers.filter(
        l =>
          isAccepted(l) &&
          classByFormation.get(l.formation_id) === scope.nadClass &&
          lithoBodyOfGeotechBand(l, lithoById) === scope.lithoBodyId,
      )
    }
  }
}

/**
 * A stable string identity for a scope — the React key, the expand-set member
 * and the selection-equality test all share it, so two scopes are "the same
 * node" iff their keys match.
 *
 * @param scope  Any scope in the five-kind union.
 * @returns  A discriminated key string.
 */
export function scopeKey(scope: ParameterUnitScope): string {
  switch (scope.kind) {
    case 'litho-unit':
      return `litho-unit:${scope.unitId}`
    case 'litho-body':
      return `litho-body:${scope.unitId}:${scope.bodyId}`
    case 'geotech-class':
      return `geotech-class:${scope.lithoUnitId}:${scope.lithoBodyId}:${scope.nadClass}`
    case 'geotech-body':
      return `geotech-body:${scope.unitId}:${scope.bodyId}`
    case 'geotech-group':
      return `geotech-group:${scope.groupNumber}:${[...scope.memberBodyIds].sort().join(',')}`
    case 'geotech-unit':
      return `geotech-unit:${scope.unitId}`
  }
}

/** ``N bands`` + ``M with cone`` over a band set — the F7 honesty counts. */
function countBands(bands: readonly LithoLayerResponse[]): {
  bandCount: number
  coneBandCount: number
} {
  let coneBandCount = 0
  for (const b of bands) if (b.cpt_id !== null) coneBandCount += 1
  return { bandCount: bands.length, coneBandCount }
}

// ---------------------------------------------------------------------------
// Single-child collapse (spec §1, GT3 precedent)
// ---------------------------------------------------------------------------

/**
 * Collapse a lone LEAF child into its parent — "a level with exactly one child
 * renders no expander and no child row; the parent row's click scopes the
 * parent's own identity".
 *
 * The absorbed row's scope is NOT re-pointed: the surviving row keeps pooling
 * its own ground. For a fully subdivided litho body that is the same ground
 * the class row covered; where a litho band is only PARTLY subdivided, the
 * parent pools the unsubdivided stretch too. That is the honest reading of a
 * row labelled with the litho body, but it is a product decision the owner
 * has not been asked about — do not "fix" it by re-pointing the scope without
 * a ruling.
 *
 * The collapse fires only when the single child is itself a LEAF: a single
 * INTERNAL child still renders, because absorbing it would hide its own
 * children (the SF-silt-1 / SF-silt-2 the owner wants reachable). This keeps
 * "identical by construction" literally true — only leaf-identical scopes
 * collapse — and never drops a selectable geotech body.
 *
 * ⚠ NOT applied to the class level under a litho body. Owner ruling
 * 2026-09-02 (verbatim: "i see some litho bodies whose submenus i cannot open
 * ... only one packing class, still confusing though, don't collapse because
 * the pakkingsdichtheid label disappears"): folding a litho body's lone
 * packing class into the body dropped the pakkingsdichtheid (NAD-class) label
 * AND left the body a non-openable leaf. So ``buildParameterTree`` keeps that
 * class node; this helper now runs only at the geotech-body level (drops the
 * body #ordinal, never the class label) and the litho-unit level (drops a lone
 * body with no packing class at all — no label to lose).
 */
function collapseSingleLeafChild(children: ParameterTreeNode[]): ParameterTreeNode[] {
  if (children.length === 1 && children[0].children.length === 0) return []
  return children
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

/**
 * The litho body ids homed to a litho unit, in roster-ordinal order.
 *
 * The F1 homing rule: a body renders under its HOME formation (the roster's
 * ``formation_id``); a body the roster does not know falls back to the
 * layer's own ``formation_id``. Distinct body ids only, ordered by ordinal
 * so the tree reads the way the 3-D legend numbers bodies.
 */
function lithoBodyIdsForUnit(
  lithoLayers: readonly LithoLayerResponse[],
  unitId: string,
  roster: ReadonlyMap<string, BodyRosterEntry>,
): string[] {
  const bodies = new Set<string>()
  for (const l of lithoLayers) {
    if (!isAccepted(l)) continue
    const bodyId = l.body_id ?? null
    if (bodyId === null) continue
    const home = roster.get(bodyId)?.formation_id ?? null
    if (home !== null ? home !== unitId : l.formation_id !== unitId) continue
    bodies.add(bodyId)
  }
  const ordinalOf = (id: string): number => roster.get(id)?.body_ordinal ?? Number.MAX_SAFE_INTEGER
  return Array.from(bodies).sort(
    (a, b) => ordinalOf(a) - ordinalOf(b) || (a < b ? -1 : a > b ? 1 : 0),
  )
}

/**
 * Build the four-level Parameters body tree.
 *
 * Parameters
 * ----------
 * input
 *     The litho + geotech formations, layers and body rosters.
 *
 * Returns
 * -------
 * ParameterTreeNode[]
 *     One litho-unit node per litho formation, in ``display_order``.
 */
export function buildParameterTree(input: ParameterTreeInput): ParameterTreeNode[] {
  const lithoById = lithoLayerIndex(input.lithoLayers)
  const classByFormation = nadClassIndex(input.geotechFormations)

  // Accepted geotech bands grouped by their litho parent body once, so the
  // class/body build is a lookup rather than a rescan per litho body.
  const geotechByLithoBody = new Map<string, LithoLayerResponse[]>()
  const orphanCountBySourceUnit = new Map<string, number>()
  const sourceUnitByGeoFormation = new Map<string, string | null>()
  for (const f of input.geotechFormations) {
    sourceUnitByGeoFormation.set(f.id, f.source_litho_formation_id)
  }
  for (const band of input.geotechLayers) {
    if (!isAccepted(band)) continue
    const lithoBody = lithoBodyOfGeotechBand(band, lithoById)
    if (lithoBody === null) {
      // Orphan — no covering litho band. Attribute to the geotech formation's
      // source litho unit; never invent a home in the tree (spec §1).
      const sourceUnit = sourceUnitByGeoFormation.get(band.formation_id) ?? null
      if (sourceUnit !== null) {
        orphanCountBySourceUnit.set(sourceUnit, (orphanCountBySourceUnit.get(sourceUnit) ?? 0) + 1)
      }
      continue
    }
    const bucket = geotechByLithoBody.get(lithoBody)
    if (bucket === undefined) geotechByLithoBody.set(lithoBody, [band])
    else bucket.push(band)
  }

  const units = [...input.lithoFormations].sort(
    (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0),
  )

  return units.map(unit => {
    const unitName = unit.name ?? '—'
    const lithoBodyIds = lithoBodyIdsForUnit(input.lithoLayers, unit.id, input.lithoBodies)

    const lithoBodyNodes = lithoBodyIds.map<ParameterTreeNode>(lithoBodyId => {
      const classBands = geotechByLithoBody.get(lithoBodyId) ?? []

      // Class rows key on nad_class — twin geotech formation rows of the same
      // class fold into ONE row.
      const bandsByClass = new Map<number, LithoLayerResponse[]>()
      for (const band of classBands) {
        const nadClass = classByFormation.get(band.formation_id)
        if (nadClass === null || nadClass === undefined) continue
        const bucket = bandsByClass.get(nadClass)
        if (bucket === undefined) bandsByClass.set(nadClass, [band])
        else bucket.push(band)
      }

      const classNodes = Array.from(bandsByClass.keys())
        .sort((a, b) => a - b)
        .map<ParameterTreeNode>(nadClass => {
          const bands = bandsByClass.get(nadClass) ?? []

          // Geotech bodies under the class row, by ordinal.
          const bodyIds = new Set<string>()
          for (const b of bands) if ((b.body_id ?? null) !== null) bodyIds.add(b.body_id as string)
          const ordinalOf = (id: string): number =>
            input.geotechBodies.get(id)?.body_ordinal ?? Number.MAX_SAFE_INTEGER
          const geotechBodyNodes = Array.from(bodyIds)
            .sort((a, b) => ordinalOf(a) - ordinalOf(b) || (a < b ? -1 : a > b ? 1 : 0))
            .map<ParameterTreeNode>(bodyId => {
              const scope: ParameterUnitScope = {
                kind: 'geotech-body',
                unitId: bands.find(b => b.body_id === bodyId)?.formation_id ?? '',
                bodyId,
              }
              const counts = countBands(bandsForScope(scope, input))
              return {
                scope,
                label: geotechBodyLabel(bodyId, nadClass, input.geotechBodies),
                bandCount: counts.bandCount,
                coneBandCount: counts.coneBandCount,
                children: [],
                // D1: the manual-group number, so a grouped leaf shows "(group N)".
                groupNumber: input.groupByBodyId?.get(bodyId) ?? null,
                // The leaf's checkbox groups THIS body (owner finding 2026-09-04).
                groupableBodyId: bodyId,
              }
            })

          // A grouped SOLE body must NOT collapse (debt #278 D1/D2): it has to
          // stay a selectable leaf so its "(group N)" tag shows AND selecting it
          // pools the group. Otherwise the lone geotech-body ordinal folds into
          // the class row exactly as before.
          const children =
            geotechBodyNodes.length === 1 && (geotechBodyNodes[0].groupNumber ?? null) !== null
              ? geotechBodyNodes
              : collapseSingleLeafChild(geotechBodyNodes)

          // When the class row collapsed its ONE geotech body into itself, the
          // row still stands for exactly that body — carry the body id so the
          // checkbox appears on the class row and it can be grouped across litho
          // parents (owner finding 2026-09-04). A multi-body class row groups its
          // children individually, so it carries no id of its own.
          const collapsedSoleBodyId =
            children.length === 0 && bodyIds.size === 1 ? [...bodyIds][0] : undefined

          const scope: ParameterUnitScope = {
            kind: 'geotech-class',
            lithoUnitId: unit.id,
            lithoBodyId,
            nadClass,
          }
          const counts = countBands(bandsForScope(scope, input))
          return {
            scope,
            label: nadClassName(nadClass),
            bandCount: counts.bandCount,
            coneBandCount: counts.coneBandCount,
            children,
            groupableBodyId: collapsedSoleBodyId,
            // Disambiguate the collapsed row's checkbox by its litho parent
            // (ux-reviewer 2026-09-04) — the same label the sibling litho-body
            // node carries, so the two never disagree.
            groupableBodyParentLabel:
              collapsedSoleBodyId !== undefined
                ? lithoBodyLabel(lithoBodyId, unitName, input.lithoBodies)
                : undefined,
          }
        })

      const scope: ParameterUnitScope = { kind: 'litho-body', unitId: unit.id, bodyId: lithoBodyId }
      const counts = countBands(bandsForScope(scope, input))
      return {
        scope,
        // The class level does NOT collapse (owner ruling 2026-09-02): a litho
        // body with a single packing class keeps that class node, so the
        // pakkingsdichtheid label survives and the body stays openable.
        children: classNodes,
        label: lithoBodyLabel(lithoBodyId, unitName, input.lithoBodies),
        bandCount: counts.bandCount,
        coneBandCount: counts.coneBandCount,
      }
    })

    const scope: ParameterUnitScope = { kind: 'litho-unit', unitId: unit.id }
    const counts = countBands(bandsForScope(scope, input))
    return {
      scope,
      label: unitName,
      bandCount: counts.bandCount,
      coneBandCount: counts.coneBandCount,
      children: collapseSingleLeafChild(lithoBodyNodes),
      orphanCount: orphanCountBySourceUnit.get(unit.id) ?? 0,
    }
  })
}
