/**
 * THROWAWAY DIAG (2026-07-16) — CS1 FLIP WALKTHROUGH DUMP (SESSION-8 8h SWEEP).
 *
 * Instruments the FLIPPED partition engine v2 on Cross-section 1 and dumps a JSON the
 * standalone HTML walkthrough renders. As of session 8 the flip is the ruling-8h SIX-PHASE
 * BIDIRECTIONAL SWEEP (per-side, unconditional; ``tileCoherentStack``). It changes NO engine
 * behaviour: it flips ``setTwoSidedTerminations(true)`` (restored in a finally), runs the SAME
 * pipeline ``computeSectionFillV2WithConflicts`` runs internally, and captures the raw
 * ``emitCurves`` output + the sliced regions. Every synthesized curve is tagged with a PHASE
 * (① 0-corr lens closings / ② onlap contours / ③ seams-floods-fill) purely from its id
 * vocabulary + geometry — no emission-site tag is added (the engine is untouched).
 *
 * TIE TAXONOMY (owner fix, 2026-07-16 — he caught a mislabel at x≈456.07). Three truthful
 * families are dumped as distinct edge kinds so the HTML can render them differently:
 *   - ``drawn-tie``   : a drawn ADJACENT correlation edge (a real tie a user placed).
 *   - ``jump-bridge`` : a drawn edge between NON-adjacent columns (the engine's bridge — the
 *                       curve visibly SPANS over intermediate column(s)).
 *   - ``derived-tie`` : an ENGINE-derived tie the user never drew — ruling-8a shared-contact
 *                       (a tie on a unit's top also ties the base of the unit above) + the
 *                       ruling-8d top-band implicit tie. Computed here via the exported
 *                       ``tiedFlags`` / ``derivedBandTies`` / ``topBandTies`` effectiveCorr
 *                       helpers so it matches EXACTLY what the engine's arithmetic sees.
 *
 * Per-gap CASE is captured with the throwaway ``TILEGAP_DIAG`` / ``COHERENT_STACK_DIAG``
 * counters (session 8 rewrote their shape: ``entered`` / ``fired`` / ``fired-converging`` /
 * ``bail-*``), plus the per-gap 2/1/0 corr arithmetic + the TRUE gap width in metres (so the
 * HTML's minimum-pixel-width warp misleads nobody).
 *
 * Run (from desktop/):
 *   $env:CS1_FLIP='1'; npx vitest run src/renderer/src/utils/partitionFillV2.cs1flip_walkthrough.diag.test.ts --disableConsoleIntercept
 *
 * Output: scripts/diag_cs1_flip_walkthrough.json (consumed by scripts/gen_cs1_flip_html.mjs).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type PartitionColumn,
  type SectionRegion,
} from './sectionPartition'
import { computeSectionFillV2WithConflicts } from './partitionFillV2'
import { buildSectionInput } from './partitionFillV2/sectionGeom'
import { emitCurves } from './partitionFillV2/emitCurves'
import {
  effectiveCorrForSide,
  tiedFlags,
  derivedBandTies,
  topBandTies,
} from './partitionFillV2/effectiveCorr'
import { collectGapBands } from './partitionFillV2/emitBands'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
// The tileGap/tileCoherentStack branch counters died with those modules (audit item 7,
// session 36) — they had reported {} since the session-15 hoist anyway. Inline stubs keep
// the dump shape (branchSummary) stable for the HTML generator.
const TILEGAP_DIAG: Record<string, number> = {}
const COHERENT_STACK_DIAG: Record<string, number> = {}
const tileGapDiagReset = (): void => {}
const coherentStackDiagReset = (): void => {}
import { type InputCurve } from './partitionFillV2/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')
// Section selectable via CS_NAME (owner asked for CS2 too, 2026-07-17); the dump filename
// carries a slug so per-section dumps coexist. Default stays CS1 (existing tooling).
const CS_NAME = process.env.CS_NAME ?? 'Cross-section 1'
const CS_SLUG = CS_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'cs1'
const DUMP = resolve(
  REPO_ROOT,
  CS_SLUG === 'crosssection1'
    ? 'scripts/diag_cs1_flip_walkthrough.json'
    : `scripts/diag_${CS_SLUG}_flip_walkthrough.json`,
)

interface RawUnit {
  layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null
}
interface RawCol { investigationId: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection {
  sectionId: string; name: string; columns: RawCol[]; alongM: number[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
}

/**
 * Map a synthesized curve to the owner's ruling-8g phase from its id vocabulary + geometry.
 * The FLIP path (``tileCoherentStack``) emits: seam / slab boundaries = ``closeclose<n>``,
 * onlap contours = ``onlapclose<n>``, floods = ``flood<n>``, enclosed-lens closings =
 * ``close<n>`` (bare). Other paths still fire where the coherent tiler bails: ``lens<n>``
 * (enclosed-lens), ``onlap<n>`` (lone-pinch / shared-contact onlap), ``btfloor``/``btcurtain``
 * (bottom-tie substrate), ``bridge`` (jump-tie), ``bandc`` (matched-pair band contour),
 * ``surface:`` (top band), ``col``/``tie`` (given line art, phase 0).
 *
 * PHASES (owner ruling 8g, verbatim order):
 *   0 = GIVEN line art (column verticals, surface/top band, drawn ties, bridges, band contours)
 *   1 = 0-corr terminations: halfway LENSES (drawn FIRST)
 *   2 = 1-corr terminations: ONLAPS riding their tie (drawn SECOND)
 *   3 = closed-shape fill: seams / floods / substrate floor (drawn LAST)
 */
function phaseOf(id: string): { phase: 0 | 1 | 2 | 3; role: string } {
  // Given line art (phase 0).
  if (id.startsWith('col')) return { phase: 0, role: 'column-vertical' }
  if (id.startsWith('surface:')) return { phase: 0, role: 'top-band (surface curve)' }
  if (id.startsWith('tie')) return { phase: 0, role: 'drawn tie' }
  if (id.startsWith('bridge')) return { phase: 0, role: 'jump-tie bridge' }
  if (id.startsWith('bandc')) return { phase: 0, role: 'matched-pair band contour' }
  // RULING 8d (owner, 2026-07-20): the mismatched-first-unit MIDPOINT SEAM is ruled LINE ART, not
  // fill scaffold — the visible horizontal split between two facing top units (the no-auto-facies
  // divider, e.g. CS1 gap8 ZAND ↔ KLEI). Tagged phase 0 like ``bandc`` so the paint tool draws it;
  // a ``flood`` prefix would classify it phase-3 scaffold and paint would leak across the boundary.
  if (id.startsWith('bandseam')) return { phase: 0, role: 'mismatched-band midpoint seam (8d)' }
  // Phase 1 — 0-corr lens closings. The session-15/16 HOIST vocabulary: the unconditional
  // termination sweep emits ``term<n>`` (0-corr lens closings) and defers sub-TD minorities
  // to ``subtdlens<n>`` — both ARE the owner's generated lens ties (his list of "still not
  // lensing" 2026-07-17 was 42 of these mis-tagged ③ and hidden; render-vocabulary bug, not
  // engine). ``onlapterm`` is caught by the ``onlap`` prefix below. ``rband`` (ruled band
  // contours for 8i-merged units) are given-band line art, phase 0.
  if (id.startsWith('rband')) return { phase: 0, role: 'ruled band contour (8i merge)' }
  if (id.startsWith('subtdlens')) return { phase: 1, role: 'sub-TD lens closing (0-corr, sweep)' }
  if (id.startsWith('term')) return { phase: 1, role: 'termination-sweep lens closing (0-corr)' }
  if (id.startsWith('lens')) return { phase: 1, role: 'enclosed-lens closing (0-corr)' }
  // Phase 2 — 1-corr onlap contours. ``oflank`` is the sweep's SINGLE onlap closing flank
  // (ruling 8i(d), 2026-07-17 — "an onlap is ONE extra line"): the free-contact→apex flank the
  // sweep now draws instead of the old TIED flank + untied bare-``term`` flank pair. It MUST be
  // caught here (phase 2) — before the ``term`` branch above — so it never mis-renders as a
  // phase-1 lens (the §20 defect: the untied ``term`` flank looked like a 0-corr lens). Must
  // precede the generic ``onlap`` check (``oflank`` does not start with ``onlap``).
  if (id.startsWith('oflank')) return { phase: 2, role: 'onlap flank (1-corr, ruling 8i(d) one line)' }
  // Both the flip's ``onlapclose`` and the lone/shared ``onlap`` (gated-off paths) ride the tie.
  if (id.startsWith('onlap')) return { phase: 2, role: 'onlap contour (1-corr, rides tie)' }
  // Phase 3 — closed-shape fill (seams, floods, substrate floor/curtain).
  if (id.startsWith('flood')) return { phase: 3, role: 'flood wedge (enclosing fill)' }
  if (id.startsWith('btfloor')) return { phase: 3, role: 'bottom-tie substrate floor' }
  if (id.startsWith('btcurtain')) return { phase: 3, role: 'bottom-tie substrate curtain' }
  // ``close<n>`` and ``closeclose<n>`` — a seam / slab boundary / lens-or-onlap flank. The
  // flip's per-slab boundaries + the shared seam are ``closeclose``; bare ``close`` is a lens
  // or onlap flank from emitLensClosing / lone-pinch. Both are the closed-shape fill scaffold;
  // classify them phase 3 (fill boundaries) — the phase-1/2 markers above already caught the
  // TRUE lens/onlap contours (``lens``/``onlap`` ids). A ``close`` flank is the geometry that
  // CLOSES a shape, i.e. ruling-8g step 3.
  if (id.startsWith('close')) return { phase: 3, role: 'closing / seam / slab boundary' }
  return { phase: 3, role: 'other closing' }
}

/** Base lithology word (ZAND/SILT/KLEI/VEEN/LEEM/GRIND) from a formation display name. */
function baseLitho(name: string): string {
  const m = name.match(/\b(ZAND|SILT|KLEI|VEEN|LEEM|GRIND|ZAVEL|GYTTJA)\b/i)
  return m ? m[1].toUpperCase() : name.split(/[\s(]/)[0].toUpperCase()
}

function prepare(sec: RawSection): {
  columns: PartitionColumn[]; alongM: number[]; edges: CorrelationEdge[]; investIds: string[]
} {
  const keep = sec.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))
  const alongM = keep.map(({ i }) => sec.alongM[i])
  const investIds = keep.map(({ c }) => c.investigationId)
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  return { columns, alongM, edges, investIds }
}

const round = (x: number): number => Math.round(x * 1000) / 1000

describe('CS1 flip walkthrough dump', () => {
  if (process.env.CS1_FLIP !== '1') {
    it.skip('dormant (set CS1_FLIP=1)', () => {})
    return
  }

  it('dumps CS1 columns / edges / synthesized curves (phase-tagged) with the flip ON', () => {
    expect(existsSync(INPUT)).toBe(true)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]; formationNames: Record<string, string>
    }
    const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)

    const sec = raw.sections.find((s) => s.name.toLowerCase().includes(CS_NAME.toLowerCase()))
    if (!sec) throw new Error(`${CS_NAME} not found in the input`)
    const { columns, alongM, edges, investIds } = prepare(sec)

    // ---- FLIP ON for the whole capture (restored in finally). ----
    const prev = setTwoSidedTerminations(true)
    let curves: InputCurve[]
    let regions: SectionRegion[]
    let engineActiveTies: import('./partitionFillV2/emitCurves').ResolvedTie[] = []
    let engineBridgeGapAnchored: Set<string> = new Set()
    const perGapCase: Record<number, { branch: string; tilegap: Record<string, number>; coherent: Record<string, number> }> = {}
    try {
      const section = buildSectionInput(columns, edges, undefined, alongM)

      // Capture the raw synthesized curves (the SAME emitCurves the wrapper calls). The
      // counters accumulate across ALL gaps in this single call — snapshot the totals.
      tileGapDiagReset()
      coherentStackDiagReset()
      const emitted = emitCurves(section)
      curves = emitted.curves
      engineActiveTies = emitted.activeTies
      engineBridgeGapAnchored = emitted.bridgeGapAnchored
      const totalTilegap = { ...TILEGAP_DIAG }
      const totalCoherent = { ...COHERENT_STACK_DIAG }

      // Sliced regions (the output contract) — the same call the overlay/build consume.
      regions = computeSectionFillV2WithConflicts(columns, edges, undefined, alongM).regions

      // Per-gap branch outcome: re-run emitCurves per-gap is not isolable (it is whole-section),
      // so we reconstruct the per-gap case from (a) the surviving synthesized curves that fall in
      // that gap's x-span and (b) the per-gap 2/1/0 corr arithmetic. The global counters above
      // give the model-wide branch mix (attached to gap -1 as the summary).
      perGapCase[-1] = { branch: 'MODEL-WIDE', tilegap: totalTilegap, coherent: totalCoherent }
    } finally {
      setTwoSidedTerminations(prev)
    }

    // Rebuild the normalised section once more (outside the flip) for column/corr reporting —
    // buildSectionInput is pure and flag-independent, so this matches the captured geometry.
    const section = buildSectionInput(columns, edges, undefined, alongM)
    const nsCols = section.columns

    // ---- Columns dump (normalised geometry, real alongM x). ----
    const colsOut = nsCols.map((c, ci) => ({
      index: ci,
      investigationId: c.investigationId,
      shortId: c.investigationId.slice(0, 8),
      x: round(c.x),
      surfaceElevM: round(c.surfaceElevM),
      units: c.units.map((u) => ({
        layerId: u.layerId,
        formationId: u.formationId,
        formationName: fname(u.formationId),
        litho: baseLitho(fname(u.formationId)),
        topElev: round(u.topElev),
        baseElev: round(u.baseElev),
        bodyId: u.bodyId,
      })),
      enclosedLenses: c.enclosedLenses.map((el) => ({
        litho: baseLitho(fname(el.lens.formationId)),
        topElev: round(el.lens.topElev),
        baseElev: round(el.lens.baseElev),
        matrixLitho: baseLitho(fname(el.matrixFormationId)),
      })),
    }))

    // layerId -> {colIndex, unitIndex, formation, elevs} for edge annotation.
    const layerLoc = new Map<string, { ci: number; ui: number; fid: string; topElev: number; baseElev: number }>()
    nsCols.forEach((c, ci) => c.units.forEach((u, ui) =>
      layerLoc.set(u.layerId, { ci, ui, fid: u.formationId, topElev: u.topElev, baseElev: u.baseElev })))

    // ---- Edges dump: real edges with sides, drawn vs derived, and gap index. ----
    // DRAWN = a direct approved edge between adjacent columns (a tie curve). A jump edge
    // (non-adjacent) is a bridge — flagged separately. DERIVED ties (shared-contact / top band)
    // are NOT in ``edges`` — they are computed by effectiveCorr; we surface them per gap below.
    const edgesOut = edges.map((e) => {
      const la = layerLoc.get(e.a)
      const lb = layerLoc.get(e.b)
      const adjacent = la && lb && Math.abs(la.ci - lb.ci) === 1
      const jump = la && lb && Math.abs(la.ci - lb.ci) > 1
      return {
        a: e.a.slice(0, 8), b: e.b.slice(0, 8), aSide: e.aSide, bSide: e.bSide,
        aCol: la?.ci ?? null, bCol: lb?.ci ?? null,
        aLitho: la ? baseLitho(fname(la.fid)) : null,
        bLitho: lb ? baseLitho(fname(lb.fid)) : null,
        aElev: la ? round(e.aSide === 'base' ? la.baseElev : la.topElev) : null,
        bElev: lb ? round(e.bSide === 'base' ? lb.baseElev : lb.topElev) : null,
        gapIndex: adjacent ? Math.min(la!.ci, lb!.ci) : null,
        kind: adjacent ? 'drawn-tie' : jump ? 'jump-bridge' : 'unresolved',
      }
    })

    // ---- Synthesized curves dump, phase-tagged, with gap membership by x-span. ----
    const colX = nsCols.map((c) => c.x)
    const gapOfX = (x: number): number => {
      for (let gi = 0; gi + 1 < colX.length; gi++) {
        if (x >= colX[gi] - 1e-6 && x <= colX[gi + 1] + 1e-6) return gi
      }
      return -1
    }
    const synthOut = curves
      .filter((c) => c.kind !== 'column-vertical' && !c.id.startsWith('tie'))
      .map((c) => {
        const pts = c.points.map((p) => ({ x: round(p.x), y: round(p.y) }))
        const midX = pts.reduce((s, p) => s + p.x, 0) / pts.length
        const { phase, role } = phaseOf(c.id)
        return { id: c.id, phase, role, gapIndex: gapOfX(midX), points: pts }
      })
    // The given surface + tie curves too (phase 0), kept separate for the "line art" layer.
    const givenOut = curves
      .filter((c) => c.kind === 'column-vertical' || c.id.startsWith('tie') || c.id.startsWith('surface:'))
      .map((c) => {
        const pts = c.points.map((p) => ({ x: round(p.x), y: round(p.y) }))
        const { phase, role } = phaseOf(c.id)
        return { id: c.id, phase, role, points: pts }
      })

    // ---- Per-gap 2/1/0 corr + derived ties + branch case. ----
    // engineActiveTies (from emitCurves) is the ground truth for what a real DRAWN tie
    // resolved to per gap; prefer it over the local reconstruction so the derived-tie
    // arithmetic matches the engine exactly. Fall back to the reconstruction if the engine
    // returned none for a gap (defensive — should not happen on CS1).
    const gaps: Record<number, unknown> = {}
    const allDerivedTies: DerivedTie[] = []
    for (let gi = 0; gi + 1 < nsCols.length; gi++) {
      const L = nsCols[gi]
      const R = nsCols[gi + 1]
      const reconTies = collectActiveTiesForGap(gi, L, R, edges, layerLoc)
      const engineTiesHere = engineActiveTies.filter((t) => t.gapIndex === gi)
      const activeTies = engineTiesHere.length > 0 ? engineTiesHere : reconTies
      const leftCorr = effectiveCorrForSide(gi, 'left', L, R, L, R, activeTies)
      const rightCorr = effectiveCorrForSide(gi, 'right', R, L, L, R, activeTies)
      const bands = collectGapBands(gi, L, R, activeTies)
      const drawnTiesHere = activeTies.length
      const bandCount = bands.length
      const regs = regions.filter((r) => r.gapIndex === gi)
      const trueWidthM = round(R.x - L.x)

      // ---- DERIVED ties (engine-computed, NOT drawn by the user). ----
      // A contact is DERIVED-tied when effectiveCorr's arithmetic ties it WITHOUT a drawn edge
      // endpoint sitting on it: (a) ruling-8a shared-contact — an adjacent same-side same-
      // formation band shares this unit's top/base (``derivedBandTies``); (b) the §4-inc-2
      // derived base-tie a drawn TOP tie sets on the unit ABOVE (``tiedFlags`` sets k-1.base);
      // (c) the ruling-8d TOP-BAND implicit tie on every FIRST unit (``topBandTies``). Each is
      // rendered as a dashed-amber line at the tied contact elevation across the gap.
      const derivedHere = collectDerivedTies(gi, L, R, activeTies, fname)
      for (const dt of derivedHere) allDerivedTies.push(dt)

      // Owner fix (2026-07-16): bare ``close`` flank pairs that CLOSE a terminating unit ARE
      // that unit's generated tie (ruling 8g/8h phases 1-2), not fill scaffold — the id
      // vocabulary alone cannot tell a lens flank from a seam (the col3 bottom-SILT right
      // lens rendered ③-purple and hid behind the fill toggle). Retag by the OWNING unit's
      // side-corr: 0 → ①, 1 → ②; anything unowned stays ③.
      const EPSE = 0.02
      for (const s of synthOut) {
        if (s.gapIndex !== gi || s.phase !== 3) continue
        if (!s.id.startsWith('close') || s.id.startsWith('closeclose')) continue
        const xs = s.points.map((p) => p.x)
        const ys = s.points.map((p) => p.y)
        const xmin = Math.min(...xs)
        const xmax = Math.max(...xs)
        const lo = Math.min(...ys)
        const hi = Math.max(...ys)
        const anchored: { units: typeof L.units; corrTab: typeof leftCorr }[] = []
        // Dump points are mm-rounded; the raw column x is not — allow the rounding error.
        if (Math.abs(xmin - L.x) < 0.005) anchored.push({ units: L.units, corrTab: leftCorr })
        if (Math.abs(xmax - R.x) < 0.005) anchored.push({ units: R.units, corrTab: rightCorr })
        for (const a of anchored) {
          const ui = a.units.findIndex((u) => u.topElev >= hi - EPSE && u.baseElev <= lo + EPSE)
          if (ui < 0) continue
          const corr = a.corrTab[ui]?.corr
          if (corr === 0) {
            s.phase = 1
            s.role = 'lens closing (0-corr flank, corr-retagged)'
          } else if (corr === 1) {
            s.phase = 2
            s.role = 'onlap flank (1-corr, corr-retagged)'
          }
          break
        }
      }

      // Case narrative — truthfully from the corr mix + region shapes in this gap.
      const c = buildCaseNarrative(leftCorr, rightCorr, bandCount, regs)
      gaps[gi] = {
        leftCol: L.investigationId.slice(0, 8),
        rightCol: R.investigationId.slice(0, 8),
        trueWidthM,
        drawnTies: drawnTiesHere,
        derivedTies: derivedHere.length,
        bands: bandCount,
        leftCorr: leftCorr.map((e, ui) => ({ ui, litho: baseLitho(fname(L.units[ui].formationId)), corr: e.corr, topTied: e.topTied, baseTied: e.baseTied })),
        rightCorr: rightCorr.map((e, ui) => ({ ui, litho: baseLitho(fname(R.units[ui].formationId)), corr: e.corr, topTied: e.topTied, baseTied: e.baseTied })),
        regionKinds: regs.map((r) => ({ litho: baseLitho(fname(r.formationId)), kind: r.kind })),
        caption: c.caption,
        warn: c.warn,
        phaseCounts: {
          p1: synthOut.filter((s) => s.gapIndex === gi && s.phase === 1).length,
          p2: synthOut.filter((s) => s.gapIndex === gi && s.phase === 2).length,
          p3: synthOut.filter((s) => s.gapIndex === gi && s.phase === 3).length,
        },
      }
    }

    // Known CS1 residual-violation gaps (design §4 — enclosed-minority ABSENT / untied pairs).
    const knownResidualGaps: Record<number, string> = {
      18: 'untied same-formation pair — needs a tie (ruling-8 retired auto-match residual)',
      19: 'untied same-formation ZAND pair + non-converging deep onlap (known residual)',
      20: 'ZAND minority ABSENT — routeLoneStack skips (enclosing SILT base-edged)',
      21: 'ZAND minority ABSENT — enclosing SILT base-edged, band sweeps the slot',
      22: 'ZAND minority ABSENT — lens edged in the adjacent gap (per-gap extraction wall)',
    }

    // Intervals the SESSION-8 8h per-side sweep newly resolved (owner call-out). The Tie-10
    // g0 ZAND[R]-class shape now lands in CS1 as g5 ZAND[L] + g7 SILT[R] with proper lens/
    // onlap geometry instead of a bailed seam. Keyed by gap for the caption highlight.
    const fixedThisSession: Record<number, string> = {
      5: 'ZAND[L] onlap now rides its tie (8h sweep, this session) — was a converging-facing bail',
      7: 'SILT[R] lens now emitted per-side (8h sweep, this session) — was a converging-facing bail',
    }

    // ---- Lens audit (ruling 8i(e)) — every corr-0 unit-side must carry a phase-1 lens flank.
    // Uses the SAME bridge-fed arithmetic (``engineBridgeGapAnchored``) + a curve-set flank check
    // (mirroring partitionFillV2.lensAudit.diag) so the HTML can flag any miss. present/missing/
    // boundaryResidual match the model-wide gate (this dump is CS1 only).
    const flankPts: { x: number; y: number }[] = []
    for (const c of curves) {
      if (!(c.id.startsWith('term') || c.id.startsWith('subtdlens') || c.id.startsWith('lens'))) continue
      for (const p of c.points) flankPts.push({ x: p.x, y: p.y })
    }
    const at = (px: number, py: number, colX: number, elev: number): boolean =>
      Math.abs(px - colX) < 0.005 && Math.abs(py - elev) < 0.005
    const lensAuditRows: { gap: number; side: string; litho: string; el: number[]; state: string }[] = []
    for (let ci = 0; ci < nsCols.length; ci++) {
      const col = nsCols[ci]
      for (const gi of [ci - 1, ci] as const) {
        if (gi < 0 || gi + 1 >= nsCols.length) continue
        const side: 'left' | 'right' = ci === gi ? 'left' : 'right'
        const facing = side === 'left' ? nsCols[gi + 1] : nsCols[gi]
        const L2 = side === 'left' ? col : facing
        const R2 = side === 'left' ? facing : col
        const corr = effectiveCorrForSide(gi, side, col, facing, L2, R2, engineActiveTies.filter((t) => t.gapIndex === gi), engineBridgeGapAnchored)
        for (let ui = 0; ui < col.units.length; ui++) {
          if ((corr[ui]?.corr ?? 0) !== 0) continue
          const u = col.units[ui]
          const has = flankPts.some((f) => at(f.x, f.y, col.x, u.topElev) || at(f.x, f.y, col.x, u.baseElev))
          const boundary = ui === 0 || ui + 1 >= col.units.length
          lensAuditRows.push({
            gap: gi, side, litho: baseLitho(fname(u.formationId)),
            el: [round(u.baseElev), round(u.topElev)],
            state: has ? 'present' : boundary ? 'boundaryResidual' : 'MISSING',
          })
        }
      }
    }
    const lensAudit = {
      corr0Sides: lensAuditRows.length,
      present: lensAuditRows.filter((r) => r.state === 'present').length,
      missing: lensAuditRows.filter((r) => r.state === 'MISSING').length,
      boundaryResidual: lensAuditRows.filter((r) => r.state === 'boundaryResidual').length,
      rows: lensAuditRows.filter((r) => r.state !== 'present'),
    }

    // ---- Region polygons (the ACTUAL flag-ON fill — what PartitionFillOverlay paints).
    // fraction -> real alongM x inside each gap so the HTML can paint the true partition
    // under the line art (owner ask 2026-07-18: show the filled polygons, not just lines).
    const regionsOut = regions.map((r) => {
      const Lx = nsCols[r.gapIndex]?.x ?? 0
      const Rx = nsCols[r.gapIndex + 1]?.x ?? Lx
      return {
        gapIndex: r.gapIndex,
        litho: baseLitho(fname(r.formationId)),
        kind: r.kind,
        poly: r.polygon.map((p) => [round(Lx + p.fraction * (Rx - Lx)), round(p.elevation)]),
      }
    })

    const dump = {
      generatedFor: `${sec.name} — partition engine v2 FLIP (hoisted sweep, rulings 8i(d)/8j/8k/8i(e))`,
      lensAudit,
      flip: 'setTwoSidedTerminations(true)',
      engine: 'tileCoherentStack (ruling 8h — per-side unconditional: ① lens-L ② lens-R ③ onlap-L ④ onlap-R ⑤⑥ edge close ⑦ little-to-big fill)',
      section: sec.name,
      formationColors: { ZAND: '#eab308', SILT: '#a3e635', KLEI: '#94a3b8', VEEN: '#78350f', LEEM: '#d97706', GRIND: '#f97316' },
      nColumns: nsCols.length,
      alongMRange: [round(Math.min(...colX)), round(Math.max(...colX))],
      columns: colsOut,
      edges: edgesOut,
      derivedTies: allDerivedTies,
      given: givenOut,
      synthesized: synthOut,
      regions: regionsOut,
      gaps,
      knownResidualGaps,
      fixedThisSession,
      branchSummary: perGapCase[-1],
      investIds,
    }
    writeFileSync(DUMP, JSON.stringify(dump, null, 1))

    const nDrawn = edgesOut.filter((e) => e.kind === 'drawn-tie').length
    const nBridge = edgesOut.filter((e) => e.kind === 'jump-bridge').length
    console.log(`\nCS1 flip walkthrough (session-8 8h sweep): ${nsCols.length} cols, ${edges.length} edges, ` +
      `${synthOut.length} synthesized curves (${givenOut.length} given).`)
    console.log(`  ties: ${nDrawn} drawn-adjacent · ${nBridge} jump-bridge · ${allDerivedTies.length} engine-DERIVED (dashed amber)`)
    console.log(`  phase mix: ①=${synthOut.filter((s) => s.phase === 1).length} ` +
      `②=${synthOut.filter((s) => s.phase === 2).length} ③=${synthOut.filter((s) => s.phase === 3).length}`)
    console.log(`  branch (model-wide): ${JSON.stringify(perGapCase[-1]?.coherent)}`)
    console.log(`  dumped -> ${DUMP}`)
    expect(true).toBe(true)
  })
})

/**
 * Reconstruct the gap's ACTIVE (drawn, adjacent) ties as ``ResolvedTie``-shaped records the
 * corr arithmetic consumes — mirroring ``emitCurves.resolveTies`` for a single gap so the
 * per-gap 2/1/0 report matches what the engine computed. Only DRAWN adjacent edges become
 * ties (jump edges are bridges, handled separately by the engine).
 */
function collectActiveTiesForGap(
  gi: number,
  L: { units: { layerId: string; topElev: number; baseElev: number }[]; x: number },
  R: { units: { layerId: string; topElev: number; baseElev: number }[]; x: number },
  edges: readonly CorrelationEdge[],
  layerLoc: Map<string, { ci: number; ui: number; fid: string; topElev: number; baseElev: number }>,
): import('./partitionFillV2/emitCurves').ResolvedTie[] {
  const out: import('./partitionFillV2/emitCurves').ResolvedTie[] = []
  let seq = 0
  for (const e of edges) {
    const la = layerLoc.get(e.a)
    const lb = layerLoc.get(e.b)
    if (!la || !lb) continue
    if (Math.abs(la.ci - lb.ci) !== 1) continue
    const lo = Math.min(la.ci, lb.ci)
    if (lo !== gi) continue
    const leftLoc = la.ci < lb.ci ? la : lb
    const rightLoc = la.ci < lb.ci ? lb : la
    const leftSide = (la.ci < lb.ci ? e.aSide : e.bSide) ?? 'top'
    const rightSide = (la.ci < lb.ci ? e.bSide : e.aSide) ?? 'top'
    out.push({
      gapIndex: gi,
      left: { x: L.x, y: leftSide === 'top' ? leftLoc.topElev : leftLoc.baseElev },
      right: { x: R.x, y: rightSide === 'top' ? rightLoc.topElev : rightLoc.baseElev },
      leftSide: leftSide as 'top' | 'base',
      rightSide: rightSide as 'top' | 'base',
      leftUnitIndex: leftLoc.ui,
      rightUnitIndex: rightLoc.ui,
      id: `tie${seq++}:${gi}`,
    })
  }
  return out
}

/** Minimal column shape the derived-tie collector needs (formation + elevations per unit). */
interface DerivedTieColumn {
  x: number
  units: { formationId: string; topElev: number; baseElev: number }[]
}

/** One engine-derived (not drawn) tie record for the HTML's dashed-amber layer. */
interface DerivedTie {
  gapIndex: number
  source: 'shared-contact' | 'derived-base' | 'top-band'
  side: 'left' | 'right'
  ui: number
  contact: 'top' | 'base'
  litho: string
  points: { x: number; y: number }[]
}

/**
 * Collect the ENGINE-DERIVED ties for one gap — the ties effectiveCorr's arithmetic infers
 * WITHOUT a drawn edge sitting on the contact. Rendered dashed-amber by the HTML so they read
 * as "computed by the engine, not by you". Three owner-ruled sources, all from the exported
 * effectiveCorr helpers so this matches the engine's own tie counting exactly:
 *
 *   - ruling-8a SHARED CONTACT (``derivedBandTies``): an adjacent same-side same-formation band
 *     shares this unit's top (band above) or base (band below) contact.
 *   - §4-inc-2 DERIVED BASE-TIE (``tiedFlags``): a drawn TOP tie on unit k also ties k-1's base;
 *     that base-tie is derived (the user drew the top of k, not the base of k-1).
 *   - ruling-8d TOP-BAND implicit tie (``topBandTies``): every FIRST unit's TOP is tied by the
 *     top-band polyline that spans every gap.
 *
 * Each derived tie is a line at the tied contact elevation from L.x to R.x (the same elevation
 * on both facing columns when they share the contact; the top-band line uses each column's own
 * first-unit top). A derived source is emitted only when NO drawn tie already sits on that exact
 * (side, unit) — otherwise it is a drawn tie, not derived.
 */
function collectDerivedTies(
  gi: number,
  L: DerivedTieColumn,
  R: DerivedTieColumn,
  activeTies: readonly import('./partitionFillV2/emitCurves').ResolvedTie[],
  fname: (id: string) => string,
): DerivedTie[] {
  const out: DerivedTie[] = []
  const litho = (name: string): string => baseLitho(fname(name))
  // Direct drawn-tie contacts per side/unit — so we exclude drawn ties from the derived set.
  const drawn = new Set<string>()
  for (const t of activeTies) {
    if (t.gapIndex !== gi) continue
    drawn.add(`left|${t.leftUnitIndex}|${t.leftSide}`)
    drawn.add(`right|${t.rightUnitIndex}|${t.rightSide}`)
  }
  const corrCol = (c: DerivedTieColumn): { units: { formationId: string }[] } => ({
    units: c.units.map((u) => ({ formationId: u.formationId })),
  })
  const yOf = (c: DerivedTieColumn, ui: number, contact: 'top' | 'base'): number =>
    contact === 'top' ? c.units[ui].topElev : c.units[ui].baseElev

  for (const [side, col, facing] of [
    ['left', L, R] as const,
    ['right', R, L] as const,
  ]) {
    const flags = tiedFlags(gi, side, col.units.length, activeTies)
    for (let ui = 0; ui < col.units.length; ui++) {
      const shared = derivedBandTies(gi, side, ui, corrCol(col), corrCol(facing), activeTies)
      // (a) ruling-8a shared contact — top or base shared with an adjacent same-formation band.
      for (const contact of ['top', 'base'] as const) {
        const isShared = contact === 'top' ? shared.topShared : shared.baseShared
        if (!isShared) continue
        if (drawn.has(`${side}|${ui}|${contact}`)) continue
        const y = yOf(col, ui, contact)
        out.push({
          gapIndex: gi, source: 'shared-contact', side, ui, contact,
          litho: litho(col.units[ui].formationId),
          points: [{ x: round(L.x), y: round(y) }, { x: round(R.x), y: round(y) }],
        })
      }
      // (b) §4-inc-2 derived base-tie: flags[ui].base set with no drawn base tie on it. This is
      // the base a drawn top-tie on the unit BELOW ties — geometrically it is the unit's own base
      // contact across the gap (the drawn tie sits on the next unit's top, same elevation).
      if (flags[ui].base && !drawn.has(`${side}|${ui}|base`) && !shared.baseShared) {
        const y = yOf(col, ui, 'base')
        out.push({
          gapIndex: gi, source: 'derived-base', side, ui, contact: 'base',
          litho: litho(col.units[ui].formationId),
          points: [{ x: round(L.x), y: round(y) }, { x: round(R.x), y: round(y) }],
        })
      }
      // (c) ruling-8d top-band implicit tie on the FIRST unit's TOP (uses each column's own top).
      if (topBandTies(ui) && !drawn.has(`${side}|${ui}|top`)) {
        // One top-band line per gap (emit on the LEFT pass only) spanning L→R at each own top.
        if (side === 'left') {
          out.push({
            gapIndex: gi, source: 'top-band', side, ui, contact: 'top',
            litho: litho(col.units[ui].formationId),
            points: [
              { x: round(L.x), y: round(yOf(L, 0, 'top')) },
              { x: round(R.x), y: round(yOf(R, 0, 'top')) },
            ],
          })
        }
      }
    }
  }
  return out
}

/** A short, truthful case caption from the gap's corr mix + region shapes. */
function buildCaseNarrative(
  leftCorr: readonly { corr: 0 | 1 | 2 }[],
  rightCorr: readonly { corr: 0 | 1 | 2 }[],
  bandCount: number,
  regs: readonly SectionRegion[],
): { caption: string; warn: boolean } {
  const nLens = regs.filter((r) => r.kind === 'lens').length
  const nQuad = regs.filter((r) => r.kind === 'quad').length
  const nPinch = regs.filter((r) => r.kind === 'pinch').length
  const zeros = [...leftCorr, ...rightCorr].filter((e) => e.corr === 0).length
  const ones = [...leftCorr, ...rightCorr].filter((e) => e.corr === 1).length
  const twos = [...leftCorr, ...rightCorr].filter((e) => e.corr === 2).length
  const parts: string[] = []
  if (bandCount > 0) parts.push(`${bandCount} matched band${bandCount > 1 ? 's' : ''} (2-corr → given)`)
  if (zeros > 0) parts.push(`${zeros} lens${zeros > 1 ? 'es' : ''} ①`)
  if (ones > 0) parts.push(`${ones} onlap${ones > 1 ? 's' : ''} ②`)
  parts.push(`fill ③ → ${nQuad}q/${nPinch}p/${nLens}L`)
  const summary = `corr 2/1/0 = ${twos}/${ones}/${zeros}. ${parts.join(', ')}.`
  return { caption: summary, warn: false }
}
