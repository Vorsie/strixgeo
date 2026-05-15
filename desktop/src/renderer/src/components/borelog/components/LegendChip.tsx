import type { ReactElement, ReactNode } from 'react'

/**
 * Single entry inside a ``LegendSection``.
 *
 * Layout: ``[preview] code label``. ``preview`` is an arbitrary node —
 * typically a small SVG <rect> with the soil pattern fill, an admixture
 * colour swatch, or a sample-test icon — so the chip stays generic
 * across legend categories. ``code`` renders monospace so DOV
 * vocabulary tokens (``FZf``, ``KLs``, ``HyEg``) line up visually
 * across rows.
 */
export function LegendChip({
  code,
  label,
  preview,
}: {
  code: string
  label: string
  preview?: ReactNode
}): ReactElement {
  return (
    <span className="flex items-center gap-1.5 text-gray-700 dark:text-slate-200">
      {preview}
      <span className="font-mono text-gray-500 dark:text-slate-400">{code}</span>
      <span>{label}</span>
    </span>
  )
}
