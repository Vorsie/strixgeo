// Shared stage-toolbar button primitives (debt #46 + the rule-of-three
// extraction GeologyToolbar's header comment scheduled).
//
// ``ToolbarButton`` + ``PrimaryToolbarButton`` were copy-pasted into
// GeologyToolbar.tsx and SectionsToolbar.tsx (identical bodies, only
// docstrings differed) with a third copy due for the Export-stage
// toolbar — past the extract-on-the-third-copy window. Lifted here
// VERBATIM, plus a ``busy`` prop: docs/ux.md requires disable + an
// in-button spinner for async triggers, but only "Build model" wired
// the spinner half. ``busy`` swaps the icon for a spinning
// ``RefreshCw`` so every long verb (Fill / Seed / Dedupe / Plaxis
// export / delete) gets the affordance for free.

import { RefreshCw } from 'lucide-react'
import type React from 'react'

interface PrimaryToolbarButtonProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
  /** When true, the icon is replaced by a spinning indicator (async
   * in-flight affordance). Callers still own ``disabled`` + the label
   * swap; this only adds the motion docs/ux.md requires. */
  busy?: boolean
}

/**
 * Accent-filled toolbar button for a stage's primary entry action.
 *
 * Parameters
 * ----------
 * icon
 *     Lucide icon element (13 px).
 * label
 *     Short text label rendered next to the icon.
 * onClick
 *     Action handler.
 * disabled
 *     When true, the button is non-interactive and dimmed.
 * title
 *     Tooltip text (full action description).
 * busy
 *     When true, the icon is swapped for a spinning ``RefreshCw``.
 *
 * Returns
 * -------
 * JSX.Element
 *     The accent-filled button element.
 */
export function PrimaryToolbarButton({
  icon,
  label,
  onClick,
  disabled,
  title,
  busy,
}: PrimaryToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-busy={busy}
      className={[
        'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        disabled
          ? 'bg-accent/40 text-text-on-accent cursor-not-allowed'
          : 'bg-accent text-text-on-accent hover:bg-accent-muted',
      ].join(' ')}
    >
      {busy ? <RefreshCw size={13} className="animate-spin" /> : icon}
      {label}
    </button>
  )
}

interface ToolbarButtonProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
  /** Render with amber tint (stale-surface badge affordance). */
  amber?: boolean
  /** Render with red tint (destructive action affordance). */
  danger?: boolean
  /** When true, the icon is replaced by a spinning indicator (async
   * in-flight affordance). Callers still own ``disabled`` + the label
   * swap; this only adds the motion docs/ux.md requires. */
  busy?: boolean
}

/**
 * Compact toolbar button for a stage's secondary verbs.
 *
 * Parameters
 * ----------
 * icon
 *     Lucide icon element (13 px).
 * label
 *     Short text label rendered next to the icon.
 * onClick
 *     Action handler.
 * disabled
 *     When true, the button is non-interactive.
 * title
 *     Tooltip text (full action description).
 * amber
 *     Highlights the button in amber (stale-surface badge affordance).
 * danger
 *     Highlights the button in red (destructive action affordance).
 * busy
 *     When true, the icon is swapped for a spinning ``RefreshCw``.
 *
 * Returns
 * -------
 * JSX.Element
 *     The button element.
 */
export function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
  title,
  amber,
  danger,
  busy,
}: ToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-busy={busy}
      className={[
        'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        disabled
          ? 'text-text-muted cursor-not-allowed'
          : danger
            ? 'text-status-danger hover:bg-surface-app'
            : amber
              ? 'text-status-amber hover:bg-surface-app'
              : 'text-text-secondary hover:bg-surface-app hover:text-text-primary',
      ].join(' ')}
    >
      {busy ? <RefreshCw size={13} className="animate-spin" /> : icon}
      {label}
    </button>
  )
}
