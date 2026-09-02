// Left workflow-spine rail.
//
// Renders one button per registered stage in ``STAGE_ORDER``. Each button
// shows the stage icon + abbreviated label. When a stage has a live summary
// badge (non-null ``StageSummary.badge``), a compact dot badge overlays the
// top-right corner of the icon.
//
// Stage transitions animate only when ``prefers-reduced-motion`` is not set
// — all transition classes are wrapped in ``motion-safe:`` per the motion
// budget (§6.5, ≤250 ms for any stage transition).
//
// All colour classes use the S1 semantic tokens (bg-spine-bg, bg-spine-active,
// bg-spine-hover, text-text-primary, text-text-muted, etc.) — never raw
// palette steps.

import type { StageId, StageDescriptor } from './StageDescriptor'
import { STAGE_ORDER, STAGE_REGISTRY } from './StageRegistry'
import { useShell } from './ShellContext'
import { log } from '../utils/log'
import { useT } from '../i18n/translate'

const SPINE_LABEL_KEYS = {
  data: 'spine.data',
  sections: 'spine.sections',
  geology: 'spine.geology',
  lithology: 'spine.lithology',
  geotechnical: 'spine.geotechnical',
  parameters: 'spine.parameters',
  export: 'spine.export',
} as const

/** Props for each spine stage button — extracted so the per-stage hook call
 *  is isolated to its own component and hooks always run in a consistent
 *  count regardless of the stage list length. */
interface SpineButtonProps {
  descriptor: StageDescriptor
  active: boolean
  onSelect: (id: StageId) => void
}

/**
 * Single stage button for the spine rail.
 *
 * Calls the descriptor's ``useStageSummary`` hook to get the live badge.
 * Must be rendered as a separate component (not inside a loop in
 * ``StageSpine``) so the hook call count is constant regardless of the
 * active stage.
 *
 * Parameters
 * ----------
 * descriptor
 *     The ``StageDescriptor`` for this button.
 * active
 *     Whether this is the currently-selected stage.
 * onSelect
 *     Callback to switch the active stage.
 */
function SpineButton({ descriptor, active, onSelect }: SpineButtonProps): JSX.Element {
  const summary = descriptor.useStageSummary()
  const Icon = descriptor.icon
  const t = useT()
  const label = t(SPINE_LABEL_KEYS[descriptor.id])

  return (
    <button
      type="button"
      // Stable anchor for the guided tutorial (highlight "open the … tab") and
      // for e2e. Ids match the descriptor id: stage-tab-data, -sections,
      // -geology, -lithology, -geotechnical, -parameters, -export.
      data-testid={`stage-tab-${descriptor.id}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={() => {
        if (!active) {
          log.debug('shell', `spine → ${descriptor.id}`)
          onSelect(descriptor.id)
        }
      }}
      className={[
        'relative flex flex-col items-center justify-center gap-1',
        'w-full py-3 rounded-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'motion-safe:transition-colors motion-safe:duration-150',
        active
          ? 'bg-spine-active text-text-on-accent'
          : 'text-text-muted hover:bg-spine-hover hover:text-text-primary',
      ].join(' ')}
    >
      {/* Icon with dot badge overlay */}
      <div className="relative">
        <Icon size={16} />
        {summary.badge !== null && (
          <span
            aria-hidden="true"
            className={[
              'absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-0.5',
              'flex items-center justify-center rounded-full text-[9px] font-bold leading-none',
              summary.badgeIntent === 'red'
                ? 'bg-status-danger text-white'
                : summary.badgeIntent === 'amber'
                  ? 'bg-status-amber text-white'
                  : active
                    ? 'bg-white/30 text-white'
                    : 'bg-border-default text-text-primary',
            ].join(' ')}
          >
            {summary.badge.length > 4 ? '…' : summary.badge}
          </span>
        )}
      </div>
      {/* Abbreviated stage label */}
      <span className="text-[10px] font-medium leading-none">
        {label}
      </span>
    </button>
  )
}

export interface StageSpineProps {
  /** Currently active stage id. */
  activeStageId: StageId
  /** Called when the user clicks a spine button to switch stages. */
  onSelectStage: (id: StageId) => void
}

/**
 * Left rail of the workflow-spine shell.
 *
 * Renders one ``SpineButton`` per registered stage in workflow order.
 * The rail is ``w-16`` (64 px) with a right border separating it from
 * the canvas area.
 *
 * Parameters
 * ----------
 * activeStageId
 *     The stage currently displayed in the canvas / toolbar / inspector.
 * onSelectStage
 *     Callback to switch the active stage (typically ``useShellState.setActiveStage``).
 *
 * Returns
 * -------
 * JSX.Element
 *     The spine rail element.
 */
export default function StageSpine({ activeStageId, onSelectStage }: StageSpineProps): JSX.Element {
  const t = useT()
  return (
    <nav
      aria-label={t('spine.title')}
      className="flex flex-col w-16 bg-spine-bg border-r border-border-subtle overflow-y-auto flex-shrink-0"
    >
      <div className="flex flex-col gap-1 p-2 flex-1">
        {STAGE_ORDER.map(stageId => {
          const descriptor = STAGE_REGISTRY.get(stageId)
          // Registry is sealed at build time — every id in STAGE_ORDER maps
          // to a descriptor. The assertion guard here protects against a
          // future partial-registry edit rather than a real runtime path.
          if (!descriptor) return null
          return (
            <SpineButton
              key={stageId}
              descriptor={descriptor}
              active={stageId === activeStageId}
              onSelect={onSelectStage}
            />
          )
        })}
      </div>
      {/* Selection footer (debt #44) — surfaces the cross-stage
          investigation selection so the user has feedback that their
          marquee in Data persists when they walk to Sections /
          Geology / etc. The set already lives in App-level state
          (marqueeSelectedIds), so persistence is structural; this
          footer makes the carry VISIBLE from every stage. */}
      <SelectionFooter />
    </nav>
  )
}

/**
 * Footer of the StageSpine — shows "N selected" with a clear button
 * whenever the cross-stage selection set is non-empty.
 *
 * Hidden when the selection is empty so the spine stays uncluttered
 * for the common case. The badge is amber-tinted to match the rest
 * of the app's "active marker" colour (same hue used for stale
 * dirty markers, unsaved indicators, ghost-edit boundaries).
 *
 * Returns
 * -------
 * JSX.Element
 *     The footer element (a clickable badge or empty when selection
 *     is empty).
 */
function SelectionFooter(): JSX.Element {
  const { coordinator } = useShell()
  const t = useT()
  const { marqueeSelectedIds, setMarqueeSelectedIds } = coordinator
  const count = marqueeSelectedIds.size
  if (count === 0) {
    return <div className="p-2" data-testid="selection-footer-empty" />
  }
  return (
    <div className="p-2 border-t border-border-subtle" data-testid="selection-footer">
      <button
        type="button"
        className="w-full flex flex-col items-center gap-0.5 rounded px-1 py-1.5 bg-amber-100/80 dark:bg-amber-950/40 border border-status-amber text-text-primary hover:bg-amber-200/80 dark:hover:bg-amber-950/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-status-amber"
        aria-label={t('spine.selectionFooterAria', { n: count })}
        title={t('spine.selectionFooterTitle', { n: count })}
        onClick={() => setMarqueeSelectedIds(new Set())}
        data-testid="selection-footer-clear"
      >
        <span className="text-[11px] font-semibold tabular-nums leading-none">{count}</span>
        <span
          className="text-[8px] uppercase tracking-wide text-text-secondary leading-none"
          aria-label={t('spine.selectionFooterLabel', { n: count })}
        >
          {/* "sel." is a visual abbreviation; aria-label on the parent span
              announces the full word so screen readers say "N selected". */}
          {t('spine.selectionFooterAbbr')}
        </span>
      </button>
    </div>
  )
}
