import type { ReactElement } from 'react'

import { LabFlaskGlyph } from './LabFlaskGlyph'
import { LAB_FLASK_HALO_WIDTH, labFlaskWidth } from './mapMarkerStyle'

/**
 * The lab-test flask as a stand-alone inline SVG, for HTML surfaces (the map
 * legend). It draws ``LabFlaskGlyph``: the same path and the same halo +
 * outline layers as the map marker and the borelog sample marker, so the
 * legend shows exactly the glyph on the map (owner 2026-10-05: a triangle on
 * the map vs a flask in the legend).
 *
 * @param props.height - Outline height, px; the SVG adds the halo around it.
 * @param props.className - Optional classes for layout (e.g. ``shrink-0``).
 * @param props['data-testid'] - Optional test id on the ``<svg>``.
 * @returns The ``<svg>`` element.
 */
export function LabFlaskIcon({
  height,
  className,
  'data-testid': testId,
}: {
  height: number
  className?: string
  'data-testid'?: string
}): ReactElement {
  const half = LAB_FLASK_HALO_WIDTH / 2
  return (
    <svg
      width={Math.ceil(labFlaskWidth(height) + LAB_FLASK_HALO_WIDTH)}
      height={Math.ceil(height + LAB_FLASK_HALO_WIDTH)}
      className={className}
      data-testid={testId}
      aria-hidden="true"
    >
      <LabFlaskGlyph left={half} top={half} height={height} />
    </svg>
  )
}
