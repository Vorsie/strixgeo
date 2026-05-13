import type { ReactElement, ReactNode } from 'react'

/**
 * Section in the borelog's bottom-of-canvas legend.
 *
 * Renders a small caps title followed by the chip wrap. Used once per
 * legend category (soil patterns, admixtures, drill methods, field
 * log codes, sample test types). The parent ``Legend`` omits a
 * section entirely when the borehole has no rows to legend in that
 * category, so the wrap never lands empty.
 */
export function LegendSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[9px] uppercase tracking-wide text-gray-400">{title}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">{children}</div>
    </div>
  )
}
