// The drilled stretches of a PDF-digitised CPT: read from the wire, and said in
// the app language. One parser and one wording for every place that shows
// them: the triage row's note, the CPT chart's gap logic, the chart's
// provenance line ("voorboring 32.0 tot 32.3 m, 40.1 tot 40.9 m").
import type { Translator } from '../i18n/translate'

/** One drilled stretch, ``[top, base]`` in metres below ground level. */
export type DrilledInterval = [number, number]

/**
 * Read a list of ``[top, base]`` pairs off the wire.
 *
 * @param raw - The ``intervals`` of a note, or ``drilled_intervals_m`` of an
 *   import provenance.
 * @returns The pairs (empty for an empty list), or null when ``raw`` is not a
 *   list of number pairs.
 */
export function parseDrilledIntervals(raw: unknown): DrilledInterval[] | null {
  if (!Array.isArray(raw)) return null
  const out: DrilledInterval[] = []
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length !== 2) return null
    const [top, base] = pair as unknown[]
    if (typeof top !== 'number' || typeof base !== 'number') return null
    out.push([top, base])
  }
  return out
}

/**
 * The stretches as one phrase: each "32.0 to 32.3 m" (one decimal), joined by
 * commas, in the app language.
 *
 * @param intervals - The stretches, shallow first.
 * @param t - The active-language translator.
 * @returns The phrase; empty for no stretch.
 */
export function drilledIntervalsText(intervals: ReadonlyArray<readonly [number, number]>, t: Translator): string {
  return intervals
    .map(([top, base]) => t('cptPdf.drilledInterval', { top: top.toFixed(1), base: base.toFixed(1) }))
    .join(', ')
}
