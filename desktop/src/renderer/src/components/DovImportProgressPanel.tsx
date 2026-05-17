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
        aria-label={`${kind === 'cpt' ? 'CPT' : 'Borehole'} import progress`}
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
            ? `${label} ${done} of ${total}`
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
    return (
      <div
        className="flex flex-col gap-2 py-2"
        aria-live="polite"
        aria-atomic="true"
      >
        <p className="text-sm font-medium text-text-primary">
          Import complete
        </p>

        <div className="flex flex-col gap-1">
          <DoneRow label="Imported" value={result.imported} />
          <DoneRow label="Already existed" value={result.duplicates} />
          {result.failed > 0 && (
            <DoneRow label="Failed" value={result.failed} />
          )}
        </div>

        {isCptDone(kind, result) && (
          <p className="text-xs text-text-muted">
            {result.cpt_ids.length} CPT
            {result.cpt_ids.length !== 1 ? 's' : ''} in project
          </p>
        )}

        {isBoreholeDone(kind, result) && (
          <div className="flex flex-col gap-1">
            {result.interpretations_attached > 0 && (
              <DoneRow label="Observations attached" value={result.interpretations_attached} />
            )}
            {result.samples_attached > 0 && (
              <DoneRow label="Samples attached" value={result.samples_attached} />
            )}
          </div>
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
        <p className="text-sm font-medium text-text-primary">Import failed</p>
        <p className="text-xs text-text-muted">{state.message}</p>
      </div>
    )
  }

  // Idle — render nothing; the caller controls visibility.
  return null
}
