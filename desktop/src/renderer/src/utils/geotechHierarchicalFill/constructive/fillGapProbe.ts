/**
 * DORMANT PROBE — the fill's own decisions, one entry per (family, gap) run.
 *
 * Owner, 2026-08-21, on a fix that changed the render but not the scene he
 * circled: *"instrument and try again."* The scene probes read the OUTPUT;
 * this reads the DECISIONS — per band: the emit and which contacts counted as
 * tied; the LINES fed to the arrangement; per face: who answered and on which
 * tier. Enabled by the construct-probe diag test only; costs nothing dormant.
 *
 * @module utils/geotechHierarchicalFill/constructive/fillGapProbe
 */

/** One band's construct decision, as the kernel and the line phase saw it. */
export interface ProbeConstruct {
  layer: string
  ci: number
  top: number
  base: number
  emit: string
  topTied: boolean
  baseTied: boolean
  extendsToFar?: boolean
  /**
   * Where a closed construct terminates, in the gap's own fraction space —
   * *"it terminates at 0.5 Distance approximately"*. The onlap-closure
   * tripwire reads this: a vertical face HERE is a wedge that was cut instead
   * of closed, while one anywhere else is a boundary of some other kind.
   */
  apexFraction?: number
}

/** One labelled face: who owns it, decided on which tier. */
export interface ProbeFace {
  owner: string | null
  role: 'construct' | 'fill' | 'residual'
  sample: [number, number]
  ring: [number, number][]
}

/** One resolved tie of the run, as the constructs see it. */
export interface ProbeTie {
  key: string
  leftCi: number
  leftY: number
  rightCi: number
  rightY: number
}

/** One (family, gap) run. ``coverLayers`` names the family via its cover. */
export interface ProbeEntry {
  gapIndex: number
  coverLayers: string[]
  /**
   * Whether this run is a STACKED SEAM — both packages closed and stacked, the
   * *"keep mtaw lvl"* fallback of 2026-08-25. There a vertical step at the seam
   * is the ruling itself (*"The different height is acceptable"*), so the
   * onlap-closure tripwire skips these runs rather than reporting the owner's
   * own accepted geometry as a defect.
   */
  stackedSeam: boolean
  constructs: ProbeConstruct[]
  ties: ProbeTie[]
  lines: [number, number][][]
  faces: ProbeFace[]
}

/** The sink. The diag test flips ``enabled`` and drains ``entries``. */
export const fillGapProbe: { enabled: boolean; entries: ProbeEntry[] } = {
  enabled: false,
  entries: [],
}
