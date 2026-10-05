// Test helper: read the lab-test flask glyph's geometry back out of its SVG
// path, so a test can pin what the eye sees (a neck you can see, a rim line)
// instead of the exact path string.

/** One subpath of the glyph: its points and whether it is closed. */
interface Subpath {
  points: Array<[number, number]>
  closed: boolean
}

/** What a viewer sees of the flask, in px. */
export interface LabFlaskGeometry {
  /** Outer box height of the whole glyph. */
  height: number
  /** Outer box width of the whole glyph. */
  width: number
  /** Outer width of the neck (the two top points of the closed outline). */
  neckWidth: number
  /** Height of the neck before the body starts to widen. */
  neckHeight: number
  /** Width of the rim line (an open subpath across the neck top), or 0 when absent. */
  rimWidth: number
  /** Bounding box of the whole glyph. */
  box: { left: number; top: number; right: number; bottom: number }
}

/**
 * Parse an SVG path ``d`` of M / L / H / V / Z commands (absolute or relative).
 *
 * @param d - The path's ``d`` attribute.
 * @returns The subpaths with absolute points.
 */
function parseSubpaths(d: string): Subpath[] {
  const tokens = d.match(/[MLHVZmlhvz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []
  const out: Subpath[] = []
  let cur: Subpath | null = null
  let cmd = ''
  let x = 0
  let y = 0
  let i = 0
  const num = (): number => Number(tokens[i++])
  while (i < tokens.length) {
    const tok = tokens[i]
    if (/[A-Za-z]/.test(tok)) {
      cmd = tok
      i++
      if (cmd === 'Z' || cmd === 'z') {
        if (cur) cur.closed = true
        continue
      }
    }
    switch (cmd) {
      case 'M':
      case 'm': {
        const nx = num()
        const ny = num()
        x = cmd === 'M' ? nx : x + nx
        y = cmd === 'M' ? ny : y + ny
        cur = { points: [[x, y]], closed: false }
        out.push(cur)
        cmd = cmd === 'M' ? 'L' : 'l'
        break
      }
      case 'L':
      case 'l': {
        const nx = num()
        const ny = num()
        x = cmd === 'L' ? nx : x + nx
        y = cmd === 'L' ? ny : y + ny
        cur?.points.push([x, y])
        break
      }
      case 'H':
      case 'h': {
        const nx = num()
        x = cmd === 'H' ? nx : x + nx
        cur?.points.push([x, y])
        break
      }
      case 'V':
      case 'v': {
        const ny = num()
        y = cmd === 'V' ? ny : y + ny
        cur?.points.push([x, y])
        break
      }
      default:
        throw new Error(`unsupported path command ${cmd} in ${d}`)
    }
  }
  return out
}

/**
 * Measure the flask glyph drawn by a path ``d``.
 *
 * @param d - The flask path's ``d`` attribute.
 * @returns The glyph's box, neck and rim sizes in px.
 */
export function measureLabFlask(d: string): LabFlaskGeometry {
  const subpaths = parseSubpaths(d)
  const outline = subpaths.find(s => s.closed)
  if (!outline) throw new Error(`no closed outline in ${d}`)
  const all = subpaths.flatMap(s => s.points)
  const xs = all.map(p => p[0])
  const ys = all.map(p => p[1])
  const box = {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  }
  const outlineTop = Math.min(...outline.points.map(p => p[1]))
  const neckTop = outline.points.filter(p => Math.abs(p[1] - outlineTop) < 1e-6)
  const neckLeft = Math.min(...neckTop.map(p => p[0]))
  const neckRight = Math.max(...neckTop.map(p => p[0]))
  // The neck ends where the outline first leaves the neck's x range.
  const neckSide = outline.points.filter(p => Math.abs(p[0] - neckRight) < 1e-6)
  const neckBottom = Math.max(...neckSide.map(p => p[1]))
  const rim = subpaths.find(s => !s.closed && s.points.length >= 2)
  const rimWidth = rim
    ? Math.max(...rim.points.map(p => p[0])) - Math.min(...rim.points.map(p => p[0]))
    : 0
  return {
    height: box.bottom - box.top,
    width: box.right - box.left,
    neckWidth: neckRight - neckLeft,
    neckHeight: neckBottom - outlineTop,
    rimWidth,
    box,
  }
}
