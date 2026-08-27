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
import { bodyLabelOf } from './parameterUnitBodies'
import { geotechBodyLabel, lithoBodyLabel } from './parameterScopeLabels'

const PATH_SEP = ' › '

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
 * bodies" count (F7). Counts only CPT-anchored bands' bodies, so a
 * borehole-only body (no cone to summarise) is never counted, matching the
 * retired ``pooledBodyCount``.
 */
function distinctBodyCount(bands: readonly LithoLayerResponse[]): number {
  const bodies = new Set<string>()
  for (const b of bands) {
    if (b.cpt_id === null) continue
    if ((b.body_id ?? null) !== null) bodies.add(b.body_id as string)
  }
  return bodies.size
}

/** The ``— pooled across N bodies`` suffix, or ``''`` for one-or-none. */
function pooledSuffix(bands: readonly LithoLayerResponse[]): string {
  const n = distinctBodyCount(bands)
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
 *
 * Returns
 * -------
 * str
 *     A one-line path label; the caller adds the "X of Y bands" and population
 *     lines around it.
 */
export function scopeHeaderLabel(scope: ParameterUnitScope, input: ParameterTreeInput): string {
  switch (scope.kind) {
    case 'litho-unit': {
      // R1's naming requirement, near-verbatim: the header must SAY the pool
      // spans the whole unit, every packing class.
      const base = `${lithoUnitName(scope.unitId, input)} — whole litho unit, all packing classes`
      return base + pooledSuffix(bandsForScope(scope, input))
    }
    case 'litho-body': {
      const unit = lithoUnitName(scope.unitId, input)
      return unit + PATH_SEP + lithoBodyLabel(scope.bodyId, unit, input.lithoBodies)
    }
    case 'geotech-class': {
      const unit = lithoUnitName(scope.lithoUnitId, input)
      const bodyLabel = lithoBodyLabel(scope.lithoBodyId, unit, input.lithoBodies)
      const path = unit + PATH_SEP + bodyLabel + PATH_SEP + nadClassName(scope.nadClass)
      return path + pooledSuffix(bandsForScope(scope, input))
    }
    case 'geotech-body': {
      const path = geotechBodyPath(scope.bodyId, input)
      const bodyLabel =
        path?.nadClass != null
          ? geotechBodyLabel(scope.bodyId, path.nadClass, input.geotechBodies)
          : bodyLabelOf(scope.bodyId, input.geotechBodies)
      if (path === null || path.lithoUnitId === null || path.lithoBodyId === null) return bodyLabel
      const unit = lithoUnitName(path.lithoUnitId, input)
      const lithoBody = lithoBodyLabel(path.lithoBodyId, unit, input.lithoBodies)
      const cls = path.nadClass != null ? nadClassName(path.nadClass) : ''
      return [unit, lithoBody, cls, bodyLabel].filter(s => s !== '').join(PATH_SEP)
    }
    case 'geotech-unit': {
      // The jump-only fallback — no litho path. Name the formation row and say
      // it pools, exactly as before this tree existed.
      const formation = input.geotechFormations.find(f => f.id === scope.unitId)
      const base = formation !== undefined ? geotechUnitLabel(formation) : scope.unitId
      return base + pooledSuffix(bandsForScope(scope, input))
    }
  }
}
