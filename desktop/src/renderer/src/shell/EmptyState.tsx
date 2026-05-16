// Shared empty / loading state primitives (debt #45).
//
// docs/ux.md: "Empty states — text + icon (Lucide), never just
// blank"; async needs an in-element spinner. GeologyCanvas's empty
// state (Mountain icon + actionable guidance) is the one that does it
// right; this lifts that shape into a reusable primitive so the
// text-only / bare-string sites can adopt it instead of each
// re-inventing the layout. The rule-of-three is already met (debt
// names ~6 sites).

import { Loader2 } from 'lucide-react'
import type React from 'react'

export interface EmptyStateProps {
  /** Lucide icon element. Rendered at 40 px, muted, like GeologyCanvas. */
  icon: React.ReactNode
  /** Primary line — what this surface is / why it is empty. */
  title: string
  /** Optional secondary guidance line (what to do about it). */
  hint?: string
  /** Optional CTA / extra content rendered under the text. */
  children?: React.ReactNode
  /** Compact variant for in-list / in-panel empties (smaller icon,
   * fixed shorter height) vs the default full-pane centred block. */
  compact?: boolean
}

/**
 * Centred icon + title (+ optional hint + CTA) for an empty surface.
 *
 * Mirrors the GeologyCanvas empty-state layout (the docs/ux.md
 * reference): vertically + horizontally centred, 40 px muted icon,
 * centred max-width copy.
 *
 * Parameters
 * ----------
 * icon
 *     Lucide icon element.
 * title
 *     Primary line.
 * hint
 *     Optional secondary guidance line.
 * children
 *     Optional CTA / extra content.
 * compact
 *     Smaller icon + fixed shorter height for in-list / in-panel use.
 *
 * Returns
 * -------
 * JSX.Element
 *     The empty-state block.
 */
export function EmptyState({
  icon,
  title,
  hint,
  children,
  compact,
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center text-text-muted',
        compact ? 'h-24 gap-2 px-4' : 'h-full gap-4',
      ].join(' ')}
    >
      <div
        className={
          compact
            ? 'text-text-muted [&>svg]:h-5 [&>svg]:w-5'
            : 'text-text-muted [&>svg]:h-10 [&>svg]:w-10'
        }
      >
        {icon}
      </div>
      <div className="flex flex-col items-center gap-1 max-w-sm text-center">
        <p
          className={[
            'leading-snug text-text-secondary',
            compact ? 'text-xs' : 'text-sm',
          ].join(' ')}
        >
          {title}
        </p>
        {hint !== undefined && (
          <p className="text-xs leading-snug text-text-muted">{hint}</p>
        )}
      </div>
      {children}
    </div>
  )
}

export interface LoadingStateProps {
  /** What is loading — e.g. "Loading chart…". */
  label: string
}

/**
 * Centred spinner + label for an in-element async wait.
 *
 * Replaces bare "Loading …" strings — docs/ux.md requires motion so
 * the user can tell working from hung.
 *
 * Parameters
 * ----------
 * label
 *     The loading message.
 *
 * Returns
 * -------
 * JSX.Element
 *     The loading-state block.
 */
export function LoadingState({ label }: LoadingStateProps): JSX.Element {
  return (
    <div
      className="flex items-center justify-center gap-2 h-full text-sm text-text-muted"
      role="status"
      aria-live="polite"
    >
      <Loader2 size={16} className="animate-spin" />
      {label}
    </div>
  )
}
