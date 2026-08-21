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
}

/** One labelled face: who owns it, decided on which tier. */
export interface ProbeFace {
  owner: string | null
  role: 'construct' | 'fill' | 'residual'
  sample: [number, number]
  ring: [number, number][]
}

/** One (family, gap) run. ``coverLayers`` names the family via its cover. */
export interface ProbeEntry {
  gapIndex: number
  coverLayers: string[]
  constructs: ProbeConstruct[]
  lines: [number, number][][]
  faces: ProbeFace[]
}

/** The sink. The diag test flips ``enabled`` and drains ``entries``. */
export const fillGapProbe: { enabled: boolean; entries: ProbeEntry[] } = {
  enabled: false,
  entries: [],
}
