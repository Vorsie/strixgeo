/**
 * oracle210.ts — the owner's 2/1/0 rule as a PLAIN WALK, no geometry.
 *
 * Owner, 2026-09-06 (verbatim): "Take the first two columns, look at the first litho on the
 * left (how many correlations does it have on the left?) 2: do nothing, 1: emit onlap
 * constructor, 0: emit lens constructor, do the same for the right side. If onlap, follow the
 * onlap and check if it is the same (and if it isn't the outermost left test, you don't have
 * to check left because you already checked it before in the previous two tests). Now do this
 * for all lithos, check the right side of the test. Go to the second test, do the left side of
 * the test, do the right side of the test, continue until everything on the CS is checked."
 *
 * This module does EXACTLY that walk and NOTHING ELSE — no polygons, no faces, no flood, no
 * bridges, no top-band. It is the INDEPENDENT ORACLE the engine's ``effectiveCorr`` is checked
 * against (``oracle210.conformance.test.ts``): where the two disagree, the oracle is the owner's
 * rule and the engine's extra machinery (top band, jump-tie bridges, the asymmetric derived-base
 * convention) is what must justify itself.
 *
 * Tie counting — the LITERAL count of a unit's two contacts, symmetric on a shared contact.
 * A unit has a TOP contact (its ``topElev``) and a BASE contact (its ``baseElev``). A contact
 * "has a correlation toward the neighbour on a side" when an approved edge draws a line on that
 * physical contact to a layer in the ADJACENT column on that side. Because the base of one unit
 * is the top of the next, a single line on that shared surface ties BOTH units meeting there
 * (owner ruling 8a, expressed as the plain geometry the owner sees on screen) — so ties are
 * counted by CONTACT ELEVATION on the column, not by which layerId the edge happened to name.
 *
 * NOT counted (deliberately — these are not in the owner's Part-A words; the conformance test
 * reports where the engine adds them and names the ruling):
 *   - the implicit TOP BAND on a first unit (ruling 5-revised / 8d);
 *   - JUMP-TIE bridges to a non-adjacent column (ruling 8i(e)) — a tie is only "the neighbour's"
 *     when it lands on the immediately adjacent test;
 *   - the engine's asymmetric derived-base convention (a top tie propagates up but a base tie
 *     does not propagate down, §4 increment-2) — the oracle is symmetric on the shared contact.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type CorrelationEdge, type PartitionColumn } from '../sectionPartition'

/** Snap tolerance (metres) for matching an edge endpoint to a contact elevation on a column. */
const CONTACT_SNAP_M = 1e-6

/** Which side of a test faces a gap: its left neighbour or its right neighbour. */
export type SideName = 'left' | 'right'

/** The owner's outcome for one side of one litho. */
export type Outcome210 = 'band' | 'onlap' | 'lens' | 'edge-of-section'

/** The rule's verdict for one unit toward one neighbour. */
export interface OracleSide {
  /** How many of the unit's two contacts carry a correlation toward this neighbour (0, 1 or 2). */
  tieCount: 0 | 1 | 2
  /** 2 -> band (do nothing), 1 -> onlap, 0 -> lens, or edge-of-section when there is no neighbour. */
  outcome: Outcome210
  /** For an ONLAP: the neighbour layer the single tie lands on ("follow the onlap"), else null. */
  partnerLayerId: string | null
  /** That partner's formation, else null. */
  partnerFormationId: string | null
  /** For an ONLAP: whether the partner is the SAME litho ("check if it is the same"), else null. */
  sameUnit: boolean | null
}

/** One litho in the walk, with its verdict on each side. */
export interface OracleUnit {
  layerId: string
  formationId: string
  left: OracleSide
  right: OracleSide
}

/** One test (column) in the walk. */
export interface OracleColumn {
  investigationId: string
  units: OracleUnit[]
}

/** A located contact endpoint: the surviving column index + the contact elevation on it. */
interface EndpointLoc {
  colIndex: number
  elev: number
}

/** Drop empty columns — the walk sees only tests that carry litho (mirrors the engine's normalise). */
function nonEmptyColumns(columns: readonly PartitionColumn[]): PartitionColumn[] {
  return columns.filter((c) => c.units.length > 0)
}

/**
 * Locate every layerId's TOP and BASE contact elevation on its surviving column. A layerId is
 * unique across the section (it is a ``litho_layer.id``), so one map answers both edge endpoints.
 */
function locateContacts(columns: readonly PartitionColumn[]): {
  top: Map<string, EndpointLoc>
  base: Map<string, EndpointLoc>
} {
  const top = new Map<string, EndpointLoc>()
  const base = new Map<string, EndpointLoc>()
  for (let ci = 0; ci < columns.length; ci++) {
    const c = columns[ci]
    for (const u of c.units) {
      top.set(u.layerId, { colIndex: ci, elev: c.surfaceElevM - u.topDepthM })
      base.set(u.layerId, { colIndex: ci, elev: c.surfaceElevM - u.baseDepthM })
    }
  }
  return { top, base }
}

/** The contact elevation an edge endpoint (layerId + side) sits at, or null if the layer is absent. */
function endpointLoc(
  layerId: string,
  side: 'top' | 'base' | undefined,
  contacts: { top: Map<string, EndpointLoc>; base: Map<string, EndpointLoc> },
): EndpointLoc | null {
  return (side === 'base' ? contacts.base : contacts.top).get(layerId) ?? null
}

/**
 * One correlation the walk can follow: a contact elevation on the near column tied to a partner
 * layer on the adjacent column on ``side``.
 */
interface TiedContact {
  /** The contact elevation on the near column that carries the line. */
  elev: number
  /** The neighbour side this tie reaches. */
  side: SideName
  /** The partner layer on the neighbour column. */
  partnerLayerId: string
}

/**
 * Build, per surviving column index, the correlations that land on ADJACENT columns. Each edge
 * whose two endpoints sit on neighbouring columns contributes a ``TiedContact`` on BOTH columns
 * (the near column toward the far side, and the far column toward the near side). Non-adjacent
 * (jump-tie) edges are skipped — they are not "the neighbour's" correlation in the owner's walk.
 */
function tiedContactsByColumn(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
): Map<number, TiedContact[]> {
  const contacts = locateContacts(columns)
  const byCol = new Map<number, TiedContact[]>()
  const add = (colIndex: number, tc: TiedContact): void => {
    let list = byCol.get(colIndex)
    if (!list) {
      list = []
      byCol.set(colIndex, list)
    }
    list.push(tc)
  }
  for (const e of edges) {
    const aLoc = endpointLoc(e.a, e.aSide, contacts)
    const bLoc = endpointLoc(e.b, e.bSide, contacts)
    if (!aLoc || !bLoc) continue
    if (Math.abs(aLoc.colIndex - bLoc.colIndex) !== 1) continue // only immediately-adjacent tests
    const aSideToB: SideName = bLoc.colIndex > aLoc.colIndex ? 'right' : 'left'
    const bSideToA: SideName = aSideToB === 'right' ? 'left' : 'right'
    add(aLoc.colIndex, { elev: aLoc.elev, side: aSideToB, partnerLayerId: e.b })
    add(bLoc.colIndex, { elev: bLoc.elev, side: bSideToA, partnerLayerId: e.a })
  }
  return byCol
}

/** Whether a contact elevation carries a correlation toward ``side`` (within the snap tolerance). */
function contactTied(ties: readonly TiedContact[], elev: number, side: SideName): boolean {
  for (const t of ties) if (t.side === side && Math.abs(t.elev - elev) < CONTACT_SNAP_M) return true
  return false
}

/** The partner layer a single-contact onlap follows (the first tie on that contact toward ``side``). */
function partnerForContact(
  ties: readonly TiedContact[],
  elev: number,
  side: SideName,
): string | null {
  for (const t of ties) if (t.side === side && Math.abs(t.elev - elev) < CONTACT_SNAP_M) return t.partnerLayerId
  return null
}

/** Resolve one unit's verdict toward one neighbour side. ``hasNeighbour`` false -> edge-of-section. */
function resolveSide(
  topElev: number,
  baseElev: number,
  ties: readonly TiedContact[],
  side: SideName,
  hasNeighbour: boolean,
  ownFormationId: string,
  formationByLayer: ReadonlyMap<string, string>,
): OracleSide {
  if (!hasNeighbour) {
    return { tieCount: 0, outcome: 'edge-of-section', partnerLayerId: null, partnerFormationId: null, sameUnit: null }
  }
  const topTied = contactTied(ties, topElev, side)
  const baseTied = contactTied(ties, baseElev, side)
  const tieCount = ((topTied ? 1 : 0) + (baseTied ? 1 : 0)) as 0 | 1 | 2
  if (tieCount === 2) {
    return { tieCount, outcome: 'band', partnerLayerId: null, partnerFormationId: null, sameUnit: null }
  }
  if (tieCount === 0) {
    return { tieCount, outcome: 'lens', partnerLayerId: null, partnerFormationId: null, sameUnit: null }
  }
  // Exactly one tie -> an onlap. Follow it: which neighbour layer, and is it the same litho?
  const contactElev = topTied ? topElev : baseElev
  const partnerLayerId = partnerForContact(ties, contactElev, side)
  const partnerFormationId = partnerLayerId ? (formationByLayer.get(partnerLayerId) ?? null) : null
  const sameUnit = partnerFormationId !== null ? partnerFormationId === ownFormationId : null
  return { tieCount, outcome: 'onlap', partnerLayerId, partnerFormationId, sameUnit }
}

/**
 * Walk the whole cross-section by the owner's 2/1/0 rule and return, for every test, for every
 * litho, its verdict on the left and the right side.
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     The section's tests, left-to-right (empty ones are dropped, mirroring the engine).
 * edges : readonly CorrelationEdge[]
 *     Approved correlation edges (``litho_layer`` id pairs, side-aware). Default ``[]``.
 *
 * Returns
 * -------
 * OracleColumn[]
 *     One entry per surviving test, each unit carrying its ``left`` and ``right`` verdict. The
 *     outermost left test's ``left`` and the outermost right test's ``right`` are
 *     ``edge-of-section``; a middle test's left side is, by construction, the same interface as
 *     the previous test's right side (the same tie count) — "checked once".
 */
export function walkSection210(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
): OracleColumn[] {
  const cols = nonEmptyColumns(columns)
  const formationByLayer = new Map<string, string>()
  for (const c of cols) for (const u of c.units) formationByLayer.set(u.layerId, u.formationId)
  const ties = tiedContactsByColumn(cols, edges)
  const out: OracleColumn[] = []
  for (let ci = 0; ci < cols.length; ci++) {
    const c = cols[ci]
    const colTies = ties.get(ci) ?? []
    const hasLeft = ci > 0
    const hasRight = ci < cols.length - 1
    const units: OracleUnit[] = c.units.map((u) => {
      const topElev = c.surfaceElevM - u.topDepthM
      const baseElev = c.surfaceElevM - u.baseDepthM
      return {
        layerId: u.layerId,
        formationId: u.formationId,
        left: resolveSide(topElev, baseElev, colTies, 'left', hasLeft, u.formationId, formationByLayer),
        right: resolveSide(topElev, baseElev, colTies, 'right', hasRight, u.formationId, formationByLayer),
      }
    })
    out.push({ investigationId: c.investigationId, units })
  }
  return out
}
