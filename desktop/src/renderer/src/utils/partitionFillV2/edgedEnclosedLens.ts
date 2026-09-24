/**
 * partitionFillV2/edgedEnclosedLens.ts — PER-GAP enclosed-lens extraction for the EDGED minority
 * (ruling 8v, "2/1/0 is the skeleton — 0 ties is ALWAYS a lens"; design partition-engine-v2.md §4
 * FINAL-SHAPES / §8 8v).
 *
 * THE CASE. A same-formation-enclosed minority that is TIED (edged) toward ONE neighbour and
 * UN-TIED toward the other — the owner's S22 lower sand: silt above + silt below on its own column,
 * a top tie to the right band column (2-corr → BAND right), zero ties toward the shallow left column
 * (0-corr → must LENS left, ruling 8v). The section-wide ``extractEnclosedLenses`` (``sectionGeom``)
 * SKIPS it: the minority is edged section-wide, so ``!edgedLayerIds.has(lens.layerId)`` fails and it
 * is never a lens anywhere; the flag-ON termination sweep then emits its left-gap lens flank but the
 * enclosing SILT flood ABSORBS the notch (no continuous annulus — the ``splitAnnulus``-bypass wall).
 *
 * THE FIX (per-gap). Extract the minority as an enclosed lens exactly as the ordinary path does —
 * merge the enclosing matrix into ONE continuous band so the lens is a real interior HOLE — but:
 *   - the merge SPLICES the ``below`` enclosing unit (grows ``above`` down over the lens), so an
 *     edged ``below``'s tie resolves through ``rawLayerContacts`` (ruling 8r) at the elevation the
 *     owner drew, and the TIED gap's band survives byte-identically in shape-family;
 *   - the lens carries ``emitGaps`` = ONLY the UN-TIED adjacent gaps, so ``emitEnclosedLensCurves``
 *     draws its flank (and ``collectEnclosedLensDiamonds`` its detour) THERE and nowhere else; in
 *     the TIED gap the ties + the ``col:lens`` column-vertical seed close a band by construction.
 *
 * "Un-tied in gap g" is BOTH: the minority is not an endpoint of a tie resolving to gap g
 * (``EdgedLayers.inGap``), AND neither of its own contacts rides a tie endpoint resolving to gap g
 * (the ruling-8a shared-contact guard, made per-gap). A minority un-tied in EVERY adjacent gap was
 * already taken by the ordinary path (it is not edged) — this pass only ever fires for a minority
 * that is edged/tied in SOME adjacent gap and free in another, so it never perturbs the ordinary
 * enclosed-lens cases.
 *
 * Flag-gated at the call site (``buildSectionInput`` runs it only under the two-sided-terminations
 * flag) and additive: a section with no edged-enclosed minority is byte-identical.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { buildEdgedLayers } from './edgedLayers'
import { type ColumnGeom, type EnclosedLens, type RawLayerContact, type UnitGeom } from './sectionGeom'
import { type CorrelationEdge } from '../sectionPartition'

/** Snap tolerance (metres) for matching a minority contact to a tie-endpoint elevation. */
const TIE_CONTACT_SNAP_M = 1e-6

/**
 * Per-(surviving column, gap) set of tie-endpoint contact ELEVATIONS.
 *
 * Built from the approved edges over the RAW picked contacts (``rawLayerContacts`` — the elevation
 * the owner drew, before any merge), bucketed by the gap the tie resolves to. A minority whose own
 * top or base coincides with an entry in ``get(colIndex, gap)`` is 8a-tied in that gap and must band
 * there, not lens.
 */
interface TieContactsByGap {
  get: (colIndex: number, gapIndex: number) => ReadonlySet<number>
}

/**
 * Build the per-(surviving column, gap) tie-contact-elevation view.
 *
 * Parameters
 * ----------
 * edges : readonly CorrelationEdge[]
 *     Approved correlation edges (side-aware).
 * rawLayerContacts : ReadonlyMap<string, RawLayerContact>
 *     Every RAW picked unit's surviving column index + top/base elevation (``sectionGeom``).
 *
 * Returns
 * -------
 * TieContactsByGap
 *     ``get(colIndex, gapIndex)`` → the tie-endpoint elevations on that column resolving to that gap.
 */
function buildTieContactsByGap(
  edges: readonly CorrelationEdge[],
  rawLayerContacts: ReadonlyMap<string, RawLayerContact>,
): TieContactsByGap {
  // colIndex -> gapIndex -> set of tie-endpoint contact elevations.
  const table = new Map<number, Map<number, Set<number>>>()
  const add = (colIndex: number, gapIndex: number, elev: number): void => {
    let byGap = table.get(colIndex)
    if (!byGap) {
      byGap = new Map<number, Set<number>>()
      table.set(colIndex, byGap)
    }
    let set = byGap.get(gapIndex)
    if (!set) {
      set = new Set<number>()
      byGap.set(gapIndex, set)
    }
    set.add(elev)
  }
  const elevOf = (raw: RawLayerContact, side: 'top' | 'base'): number =>
    side === 'top' ? raw.topElev : raw.baseElev
  for (const e of edges) {
    const ra = rawLayerContacts.get(e.a)
    const rb = rawLayerContacts.get(e.b)
    if (!ra || !rb) continue
    // Only an ADJACENT-column edge resolves to a single gap (the same test ``resolveTies`` and
    // ``buildEdgedLayers`` use). A jump edge becomes a substrate bridge and ties no single gap here.
    if (Math.abs(ra.colIndex - rb.colIndex) !== 1) continue
    const gapIndex = Math.min(ra.colIndex, rb.colIndex)
    add(ra.colIndex, gapIndex, elevOf(ra, e.aSide ?? 'top'))
    add(rb.colIndex, gapIndex, elevOf(rb, e.bSide ?? 'top'))
  }
  return {
    get: (colIndex, gapIndex) => table.get(colIndex)?.get(gapIndex) ?? EMPTY,
  }
}

const EMPTY: ReadonlySet<number> = new Set<number>()

/**
 * Extract EDGED same-formation-enclosed minorities per gap across a resolved section, IN PLACE.
 *
 * Runs AFTER ``sectionGeom.buildSectionInput`` has assembled every column (so surviving indices +
 * x are known) and AFTER the ordinary ``extractEnclosedLenses`` (so any un-edged minority is already
 * a lens and gone from the stack). For each column it finds a same-formation-enclosed minority that
 * is UN-TIED in at least one adjacent gap but TIED in another, merges its enclosing matrix (growing
 * ``above`` down, splicing the lens + ``below``), and records the lens with ``emitGaps`` = the
 * un-tied adjacent gaps.
 *
 * Parameters
 * ----------
 * columns : ColumnGeom[]
 *     The resolved columns (mutated in place — each column's ``units`` may lose the lens + its
 *     ``below`` matrix unit, and its ``enclosedLenses`` gains the recorded lens).
 * edges : readonly CorrelationEdge[]
 *     Approved correlation edges.
 * rawLayerContacts : ReadonlyMap<string, RawLayerContact>
 *     Raw picked contacts, captured pre-merge (for the per-gap tie-contact view + tie resolution).
 */
export function extractPerGapEnclosedLenses(
  columns: ColumnGeom[],
  edges: readonly CorrelationEdge[],
  rawLayerContacts: ReadonlyMap<string, RawLayerContact>,
): void {
  if (columns.length < 2) return
  const edged = buildEdgedLayers(columns, edges)
  const tieContacts = buildTieContactsByGap(edges, rawLayerContacts)
  const sameFormationTie = buildSameFormationTieGaps(edges, rawLayerContacts)

  for (let ci = 0; ci < columns.length; ci++) {
    const units = columns[ci].units
    // Adjacent gaps this column faces: the gap to its left (ci-1) and to its right (ci).
    const adjGaps: number[] = []
    if (ci - 1 >= 0) adjGaps.push(ci - 1)
    if (ci + 1 < columns.length) adjGaps.push(ci)
    if (adjGaps.length === 0) continue

    // Is ``lens`` un-tied toward gap ``g`` — neither an edge endpoint resolving to g, nor a contact
    // riding a tie endpoint resolving to g (the per-gap ruling-8a shared-contact guard)?
    const untiedInGap = (lens: UnitGeom, g: number): boolean => {
      if (edged.inGap(lens.layerId, g)) return false
      const tied = tieContacts.get(ci, g)
      for (const e of tied) {
        if (Math.abs(lens.topElev - e) < TIE_CONTACT_SNAP_M) return false
        if (Math.abs(lens.baseElev - e) < TIE_CONTACT_SNAP_M) return false
      }
      return true
    }

    let changed = true
    while (changed) {
      changed = false
      for (let k = 1; k + 1 < units.length; k++) {
        const above = units[k - 1]
        const lens = units[k]
        const below = units[k + 1]
        // Same-formation enclosure (a genuine matrix wrap), the minority a different formation.
        if (above.formationId !== below.formationId) continue
        if (above.formationId === lens.formationId) continue
        // The gaps this minority is UN-TIED toward (0-tie → a lens by ruling 8v), and the rest (tied).
        const untiedGaps = adjGaps.filter((g) => untiedInGap(lens, g))
        const tiedGaps = adjGaps.filter((g) => !untiedGaps.includes(g))
        // Fire ONLY for the edged case: un-tied in SOME adjacent gap but NOT all. A minority un-tied
        // in EVERY adjacent gap was already taken by the ordinary ``extractEnclosedLenses`` (it is not
        // edged); a minority tied in every adjacent gap bands both ways (ruling 8a) and is left alone.
        if (untiedGaps.length === 0 || tiedGaps.length === 0) continue
        // The untied gap the lens is EMITTED into must be ABOVE the facing column's TD (the lens's top
        // sits above the facing's deepest base). A minority entirely BELOW the facing TD is a SUB-TD
        // lens owned by ``emitSubTdLenses`` + the deep-to-deep substrate (which span gaps), NOT this
        // above-TD enclosed-lens path — extracting one here perturbs that substrate non-locally (col-7
        // sub-TD minorities overpainted col-9's drilled ZAND in gap 8). The S22 sand STRADDLES the
        // facing TD (top −1.79 above S1's −4.32), so it stays an above-TD enclosed lens. If no untied
        // gap is above-TD, leave the minority for the sub-TD machinery (do not splice it).
        const facingTd = (g: number): number => {
          const facing = columns[g === ci ? g + 1 : g]
          let td = Infinity
          for (const u of facing.units) if (u.baseElev < td) td = u.baseElev
          return td
        }
        // The enclosing MATRIX must itself BAND across each emit gap — i.e. an enclosing unit
        // (``above`` or ``below``, both the matrix formation) carries a DIRECT same-formation tie
        // there. Only then is the matrix a continuous band across the untied gap and the lens a clean
        // interior HOLE (``shouldEmitLens`` case 1). Without it (an interbedded ZAND/SILT comb whose
        // enclosing ZAND has no same-formation tie in the untied gap — CS1 gap22 col-22), the merge
        // grows a matrix that does NOT band, opening holes in the tied-gap session-24 annulus next to
        // it. S22's enclosing SILT bands in gap 0 (lay-003 ↔ lay-009), so it stays in.
        const matrixBandsInGap = (g: number): boolean =>
          (sameFormationTie.get(above.layerId)?.has(g) ?? false) ||
          (sameFormationTie.get(below.layerId)?.has(g) ?? false)
        const emitGaps = untiedGaps.filter(
          (g) => lens.topElev > facingTd(g) + TIE_CONTACT_SNAP_M && matrixBandsInGap(g),
        )
        if (emitGaps.length === 0) continue
        // SAFETY GATE — only the ISOLATED same-formation-tied minority (the S22 sand: sand↔sand top
        // tie). In EVERY tied adjacent gap the minority must carry a DIRECT tie to its OWN formation,
        // so that gap is a guaranteed same-formation band (ruling 8g(b)/8j: two same-formation onlaps
        // meeting a tie merge into one body) that survives the merge intact. This deliberately EXCLUDES
        // the interbedded-stack minority (a thin unit tied to a DIFFERENT facing formation inside a
        // KLEI/SILT/KLEI/ZAND/KLEI comb), where the greedy merge cascades and the enclosing matrix
        // floods the drilled unit's slot in the tied gap (a ground-truth overpaint) — that class is the
        // multi-increment two-sided-terminations restructuring §4 documents as STOPPED WITH GEOMETRY.
        if (!tiedGaps.every((g) => sameFormationTie.get(lens.layerId)?.has(g))) continue
        // The KEPT ``below`` matrix unit must NOT itself carry a same-formation tie: the minimal merge
        // grows ``above`` down to abut ``below`` (both the matrix formation), so if ``below`` bands via
        // its own same-formation tie the abutted run reads as ONE full-width matrix band — a shape the
        // 2/1/0 conformance gate flags (a corr-1 ``below`` rendering band, CS1 gap11 SILT ``lay-080``
        // tied to col-11 SILT). The S22 ``below`` (SILT ``lay-011``) ties to SAND (a DIFFERENT
        // formation), so it does not band and stays in. A same-formation-tied ``below`` is the
        // interbedded class the two-sided restructuring owns (§4 STOPPED WITH GEOMETRY).
        if (adjGaps.some((g) => sameFormationTie.get(below.layerId)?.has(g))) continue
        // MINIMAL merge: grow ``above`` DOWN over the LENS ONLY (to the lens base) and splice ONLY the
        // lens — ``below`` (the second enclosing matrix unit) is KEPT with its own identity + ties. This
        // still makes the matrix band continuous over the lens interval (so ``emitColumnVerticals``
        // emits the ``col:lens`` seed and the lens is a real HOLE), but it does NOT grow the matrix over
        // a tied ``below`` unit — which would splice that unit's own tie/band out of the guard's view
        // and flood the TIED gap full-width. ``above`` and ``below`` now abut at the lens base (both the
        // same formation), which the arrangement traces as one continuous matrix face. ``above``'s own
        // top tie is unmoved (only its base grows), so the UNTIED gap's enclosing band keeps its anchor.
        // STACKED LENSES (owner 2026-09-23, section "test" GEO-08/118-S8: a clay/silt comb whose silt
        // is tied toward one neighbour only). The section-wide walk may have welded this minority
        // from raw pieces around lenses of the MATRIX formation (the inner clays pulled as lenses in
        // silt, the silts merged into one run). Toward the emit gaps that run is a lens in the matrix
        // and comes apart into its raw pieces — each a lens at its own level — while the lenses
        // nested inside it are the matrix's own material there: they are emitted only where the run
        // bands (the tied gaps). Toward the tied gaps nothing changes. Without this the run was one
        // silt diamond cut by nested clay lenses, and the host's raw split cut at those nested
        // intervals — phantom clay pieces exactly where the silt is.
        const pieces = lens.rawPieces ?? [lens]
        for (const el of columns[ci].enclosedLenses) {
          if (
            el.matrixFormationId === lens.formationId &&
            el.lens.topElev <= lens.topElev + TIE_CONTACT_SNAP_M &&
            el.lens.baseElev >= lens.baseElev - TIE_CONTACT_SNAP_M
          ) {
            el.emitGaps = new Set(tiedGaps.filter((g) => el.emitGaps === undefined || el.emitGaps.has(g)))
          }
        }
        for (const piece of pieces) {
          columns[ci].enclosedLenses.push({
            lens: { ...piece },
            matrixFormationId: above.formationId,
            emitGaps: new Set(emitGaps),
          })
        }
        above.baseElev = lens.baseElev
        units.splice(k, 1) // remove ONLY the lens; ``below`` survives at k with its ties intact
        changed = true
        break
      }
    }
  }
}

/**
 * Per-layerId set of gaps where that layer has a DIRECT tie to a facing unit of its OWN formation.
 *
 * The extraction's safety gate (only the isolated same-formation-tied minority) reads this: a minority
 * whose tied gap carries a same-formation tie is a guaranteed same-formation band there (8g(b)/8j), so
 * the per-gap merge keeps that band. Built from the raw contacts (formation + surviving column index).
 */
function buildSameFormationTieGaps(
  edges: readonly CorrelationEdge[],
  rawLayerContacts: ReadonlyMap<string, RawLayerContact>,
): Map<string, Set<number>> {
  const byLayer = new Map<string, Set<number>>()
  const add = (layerId: string, gapIndex: number): void => {
    let s = byLayer.get(layerId)
    if (!s) {
      s = new Set<number>()
      byLayer.set(layerId, s)
    }
    s.add(gapIndex)
  }
  for (const e of edges) {
    const ra = rawLayerContacts.get(e.a)
    const rb = rawLayerContacts.get(e.b)
    if (!ra || !rb) continue
    if (Math.abs(ra.colIndex - rb.colIndex) !== 1) continue // adjacent-gap tie only
    if (ra.formationId !== rb.formationId) continue // same formation on both ends
    const gapIndex = Math.min(ra.colIndex, rb.colIndex)
    add(e.a, gapIndex)
    add(e.b, gapIndex)
  }
  return byLayer
}
