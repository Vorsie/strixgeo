// Shared button component for dialogs and panels.
//
// Variants: primary (accent-filled), secondary (surface border), danger
// (destructive red), ghost (text-only). The focus ring uses ``ring-accent``
// (resolves to blue-600 in light, blue-400 in dark) which clears the WCAG
// 2.2 AA 3:1 UI-component contrast requirement in both themes. The previous
// ``ring-blue-500`` was ~2.8:1 on dark surfaces (AA fail).
//
// ``secondary`` and ``ghost`` use semantic surface tokens so they render
// correctly in dark mode without extra ``dark:`` pairs per-callsite.

import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size    = 'sm' | 'md'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children: ReactNode
}

// ring-accent resolves to blue-600 (light) / blue-400 (dark) via the CSS
// custom property --color-accent. Both clear WCAG 2.2 AA 3:1 against
// the respective surface backgrounds.
const BASE = 'inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40'

const VARIANTS: Record<Variant, string> = {
  // primary + danger are accent/danger fills — surface-agnostic.
  primary:   'bg-accent text-text-on-accent hover:bg-accent-muted active:bg-accent-muted',
  danger:    'bg-status-danger text-white hover:bg-red-700 active:bg-red-800',
  // secondary / ghost use semantic surface tokens so they adapt to dark mode
  // via CSS custom properties rather than needing ``dark:`` per-callsite.
  secondary: 'bg-surface-page border border-border-default text-text-primary hover:bg-surface-card active:bg-surface-card',
  ghost:     'text-text-secondary hover:bg-surface-card active:bg-surface-card',
}

const SIZES: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3.5 py-1.5 text-sm',
}

/**
 * Shared button for dialogs and inspector panels.
 *
 * Parameters
 * ----------
 * variant
 *     Visual intent: ``primary``, ``secondary``, ``danger``, or ``ghost``.
 *     Defaults to ``secondary``.
 * size
 *     ``sm`` (default) or ``md``.
 * children
 *     Button label content.
 *
 * ref
 *     Forwarded to the underlying ``<button>`` so callers can focus it
 *     (e.g. default-focus Cancel in confirm dialogs).
 *
 * Returns
 * -------
 * JSX.Element
 *     The button element.
 */
const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'secondary', size = 'sm', className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={[BASE, VARIANTS[variant], SIZES[size], className].join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
})

export default Button
