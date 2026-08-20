/**
 * THE LAW. The owner's complete emit specification, 2026-08-19, verbatim:
 *
 *   *"If litho has no ties emit lens, if litho has one tie, follow tie - if
 *    litho at other end of tie has same litho and packing density emit nothing.
 *    If it is a different litho emit an onlap, if a litho has two ties, follow
 *    ties and check litho and packing density on the other end. if it is
 *    different then vertical line in the middle, else no emit. Fill = emit
 *    lenses first, then emit onlaps, then fill in the rest with the dominant
 *    lithology (should be the same if all onlaps and lenses are emitted). Fill
 *    sweep if a lens is touching a body with same litho and packing then lens
 *    disappears and it becomes one body, in the renderer and in the database."*
 *
 * ...and the TERMINATION CLAUSE that governs every construct it emits
 * (2026-08-20, on the ground a construct painted over at the facing test):
 *
 *   *"an onlap can't paint over ground near test itself, it terminates at 0.5
 *    Distance approximately."*
 *
 * *"a few very simple rules that can be written in 50 lines of code when bare."*
 *
 * This module is those rules and NOTHING else. It knows no geometry: it is
 * handed what a band's ties show at their other end and it answers what to
 * emit. Everything around it — intersecting lines, tracing loops, clipping to
 * the litho cover, welding faces — is plumbing that DRAWS what this decides.
 *
 * @module utils/geotechHierarchicalFill/constructive/emitKernel
 */

/** A mass, as the law compares them: a lithology and a packing density. */
export interface Mass {
  litho: string
  packing: string
}

/** What the law says to emit for one band in one gap. */
export type Emit = 'lens' | 'onlap' | 'nothing' | 'vertical'

/** *"same litho and packing density"* — the one comparison the law makes. */
export function sameMass(a: Mass, b: Mass): boolean {
  return a.litho === b.litho && a.packing === b.packing
}

/**
 * What to emit for one band, given what each of its ties shows at the other end.
 *
 * @param own The band's own mass.
 * @param farEnds The mass on the far end of each tie the band carries across
 *   this gap — the band on the SAME SIDE of the contact the tie lands on.
 * @returns The construct the law calls for.
 */
export function emitFor(own: Mass, farEnds: readonly Mass[]): Emit {
  // "If litho has no ties emit lens"
  if (farEnds.length === 0) return 'lens'
  // "follow tie(s) ... check litho and packing density on the other end"
  const same = farEnds.every((far) => sameMass(own, far))
  // "if litho at other end of tie has same litho and packing density emit
  //  nothing. If it is a different litho emit an onlap"
  if (farEnds.length === 1) return same ? 'nothing' : 'onlap'
  // "if a litho has two ties ... if it is different then vertical line in the
  //  middle, else no emit"
  return same ? 'nothing' : 'vertical'
}

/**
 * *"Fill = emit lenses first, then emit onlaps, then fill in the rest with the
 * dominant lithology"* — the order a loop's owner is looked for in.
 */
export const FILL_ORDER = ['lens', 'onlap', 'remainder'] as const

/**
 * *"Fill sweep if a lens is touching a body with same litho and packing then
 * lens disappears and it becomes one body"* — in the renderer and in the
 * database. Two faces weld iff they carry the same key, so the sweep IS this
 * key: touching + same mass = one body, and nothing else merges.
 */
export function massKey(mass: Mass): string {
  return `${mass.litho}|${mass.packing}`
}
