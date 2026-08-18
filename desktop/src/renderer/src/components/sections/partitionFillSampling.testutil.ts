// Point-sampling oracles for partition-fill render tests (audit P1-5).
//
// "Some path touches the gap" and "the deepest vertex reaches the base" are
// weak oracles: a sliver satisfies the first and a mis-placed deep polygon the
// second, while voids, overlaps and compensating errors all pass. These
// helpers read the RENDERED geometry the way a viewer does — point by point —
// so a test can assert "every point in this window is painted exactly once".
//
// Test-only module: imported by the PartitionFillOverlay test files, never by
// application code.

/** One painted SVG element: its fill colour and its sub-polygon rings. */
export interface PaintedElement {
  color: string
  subpaths: { x: number; y: number }[][]
}

/**
 * Split an ``M … Z M … Z`` path into its sub-rings of screen points.
 *
 * Fill groups merge many regions into one element, so a single ``d`` can
 * carry dozens of rings; rings with fewer than three points are dropped.
 */
export function parseSubpaths(d: string): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = []
  for (const chunk of d.split('M').slice(1)) {
    const pts: { x: number; y: number }[] = []
    for (const m of `M${chunk}`.matchAll(/[ML]\s*(-?[\d.]+),(-?[\d.]+)/g)) {
      pts.push({ x: Number(m[1]), y: Number(m[2]) })
    }
    if (pts.length >= 3) out.push(pts)
  }
  return out
}

/** Even-odd point-in-polygon in screen space. */
export function inScreenPoly(
  px: number,
  py: number,
  pts: readonly { x: number; y: number }[],
): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.y > py !== b.y > py && px < a.x + ((py - a.y) / (b.y - a.y)) * (b.x - a.x)) {
      inside = !inside
    }
  }
  return inside
}

/** Read a container's elements matching a selector into sampleable paint. */
export function paintedElements(container: HTMLElement, selector: string): PaintedElement[] {
  return Array.from(container.querySelectorAll(selector)).map((el) => ({
    color: el.getAttribute('fill') ?? '',
    subpaths: parseSubpaths(el.getAttribute('d') ?? ''),
  }))
}

/**
 * Sample a screen window on a grid and report every point NOT covered by
 * exactly one colour.
 *
 * A point with zero colours is a VOID; more than one is a blend/overlap.
 * The fractional offsets keep sample points off the fills' shared seams,
 * where even-odd point-in-polygon is undefined. Returns human-readable
 * defect strings — assert the result equals ``[]``.
 */
export function coverageDefects(
  painted: readonly PaintedElement[],
  window: { x0: number; x1: number; y0: number; y1: number },
  steps = 20,
): string[] {
  const defects: string[] = []
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const x = window.x0 + (i / steps) * (window.x1 - window.x0) + 0.137
      const y = window.y0 + (j / steps) * (window.y1 - window.y0) + 0.171
      if (x >= window.x1 || y >= window.y1) continue
      const hit = new Set<string>()
      for (const p of painted) {
        if (p.subpaths.some((pts) => inScreenPoly(x, y, pts))) hit.add(p.color)
      }
      if (hit.size !== 1) {
        defects.push(
          `(${x.toFixed(1)},${y.toFixed(1)}) → ${hit.size === 0 ? 'VOID' : [...hit].join('+')}`,
        )
      }
    }
  }
  return defects
}

/** Fraction of the window's sample points covered by at least one element. */
export function coveredFraction(
  painted: readonly PaintedElement[],
  window: { x0: number; x1: number; y0: number; y1: number },
  steps = 20,
): number {
  let covered = 0
  let total = 0
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const x = window.x0 + (i / steps) * (window.x1 - window.x0) + 0.137
      const y = window.y0 + (j / steps) * (window.y1 - window.y0) + 0.171
      if (x >= window.x1 || y >= window.y1) continue
      total += 1
      if (painted.some((p) => p.subpaths.some((pts) => inScreenPoly(x, y, pts)))) covered += 1
    }
  }
  return total === 0 ? 0 : covered / total
}
