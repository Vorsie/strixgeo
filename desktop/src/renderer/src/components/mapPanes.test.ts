// Owner 2026-09-04 (installer #12, "Still can't click a cross section on the
// map to open it"): since the map draws markers on a canvas (a6696974b), the
// markers' canvas covered the whole map ABOVE the section pane, so a click on
// a section line never reached the section's hit-band. Rule: the section
// overlay pane sits above the investigation-markers pane, and section vectors
// use the SVG renderer so only their painted stroke takes the click.
import { describe, expect, it } from 'vitest'

import { INVESTIGATION_MARKERS_PANE_Z, SECTION_PANE_Z, TOOLTIP_PANE_Z } from './mapPanes'

describe('map pane order', () => {
  it('the section overlay pane sits above the investigation-markers canvas', () => {
    expect(SECTION_PANE_Z).toBeGreaterThan(INVESTIGATION_MARKERS_PANE_Z)
  })
  it('and below the tooltip pane, so hover tooltips still win', () => {
    expect(SECTION_PANE_Z).toBeLessThan(TOOLTIP_PANE_Z)
  })
})
