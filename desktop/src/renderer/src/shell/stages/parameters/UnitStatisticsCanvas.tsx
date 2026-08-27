// The scoped unit's statistics — the MAIN canvas content of the per-unit tab
// (owner ruling R3, 2026-08-27: "The statistics should be the main item,
// switch statistics and list from pane").
//
// Scope resolution is the R1 contract: a GEOTECH scope pools one packing
// unit's accepted CPT bands; a LITHO scope pools the WHOLE litho unit's
// accepted bands — every packing class inside it ("regardless of packing
// density") — and the header names exactly which of the two is pooled.
//
// The pooling population is the R6 contract: only CPTs that are members of
// the project's sections per the canonical membership rule (in corridor AND
// between the endpoints — ``memberIdsBySection`` folds the ONE existing
// helper), over the app's VISIBLE lists, so project-removed and
// manifest-gated tests are already out. The header states the population.

import { useMemo } from 'react'
import { Layers, X } from 'lucide-react'

import { memberIdsBySection } from '../../../utils/sectionClassification'
import { geotechUnitLabel } from '../../../utils/nadClasses'
import {
  buildSourceLithoNameMap,
  sourceLithoNameOf,
} from '../../../utils/sourceLithoNames'
import { EmptyState, LoadingState } from '../../EmptyState'
import { useShell } from '../../ShellContext'
import type { ParameterUnitScope } from '../../ShellContext'
import {
  bodyScopedHeaderLabel,
  pooledBodyCount,
  pooledHeaderLabel,
} from './parameterUnitBodies'
import UnitDistributionPanels from './UnitDistributionPanels'
import UnitFenceCutout from './UnitFenceCutout'
import UnitIdentificationPanels from './UnitIdentificationPanels'
import { useModelBodies } from './useModelBodies'
import { useUnitStatistics } from './useUnitStatistics'

interface Props {
  /** The unit driving the canvas — set by the inspector list or a deep link. */
  scope: ParameterUnitScope
}

/**
 * Distribution statistics + fence cutout + identification tests for one unit.
 *
 * Parameters
 * ----------
 * props : Props
 *     The typed unit scope (litho or geotech + formation id).
 *
 * Returns
 * -------
 * JSX.Element
 *     The statistics surface, or a quiet empty state when the scoped unit no
 *     longer exists.
 */
export default function UnitStatisticsCanvas({ scope }: Props): JSX.Element {
  const {
    project,
    investigations: { plotMap },
    visibleCpts,
    visibleBoreholes,
    sections: { visibleSections },
    geoModel: {
      lithoFormations,
      geotechFormations,
      lithoLayers,
      geotechLayers,
      activeLithoModel,
      activeGeotechModel,
    },
    coordinator: {
      setSelectedParameterUnit,
      bodyRecomputeLithoNonce,
      bodyRecomputeGeotechNonce,
    },
  } = useShell()

  const projectId = project.id

  // ── The pooling population (R6) ───────────────────────────────────────────
  // Canonical membership per section over the VISIBLE lists; the union is
  // "on the sections". Hidden (manifest-gated) and removed tests never reach
  // the visible lists, so they cannot reach the pool.
  const bySection = useMemo(
    () => memberIdsBySection(visibleSections, visibleCpts, visibleBoreholes),
    [visibleSections, visibleCpts, visibleBoreholes],
  )
  const memberIds = useMemo(() => {
    const union = new Set<string>()
    for (const ids of bySection.values()) for (const id of ids) union.add(id)
    return union
  }, [bySection])

  // ── Scope resolution (R1) ─────────────────────────────────────────────────
  // A litho scope reads the LITHO layer list — the whole unit's ground,
  // spanning every NAD subdivision. A geotech scope reads the geotech list.
  const layers = scope.kind === 'litho' ? lithoLayers : geotechLayers

  const sourceLithoNameById = useMemo(
    () => buildSourceLithoNameMap(lithoFormations),
    [lithoFormations],
  )

  const unit = useMemo(
    () =>
      scope.kind === 'litho'
        ? (lithoFormations.find(f => f.id === scope.unitId) ?? null)
        : ((geotechFormations ?? []).find(f => f.id === scope.unitId) ?? null),
    [scope, lithoFormations, geotechFormations],
  )

  // ── The body scope (owner ruling 2026-08-27) ──────────────────────────────
  // "a body is only a body if it is geometrically connected or if the users
  // says, this body is the same as that body." The unit row lumps resolver
  // bodies; a set ``bodyId`` narrows every pool below to that ONE body, and
  // the header must say which view it shows either way.
  const scopedBodyId = scope.bodyId ?? null
  const bodiesById = useModelBodies(
    projectId,
    scope.kind === 'geotech' ? (activeGeotechModel?.id ?? null) : (activeLithoModel?.id ?? null),
    // F9: the labels (and F1's home formations) go stale after a body
    // recompute rewrites the stamps — the axis's nonce re-fetches them.
    scope.kind === 'geotech' ? bodyRecomputeGeotechNonce : bodyRecomputeLithoNonce,
  )

  const unitLabel = useMemo(() => {
    if (unit === null) return 'Unit'
    const unitName =
      scope.kind === 'litho'
        ? (unit.name ?? 'Litho unit')
        : geotechUnitLabel(unit, sourceLithoNameOf(unit, sourceLithoNameById))
    if (scopedBodyId !== null) {
      // Body-scoped: name the one body, the way the 3-D legend names bodies.
      return bodyScopedHeaderLabel(unitName, scopedBodyId, bodiesById)
    }
    const base =
      scope.kind === 'litho'
        ? // R1's naming requirement, near-verbatim: the header must SAY the
          // pool spans the whole unit, every packing class.
          `${unitName} — whole litho unit, all packing classes`
        : unitName
    // The honest label is the ruling's point: the lumped view says it lumps —
    // counting only bodies CONTRIBUTING to the pool (F7): accepted CPT bands
    // on member holes, the same filters the pool itself applies.
    return pooledHeaderLabel(base, pooledBodyCount(layers, scope.unitId, memberIds))
  }, [unit, scope.kind, scope.unitId, sourceLithoNameById, scopedBodyId, bodiesById, layers, memberIds])

  // The scope's TOTAL accepted band count — the pane row's number (both
  // anchors, no member filter): body scope = the body's bands wherever their
  // formation row (F2's authority); pooled = the formation's bands. Feeds the
  // header's "X of Y bands" honesty line (F7).
  const totalBandCount = useMemo(() => {
    let count = 0
    for (const layer of layers) {
      if (layer.status !== 'accepted') continue
      if (
        scopedBodyId !== null
          ? (layer.body_id ?? null) === scopedBodyId
          : layer.formation_id === scope.unitId
      )
        count += 1
    }
    return count
  }, [layers, scopedBodyId, scope.unitId])

  const {
    statistics,
    loading,
    error,
    pendingCptCount,
    pooledCptIds,
    retry,
  } = useUnitStatistics(
    unit === null ? null : scope.unitId,
    layers,
    plotMap,
    projectId,
    memberIds,
    scopedBodyId,
  )

  // ── The population header line (R6) ───────────────────────────────────────
  const populationNote = useMemo(() => {
    const qcN = statistics.channels.find(c => c.channel === 'qc')?.summary.n ?? 0
    const cptCount = pooledCptIds.length
    let sectionCount = 0
    for (const ids of bySection.values()) {
      if (pooledCptIds.some(id => ids.has(id))) sectionCount += 1
    }
    return (
      `n = ${qcN.toLocaleString('en-US')} qc samples over ${cptCount} ` +
      `CPT${cptCount === 1 ? '' : 's'} on ${sectionCount} ` +
      `section${sectionCount === 1 ? '' : 's'} — only tests on sections pool; ` +
      `hidden and removed are excluded`
    )
  }, [statistics.channels, pooledCptIds, bySection])

  if (unit === null) {
    return (
      <EmptyState
        icon={<Layers />}
        title="This unit no longer exists"
        hint="It was removed or rebuilt since it was selected — pick another unit in the list."
      />
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="parameters-unit-canvas">
      {/* Header — which model the unit lives in, and the way out. */}
      <div className="flex items-start gap-2 px-3 py-2 border-b border-border-subtle shrink-0">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wide text-text-muted">
            {scope.kind === 'litho' ? 'Lithostratigraphic unit' : 'Geotechnical unit'}
          </div>
        </div>
        <button
          onClick={() => setSelectedParameterUnit(null)}
          title="Close the unit statistics"
          aria-label="Close the unit statistics"
          className="shrink-0 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-app"
          data-testid="parameters-unit-close"
        >
          <X size={12} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <div className="max-w-3xl">
          {error !== null ? (
            <div
              className="flex flex-col items-start gap-2 px-3 py-3 text-[11px] text-status-danger"
              data-testid="parameters-unit-error"
            >
              <span>{error}</span>
              <button
                onClick={retry}
                className="px-2 py-0.5 rounded border border-border-default text-text-primary hover:bg-surface-app"
                data-testid="parameters-unit-retry"
              >
                Retry
              </button>
            </div>
          ) : loading ? (
            <div className="py-6" data-testid="parameters-unit-loading">
              <LoadingState label="Loading measurements…" />
            </div>
          ) : (
            <UnitDistributionPanels
              statistics={statistics}
              unitLabel={unitLabel}
              pendingCptCount={pendingCptCount}
              populationNote={populationNote}
              totalBandCount={totalBandCount}
              bodyScoped={scopedBodyId !== null}
            />
          )}

          {/* Identification tests (R8) — pooled from the unit's borehole
              samples; renders nothing louder than a quiet line when there are
              none. */}
          <UnitIdentificationPanels
            scope={scope}
            layers={layers}
            memberInvestigationIds={memberIds}
          />

          {/* Fence cutout (R4) — the selected unit's walls over the basemap,
              a passive visual anchor. Mounted only while a unit is scoped, so
              the Cesium chunk and the fence fetches stay lazy. */}
          <UnitFenceCutout scope={scope} />
        </div>
      </div>
    </div>
  )
}
