// Top bar for the shell.
//
// Two zones (per §4.4):
//
//   Left  — renders the active stage's ``ToolbarComponent`` (stage-specific
//            verbs: import, new section, build model, etc.).
//   Right — always-visible global controls: dirty indicator + Save button,
//            inspector toggle.
//
// The global controls in the right zone are placeholders in S3. The dirty
// indicator and Save button wire up in S4 when the DataStage toolbar is
// built; the theme toggle lands alongside that. For S3 the right zone is
// intentionally minimal — the intent is to prove the skeleton composes,
// not to migrate existing buttons prematurely.
//
// Semantic tokens only (bg-surface-card, border-border-subtle, etc.).
// motion-safe: on any transition class.

import type { StageId, StageDescriptor } from './StageDescriptor'
import { STAGE_REGISTRY } from './StageRegistry'

export interface StageToolbarProps {
  /** Currently active stage id. */
  activeStageId: StageId
  /** Whether the inspector panel is currently open. */
  inspectorOpen: boolean
  /** Toggle the inspector panel open/closed. */
  onToggleInspector: () => void
}

/**
 * Top toolbar bar for the workflow-spine shell.
 *
 * Renders the active stage's ``ToolbarComponent`` on the left and
 * always-visible global controls on the right. ``h-10`` matches the
 * ``AppShell`` layout spec in §2.2.
 *
 * Parameters
 * ----------
 * activeStageId
 *     The stage currently displayed in the canvas.
 * inspectorOpen
 *     Whether the right inspector panel is expanded.
 * onToggleInspector
 *     Called when the user clicks the inspector toggle button.
 *
 * Returns
 * -------
 * JSX.Element
 *     The toolbar bar element.
 */
export default function StageToolbar({
  activeStageId,
  inspectorOpen,
  onToggleInspector,
}: StageToolbarProps): JSX.Element {
  const descriptor: StageDescriptor | undefined = STAGE_REGISTRY.get(activeStageId)
  const StageVerbs = descriptor?.ToolbarComponent ?? null

  return (
    <div
      role="toolbar"
      aria-label="Stage toolbar"
      className="flex items-center h-10 bg-surface-card border-b border-border-subtle flex-shrink-0"
    >
      {/* Left zone — stage-specific verb buttons */}
      <div className="flex items-center flex-1 overflow-hidden px-2 gap-1">
        {StageVerbs !== null && <StageVerbs />}
      </div>

      {/* Right zone — global shell controls */}
      <div className="flex items-center gap-1 px-2 flex-shrink-0">
        {/* Inspector panel toggle (panel-right icon) */}
        <button
          type="button"
          aria-label={inspectorOpen ? 'Collapse inspector' : 'Expand inspector'}
          aria-pressed={inspectorOpen}
          onClick={onToggleInspector}
          className={[
            'flex items-center justify-center w-7 h-7 rounded',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            'motion-safe:transition-colors motion-safe:duration-150',
            inspectorOpen
              ? 'bg-accent/10 text-accent'
              : 'text-text-muted hover:bg-spine-hover hover:text-text-primary',
          ].join(' ')}
        >
          {/* Simple two-column SVG representing a panel-right layout */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="0" y="0" width="8" height="14" rx="1" opacity="0.4" />
            <rect x="10" y="0" width="4" height="14" rx="1" />
          </svg>
        </button>
      </div>
    </div>
  )
}
