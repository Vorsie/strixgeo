// Parameters stage inspector — the per-CPT plot surface, and (on the
// per-unit tab) the UNIT LIST.
//
// Owner ruling (dogfeed 2026-08-03): the empty right-hand inspector pane
// BECOMES the per-CPT plot surface. Clicking a row in the per-test table
// selects the CPT; this pane then shows a header, the water-table line, and the
// tall depth-synced panels (qc | fs+Rf | Ic | both SBT strips).
//
// Owner ruling R3 (2026-08-27): on the PER-UNIT tab this pane is the unit
// list instead — the statistics it used to draw here are the canvas now
// ("switch statistics and list from pane"). See ``UnitListPane``.
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
import { EmptyState, LoadingState } from '../../EmptyState'
import { useShell } from '../../ShellContext'
import { t as tStatic, useT } from '../../../i18n/translate'
import type { MessageKey } from '../../../i18n/locales/en'
import CptSbtDepthPanels from './CptSbtDepthPanels'
import UnitListPane from './UnitListPane'

/** How the water-table line reads for each provenance — a catalogue key so it
 *  translates at render time. */
const GWT_PROVENANCE_LABEL_KEY: Record<GwtProvenance, MessageKey> = {
  recorded: 'params.gwtRecorded',
  engineer: 'params.gwtEngineer',
  assumed: 'params.gwtAssumed',
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
    coordinator: { selectedId, markMutated, parametersActiveTab },
    toasts: { toast },
  } = useShell()
  const t = useT()

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
            ? tStatic('params.cptLoadFailedDetail', { error: err.message })
            : tStatic('params.cptLoadFailed'),
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
        toast('error', tStatic('params.waterTableInvalid'))
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
            ? tStatic('params.waterTableSaveFailedDetail', { error: err.message })
            : tStatic('params.waterTableSaveFailed'),
        )
      } finally {
        setSaving(false)
      }
    },
    [selectedId, projectId, toast, markMutated],
  )

  // ── Render ────────────────────────────────────────────────────────────────
  // Every hook above runs unconditionally; the early returns start here.

  // The per-unit tab's inspector IS the unit list (owner ruling R3,
  // 2026-08-27: "switch statistics and list from pane") — the statistics it
  // used to draw here are the canvas now, and the list is how the engineer
  // drives them.
  if (parametersActiveTab === 'per-unit') {
    return <UnitListPane />
  }

  if (selectedId === null) {
    return (
      <EmptyState
        icon={<Beaker />}
        title={t('params.noTestSelected')}
        hint={t('params.pickCptRow')}
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
          {cpt?.name ?? t('params.cptFallbackName')}
        </div>
        <div className="text-[10px] text-text-muted tabular-nums">
          {cpt?.max_depth_m != null
            ? t('params.depthMDeep', { depth: cpt.max_depth_m.toFixed(1) })
            : t('params.depthUnknown')}
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
            {t('common.retry')}
          </button>
        </div>
      ) : loading || plot === null ? (
        <div className="flex-1 min-h-0" data-testid="parameters-inspector-loading">
          <LoadingState label={t('params.loadingDepthSeries')} />
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
  const t = useT()
  const editing = draft !== null

  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border-subtle shrink-0 text-[10px]"
      data-testid="parameters-water-table-line"
    >
      <Droplet size={11} className="text-text-muted shrink-0" aria-hidden="true" />
      <span className="text-text-muted shrink-0">{t('params.waterTable')}</span>

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
            aria-label={t('params.waterTableHint')}
            className="w-16 bg-surface-app border border-border-default rounded px-1 py-0.5 tabular-nums text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            data-testid="parameters-water-table-input"
          />
          <span className="text-text-muted">{t('params.waterTableEditHint')}</span>
        </>
      ) : profile === null ? (
        <span className="text-text-muted">—</span>
      ) : (
        <>
          <button
            onClick={onStartEdit}
            title={t('params.waterTableSet')}
            className="tabular-nums text-text-primary underline decoration-dotted underline-offset-2 hover:text-accent"
            data-testid="parameters-water-table-value"
          >
            {profile.gwt_m.toFixed(2)} m
          </button>
          <span className="text-text-muted truncate" data-testid="parameters-water-table-source">
            — {t(GWT_PROVENANCE_LABEL_KEY[profile.gwt_source])}
          </span>
          {profile.gwt_source === 'engineer' && (
            <button
              onClick={onClear}
              title={t('params.waterTableUndo')}
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
