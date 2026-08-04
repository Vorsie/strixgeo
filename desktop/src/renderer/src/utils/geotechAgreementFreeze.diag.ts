/**
 * The FROZEN half of the geotech render-vs-build agreement gate.
 *
 * ``geotechEngineAgreement.diag.test.ts`` measures how far apart the two
 * geotech-axis geometries are. On its own it is a reporter: it prints numbers and
 * always passes, so nothing stops the two arms drifting further apart between
 * sessions. This module turns the measurement into an arbiter by comparing it
 * against a committed baseline
 * (``__fixtures__/geotech_agreement_baseline.json``):
 *
 *  * WORSE than the baseline by more than ``TOLERANCE_PCT`` on any section, or on
 *    the model-wide total  ->  the gate FAILS and names the sections;
 *  * BETTER  ->  the gate passes and prints the improvement, with a reminder to
 *    re-freeze so the next session cannot silently give the gain back;
 *  * the model has MOVED under the baseline (different model ids, or a section
 *    whose column / edge counts changed)  ->  the comparison is SKIPPED for that
 *    section and said out loud. A baseline measured on other data is not evidence,
 *    and pretending otherwise would produce exactly the false green this gate
 *    exists to prevent.
 *
 * The number the gate ENFORCES on the model as a whole is accumulated over the
 * COMPARABLE sections only, and the excluded sections are named next to it. The
 * model-wide total across all 14 sections is still printed, but enforcing it
 * would re-admit through the back door exactly what the per-section skip just
 * refused: edit one section in the app, and its movement drags the total past
 * the tolerance while its own row reads "not enforced".
 *
 * Re-freeze with ``GEOTECH_AGREE=1 GEOTECH_AGREE_FREEZE=1``; the run rewrites the
 * baseline from what it just measured and still prints the deltas it replaced.
 *
 * Kept out of the test file so the gate stays readable, and suffixed ``.diag`` so
 * it is obvious that no production code path imports it.
 */

import { readFileSync, writeFileSync } from 'node:fs'

/** Percentage points a section may worsen before the gate fails. */
export const TOLERANCE_PCT = 0.5

/** One section's frozen measurement plus the input fingerprint it was measured on. */
export interface BaselineSection {
  name: string
  /** Litho columns the render arm ran on. */
  lithoCols: number
  /** Geotech columns the build arm ran on (< 2 means the build drops the section). */
  geoCols: number
  /** Approved correlation edges per arm. */
  lithoEdges: number
  geoEdges: number
  /** Share of the section plane where the two arms assign a different class. */
  disagreementPct: number
  agreeM2: number
  disagreeM2: number
  renderOnlyM2: number
  buildOnlyM2: number
}

/** The committed baseline: what the two arms disagreed on when it was frozen. */
export interface AgreementBaseline {
  frozenAt: string
  /** Partition engine the baseline was measured with ('v1' | 'v2'). */
  engine: string
  lithoModelId: string
  geotechModelId: string
  /** Model-wide disagreement percentage over all sections. */
  totalDisagreementPct: number
  /** Model-wide disagreement over only the sections the build can produce. */
  buildableDisagreementPct: number
  sections: BaselineSection[]
  /** Free text: what the number meant when it was frozen. */
  note: string
}

/** The subset of a gate result the freeze reads. */
export interface MeasuredSection {
  name: string
  lithoCols: number
  geoCols: number
  lithoEdges: number
  geoEdges: number
  disagreementPct: number
  buckets: { agree: number; disagree: number; renderOnly: number; buildOnly: number }
}

/** Outcome of a baseline comparison. */
export interface FreezeVerdict {
  /** Lines to print, in order. */
  lines: string[]
  /** Sections that got worse by more than the tolerance — a non-empty list fails the gate. */
  regressions: string[]
  /** Sections whose fingerprint no longer matches the baseline. */
  skipped: string[]
  /** Sections that improved by more than the tolerance. */
  improvements: string[]
}

/**
 * Compare a measured run against the committed baseline.
 *
 * @param measured One entry per section, in any order.
 * @param baseline The committed baseline.
 * @param lithoModelId Litho model the run measured.
 * @param geotechModelId Geotech model the run measured.
 * @param engine Active partition engine ('v1' | 'v2').
 * @param totalPct Model-wide disagreement percentage of the run.
 * @param buildablePct Disagreement over the sections the build can produce.
 * @returns The verdict; ``regressions`` non-empty means the gate must fail.
 */
export function compareToBaseline(
  measured: readonly MeasuredSection[],
  baseline: AgreementBaseline,
  lithoModelId: string,
  geotechModelId: string,
  engine: string,
  totalPct: number,
  buildablePct: number,
): FreezeVerdict {
  const lines: string[] = []
  const regressions: string[] = []
  const skipped: string[] = []
  const improvements: string[] = []
  const f = (n: number): string => n.toFixed(1)
  const signed = (n: number): string => (n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1))

  lines.push(`  baseline frozen ${baseline.frozenAt} on engine ${baseline.engine}`)
  if (baseline.engine !== engine) {
    lines.push(
      `  NOTE  this run used engine ${engine}, the baseline was frozen on ` +
        `${baseline.engine} — the engines produce different partitions, so the ` +
        `comparison below is between two different things and is reported, not enforced.`,
    )
  }
  const sameModel =
    baseline.lithoModelId === lithoModelId && baseline.geotechModelId === geotechModelId
  if (!sameModel) {
    lines.push(
      `  NOTE  the baseline was frozen on litho ${baseline.lithoModelId} / geotech ` +
        `${baseline.geotechModelId}; this run measured ${lithoModelId} / ${geotechModelId}. ` +
        `Different models are not comparable — re-freeze.`,
    )
  }

  const byName = new Map(baseline.sections.map((s) => [s.name, s]))
  // The ENFORCED total is accumulated over the comparable sections only. The
  // model-wide total is still printed, but a section whose inputs moved is
  // reported as not-enforced per section and must not sneak back in through the
  // total: editing one section in the app would otherwise drag the total past
  // the tolerance and fail a run in which every enforced section was unchanged —
  // exactly the false red this module exists to prevent.
  let baseAgree = 0
  let baseUnion = 0
  let nowAgree = 0
  let nowUnion = 0
  let comparable = 0
  lines.push('  section            baseline%   now%     delta   verdict')
  for (const m of [...measured].sort((a, b) => a.name.localeCompare(b.name))) {
    const b = byName.get(m.name)
    if (!b) {
      skipped.push(m.name)
      lines.push(`  ${m.name.padEnd(18)} ${'—'.padStart(9)} ${f(m.disagreementPct).padStart(6)} ` + `${'—'.padStart(9)}   NEW section, not in the baseline`)
      continue
    }
    const moved =
      b.lithoCols !== m.lithoCols ||
      b.geoCols !== m.geoCols ||
      b.lithoEdges !== m.lithoEdges ||
      b.geoEdges !== m.geoEdges
    const delta = m.disagreementPct - b.disagreementPct
    if (moved || !sameModel) {
      skipped.push(m.name)
      lines.push(
        `  ${m.name.padEnd(18)} ${f(b.disagreementPct).padStart(9)} ` +
          `${f(m.disagreementPct).padStart(6)} ${signed(delta).padStart(9)}   INPUTS MOVED ` +
          `(cols ${b.lithoCols}/${b.geoCols}->${m.lithoCols}/${m.geoCols}, edges ` +
          `${b.lithoEdges}/${b.geoEdges}->${m.lithoEdges}/${m.geoEdges}) — not enforced`,
      )
      continue
    }
    comparable += 1
    baseAgree += b.agreeM2
    baseUnion += b.agreeM2 + b.disagreeM2 + b.renderOnlyM2 + b.buildOnlyM2
    nowAgree += m.buckets.agree
    nowUnion += m.buckets.agree + m.buckets.disagree + m.buckets.renderOnly + m.buckets.buildOnly
    let verdict = 'unchanged'
    if (delta > TOLERANCE_PCT) {
      regressions.push(`${m.name} ${f(b.disagreementPct)} -> ${f(m.disagreementPct)} %`)
      verdict = 'WORSE'
    } else if (delta < -TOLERANCE_PCT) {
      improvements.push(`${m.name} ${f(b.disagreementPct)} -> ${f(m.disagreementPct)} %`)
      verdict = 'better'
    }
    lines.push(
      `  ${m.name.padEnd(18)} ${f(b.disagreementPct).padStart(9)} ` +
        `${f(m.disagreementPct).padStart(6)} ${signed(delta).padStart(9)}   ${verdict}`,
    )
  }
  const totalDelta = totalPct - baseline.totalDisagreementPct
  const buildableDelta = buildablePct - baseline.buildableDisagreementPct
  lines.push(
    `  TOTAL              ${f(baseline.totalDisagreementPct).padStart(9)} ` +
      `${f(totalPct).padStart(6)} ${signed(totalDelta).padStart(9)}`,
  )
  lines.push(
    `  buildable only     ${f(baseline.buildableDisagreementPct).padStart(9)} ` +
      `${f(buildablePct).padStart(6)} ${signed(buildableDelta).padStart(9)}`,
  )
  const basePct = baseUnion > 0 ? ((baseUnion - baseAgree) / baseUnion) * 100 : 0
  const nowPct = nowUnion > 0 ? ((nowUnion - nowAgree) / nowUnion) * 100 : 0
  const enforcedDelta = nowPct - basePct
  if (skipped.length === 0) {
    lines.push(`  (every section comparable — the TOTAL above is the enforced number)`)
  } else {
    lines.push(
      `  ENFORCED TOTAL     ${f(basePct).padStart(9)} ${f(nowPct).padStart(6)} ` +
        `${signed(enforcedDelta).padStart(9)}   over the ${comparable} comparable section(s); ` +
        `excludes ${skipped.join(', ')}`,
    )
  }
  if (sameModel && comparable > 0 && enforcedDelta > TOLERANCE_PCT) {
    regressions.push(
      `total over the ${comparable} comparable section(s) ${f(basePct)} -> ${f(nowPct)} %`,
    )
  }
  if (improvements.length > 0) {
    lines.push(
      `  ${improvements.length} section(s) improved — re-freeze with ` +
        `GEOTECH_AGREE_FREEZE=1 so the gain cannot be given back silently.`,
    )
  }
  return { lines, regressions, skipped, improvements }
}

/**
 * Read the committed baseline.
 *
 * @param path Absolute path to the baseline JSON.
 * @returns The parsed baseline, or ``null`` when the file does not exist.
 */
export function readBaseline(path: string): AgreementBaseline | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as AgreementBaseline
  } catch {
    return null
  }
}

/**
 * Rewrite the baseline from a measured run.
 *
 * @param path Absolute path to the baseline JSON.
 * @param baseline The baseline to write.
 */
export function writeBaseline(path: string, baseline: AgreementBaseline): void {
  writeFileSync(path, `${JSON.stringify(baseline, null, 1)}\n`, 'utf8')
}
