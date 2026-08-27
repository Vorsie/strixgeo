// Parameters stage inspector — the per-CPT plot surface.
//
// Owner ruling (dogfeed 2026-08-03): the empty right-hand inspector pane
// BECOMES the per-CPT plot surface. Clicking a row in the per-test table
// selects the CPT; this pane then shows a header, the water-table line, and the
// tall depth-synced panels (qc | fs+Rf | Ic | both SBT strips).
//
// Two things it owns that nothing else does:
//   * the SBT profile fetch — on demand at selection, never eagerly for every
//     CPT in the project (a 250-CPT project would fetch 250 profiles nobody
//     asked for). It goes out under the engineer's Settings → Litho segmenter
//     unit weights, so this strip and the segmenter's ghost boundaries share
//     one effective-stress profile;
//   * the water-table edit — click the value, type, Enter. The whole Robertson
//     normalisation hangs off that number, so the line always says WHERE it
//     came from (Data Integrity Rule 1), the edit is a PATCH (not a local
//     override), and it marks the project dirty like any other engineering
//     decision.
//
// The raw plot is normally warmed by ``coordinator.handleSelectWithoutView``
// (which the table's row click calls), but this pane does NOT depend on that
// succeeding: if the plot is still missing once the profile has landed, it
// fetches the plot itself. ``loadChart`` swallows its own failure, so trusting
// it left the pane on "Loading depth series…" forever after one bad response.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Beaker, Droplet, X } from 'lucide-react'

import { api } from '../../../api/client'
import type { CptPlotResponse, CptSbtProfileResponse, GwtProvenance } from '../../../api/client'
import { formatNumericForDisplay, tryParseNumeric } from '../../../components/ui/NumericInput'
import { readLithoSegmenterPrefs } from '../../../utils/lithoSegmenterPrefs'
import { log } from '../../../utils/log'
import { geotechUnitLabel } from '../../../utils/nadClasses'
import {
  buildSourceLithoNameMap,
  sourceLithoNameOf,
} from '../../../utils/sourceLithoNames'
import { EmptyState, LoadingState } from '../../EmptyState'
import { useShell } from '../../ShellContext'
import CptSbtDepthPanels from './CptSbtDepthPanels'
import UnitDistributionPanels from './UnitDistributionPanels'
import { useUnitStatistics } from './useUnitStatistics'

/** How the water-table line reads for each provenance. */
const GWT_PROVENANCE_LABEL: Record<GwtProvenance, string> = {
  recorded: 'recorded',
  engineer: 'set by engineer',
  assumed: 'assumed',
}

/**
 * Right inspector content for the Parameters stage.
 *
 * Takes no props — all state is sourced from ``useShell()`` (the
 * ``StageDescriptor.InspectorComponent`` contract).
 *
 * Returns
 * -------
 * JSX.Element
 *     The inspector pane element: an empty state until a CPT is selected,
 *     then the header + water-table line + depth panels.
 */
export default function ParametersInspector(): JSX.Element {
  const {
    project,
    investigations: { cpts, plotMap },
    geoModel: { geotechLayers, geotechFormations, lithoFormations },
    coordinator: {
      selectedId,
      markMutated,
      selectedParameterUnitId,
      setSelectedParameterUnitId,
    },
    toasts: { toast },
  } = useShell()

  const [profile, setProfile] = useState<CptSbtProfileResponse | null>(null)
  // Plot fetched by THIS pane, used only when the shared cache does not have
  // one (see the header note on ``loadChart`` swallowing its failure).
  const [ownPlot, setOwnPlot] = useState<CptPlotResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bumped after a successful water-table PATCH — and by the Retry button —
  // to re-run the fetch effect. The profile is derived on read, so a new water
  // table means a new profile.
  const [refetchNonce, setRefetchNonce] = useState(0)

  // Inline water-table editor. ``null`` = not editing; a string = the draft.
  const [gwtDraft, setGwtDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const projectId = project.id

  // The SAME unit weights the litho segmenter is driven with — Settings →
  // Litho segmenter, whose own hint says it "feeds the Robertson Ic". Sending
  // anything else would normalise this strip against a different
  // effective-stress profile than the ghost boundaries the engineer accepts.
  // ``gwater`` has no pref: the segmenter leaves it at the backend default, so
  // omitting it here is what keeps the two identical.
  const gunsatKNm3 = useMemo(
    () => readLithoSegmenterPrefs(project.view_state ?? null).gunsatKNm3,
    [project.view_state],
  )

  // Keep the shared plot cache reachable from the effect WITHOUT listing it as
  // a dependency: it re-identifies on every import and every other CPT's
  // fetch, and re-running the profile request for those would be pure churn.
  const plotMapRef = useRef(plotMap)
  plotMapRef.current = plotMap

  // Fetch the SBT profile — and, if nothing else has, the plot — for the
  // selected CPT. Guarded against races: a fast click through three rows must
  // leave the THIRD profile on screen, not whichever response landed last.
  useEffect(() => {
    if (selectedId === null) {
      setProfile(null)
      setOwnPlot(null)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setOwnPlot(null)
    void (async () => {
      try {
        const next = await api.cpt.sbtProfile(selectedId, projectId, { gunsatKNm3 })
        if (cancelled) return
        setProfile(next)
        // The profile round-trip has landed, so the concurrent ``loadChart``
        // has almost certainly landed too — re-check before spending a second
        // request. When it has NOT (it failed, and swallowed the failure),
        // this pane fetches the plot itself rather than showing "loading"
        // until the engineer selects something else and comes back.
        if (!plotMapRef.current.has(selectedId)) {
          const plot = await api.cpt.plot(selectedId, projectId)
          if (cancelled) return
          setOwnPlot(plot)
        }
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        log.error('cpt', `parameters inspector fetch(${selectedId}) failed`, err)
        setError(
          err instanceof Error && err.message
            ? `Could not load this CPT — ${err.message}`
            : 'Could not load this CPT.',
        )
        setProfile(null)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId, projectId, refetchNonce, gunsatKNm3])

  // Leaving one CPT for another must not carry the previous row's half-typed
  // water table onto it.
  useEffect(() => {
    setGwtDraft(null)
  }, [selectedId])

  const commitWaterTable = useCallback(
    async (raw: string): Promise<void> => {
      if (selectedId === null) return
      const trimmed = raw.trim()
      // An empty field is the CLEAR gesture — undo the engineer's value.
      // NEGATIVES are accepted: the depth is measured down from the collar,
      // so water standing ABOVE it reads negative — the offshore case, where
      // the collar is the seabed (owner ruling 2026-08-23). The server bounds
      // it at +/-500 m; anything past that is a typo, and its 422 message is
      // what the catch below surfaces.
      const parsed = trimmed === '' ? null : tryParseNumeric(trimmed, { allowNegative: true })
      if (trimmed !== '' && parsed === null) {
        toast('error', 'Water table must be a number in metres — negative if the water is above the surface.')
        return
      }
      setSaving(true)
      try {
        await api.cpt.patchWaterTable(selectedId, projectId, { water_depth_m: parsed })
        setGwtDraft(null)
        // An engineering decision that only lives in the DB is a decision the
        // next .gmproj open silently drops: opening a project replace-restores
        // the DB from the file, so without this the title bar shows nothing
        // unsaved, File → Save is never prompted, and the value is gone.
        markMutated()
        // Re-derive: the Ic curve, both strips and the label all move with it.
        setRefetchNonce(n => n + 1)
        log.info('cpt', `water table set: ${selectedId} → ${parsed ?? 'cleared'}`)
      } catch (err) {
        log.error('cpt', `patchWaterTable(${selectedId}) failed`, err)
        // Surface the SERVER's reason. The range guard 422s on an absurd
        // depth (past +/-500 m), and "Could not save" alone leaves the
        // engineer with no idea that 5000 m was the problem.
        toast(
          'error',
          err instanceof Error && err.message
            ? `Could not save the water table — ${err.message}`
            : 'Could not save the water table.',
        )
      } finally {
        setSaving(false)
      }
    },
    [selectedId, projectId, toast, markMutated],
  )

  // ── Per-unit statistics ───────────────────────────────────────────────────
  // The other subject this pane can have (owner ballot 2026-08-26): a geotech
  // unit rather than a single test. Reached from the per-unit table's row
  // click, or from a geotech band's "Unit statistics…" menu in a section.

  const {
    statistics: unitStatistics,
    loading: unitLoading,
    error: unitError,
    pendingCptCount,
    retry: retryUnit,
  } = useUnitStatistics(selectedParameterUnitId, geotechLayers, plotMap, projectId)

  const selectedUnit = useMemo(
    () =>
      selectedParameterUnitId === null
        ? null
        : (geotechFormations.find(f => f.id === selectedParameterUnitId) ?? null),
    [geotechFormations, selectedParameterUnitId],
  )

  // The unit's source litho name — reached through ``source_litho_formation_id``,
  // NOT ``parent_formation_name`` (always null on a geotech row; see
  // ``sourceLithoNames.ts``). It is what tells two same-soil units apart.
  const selectedUnitSourceName = useMemo(
    () =>
      selectedUnit === null
        ? null
        : sourceLithoNameOf(selectedUnit, buildSourceLithoNameMap(lithoFormations)),
    [selectedUnit, lithoFormations],
  )

  // ── Render ────────────────────────────────────────────────────────────────
  // Every hook above runs unconditionally; the early returns start here.

  // A chosen UNIT wins over a chosen test: it is the more recent, more
  // explicit gesture, and the per-test tab clears it when the engineer goes
  // back to looking at one hole.
  if (selectedParameterUnitId !== null) {
    return (
      <div className="flex flex-col h-full min-h-0" data-testid="parameters-inspector-unit">
        {/* Header carries the way OUT of the unit view — without it the only
            escape from a deep-linked unit is to click a test row. */}
        <div className="flex items-start gap-2 px-3 py-2 border-b border-border-subtle shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-text-muted">
              Geotechnical unit
            </div>
          </div>
          <button
            onClick={() => setSelectedParameterUnitId(null)}
            title="Close the unit statistics"
            aria-label="Close the unit statistics"
            className="shrink-0 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-app"
            data-testid="parameters-unit-close"
          >
            <X size={12} />
          </button>
        </div>
        {unitError !== null ? (
          <div
            className="flex flex-col items-start gap-2 px-3 py-3 text-[11px] text-status-danger"
            data-testid="parameters-unit-error"
          >
            <span>{unitError}</span>
            <button
              onClick={retryUnit}
              className="px-2 py-0.5 rounded border border-border-default text-text-primary hover:bg-surface-app"
              data-testid="parameters-unit-retry"
            >
              Retry
            </button>
          </div>
        ) : unitLoading ? (
          <div className="flex-1 min-h-0" data-testid="parameters-unit-loading">
            <LoadingState label="Loading measurements…" />
          </div>
        ) : (
          <UnitDistributionPanels
            statistics={unitStatistics}
            unitLabel={
              selectedUnit === null
                ? 'Unit'
                : geotechUnitLabel(selectedUnit, selectedUnitSourceName)
            }
            pendingCptCount={pendingCptCount}
          />
        )}
      </div>
    )
  }

  if (selectedId === null) {
    return (
      <EmptyState
        icon={<Beaker />}
        title="No test selected"
        hint="Click a CPT row in the per-test table to plot its depth series and soil-behaviour-type profile here."
      />
    )
  }

  const cpt = cpts.find(c => c.id === selectedId) ?? null
  // The shared cache first (warmed by the row click), this pane's own fetch as
  // the fallback when that never arrived.
  const plot = plotMap.get(selectedId) ?? ownPlot

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="parameters-inspector">
      {/* Header — name + depth. */}
      <div className="px-3 py-2 border-b border-border-subtle shrink-0">
        <div className="text-xs font-semibold text-text-primary truncate" data-testid="parameters-inspector-title">
          {cpt?.name ?? 'CPT'}
        </div>
        <div className="text-[10px] text-text-muted tabular-nums">
          {cpt?.max_depth_m != null ? `${cpt.max_depth_m.toFixed(1)} m deep` : 'depth unknown'}
          {cpt?.cpt_type ? ` · ${cpt.cpt_type}` : ''}
        </div>
      </div>

      {/* Water-table line — click the value to edit it. */}
      <WaterTableLine
        profile={profile}
        draft={gwtDraft}
        saving={saving}
        inputRef={inputRef}
        onStartEdit={() =>
          setGwtDraft(profile ? formatNumericForDisplay(profile.gwt_m, 2) : '')
        }
        onDraftChange={setGwtDraft}
        onCommit={() => void commitWaterTable(gwtDraft ?? '')}
        onCancel={() => setGwtDraft(null)}
        onClear={() => void commitWaterTable('')}
      />

      {/* Body — error (with a way out) / loading / panels. */}
      {error !== null ? (
        <div
          className="flex flex-col items-start gap-2 px-3 py-3 text-[11px] text-status-danger"
          data-testid="parameters-inspector-error"
        >
          <span>{error}</span>
          {/* A dead end is not an error state. Retrying re-runs the same
              effect, which fetches the profile AND, if it is still missing,
              the plot. */}
          <button
            onClick={() => setRefetchNonce(n => n + 1)}
            className="px-2 py-0.5 rounded border border-border-default text-text-primary hover:bg-surface-app"
            data-testid="parameters-inspector-retry"
          >
            Retry
          </button>
        </div>
      ) : loading || plot === null ? (
        <div className="flex-1 min-h-0" data-testid="parameters-inspector-loading">
          <LoadingState label="Loading depth series…" />
        </div>
      ) : (
        <CptSbtDepthPanels plot={plot} profile={profile} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Water-table line
// ---------------------------------------------------------------------------

/**
 * The one line that says which water table every normalised value above it was
 * computed under — and lets the engineer change it.
 *
 * Reading the value from the PROFILE (not from the CPT detail row) is
 * deliberate: the label and the maths then cannot disagree, because they are
 * the same response.
 */
function WaterTableLine({
  profile,
  draft,
  saving,
  inputRef,
  onStartEdit,
  onDraftChange,
  onCommit,
  onCancel,
  onClear,
}: {
  profile: CptSbtProfileResponse | null
  draft: string | null
  saving: boolean
  inputRef: React.RefObject<HTMLInputElement>
  onStartEdit: () => void
  onDraftChange: (next: string) => void
  onCommit: () => void
  onCancel: () => void
  onClear: () => void
}): JSX.Element {
  const editing = draft !== null

  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border-subtle shrink-0 text-[10px]"
      data-testid="parameters-water-table-line"
    >
      <Droplet size={11} className="text-text-muted shrink-0" aria-hidden="true" />
      <span className="text-text-muted shrink-0">Water table:</span>

      {editing ? (
        <>
          <input
            ref={inputRef}
            autoFocus
            type="text"
            inputMode="decimal"
            value={draft}
            disabled={saving}
            onChange={e => onDraftChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onCommit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onCancel()
              }
            }}
            // Blur CANCELS rather than commits: clicking away with a
            // half-typed depth must not silently re-normalise the whole
            // profile. Enter is the commit gesture, and the hint says so.
            onBlur={onCancel}
            aria-label="Depth to groundwater in metres below ground surface"
            className="w-16 bg-surface-app border border-border-default rounded px-1 py-0.5 tabular-nums text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            data-testid="parameters-water-table-input"
          />
          <span className="text-text-muted">m — Enter to apply, Esc to cancel</span>
        </>
      ) : profile === null ? (
        <span className="text-text-muted">—</span>
      ) : (
        <>
          <button
            onClick={onStartEdit}
            title="Click to set the water table for this CPT"
            className="tabular-nums text-text-primary underline decoration-dotted underline-offset-2 hover:text-accent"
            data-testid="parameters-water-table-value"
          >
            {profile.gwt_m.toFixed(2)} m
          </button>
          <span className="text-text-muted truncate" data-testid="parameters-water-table-source">
            — {GWT_PROVENANCE_LABEL[profile.gwt_source]}
          </span>
          {profile.gwt_source === 'engineer' && (
            <button
              onClick={onClear}
              title="Undo the water table you set — the file's value comes back when the file recorded one, otherwise the app's assumption"
              className="ml-auto shrink-0 p-0.5 rounded text-text-muted hover:text-status-danger hover:bg-surface-app"
              data-testid="parameters-water-table-clear"
            >
              <X size={11} />
            </button>
          )}
        </>
      )}
    </div>
  )
}
