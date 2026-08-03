// Paint order on the section canvas.
//
// Observed 2026-08-02 (owner screenshots, both hidden): the violet review-flag
// badge and the tie context menu rendered UNDERNEATH PartitionFillOverlay's
// 0.62-opacity fills. The badge came out tinted to near-invisibility and the
// menu was simply occluded — which made the "Confirm tie" flow undiscoverable
// on the very axis it was built for.
//
// The cause is not styling. Every overlay lives in ONE `<svg>` in SectionPanel,
// and SVG has no `z-index`: it paints in document order, last on top. So the
// layer order IS the JSX order, and the invariant worth protecting is a
// statement about the source.
//
// WHY THIS TEST READS THE SOURCE FILE rather than rendering: SectionPanel takes
// 40+ props and mounts a canvas, so its own suites deliberately never mount it
// (see SectionPanel.geotech.test.tsx's header). A DOM-order assertion would
// therefore cost a mock of most of the app to pin a one-line ordering fact.
// This is narrow, it fails for exactly one reason, and its failure message
// names the fix. The VISUAL half — that the badge is legible over a fill and
// the menu is clickable — still needs the owner's eyes; no unit test sees
// opacity compositing.

import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(join(__dirname, 'SectionPanel.tsx'), 'utf-8')

/** Index of a JSX element's opening tag in the SectionPanel source. */
function indexOfElement(tag: string): number {
  const at = SOURCE.indexOf(`<${tag}`)
  expect(at, `<${tag}> should be rendered by SectionPanel`).toBeGreaterThan(-1)
  return at
}

// The fills that were painting over the interaction layer. Both draw broad
// translucent regions across the whole plot, so anything beneath them is tinted
// rather than hidden — which is worse than hidden, because it looks deliberate.
const FILL_OVERLAYS = ['PartitionFillOverlay', 'ModelFillOverlay']

describe('LO1 — the correlation interaction layer paints above every fill', () => {
  it.each(FILL_OVERLAYS)('CorrelationEdgesOverlay comes after %s', fill => {
    expect(
      indexOfElement('CorrelationEdgesOverlay'),
      `CorrelationEdgesOverlay must be rendered AFTER <${fill}> in SectionPanel's ` +
        'SVG: it carries the review-flag badges, the edge hit-targets and the ' +
        'edge context menus, and SVG paints in document order.',
    ).toBeGreaterThan(indexOfElement(fill))
  })
})

describe('LO2 — context menus stay at the very top of the stack', () => {
  // A menu that opens under a band cannot be clicked. BodyContextMenu already
  // lives last in the SVG; the correlation menus ride inside
  // CorrelationEdgesOverlay, so LO1 is what keeps them reachable.
  it('BodyContextMenu is rendered after the fill overlays', () => {
    for (const fill of FILL_OVERLAYS) {
      expect(indexOfElement('BodyContextMenu')).toBeGreaterThan(indexOfElement(fill))
    }
  })
})
