/**
 * THE CORRELATIONS DRAWN ON A BAND'S OWN TWO CONTACTS.
 *
 * Owner, 2026-08-28, on Cross-section 1 gap 14: *"i don't want the VD sand to
 * spill below that bottom tie"*.
 *
 * A tie landing on a band's own top or base is that band's own boundary. The
 * standing absolute — a class may never cross a correlation — is at its very
 * strongest there: the line was drawn ON this band's contact, so ground on the
 * far side of it is, by the engineer's own statement, not this band's.
 *
 * The remainder ladder already tests candidates against the gap's drawn ties,
 * but that set answers a different question. It is filtered to the ties that
 * SPAN the gap being filled (``fillGap``), because a wall is there to choose
 * between candidates reaching across this ground. His S9↔S8 tie was drawn one
 * gap back and so is absent from gap 14's set — while S9's very dense sand,
 * reaching 33.7 m across an intervening test, was handed the wedge beneath
 * exactly that line.
 *
 * So this index is RUN-WIDE, and deliberately: the line bounding a band's
 * contact bounds it wherever that band's class is proposed, not only in the gap
 * the line happens to cross.
 *
 * Pure module. It depends on ``constructs.ts`` (for the band and tie shapes and
 * for ``tieElevAt``) and nothing depends on it but ``fillGap`` and the ladder,
 * so the arrow points one way and there is no cycle.
 *
 * @module utils/geotechHierarchicalFill/constructive/ownContactTies
 */

import { tieElevAt, type RunBand, type RunTie } from './constructs'
import { CONTACT_EPS } from './farBand'

/**
 * Index the run's ties by the band whose own contact each one lands on.
 *
 * @param bands Every band of the family, on every column of the run.
 * @param ties The run's surviving packing ties.
 * @returns Layer id → the ties landing on that band's top or base, at that
 *   band's own column. Bands carrying no tie of their own are absent, so a
 *   lookup miss reads as "this band has no boundary of its own to honour".
 */
export function ownContactTiesOf(
  bands: readonly RunBand[],
  ties: readonly RunTie[],
): Map<string, readonly RunTie[]> {
  const out = new Map<string, readonly RunTie[]>()
  for (const band of bands) {
    // A contact is shared by the bands above and below it, so a tie stored
    // against either of them lands on this band's own contact just the same —
    // which is why the test is on the ELEVATION at this band's column, never on
    // which layer the correlation row happens to name.
    const onThisBand = (ci: number, y: number): boolean =>
      ci === band.ci &&
      (Math.abs(y - band.top) <= CONTACT_EPS || Math.abs(y - band.base) <= CONTACT_EPS)
    const mine = ties.filter(
      (tie) => onThisBand(tie.leftCi, tie.leftY) || onThisBand(tie.rightCi, tie.rightY),
    )
    if (mine.length > 0) out.set(band.layerId, mine)
  }
  return out
}

/**
 * WHICH correlations a rung of the remainder ladder tests its candidates
 * against.
 *
 * ``drawn``        — every line crossing this gap: the walls that choose
 *                    BETWEEN candidates reaching over this ground.
 * ``own-contacts`` — those walls dropped, because *"a wall may never un-class
 *                    ground"* — and replaced by the candidate's OWN boundaries,
 *                    which nothing may drop (see ``remainderLadder.ts``'s rung
 *                    table).
 *
 * There is deliberately no third scope meaning "no walls at all". Standing a
 * class on the far side of the line drawn on its own contact is not a fill
 * decision the ladder is allowed to express, and the wall-less rung is where it
 * used to be expressible.
 */
export type WallScope = 'drawn' | 'own-contacts'

/** The two tie collections {@link wallsFor} composes a wall set from. */
export interface WallSource {
  /** The correlation lines actually drawn across this gap. */
  drawnTies: readonly RunTie[]
  /** The ties bounding each band's OWN contacts, run-wide, by layer id. */
  ownContactTies: ReadonlyMap<string, readonly RunTie[]>
}

/** One correlation line, and how far it speaks. */
export interface Wall {
  tie: RunTie
  /**
   * Whether the line states nothing beyond its own two ends.
   *
   * A DRAWN tie is drawn right across this gap, so reading it at any x — the
   * gap's own, or a distant candidate's column — is reading a line that is
   * actually there. That extrapolation is load-bearing and is left alone.
   *
   * A tie brought in from a NEIGHBOURING gap is not drawn on this ground at
   * all. Continuing its slope indefinitely invents a boundary nobody drew, and
   * the further it runs the more it invents. So it is read at its nearest end
   * instead, which is exactly the statement the engineer made: *"this contact,
   * at this test, is at this level"*.
   *
   * MEASURED, not assumed (2026-08-28, the whole 14-section model both ways):
   * un-clamped, this rule ALSO moved his CS3 gap 1 — two masses swapped about
   * 0.09 m2 of a wedge that has nothing to do with the ruling. Clamped, the
   * change is confined to the two CS1 gaps his ruling is about.
   */
  spanOnly: boolean
}

/**
 * A wall's elevation at along-x, honouring how far the line speaks.
 *
 * @param wall The line (see {@link Wall}).
 * @param x Along-section metres.
 * @returns The line's elevation there, clamped to its own ends where it states
 *   nothing beyond them.
 */
export function wallElevAt(wall: Wall, x: number): number {
  if (!wall.spanOnly) return tieElevAt(wall.tie, x)
  const lo = Math.min(wall.tie.leftX, wall.tie.rightX)
  const hi = Math.max(wall.tie.leftX, wall.tie.rightX)
  return tieElevAt(wall.tie, Math.min(hi, Math.max(lo, x)))
}

/**
 * The walls one candidate is tested against on a rung.
 *
 * His very dense sand won the wall-less last rung and was painted 0.6 m below
 * the very-dense base he had himself tied: that tie was drawn one gap back, so
 * it was never in ``drawnTies``, and the last rung had dropped every wall
 * anyway.
 *
 * The last rung still drops the walls, for the reason it always had — a wall
 * chooses between candidates and may never starve legitimate ground into hatch.
 * What it may not drop is the candidate's own boundary. Composing the set HERE,
 * per candidate, is what makes the difference structural: a rung names a scope,
 * every scope answers with lines, and the one the last rung names IS the
 * candidate's own contacts. Putting a class back across its own tie would take
 * a scope that does not exist.
 *
 * @param scope What the rung asks for.
 * @param band The candidate being tested.
 * @param source The gap's drawn ties and the run-wide own-contact index.
 * @returns Every correlation line this candidate must not be found across.
 */
export function wallsFor(scope: WallScope, band: RunBand, source: WallSource): readonly Wall[] {
  const drawn = source.drawnTies.map((tie) => ({ tie, spanOnly: false }))
  const mine = (source.ownContactTies.get(band.layerId) ?? []).map((tie) => ({
    tie,
    spanOnly: true,
  }))
  // A tie that both spans this gap AND lands on this band's contact is ONE
  // wall, not two, and the DRAWN reading of it wins: ``key`` is the correlation
  // edge's own order-invariant identity, so a gap the line really crosses keeps
  // precisely the behaviour it had.
  const spanning = new Set(source.drawnTies.map((t) => t.key))
  const own = mine.filter((w) => !spanning.has(w.tie.key))
  // WHY THE FIRST FOUR RUNGS DO NOT ALSO GET THE UNDRAWN ONES, measured
  // 2026-08-28. ``fillGap`` filters the drawn set to the lines that cross this
  // RUN — a family's run skips the columns it was never divided on, so a tie
  // between two of them is not a line across this ground even where its span
  // happens to lie over it. Handing those to the rungs that still have their
  // walls cut the right test's own clay off from the ground beside its own
  // column on his CS1 gap 2 (LOOP_SCENES S9) and moved the CS1 golden master.
  // On the wall-less rung the walls are gone anyway and the only question left
  // is the candidate's own boundary, which is where his ruling bites.
  return scope === 'own-contacts' ? own : drawn
}
