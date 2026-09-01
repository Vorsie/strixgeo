// The header label a scoped Parameters view shows — the path from the litho
// unit down to the scoped node (spec §3), plus the honest "pooled across N
// bodies" suffix on the aggregate views.
//
// Split out of ``parameterBodyTree.ts`` to keep that module under the 500-line
// god-component cap (debt #201): the tree owns the STRUCTURE + the band
// authority, this file owns the ONE-LINE PATH a node reads. It depends one way
// on the tree module (``bandsForScope`` + the shared index helpers) — the tree
// never imports back, so there is no cycle.

import type { LithoLayerResponse } from '../../../api/client'
import { geotechUnitLabel, nadClassName } from '../../../utils/nadClasses'
import type { ParameterUnitScope } from '../../ShellContext'
import {
  bandsForScope,
  isAccepted,
  lithoBodyOfGeotechBand,
  lithoLayerIndex,
  nadClassIndex,
  type ParameterTreeInput,
} from './parameterBodyTree'
import { bodyLabelOf, type BodyRosterEntry } from './parameterUnitBodies'
import { geotechBodyLabel, lithoBodyLabel } from './parameterScopeLabels'
import { crossedFormationLabel } from '../../../utils/crossedFormationLabel'

const PATH_SEP = ' › '
/** The middot the header uses before a body's geological context, matching the
 * ``BodyContextMenu`` header ("… · Holoceen + Pleistoceen"). */
const GEO_SEP = ' · '

/**
 * The ``· <crossed formations>`` suffix a body path ends with (R2, debt #278) —
 * every geological formation the body crosses, or ``''`` when the roster does
 * not carry any (an old cached response, or a body the roster does not know).
 */
function geoContextSuffix(entry: BodyRosterEntry | undefined): string {
  const label = crossedFormationLabel(entry)
  return label === '' ? '' : GEO_SEP + label
}

/**
 * The crossed-formation suffix for a geotech body — its OWN list if it carries
 * one, else its LITHO PARENT body's (owner dogfeed 2026-09-01).
 *
 * The backend now derives a geotech body's own crossed-formation list correctly
 * (``GetBodyGeoLabels`` walks the parent chain geological <- litho <- geotech,
 * so a geotech model reaches its geological GRANDPARENT's contacts, not the
 * litho model's empty set — the earlier bug that always left the list empty).
 * So the OWN list is normally populated and wins here. The litho-parent fallback
 * is the DEGRADED path: it covers a geotech body whose own list is genuinely
 * empty (e.g. no geological model defined at its investigations) while the litho
 * parent — a wider mass — still resolves one. The geotech body sits inside its
 * litho parent, so inheriting the parent's list makes the SAME body read the
 * SAME context on both arrival paths.
 *
 * Parameters
 * ----------
 * bodyId
 *     The geotech body id.
 * lithoBodyId
 *     Its litho parent body id, or ``null`` when the path could not resolve one.
 * input
 *     The tree input (both body rosters).
 *
 * Returns
 * -------
 * str
 *     The ``· <formations>`` suffix, or ``''`` when neither carries a list.
 */
function geotechGeoContextSuffix(
  bodyId: string,
  lithoBodyId: string | null,
  input: ParameterTreeInput,
): string {
  const own = geoContextSuffix(input.geotechBodies.get(bodyId))
  if (own !== '') return own
  if (lithoBodyId === null) return ''
  return geoContextSuffix(input.lithoBodies.get(lithoBodyId))
}

/** The litho unit a litho body homes to (roster home, else a layer's formation). */
function homeUnitOfLithoBody(bodyId: string, input: ParameterTreeInput): string | null {
  const home = input.lithoBodies.get(bodyId)?.formation_id ?? null
  if (home !== null) return home
  return input.lithoLayers.find(l => (l.body_id ?? null) === bodyId)?.formation_id ?? null
}

/** A litho unit's display name, or ``'—'`` when unknown. */
function lithoUnitName(unitId: string | null, input: ParameterTreeInput): string {
  if (unitId === null) return '—'
  return input.lithoFormations.find(f => f.id === unitId)?.name ?? '—'
}

/**
 * Distinct resolver bodies CONTRIBUTING to the cone pool — the honest "N
 * bodies" count (F7).
 *
 * Two exclusions, both of which the retired ``pooledBodyCount`` carried:
 *
 * * a borehole-anchored band has no cone to summarise;
 * * a band whose cone is not in the pooling POPULATION contributes no samples
 *   — hidden in the project view, removed, or on no section at all. Without
 *   this the header overstates its evidence (the live case that produced the
 *   rule read "16 bodies" where only 9 contributed). ``useUnitStatistics``
 *   filters the NUMBERS by the same set, so the count has to read it too or
 *   the two disagree on screen.
 *
 * ``null``/omitted members means no population filter (nothing has scoped the
 * pool yet); an EMPTY set means nothing is a member and the count is honestly
 * zero.
 */
function distinctBodyCount(
  bands: readonly LithoLayerResponse[],
  memberInvestigationIds: ReadonlySet<string> | null | undefined,
): number {
  const bodies = new Set<string>()
  for (const b of bands) {
    if (b.cpt_id === null) continue
    if (memberInvestigationIds != null && !memberInvestigationIds.has(b.cpt_id)) continue
    if ((b.body_id ?? null) !== null) bodies.add(b.body_id as string)
  }
  return bodies.size
}

/** The ``— pooled across N bodies`` suffix, or ``''`` for one-or-none. */
function pooledSuffix(
  bands: readonly LithoLayerResponse[],
  memberInvestigationIds: ReadonlySet<string> | null | undefined,
): string {
  const n = distinctBodyCount(bands, memberInvestigationIds)
  if (n <= 1) return ''
  return ` — pooled across ${n} bodies`
}

/**
 * Resolve a geotech body's litho path — its litho unit, litho body and NAD
 * class — from one of its bands, so a leaf header reads the full path
 * "SILT › #3 › SF #1".
 *
 * Returns ``null`` when the body has no accepted band (it should not appear in
 * the tree at all), so the caller falls back to the bare body label.
 */
function geotechBodyPath(
  bodyId: string,
  input: ParameterTreeInput,
): { lithoUnitId: string | null; lithoBodyId: string | null; nadClass: number | null } | null {
  const lithoById = lithoLayerIndex(input.lithoLayers)
  const classByFormation = nadClassIndex(input.geotechFormations)
  const band = input.geotechLayers.find(l => isAccepted(l) && (l.body_id ?? null) === bodyId)
  if (band === undefined) return null
  const lithoBodyId = lithoBodyOfGeotechBand(band, lithoById)
  return {
    lithoBodyId,
    lithoUnitId: lithoBodyId === null ? null : homeUnitOfLithoBody(lithoBodyId, input),
    nadClass: classByFormation.get(band.formation_id) ?? null,
  }
}

/**
 * The header label a scoped Parameters view shows.
 *
 * Parameters
 * ----------
 * scope
 *     Any scope in the five-kind union.
 * input
 *     The tree input.
 * memberInvestigationIds
 *     The pooling population — the same set ``useUnitStatistics`` filters the
 *     numbers by, so the "pooled across N bodies" claim matches the evidence
 *     on screen. ``null``/omitted skips the filter.
 *
 * Returns
 * -------
 * str
 *     A one-line path label; the caller adds the "X of Y bands" and population
 *     lines around it.
 */
export function scopeHeaderLabel(
  scope: ParameterUnitScope,
  input: ParameterTreeInput,
  memberInvestigationIds?: ReadonlySet<string> | null,
): string {
  switch (scope.kind) {
    case 'litho-unit': {
      // R1's naming requirement, near-verbatim: the header must SAY the pool
      // spans the whole unit, every packing class.
      const base = `${lithoUnitName(scope.unitId, input)} — whole litho unit, all packing classes`
      return base + pooledSuffix(bandsForScope(scope, input), memberInvestigationIds)
    }
    case 'litho-body': {
      const unit = lithoUnitName(scope.unitId, input)
      const base = unit + PATH_SEP + lithoBodyLabel(scope.bodyId, unit, input.lithoBodies)
      return base + geoContextSuffix(input.lithoBodies.get(scope.bodyId))
    }
    case 'geotech-class': {
      const unit = lithoUnitName(scope.lithoUnitId, input)
      const bodyLabel = lithoBodyLabel(scope.lithoBodyId, unit, input.lithoBodies)
      const path = unit + PATH_SEP + bodyLabel + PATH_SEP + nadClassName(scope.nadClass)
      // The crossed formations are the litho body's — the jump lands here when
      // the body could not be resolved (dogfeed 2026-09-01), so it must still
      // show the geological context the resolved body would.
      return (
        path +
        geoContextSuffix(input.lithoBodies.get(scope.lithoBodyId)) +
        pooledSuffix(bandsForScope(scope, input), memberInvestigationIds)
      )
    }
    case 'geotech-body': {
      const path = geotechBodyPath(scope.bodyId, input)
      const bodyLabel =
        path?.nadClass != null
          ? geotechBodyLabel(scope.bodyId, path.nadClass, input.geotechBodies)
          : bodyLabelOf(scope.bodyId, input.geotechBodies)
      // The geological context: the geotech body's OWN crossed-formation list
      // (now resolved by the backend), else its litho parent's as a degraded
      // fallback — see ``geotechGeoContextSuffix``. Appends regardless of
      // whether the full litho path resolves.
      const geoSuffix = geotechGeoContextSuffix(scope.bodyId, path?.lithoBodyId ?? null, input)
      if (path === null || path.lithoUnitId === null || path.lithoBodyId === null)
        return bodyLabel + geoSuffix
      const unit = lithoUnitName(path.lithoUnitId, input)
      const lithoBody = lithoBodyLabel(path.lithoBodyId, unit, input.lithoBodies)
      const cls = path.nadClass != null ? nadClassName(path.nadClass) : ''
      return [unit, lithoBody, cls, bodyLabel].filter(s => s !== '').join(PATH_SEP) + geoSuffix
    }
    case 'geotech-unit': {
      // The jump-only fallback — no litho path. Name the formation row and say
      // it pools, exactly as before this tree existed.
      const formation = input.geotechFormations.find(f => f.id === scope.unitId)
      const base = formation !== undefined ? geotechUnitLabel(formation) : scope.unitId
      return base + pooledSuffix(bandsForScope(scope, input), memberInvestigationIds)
    }
  }
}
