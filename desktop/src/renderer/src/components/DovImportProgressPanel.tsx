/**
 * Progress panel rendered inside the DOV import modal while an SSE stream
 * is running.
 *
 * Renders:
 *   - A phase label with a determinate progress bar (done / total) for every
 *     phase that has a measurable total > 0.
 *   - An indeterminate (pulsing) bar for the ``commit`` phase and for any
 *     phase that fires with total === 0 (e.g. ``dedup`` on an empty result).
 *   - A compact completion summary on ``status: 'done'``.
 *   - An error message on ``status: 'error'``.
 *   - An ARIA live region so screen-reader users hear progress updates
 *     without focus moving away from whatever they last interacted with.
 */

import type {
  BoreholeImportDonePayload,
  CptImportDonePayload,
  DovImportState,
  ImportPhase,
} from '../hooks/useDovImportStream'
import { PHASE_LABELS } from '../hooks/useDovImportStream'
import { dovSubPhaseFailures } from '../utils/dovImportFailures'
import { useT } from '../i18n/translate'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isCptDone(
  kind: 'cpt' | 'borehole',
  result: unknown,
): result is CptImportDonePayload {
  return kind === 'cpt'
}

function isBoreholeDone(
  kind: 'cpt' | 'borehole',
  result: unknown,
): result is BoreholeImportDonePayload {
  return kind === 'borehole'
}

/** The commit phase is considered indeterminate — duration unknown. */
function isIndeterminate(phase: ImportPhase, total: number): boolean {
  return phase === 'commit' || total === 0
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ProgressBarProps {
  /** 0–100, or -1 for indeterminate. */
  pct: number
}

function ProgressBar({ pct }: ProgressBarProps) {
  const indeterminate = pct < 0
  return (
    // Outer track
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-border-default"
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {indeterminate ? (
        // Pulsing stripe for the commit phase — CSS animation via Tailwind
        // ``animate-pulse``. The bar fills half the track so the motion
        // reads as "working" not "complete".
        <div className="h-full w-1/2 animate-pulse rounded-full bg-accent-muted" />
      ) : (
        <div
          className="h-full rounded-full bg-accent-muted transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  )
}

interface DoneRowProps {
  label: string
  value: number | string
}

function DoneRow({ label, value }: DoneRowProps) {
  if (!value && value !== 0) return null
  return (
    <div className="flex justify-between text-xs">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-text-primary">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  state: DovImportState
}

/**
 * Progress panel for a DOV import stream.
 *
 * @param state - The ``DovImportState`` from ``useDovImportStream``.
 */
export default function DovImportProgressPanel({ state }: Props) {
  const t = useT()

  // ---------------------------------------------------------------------------
  // Running state
  // ---------------------------------------------------------------------------

  if (state.status === 'running') {
    const { latest, kind } = state
    const phase = latest?.phase ?? 'wfs'
    const label = PHASE_LABELS[phase] ?? phase
    const done = latest?.done ?? 0
    const total = latest?.total ?? 0
    const indeterminate = isIndeterminate(phase, total)
    const pct = indeterminate ? -1 : Math.round((done / total) * 100)
    const countLabel =
      !indeterminate && total > 0
        ? `${done} / ${total}`
        : null

    return (
      // ``aria-live="polite"`` announces updates without interrupting the
      // user's current screen-reader context. ``aria-atomic="false"``
      // lets the SR announce only the changed parts rather than re-reading
      // the whole region on every tick.
      <div
        className="flex flex-col gap-3 py-2"
        aria-live="polite"
        aria-atomic="false"
        aria-label={t(kind === 'cpt' ? 'map.cptImportProgress' : 'map.boreholeImportProgress')}
      >
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-text-primary">{label}</span>
          {countLabel !== null && (
            <span className="text-xs tabular-nums text-text-muted">{countLabel}</span>
          )}
        </div>

        <ProgressBar pct={pct} />

        {/* Visually hidden live text for screen readers — gives richer
            context than the progressbar role alone. */}
        <span className="sr-only">
          {countLabel !== null
            ? t('map.importProgressOf', { label, done, total })
            : label}
        </span>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Done state
  // ---------------------------------------------------------------------------

  if (state.status === 'done') {
    const { kind, result } = state
    // A failed sub-phase (the interpretaties WFS being down is routine) is
    // recorded as a counter, not an error — so it has to be READ or the panel
    // renders a dead phase exactly like a clean import (audit 2026-08-02).
    const subPhaseFailures = isBoreholeDone(kind, result) ? dovSubPhaseFailures(result) : []
    return (
      <div
        className="flex flex-col gap-2 py-2"
        aria-live="polite"
        aria-atomic="true"
      >
        <p className="text-sm font-medium text-text-primary">
          {subPhaseFailures.length > 0
            ? t('map.importFinishedWithErrors')
            : t('map.importComplete')}
        </p>

        <div className="flex flex-col gap-1">
          <DoneRow label={t('map.imported')} value={result.imported} />
          <DoneRow label={t('map.alreadyExisted')} value={result.duplicates} />
          {result.failed > 0 && (
            <DoneRow label={t('map.failed')} value={result.failed} />
          )}
        </div>

        {isCptDone(kind, result) && (
          <p className="text-xs text-text-muted">
            {t(
              result.cpt_ids.length === 1 ? 'map.cptsInProjectOne' : 'map.cptsInProjectMany',
              { n: result.cpt_ids.length },
            )}
          </p>
        )}

        {isBoreholeDone(kind, result) && (
          <div className="flex flex-col gap-1">
            {result.interpretations_attached > 0 && (
              <DoneRow label={t('map.observationsAttached')} value={result.interpretations_attached} />
            )}
            {result.samples_attached > 0 && (
              <DoneRow label={t('map.samplesAttached')} value={result.samples_attached} />
            )}
            {/* A retryable row reads "<phase> failed"; a WFS gap's label is a
                whole phrase already ("Observations DOV lists but did not
                return") and appending "failed" to it would be wrong twice —
                nothing failed, and it would not parse. */}
            {subPhaseFailures.map(f => (
              <DoneRow
                key={f.label}
                label={f.retryable ? t('map.subPhaseFailed', { label: f.label }) : f.label}
                value={f.count}
              />
            ))}
          </div>
        )}

        {subPhaseFailures.length > 0 && (
          <p className="text-xs text-status-danger">
            {t('map.dovMissingData')}
            {subPhaseFailures.some(f => f.retryable)
              ? t('map.dovMissingRetry')
              : t('map.dovMissingNoRetry')}
          </p>
        )}
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------

  if (state.status === 'error') {
    return (
      <div
        className="flex flex-col gap-1 py-2"
        aria-live="assertive"
        aria-atomic="true"
        role="alert"
      >
        <p className="text-sm font-medium text-text-primary">{t('map.importFailed')}</p>
        <p className="text-xs text-text-muted">{state.message}</p>
      </div>
    )
  }

  // Idle — render nothing; the caller controls visibility.
  return null
}
