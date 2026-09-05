// Right inspector panel — 420 px fixed width, push-mode, non-modal.
//
// "Push-mode" means the inspector takes space from the canvas when open
// (the body row is ``flex``; the inspector adds to the row, pushing the
// canvas left). There is no overlay or backdrop — the inspector is always
// inside the content flow.
//
// Open/close is a width transition (200 ms, ease-out per §6.5) wrapped in
// ``motion-safe:`` so reduced-motion users see an instant toggle.
//
// Renders the active stage's ``InspectorComponent`` with no props —
// the component reads its data via ``useShell()``.
//
// Semantic tokens only (bg-surface-card, border-border-subtle, etc.).

import type { StageId } from './StageDescriptor'
import { STAGE_REGISTRY } from './StageRegistry'
import { useT } from '../i18n/translate'

/** Width class for the open inspector (420 px). */
const WIDTH_OPEN = 'w-[420px]'
/** Width class for the collapsed inspector. */
const WIDTH_CLOSED = 'w-0'

export interface InspectorProps {
  /** Currently active stage id. */
  activeStageId: StageId
  /** Whether the inspector is currently expanded. */
  open: boolean
}

/**
 * Right inspector rail of the workflow-spine shell.
 *
 * Renders the active stage's ``InspectorComponent`` in a fixed-width 420 px
 * panel. When ``open`` is ``false`` the panel collapses to zero width
 * (``overflow-hidden``) — the canvas claims the freed space automatically
 * because the body row is ``flex``.
 *
 * The transition is width-based (``motion-safe:transition-[width]``). Content
 * inside the panel does not need to know about the open/closed state; it is
 * clipped by ``overflow-hidden`` when the panel is closed.
 *
 * Parameters
 * ----------
 * activeStageId
 *     The stage whose ``InspectorComponent`` should render.
 * open
 *     ``true`` = 420 px panel; ``false`` = 0 px collapsed.
 *
 * Returns
 * -------
 * JSX.Element
 *     The inspector rail element.
 */
export default function Inspector({ activeStageId, open }: InspectorProps): JSX.Element {
  const t = useT()
  const descriptor = STAGE_REGISTRY.get(activeStageId)
  const InspectorContent = descriptor?.InspectorComponent ?? null

  return (
    <aside
      aria-label={t('shell.inspector')}
      // Tutorial anchor: the overlay rings the whole pane when a highlighted
      // control lives inside the right rail (owner ruling 1, 2026-09-05).
      data-testid="shell-inspector"
      // overflow-hidden clips content when collapsing and prevents
      // a horizontal scrollbar on the body row during the transition.
      className={[
        'flex flex-col bg-surface-card border-l border-border-subtle',
        'overflow-hidden flex-shrink-0',
        'motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out',
        open ? WIDTH_OPEN : WIDTH_CLOSED,
      ].join(' ')}
    >
      {/* Inner container carries the fixed width so content doesn't
          reflow during the width transition. The outer aside owns the
          animated width; the inner div stays at the target width and
          is clipped by overflow-hidden. */}
      <div className="flex flex-col w-[420px] h-full overflow-y-auto">
        {InspectorContent !== null && <InspectorContent />}
      </div>
    </aside>
  )
}
