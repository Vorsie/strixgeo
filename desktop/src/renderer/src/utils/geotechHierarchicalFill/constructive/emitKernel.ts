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
 * ...and the BIDIRECTIONAL COLLISION, ruled 2026-08-21. Two onlaps facing each
 * other on ONE tie, both reading a different mass at the far end:
 *
 *   *"Start with clearly thicker wins, but program it so that you just have to
 *    delete the ratio 2 to make it option 1."*
 *
 * SCOPE, narrowed 2026-08-21: this decides ONLY the true bidirectional case —
 * both bands carry exactly ONE tie, the SAME tie, and each reads a different
 * mass at the other end. CLEARLY thicker (MORE than {@link CLEAR_THICKER_RATIO}
 * times — exactly the ratio is still a tie) is the one whose onlap exists; the
 * thinner side emits none and closes at its own level. It does NOT extend the
 * winner's reach: *"the MD sand onlaps, that means it is a closed loop in that
 * gap and cannot fill the gap."* Below the ratio neither is clearly thicker,
 * so both onlap and pinch at the middle — the 2026-08-20
 * termination clause standing as the tie-break. Deleting the ratio (or setting
 * it to 1) degenerates the whole rule to plain thicker-wins, which is his
 * option 1, and that constant is the ONLY thing to touch.
 *
 * @module utils/geotechHierarchicalFill/constructive/emitKernel
 */

/** A mass, as the law compares them: a lithology and a packing density. */
export interface Mass {
  litho: string
  packing: string
}

/** What the law says to emit for one band in one gap. */
export type Emit = 'lens' | 'onlap' | 'nothing'

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
  //
  // TWO TIED CONTACTS IS A BAND, ruled 2026-08-21: *"the SF silt on the right
  // has 2 bands, definition is band an no lens or onlap is emitted, two ties is
  // two tied contacts"* — and, on the same silt, *"had 2 ties, so it shoudnt
  // emit jack shit, which leaves it open ... the other silt onlaps and the sf
  // silt fills."* So a band with two tied contacts emits NOTHING whatever the
  // far ends read: it stays OPEN and spans.
  //
  // His table's *"vertical line in the middle"* is still drawn — but it is the
  // SEAM WHERE TWO OPEN MASSES MEET, not something one band emits on its own.
  // Two spanning masses reaching for the same ground share the two tie lines
  // that bound it, so the nearer test owns each half and the line falls exactly
  // in the middle (his S12 scene). Where the mass facing an open band has
  // CLOSED its loop instead, there is nobody to meet and the open mass fills
  // through — which is the SF silt.
  return 'nothing'
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

/**
 * *"Start with clearly thicker wins, but program it so that you just have to
 * delete the ratio 2 to make it option 1."*
 *
 * THE ONE DELETION POINT. Set this to 1 (or drop the multiplier from
 * {@link collision}) and every collision resolves by thickness alone.
 */
export const CLEAR_THICKER_RATIO = 2

/**
 * Which side of a bidirectional onlap collision yields.
 *
 * @param mine The band's own thickness at its own test.
 * @param theirs The opposing band's thickness at its own test.
 * @returns ``'win'`` (take the contested window, ride the tie to the far
 *   contact), ``'yield'`` (no onlap here — close at your own column), or
 *   ``'meet'`` (neither is CLEARLY thicker: both onlap to the middle).
 */
export function collision(mine: number, theirs: number): 'win' | 'yield' | 'meet' {
  if (mine > theirs * CLEAR_THICKER_RATIO) return 'win'
  if (theirs > mine * CLEAR_THICKER_RATIO) return 'yield'
  return 'meet'
}
