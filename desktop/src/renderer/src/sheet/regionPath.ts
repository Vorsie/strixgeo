/** Fraction polygons (``RegionInput``) → pixel paths. Numbers are rounded to 0.01 px. */

export interface FractionRegion {
  gap_index: number
  polygon: readonly (readonly [number, number])[]
}

function r2(v: number): string {
  return String(Math.round(v * 100) / 100)
}

export function resolveRegionPoints(
  region: FractionRegion,
  columnX: readonly number[],
  levelToY: (level: number) => number,
): [number, number][] {
  const x0 = columnX[region.gap_index] ?? 0
  const x1 = columnX[region.gap_index + 1] ?? x0
  return region.polygon.map(([f, level]) => [x0 + f * (x1 - x0), levelToY(level)])
}

export function regionPathD(
  region: FractionRegion,
  columnX: readonly number[],
  levelToY: (level: number) => number,
): string {
  const pts = resolveRegionPoints(region, columnX, levelToY)
  if (pts.length === 0) return ''
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${r2(x)} ${r2(y)}`).join('') + 'Z'
}

export function regionBounds(
  region: FractionRegion,
  columnX: readonly number[],
  levelToY: (level: number) => number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const pts = resolveRegionPoints(region, columnX, levelToY)
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}
