/**
 * Compact inline progress + Cancel for a running 3-D voxel build (debt #282).
 *
 * Rendered by the Lithology toolbar IN PLACE of the Build button while a
 * background build job runs. Shows the current phase label, a determinate
 * progress bar (or an indeterminate pulse when the phase has no measurable
 * total), and a Cancel button. Reuses the DOV import panel's bar look.
 *
 * Renders ``null`` unless ``state.status === 'running'`` — the toolbar reverts to
 * the Build button on every terminal state.
 */

import { X } from 'lucide-react'

import type { VoxelBuildPhase, VoxelBuildState } from '../hooks/useVoxelBuildStream'
import type { MessageKey } from '../i18n/locales/en'
import { useT } from '../i18n/translate'
import { ToolbarButton } from '../shell/ToolbarPrimitives'

/** i18n key for each phase's progress label. */
function phaseLabelKey(phase: VoxelBuildPhase): MessageKey {
  switch (phase) {
    case 'label':
      return 'litho.buildProgressLabel'
    case 'reconcile':
      return 'litho.buildProgressReconcile'
    case 'extract':
      return 'litho.buildProgressExtract'
    case 'persist':
      return 'litho.buildProgressPersist'
  }
}

interface Props {
  state: VoxelBuildState
  onCancel: () => void
  /**
   * testid for the Cancel button. Defaults to the litho id so the litho toolbar
   * is unchanged; the geotech toolbar passes its own so the two stages' Cancel
   * buttons are addressable independently (debt #282).
   */
  cancelTestid?: string
}

/**
 * The running-state progress + Cancel element for the toolbar.
 *
 * @param state - The voxel build state from ``useVoxelBuildStream``.
 * @param onCancel - Fired when the user presses Cancel.
 * @param cancelTestid - testid for the Cancel button (default litho id).
 */
export default function VoxelBuildProgressInline({
  state,
  onCancel,
  cancelTestid = 'litho-build-cancel-button',
}: Props): JSX.Element | null {
  const t = useT()
  if (state.status !== 'running') return null

  const { latest, cancelRequested } = state
  const label = latest ? t(phaseLabelKey(latest.phase)) : t('litho.buildProgressStarting')
  const total = latest?.total ?? 0
  const done = latest?.done ?? 0
  const determinate = total > 0
  const pct = determinate ? Math.min(100, Math.round((done / total) * 100)) : -1

  return (
    <div
      className="flex items-center gap-2"
      role="status"
      aria-live="polite"
      aria-label={t('litho.building3dModel')}
    >
      <div className="flex flex-col gap-1" style={{ minWidth: 140 }}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-text-primary">
            {cancelRequested ? t('litho.buildCancelling') : label}
          </span>
          {determinate && (
            <span className="text-[10px] tabular-nums text-text-muted">{`${pct}%`}</span>
          )}
        </div>
        {/* Bar — determinate width, or an indeterminate pulse (mirrors the DOV
            import panel's ProgressBar look). */}
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-border-default"
          role="progressbar"
          aria-valuenow={determinate ? pct : undefined}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {determinate ? (
            <div
              className="h-full rounded-full bg-accent-muted transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          ) : (
            <div className="h-full w-1/2 animate-pulse rounded-full bg-accent-muted" />
          )}
        </div>
      </div>
      <ToolbarButton
        icon={<X size={13} />}
        label={cancelRequested ? t('litho.buildCancelling') : t('litho.buildCancel')}
        onClick={onCancel}
        disabled={cancelRequested}
        testid={cancelTestid}
        title={t('litho.buildCancel')}
      />
    </div>
  )
}
