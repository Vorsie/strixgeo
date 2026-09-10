// One tab of a canvas view-switcher strip (Map | Chart on the Data stage,
// Map | Section on the Sections stage). Lifted out of DataCanvas on
// 2026-09-10 when the Sections stage grew the same strip: the owner could not
// find the way back to the map from an open section (it was an icon-only X),
// so both canvases now share this labelled tab.
import type React from 'react'

export interface ViewTabProps {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
  /** Optional hook for tests and the tutorial anchor chain. */
  testid?: string
}

/** A labelled view tab; the active one carries the accent border. */
export default function ViewTab({ icon, label, active, onClick, testid }: ViewTabProps): JSX.Element {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      aria-pressed={active}
      className={[
        'flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors',
        active
          ? // accent border (not border-subtle) so the selected-state
            // boundary clears WCAG 2.2 1.4.11 (3:1) in dark mode —
            // surface-app on surface-card is only ~1.4:1; the accent
            // border carries the state indication at ~6:1.
            'bg-surface-app border border-accent shadow-sm text-text-primary'
          : 'text-text-secondary hover:text-text-primary',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}
