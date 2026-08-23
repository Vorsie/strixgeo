/**
 * THE CS1 GOLDEN MASTER — freeze the whole picture, diff every future one.
 *
 * Owner, 2026-08-23: *"can we now take a snapshot from CS1 ... if the engine
 * differs from CS1 then something broke"*, *"make sure to have all quads
 * too"*, *"not only what is in DB also what is rendered on screen"*.
 *
 * TWO HALVES, and the second one is not optional. Over 2026-08-22 the ENGINE
 * output for CS1 was byte-identical from the session's first commit to its
 * last, while THREE separate render layers changed what the user actually saw
 * (the seam-stroke identity, the fill dissolve, the litho outline's
 * column-line guard). A snapshot of the engine alone would have reported that
 * night as "nothing changed". So:
 *
 *   A. ENGINE — every region the fill emits: gap, class, kind, layers and the
 *      FULL ring, every vertex of every quad, plus the "correlate me"
 *      fallback regions.
 *   B. SCREEN — every SVG element the overlay actually paints on the geotech
 *      axis: the dissolved fill groups, the seam strokes, the litho outlines,
 *      the fallback fills and the hatch, each with its colour, opacity and
 *      path data.
 *
 * ALWAYS ON. No env var to run it, no gitignored input — the trap documented
 * in docs/lessons-learned.md #4 ("synthetic passes while real data breaks") is
 * exactly what this gate exists to close, so it must not itself be dormant.
 *
 * WHEN IT GOES RED
 * ----------------
 * It is doing its job. Read the diff: it names the gap, the class and the
 * ring that moved. Then decide which of two things happened:
 *   * a REGRESSION — fix it; or
 *   * an INTENDED change — re-freeze deliberately and say why in the commit
 *     message, exactly as the 2/1/0 and consistency ratchets require:
 *
 *       cd desktop && CS1_GOLDEN_FREEZE=1 npx vitest run \
 *         src/renderer/src/utils/cs1GoldenMaster.test.tsx
 *
 * Never re-freeze to make a red go away without reading what moved.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { computeEngineSnapshot, type FrozenRegion } from './cs1GoldenMaster/engineSnapshot'
import { computeScreenSnapshot, type FrozenElement } from './cs1GoldenMaster/screenSnapshot'

afterEach(() => cleanup())

const HERE = dirname(fileURLToPath(import.meta.url))
const GOLDEN = resolve(HERE, '__fixtures__/cs1_golden_master.json')

interface Golden {
  note: string
  engine: { regions: FrozenRegion[]; fallback: FrozenRegion[] }
  screen: FrozenElement[]
  /** Element families in paint order — the z-order the render depends on. */
  layerOrder: string[]
}

/**
 * Report the FIRST few real differences in words, not as two 400-element
 * object dumps. A gate nobody can read is a gate that gets re-frozen blind.
 */
function describeDiff<T>(
  label: string,
  golden: readonly T[],
  fresh: readonly T[],
  keyOf: (t: T) => string,
  showOf: (t: T) => string,
): string[] {
  // MULTISET, not set. Keying into a plain Map collapses duplicates, and an
  // element emitted TWICE then reads as identical to one emitted once — the
  // gate stayed green on an injected duplicate (audit finding, 2026-08-23,
  // reproduced by hand: `out.push({...out[0]})` took the screen half from 476
  // to 477 painted elements and the gate still passed). Counts are part of
  // the picture: painting the same band twice is a real defect (double
  // compositing darkens a translucent fill) and the whole point of this gate
  // is that nothing about the picture moves silently.
  const count = (ts: readonly T[]): Map<string, { n: number; sample: T }> => {
    const m = new Map<string, { n: number; sample: T }>()
    for (const t of ts) {
      const k = keyOf(t)
      const prev = m.get(k)
      if (prev === undefined) m.set(k, { n: 1, sample: t })
      else prev.n += 1
    }
    return m
  }
  const g = count(golden)
  const f = count(fresh)
  const lines: string[] = []
  const gone = [...g.keys()].filter((k) => !f.has(k))
  const born = [...f.keys()].filter((k) => !g.has(k))
  const requantified = [...g.keys()].filter(
    (k) => f.has(k) && (f.get(k) as { n: number }).n !== (g.get(k) as { n: number }).n,
  )
  if (
    gone.length === 0 &&
    born.length === 0 &&
    requantified.length === 0 &&
    golden.length === fresh.length
  ) {
    return lines
  }
  lines.push(
    `${label}: ${golden.length} frozen -> ${fresh.length} now  (${gone.length} gone, ${born.length} new, ${requantified.length} re-counted)`,
  )
  for (const k of gone.slice(0, 5)) lines.push(`  GONE    ${showOf((g.get(k) as { sample: T }).sample)}`)
  for (const k of born.slice(0, 5)) lines.push(`  NEW     ${showOf((f.get(k) as { sample: T }).sample)}`)
  for (const k of requantified.slice(0, 5)) {
    const gn = (g.get(k) as { n: number }).n
    const fn = (f.get(k) as { n: number }).n
    lines.push(`  x${gn} -> x${fn}  ${showOf((f.get(k) as { sample: T }).sample)}`)
  }
  return lines
}

const showRegion = (r: FrozenRegion): string =>
  `gap ${r.gap} ${r.formationId} [${r.kind}] layers=${r.layerIds.join('+') || '-'} ring=${r.ring}`

const showElement = (e: FrozenElement): string =>
  `${e.family} fill=${e.fill} stroke=${e.stroke} op=${e.opacity} d=${e.d.length > 120 ? `${e.d.slice(0, 120)}…` : e.d}`

/**
 * The FULL content is the key, ring included — so a moved vertex reports as an
 * unpaired GONE plus an unpaired NEW rather than a paired before/after. That is
 * deliberate: several regions legitimately share (gap, formationId, kind), so a
 * shorter key would not be unique and any pairing would be a guess.
 */
const regionKey = (r: FrozenRegion): string => `${r.gap}|${r.formationId}|${r.kind}|${r.ring}`
const elementKey = (e: FrozenElement): string => `${e.family}|${e.fill}|${e.stroke}|${e.d}`

describe('CS1 golden master — the whole picture, frozen', () => {
  // Rendering 24 columns of real CS1 into jsdom is genuinely slow; under the
  // full suite's parallel load it exceeds the 5 s default.
  it('the engine and the screen both reproduce the frozen CS1', { timeout: 60_000 }, () => {
    const engine = computeEngineSnapshot()
    const { elements: screen, layerOrder } = computeScreenSnapshot()

    if (process.env.CS1_GOLDEN_FREEZE === '1') {
      const golden: Golden = {
        note: 'CS1 golden master — regenerate ONLY via CS1_GOLDEN_FREEZE=1, and only for a change you can explain. See cs1GoldenMaster.test.tsx.',
        engine,
        screen,
        layerOrder,
      }
      writeFileSync(GOLDEN, JSON.stringify(golden, null, 1) + '\n')
      // eslint-disable-next-line no-console
      console.log(
        `FROZE ${engine.regions.length} regions + ${engine.fallback.length} fallback + ${screen.length} painted elements + ${layerOrder.length} layers -> ${GOLDEN}`,
      )
      return
    }

    expect(
      existsSync(GOLDEN),
      'no golden committed — freeze one with CS1_GOLDEN_FREEZE=1',
    ).toBe(true)
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden

    const lines = [
      ...describeDiff('ENGINE regions', golden.engine.regions, engine.regions, regionKey, showRegion),
      ...describeDiff(
        'ENGINE fallback',
        golden.engine.fallback,
        engine.fallback,
        regionKey,
        showRegion,
      ),
      ...describeDiff('SCREEN elements', golden.screen, screen, elementKey, showElement),
      // PAINT ORDER, pinned separately (see ScreenSnapshot). The element diff
      // above is content-keyed and cannot see a reshuffle; the litho outline
      // is drawn deliberately OVER the fills and an audit agent moved it under
      // them with this gate green.
      ...(JSON.stringify(golden.layerOrder ?? []) === JSON.stringify(layerOrder)
        ? []
        : [
            `SCREEN layer order changed:
  frozen: ${JSON.stringify(golden.layerOrder ?? [])}
  now:    ${JSON.stringify(layerOrder)}`,
          ]),
    ]
    expect(lines.join('\n'), `CS1 changed:\n${lines.join('\n')}`).toBe('')
  })

  it('the frozen scene is the one we think it is', { timeout: 60_000 }, () => {
    // A cheap tripwire on the FIXTURE itself: if someone regenerates the input
    // without re-freezing the golden, the counts above would move for a reason
    // that is not a code change at all. Pin the scene's own shape.
    const engine = computeEngineSnapshot()
    expect(engine.regions.length, 'CS1 region count').toBeGreaterThan(300)
    expect(new Set(engine.regions.map((r) => r.gap)).size, 'CS1 gap count').toBe(23)
  })
})
