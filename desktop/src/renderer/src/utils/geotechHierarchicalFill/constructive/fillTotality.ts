/**
 * THE TOTALITY TRIPWIRE — residual on a banded gap is a DEFECT now.
 *
 * Until 2026-08-26 the fill was allowed to hand ground back unanswered. The
 * "correlate me" hatch was the honest floor: the constructs claimed what they
 * claimed, the remainder ladder answered what it could relate to, and whatever
 * neither reached stayed blank because no rule of the owner's covered it.
 *
 * His least-dense ruling of that day closes the last hole — *"if 2 lenses are
 * pointed to eachother and there is nothing else to fill the gap, no open band
 * above or below, then you fill with the lowest density"* (see
 * ``leastDenseLeftover.ts``). Ground the ladder declines is now owned by the
 * least dense of the masses that bound it, so on any gap the law can speak
 * about at all there is no ground left over. What used to be an accepted
 * outcome is therefore a symptom, and this module is what says so by name
 * rather than leaving a silent patch of hatch on a section for the owner to
 * find with his eyes for the sixth time.
 *
 * WHERE IT IS SILENT, and this is the whole of the scope. A gap with no banded
 * RUN over it has no law to be total about: one of its tests carries the family
 * and has not been divided (owner ruling 2026-08-15 — an un-divided borehole
 * shows visibly EMPTY ground), or no test on that side carries the family at
 * all. Blank there is the correct answer, not a defect, and a tripwire that
 * cried wolf on it would be turned off within a week.
 *
 * Pure module — a plan and its result in, a violation or null out.
 *
 * @module utils/geotechHierarchicalFill/constructive/fillTotality
 */

import type { GapFillInput, GapFillResult } from './fillGap'
import { regionAreaM2 } from '../../sectionPartition/regionArea'

/** One gap that kept ground the law should have owned. */
export interface TotalityViolation {
  /** The frame gap it stands on. */
  gapIndex: number
  /** How many loops were left unanswered. */
  faces: number
  /** How much cover they hold, in square metres. */
  areaM2: number
}

/**
 * Did this gap leave ground the law should have owned?
 *
 * @param input The gap's plan — only its identity, its width and whether a
 *   banded run spans it are read.
 * @param result The fill's own output for it — only the residual is read.
 * @returns The violation, or null where the gap is total (or out of scope).
 */
export function totalityViolationOf(
  input: Pick<GapFillInput, 'gapIndex' | 'xa' | 'xb' | 'run'>,
  result: Pick<GapFillResult, 'residual'>,
): TotalityViolation | null {
  if (input.run === null || result.residual.length === 0) return null
  const width = input.xb - input.xa
  let total = 0
  for (const region of result.residual) total += regionAreaM2(region, width)
  return { gapIndex: input.gapIndex, faces: result.residual.length, areaM2: total }
}
