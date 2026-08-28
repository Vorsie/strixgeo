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

import { useCallback, useMemo } from 'react'
import { Layers, X } from 'lucide-react'

import type { GeologicalFormationResponse } from '../../../api/client'
import { memberIdsBySection } from '../../../utils/sectionClassification'
import { EmptyState, LoadingState } from '../../EmptyState'
import { useShell } from '../../ShellContext'
import { parameterScopeModel, type ParameterUnitScope } from '../../ShellContext'
import { bandsForScope, type ParameterTreeInput } from './parameterBodyTree'
import {
  pickSectionForInvestigation,
  sampleNotOnAnySectionMessage,
} from './sampleSectionReveal'
import { scopeHeaderLabel } from './parameterScopeHeader'
import UnitDistributionPanels from './UnitDistributionPanels'
import UnitFenceCutout from './UnitFenceCutout'
import UnitIdentificationPanels from './UnitIdentificationPanels'
import type { UnitPsdCurve } from './unitPsd'
import { useModelBodies } from './useModelBodies'
import { useUnitStatistics } from './useUnitStatistics'

interface Props {
  /** The unit driving the canvas — set by the inspector list or a deep link. */
  scope: ParameterUnitScope
}

/** Whether the scope's home formation still exists (deleted / rebuilt = gone). */
function scopeUnitExists(
  scope: ParameterUnitScope,
  lithoFormations: readonly GeologicalFormationResponse[],
  geotechFormations: readonly GeologicalFormationResponse[],
): boolean {
  switch (scope.kind) {
    case 'litho-unit':
    case 'litho-body':
      return lithoFormations.some(f => f.id === scope.unitId)
    case 'geotech-body':
    case 'geotech-unit':
      return geotechFormations.some(f => f.id === scope.unitId)
    case 'geotech-class':
      return lithoFormations.some(f => f.id === scope.lithoUnitId)
  }
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
      setSectionsDeepLinkTarget,
      bodyRecomputeLithoNonce,
      bodyRecomputeGeotechNonce,
    },
    toasts: { toast },
  } = useShell()

  const projectId = project.id
  const model = parameterScopeModel(scope)

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

  // ── Right-click a PSD curve → the sample on a cross-section (owner
  // 2026-08-28) ─────────────────────────────────────────────────────────────
  // WHICH section: the canonical membership map (``bySection``), the FIRST that
  // carries the borehole (its list order) — never a second membership rule.
  // ON NO section: the honest toast, mirroring the pending-tie chip. The
  // navigation reuses the Build pre-flight's deep-link — switch to Sections,
  // select the section, centre + pulse the borehole column (AppShell drives it
  // from ``setSectionsDeepLinkTarget``).
  const revealSampleOnSection = useCallback(
    (curve: UnitPsdCurve) => {
      const sectionId = pickSectionForInvestigation(bySection, curve.boreholeId)
      if (sectionId === null) {
        toast('warning', sampleNotOnAnySectionMessage(curve))
        return
      }
      setSectionsDeepLinkTarget({
        sectionId,
        // Empty on purpose: this is a COLUMN reveal, and ``handleFocusContacts``
        // no-ops on an empty list, so the two halves never fight over the
        // camera (the same shape the Build pre-flight's one-click visit uses).
        contactIds: [],
        // ONE id, so the panel centres AND pulses that column — this reveal is
        // about the sample's borehole. (A two-id payload names a GAP instead;
        // see ``ShellContext``'s own doc on the field.)
        revealInvestigationIds: [curve.boreholeId],
      })
    },
    [bySection, toast, setSectionsDeepLinkTarget],
  )

  // ── The body rosters (F9) ─────────────────────────────────────────────────
  // Both axes' rosters feed the path header labels (a geotech-body row names
  // its litho unit + litho body too). Each rides its axis's recompute nonce so
  // the labels — and the homes — follow a body recompute. A no-model axis
  // fetches nothing (``useModelBodies`` no-ops on a null model id).
  const lithoBodies = useModelBodies(projectId, activeLithoModel?.id ?? null, bodyRecomputeLithoNonce)
  const geotechBodies = useModelBodies(
    projectId,
    activeGeotechModel?.id ?? null,
    bodyRecomputeGeotechNonce,
  )

  // ── The one band-selection authority ──────────────────────────────────────
  // ``bandsForScope`` maps the scope to its accepted bands; every pool below
  // (statistics, OKP/PSD, the cutout, the counts) reads THIS, never a per-kind
  // branch (spec §3 / §6).
  const treeInput = useMemo<ParameterTreeInput>(
    () => ({
      lithoFormations,
      geotechFormations: geotechFormations ?? [],
      lithoLayers,
      geotechLayers,
      lithoBodies,
      geotechBodies,
    }),
    [lithoFormations, geotechFormations, lithoLayers, geotechLayers, lithoBodies, geotechBodies],
  )

  const unitExists = useMemo(
    () => scopeUnitExists(scope, lithoFormations, geotechFormations ?? []),
    [scope, lithoFormations, geotechFormations],
  )

  const scopeBands = useMemo(
    () => (unitExists ? bandsForScope(scope, treeInput) : []),
    [scope, treeInput, unitExists],
  )

  // The header names the path (spec §3); the label authority lives in the tree
  // module so it never drifts from what a node pools. ``memberIds`` rides along
  // so the "pooled across N bodies" claim counts the SAME population the
  // numbers below are computed from (F7) — without it the header counts bodies
  // whose cones are hidden, removed, or on no section.
  const unitLabel = useMemo(
    () => scopeHeaderLabel(scope, treeInput, memberIds),
    [scope, treeInput, memberIds],
  )

  // A LEAF body scope blames the body, not the unit, on an empty pool (F7); a
  // class row is an aggregate view, so it does not.
  const bodyScoped = scope.kind === 'litho-body' || scope.kind === 'geotech-body'

  // The scope's TOTAL accepted band count (both anchors) — feeds the "X of Y
  // bands" honesty line when the member/anchor-filtered pool is smaller (F7).
  const totalBandCount = scopeBands.length

  const {
    statistics,
    loading,
    error,
    pendingCptCount,
    pooledCptIds,
    retry,
  } = useUnitStatistics(scopeBands, plotMap, projectId, memberIds)

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

  if (!unitExists) {
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
            {model === 'litho' ? 'Lithostratigraphic unit' : 'Geotechnical unit'}
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
              bodyScoped={bodyScoped}
            />
          )}

          {/* Identification tests (R8) — pooled from the SAME scope bands the
              statistics read (the one authority), so litho / geotech / class /
              body all pool consistently. Renders nothing louder than a quiet
              line when there are none. */}
          <UnitIdentificationPanels
            scopeBands={scopeBands}
            memberInvestigationIds={memberIds}
            onRevealSample={revealSampleOnSection}
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
