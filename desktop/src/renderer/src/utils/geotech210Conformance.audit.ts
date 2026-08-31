/**
 * THE 2/1/0 CONFORMANCE ORACLE — the audit itself, without the harness.
 *
 * ``geotech210Conformance.diag.test.ts`` holds the ratchet (read the dump, count
 * per section, compare against the frozen baseline) and the synthetic pins; this
 * module holds the thing they both exercise: given ONE section's partition, which
 * bands break the 2/1/0 law and how. Split out when the pins landed and the test
 * file crossed the 500-line mark (debt #201) — and the split earns its keep
 * twice over, because a pin can now hand the oracle a partition it built by hand
 * instead of one the engine drew, which is the only way to prove the audit still
 * FLAGS a violation rather than merely failing to find one.
 *
 * THE LAW. A band with 2 tied contacts BANDS across its gap, with 1 ONLAPS
 * following the tie, with 0 closes as a LENS at its own level. Four ways to
 * break it, and the oracle names them:
 *
 *   V-BALLOON  a 0/1-tie band's construct grows far outside its own extent and
 *              the lines it rides (the 0.41 m crust that painted 2.8 m).
 *   V-MISSING  a 0/1-tie band emits NOTHING into an adjacent gap — its loop
 *              never closed (the spur-stripped onlap flank).
 *   V-NOSPAN   a band tied >= 2x into a gap does not reach the far column.
 *   V-OVERREACH a 0/1-tie construct paints past the middle of its own run
 *              (*"an onlap can't paint over ground near test itself, it
 *              terminates at 0.5 Distance approximately"*).
 *
 * A gap whose FACING test carries no bands at all is out of scope: an un-divided
 * test shows empty ground by ruling (2026-08-15), so nothing being emitted there
 * is the law working. Everything else is audited.
 *
 * COUNTING, ruled 2026-08-21 (verbatim): *"two ties is two tied contacts, if you
 * have two ties on the same contact that means a layer tapers out to a pinch,
 * right up to that contact. 0.5x distance to next test (so half of the line
 * width it onlaps on)."* A fan on one contact is ONE tie here, and a band with
 * two tied contacts is a BAND — it emits nothing, spans, and is audited on the
 * merged mass rather than on construct loops it no longer draws.
 *
 * A tie is counted on the contact it lands on whatever family the band at its far
 * end belongs to (the same ruling).
 *
 * WHAT ELSE TIES A CONTACT — the 2026-08-26 rulings, and how this module is told
 * ----------------------------------------------------------------------------
 * A packing tie is not the only thing that ties a contact. Both rulings reach the
 * oracle by ASKING THE ENGINE'S OWN MODULE, never by a second opinion written
 * here — a re-implementation is a place the audit and the render can drift apart,
 * which is precisely the class of bug this gate exists to catch:
 *
 *  * **THE COVER WELD** (*"those top sands have an engine tie no? the tops of all
 *    tests are connected? follow the tie, same nad class, emit nothing"*). A
 *    cover boundary whose far band is the same litho AND the same packing is a
 *    TIED CONTACT: the two bands are one mass, the law's answer for a tied
 *    contact whose far end matches is *"emit nothing"*, and the mass therefore
 *    reaches the far column lawfully. {@link coverReadsOf} asks
 *    ``coverWeld.ts``'s own ``coverContactOf`` — the same predicate on the same
 *    inputs that ``constructs.ts`` asks — for every contact carrying no packing
 *    tie across the gap, and its answer feeds THREE things:
 *      1. the tie COUNT — a weld is a tied contact;
 *      2. the far-end read — a weld's far end is the band's own mass, so
 *         ``sameMassAcross`` holds and the termination clause is silent;
 *      3. the balloon ENVELOPE — a RIDDEN cover edge (``stored || welds``, the
 *         engine's own ``ridesCover``) is a line the construct follows, exactly
 *         as a packing tie is. And on the ridden SIDE the envelope opens to the
 *         cover RING rather than to ``coverEdge``'s straight chord, because a
 *         welded contact draws no line of its own — *"its line is the cover's
 *         own edge, which the arrangement already carries as a cover-ring
 *         edge"* — and that edge is a polyline. CS1 gap 11 is the measured
 *         case: chord +4.70 at mid-gap, cover base +3.70, the welded band's
 *         face on the base.
 *    Without it the audit read every welded band as an untied lens that had
 *    painted its whole gap: 17 sections of ``overreach`` whose first entry was
 *    the ruling's own target, CS1 col20 gap19.
 *  * **THE LEAST-DENSE LEFTOVER** (*"if 2 lenses are pointed to eachother and
 *    there is nothing else to fill the gap ... you fill with the lowest
 *    density"*). Ladder-declined ground is now CLASSED, and it must never be
 *    measured as a shape the law drew. It is not: ``fillGap`` stamps every
 *    leftover ``role: 'fill'`` — only ``constructOwner`` ever sets
 *    ``'construct'`` — and both pinch demands here read {@link AuditBundle.preMerge}
 *    filtered to construct loops ONLY. Leftover ground still reaches the MERGED
 *    surface, where it can only ever help ``missing`` and ``nospan``. The
 *    ``LDA1``/``LDA2`` pins hold that exemption against the exact ring that would
 *    otherwise trip both checks.
 *
 * RATCHET, not absolute truth: the oracle is deliberately coarse (a dipping
 * one-tie onlap can legitimately exceed the height cap by its tie's dip), so the
 * caller counts violations per section against a frozen baseline and lets them
 * only shrink.
 *
 * @module utils/geotech210Conformance.audit
 */

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import { deriveSectionApexOverrides } from './buildVoxelRequest'
import { frameAlignedColumns } from './frameAlignedPartition'
import { coverReadsOf } from './geotech210Conformance.coverReads'
import { resolveBandParents } from './geotechHierarchicalFill/bandParents'
import { computeHierarchicalGeotechFill } from './geotechHierarchicalFill'
import { CONTACT_EPS } from './geotechHierarchicalFill/constructive/farBand'
import { buildLithoFamilies } from './geotechHierarchicalFill/families'
import { computeSectionFillActive } from './partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from './partitionFill'

/** A 0/1-tie construct may be this many times taller than its own band. */
const BALLOON_SLACK = 2.0
/** Slack on "terminates at 0.5 Distance approximately" — his own word. */
const MIDDLE_GRACE = 0.06
/** Absolute grace on the balloon cap (m) — snap grain and label strokes. */
const BALLOON_GRACE_M = 0.05
/** How close to the far column a same-mass welded span must reach (fraction). */
const SPAN_REACH = 0.99
/** How close to the middle a 2-tie-different construct must reach. The law
 * says the vertical stands "in the middle ... at 0.5 Distance approximately",
 * so the check carries the same tolerance both ways. */
const MIDDLE_REACH = 0.4

/** One packing band of the dump, in metres below the collar. */
export interface RawUnit {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}
/** One test column of the dump. */
export interface RawColumn {
  investigationId: string
  surfaceElevM: number | null
  units: RawUnit[]
}
/** One model arm (litho or geotech) of the dump. */
export interface RawArm {
  columns: RawColumn[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
  alongM: number[]
}
/** One section of the dump: its litho arm, with the geotech arm nested. */
export interface RawSection extends RawArm {
  name: string
  geotech: RawArm
}
/** One band breaking the law, and how. */
export interface Violation {
  kind: 'balloon' | 'missing' | 'nospan' | 'overreach'
  detail: string
}
/** Violations of one section, per kind. */
export type Counts = { balloon: number; missing: number; nospan: number; overreach: number }

/**
 * ONE SECTION'S PARTITION, as the oracle needs to see it: the geotech arm it
 * audits, and the litho frame that arm was built on (the families, the parents
 * and the cover boundaries all come from there).
 */
export interface AuditBundle {
  columns: PartitionColumn[]
  alongM: number[]
  edges: CorrelationEdge[]
  /** The MERGED surface — existence and span are read here. */
  regions: SectionRegion[]
  /** The PRE-MERGE loops, role-tagged. Pinch demands read the constructs only. */
  preMerge: (SectionRegion & { role: 'construct' | 'fill' })[]
  lithoColumns: PartitionColumn[]
  lithoEdges: CorrelationEdge[]
  lithoRegions: SectionRegion[]
}

function assemble(arm: RawArm): {
  columns: PartitionColumn[]
  alongM: number[]
  edges: CorrelationEdge[]
} {
  const paired = arm.columns
    .map((c, i) => ({ c, a: arm.alongM[i] }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
    .sort((p, q) => p.a - q.a)
  return {
    columns: paired.map(({ c }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM as number,
      units: [...(c.units as PartitionColumn['units'])].sort((a, b) => a.topDepthM - b.topDepthM),
    })),
    alongM: paired.map(({ a }) => a),
    edges: arm.edges.map((e) => ({
      a: e.a,
      b: e.b,
      aSide: (e.aSide ?? 'top') as 'top' | 'base',
      bSide: (e.bSide ?? 'top') as 'top' | 'base',
    })),
  }
}

/**
 * The partition the oracle audits.
 *
 * By default it is the RENDERED one — the hierarchical fill, on the LITHO
 * FRAME's column axis (the axis the render and the build both use). ``raw``
 * audits the pre-hierarchical whole-section geotech partition instead, which is
 * what the committed baseline was frozen on; the two agree column-for-column
 * wherever every borehole is divided (Cross-section 1), and the raw arm simply
 * has FEWER gaps elsewhere because a column with no bands is dropped from its
 * axis. The raw arm carries no litho frame at all, so it states no cover
 * boundaries and the envelope stays the packing ties' alone.
 *
 * @param sec The dump's section.
 * @param packingClassOf Formation row id → canonical packing class key.
 * @param raw Audit the whole-section geotech partition instead of the render's.
 * @returns The bundle {@link auditPartition} reads.
 */
export function auditedPartition(
  sec: RawSection,
  packingClassOf: ReadonlyMap<string, string>,
  raw = false,
): AuditBundle {
  const G = assemble(sec.geotech)
  const empty = new Map<string, BodyBoundaryResponse>()
  if (raw) {
    const rawRegions = computeSectionFillActive(
      G.columns,
      G.edges,
      deriveSectionApexOverrides(G.columns, G.edges, G.alongM, empty),
      G.alongM,
    )
    return {
      lithoColumns: [],
      lithoEdges: [],
      lithoRegions: [],
      ...G,
      regions: rawRegions,
      preMerge: rawRegions.map((r) => ({ ...r, role: 'construct' as const })),
    }
  }
  const L = assemble(sec)
  if (L.columns.length < 2)
    return { lithoColumns: [], lithoEdges: [], lithoRegions: [], ...G, regions: [], preMerge: [] }
  const geotechColumns = frameAlignedColumns(
    L.columns,
    new Map(G.columns.map((c) => [c.investigationId, c])),
  )
  const lithoRegions = computeSectionFillActive(L.columns, L.edges, undefined, L.alongM)
  const out = computeHierarchicalGeotechFill({
    lithoColumns: L.columns,
    lithoEdges: L.edges,
    lithoRegions,
    geotechColumns,
    geotechEdges: G.edges,
    alongM: L.alongM,
    packingClassOf,
  })
  return {
    columns: geotechColumns,
    alongM: L.alongM,
    edges: G.edges,
    regions: out.regions,
    // The PRE-MERGE surface, role-tagged. Balloons and overreach audit only the
    // CONSTRUCT loops — the geometric shapes the law drew from the ties,
    // structurally inside their own envelope, so the expected count is ZERO and
    // any hit is a constructor bug (owner: "there shouldn't be pre merge
    // ballooning anywhere ... not untill we do the geometrical fill"). Fill
    // loops are the law's dominant-lithology step and the least-dense leftover,
    // and both legitimately exceed one band's extent.
    preMerge: out.preMergeRegions,
    lithoColumns: L.columns,
    lithoEdges: L.edges,
    lithoRegions,
  }
}


/**
 * The elevation range a set of rings occupies inside a fraction window.
 *
 * Edge-exact rather than vertex-only: a ring's lowest point inside the window is
 * often the interpolation of an edge that CROSSES the window's boundary, and
 * reading vertices alone reports a floor the ring never had (CS1 gap 11's cover
 * kinks at fraction 0.4999, a hair outside the loop that follows it).
 *
 * @param rings The regions to measure.
 * @param f0, f1 The fraction window, ``f0 <= f1``.
 * @returns The window's elevation range, or null where no ring reaches it.
 */
function ringExtentOver(
  rings: readonly SectionRegion[],
  f0: number,
  f1: number,
): { lo: number; hi: number } | null {
  let lo = Infinity
  let hi = -Infinity
  const take = (elevation: number): void => {
    if (elevation < lo) lo = elevation
    if (elevation > hi) hi = elevation
  }
  for (const region of rings) {
    const ring = region.polygon
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      if (Math.max(a.fraction, b.fraction) < f0 || Math.min(a.fraction, b.fraction) > f1) continue
      if (a.fraction >= f0 && a.fraction <= f1) take(a.elevation)
      if (b.fraction >= f0 && b.fraction <= f1) take(b.elevation)
      const span = b.fraction - a.fraction
      if (Math.abs(span) < 1e-12) continue
      for (const f of [f0, f1]) {
        const t = (f - a.fraction) / span
        if (t >= 0 && t <= 1) take(a.elevation + t * (b.elevation - a.elevation))
      }
    }
  }
  return lo === Infinity ? null : { lo, hi }
}

/**
 * Audit ONE section's partition against the 2/1/0 law.
 *
 * @param name The section's name — it prefixes every violation's detail.
 * @param bundle The partition (see {@link AuditBundle}).
 * @param packingClassOf Formation row id → canonical packing class key. The
 *   oracle must compare masses exactly as the fill does — by CLASS (owner
 *   2026-08-21: one mass one body) — or it audits a law the fill was never given.
 * @returns Every violation found, in column then gap order.
 */
export function auditPartition(
  name: string,
  bundle: AuditBundle,
  packingClassOf: ReadonlyMap<string, string>,
): Violation[] {
  const G = bundle
  const regions = G.regions
  const classKeyOf = (formationId: string): string =>
    packingClassOf.get(formationId) ?? formationId

  // layerId → owning column index.
  const columnOf = new Map<string, number>()
  for (let ci = 0; ci < G.columns.length; ci++) {
    for (const u of G.columns[ci].units) columnOf.set(u.layerId, ci)
  }
  // FAMILY MEMBERSHIP, computed exactly as the fill computes it (same two
  // helpers, same inputs) so the audit counts the ties the constructor kept.
  const bandParents = resolveBandParents(G.columns, G.lithoColumns)
  const { familyOfLithoLayer } = buildLithoFamilies(G.lithoColumns, G.lithoEdges, G.lithoRegions)
  const familyOfBand = new Map<string, string>()
  for (const [band, parentLayer] of bandParents.parentOfBand) {
    const familyId = familyOfLithoLayer.get(parentLayer)
    if (familyId !== undefined) familyOfBand.set(band, familyId)
  }
  const bandedColumnsByFamily = new Map<string, Set<number>>()
  for (let ci = 0; ci < G.columns.length; ci++) {
    for (const u of G.columns[ci].units) {
      const familyId = familyOfBand.get(u.layerId)
      if (familyId === undefined) continue
      const set = bandedColumnsByFamily.get(familyId)
      if (set === undefined) bandedColumnsByFamily.set(familyId, new Set([ci]))
      else set.add(ci)
    }
  }
  // TIES ARE COUNTED THE WAY THE FILL COUNTS THEM, or the audit measures a
  // construct against a law the constructor was never given:
  //
  //  * a tie whose two bands sit in DIFFERENT litho families is DROPPED by the
  //    fill (a packing tie states one mass inside one litho body — the draw-time
  //    cross-litho-body guard's own rule), so it must not count here either.
  //    Counting it made CS1 col15's very dense sand audit as a two-tie band that
  //    fails to span, when what the render draws — correctly — is a lens (the
  //    #273 cross-family case: its parent units are not correlated);
  //  * a tie that JUMPS a column the family has no bands on is the fill's own
  //    ADJACENT tie: the family's run spans that column (the 2026-08-15 EXCLUDED
  //    ruling keeps a deep mass continuous across a short test), so the tie
  //    bounds the contact exactly as a neighbour-to-neighbour one does. Counting
  //    only |ci - cj| === 1 read CS1 col19's medium-dense sand as a 0-tie lens
  //    and called its own two tie lines a balloon.
  const unitOf = new Map<string, { u: RawUnit; ci: number }>()
  for (let ci = 0; ci < G.columns.length; ci++) {
    for (const u of G.columns[ci].units) unitOf.set(u.layerId, { u: u as RawUnit, ci })
  }
  const surfaceElev = (layer: string): number => {
    const home = unitOf.get(layer)
    return home ? G.columns[home.ci].surfaceElevM : 0
  }
  const tieCount = new Map<string, number>()
  /** (layerId|gap)@contact — a fan on one contact counts once (ruling below). */
  const countedContacts = new Set<string>()
  /** The bands adjoining a contact on one column, and on which side they sit. */
  const bandsOnContact = (ci: number, elevation: number): { u: RawUnit; above: boolean }[] => {
    const out: { u: RawUnit; above: boolean }[] = []
    for (const u of G.columns[ci].units) {
      const top = G.columns[ci].surfaceElevM - u.topDepthM
      const base = G.columns[ci].surfaceElevM - u.baseDepthM
      if (Math.abs(base - elevation) <= CONTACT_EPS) out.push({ u: u as RawUnit, above: true })
      else if (Math.abs(top - elevation) <= CONTACT_EPS) out.push({ u: u as RawUnit, above: false })
    }
    return out
  }
  // RUN-WIDE FAN WELD (the engine's ``fanWeldsSameMass``): a contact may carry
  // several ties (the fan), and ONE same-class far end welds it wherever the
  // band answers — the other ties are the far layers' own pinch statements.
  // The per-gap loop below only visits gaps a tie CROSSES, so the welding tie
  // of B2's MD tail (a jump to S6's own MD) is invisible from the S10|B2 gap;
  // this set carries the weld across. Keyed layerId@elevKey.
  const weldedContacts = new Set<string>()
  for (const e of G.edges) {
    const ca = columnOf.get(e.a)
    const cb = columnOf.get(e.b)
    if (ca === undefined || cb === undefined || ca === cb) continue
    const preElevOf = (layer: string, side: 'top' | 'base'): number => {
      const home = unitOf.get(layer)
      if (!home) return 0
      return surfaceElev(layer) - (side === 'top' ? home.u.topDepthM : home.u.baseDepthM)
    }
    const elevA = preElevOf(e.a, e.aSide ?? 'top')
    const elevB = preElevOf(e.b, e.bSide ?? 'top')
    for (const [nearCi, nearElev, farCi, farElev] of [
      [ca, elevA, cb, elevB],
      [cb, elevB, ca, elevA],
    ] as const) {
      for (const near of bandsOnContact(nearCi, nearElev)) {
        const far = bandsOnContact(farCi, farElev).find((b) => b.above === near.above)
        if (far === undefined) continue
        if (classKeyOf(far.u.formationId) === classKeyOf(near.u.formationId))
          weldedContacts.add(`${near.u.layerId}@${Math.round(nearElev * 1000)}`)
      }
    }
  }
  // Per (layerId, gap): the formationIds at the ties' far ends — same
  // formationId = same mass (the kernel's one comparison).
  const farForms = new Map<string, string[]>()
  // Per (layerId, gap): the tied LINE as (elev at left column, elev at right column).
  const tieLines = new Map<string, [number, number][]>()
  for (const e of G.edges) {
    const ca = columnOf.get(e.a)
    const cb = columnOf.get(e.b)
    if (ca === undefined || cb === undefined || ca === cb) continue
    // A TIE ON A BAND'S OWN CONTACT COUNTS FOR THAT BAND (owner, 2026-08-21):
    // *"two ties is two tied contacts"* — the tie he drew on the SF silt's base
    // is one of its two even though the band at the other end belongs to a
    // neighbouring litho family. The fill no longer drops those either, so the
    // audit must not: the family is used here only to know which columns the
    // run spans. (Debt #273's silently-dropped class is partly resolved by this
    // ruling — the near-end-in-family half of it.)
    const fa = familyOfBand.get(e.a) ?? familyOfBand.get(e.b)
    if (fa === undefined) continue
    const lo = Math.min(ca, cb)
    const hi = Math.max(ca, cb)
    // Every column it jumps must carry NO band of this family — then the run
    // spans it and the tie is the run's own adjacent tie. A column that DOES
    // carry the family between them is a real intermediate test; a tie over it
    // is bridge machinery with its own rules and stays out of the count.
    let spans = true
    for (let between = lo + 1; between < hi; between++) {
      if (bandedColumnsByFamily.get(fa)?.has(between) === true) spans = false
    }
    if (!spans) continue
    const elevOf = (layer: string, side: 'top' | 'base'): number => {
      const home = unitOf.get(layer)
      if (!home) return 0
      return surfaceElev(layer) - (side === 'top' ? home.u.topDepthM : home.u.baseDepthM)
    }
    const elevA = elevOf(e.a, e.aSide ?? 'top')
    const elevB = elevOf(e.b, e.bSide ?? 'top')
    const loElev = ca < cb ? elevA : elevB
    const hiElev = ca < cb ? elevB : elevA
    const loX = G.alongM[lo]
    const hiX = G.alongM[hi]
    // The tie's elevation at a column, interpolated along the straight line —
    // the same line the fill draws.
    const at = (ci: number): number =>
      Math.abs(hiX - loX) < 1e-9
        ? loElev
        : loElev + ((G.alongM[ci] - loX) / (hiX - loX)) * (hiElev - loElev)
    // A TIE IS DRAWN ON A CONTACT, AND A CONTACT IS SHARED (owner: *"it has a
    // top and bottom tie to the right though?"*). The fill credits the tie to
    // BOTH bands that adjoin the contact it lands on, whichever of them the
    // stored row happens to name, and the far end it compares against is the
    // band on the SAME SIDE of the contact over there. Crediting only the named
    // layer read CS1 col19's medium-dense sand as a one-tie band when the law
    // gives it two.
    // The tie bounds the contact in EVERY gap it crosses.
    for (let gap = lo; gap < hi; gap++) {
      const left = at(gap)
      const right = at(gap + 1)
      for (const [nearCi, nearElev, farCi, farElev] of [
        [ca, elevA, cb, elevB],
        [cb, elevB, ca, elevA],
      ] as const) {
        for (const near of bandsOnContact(nearCi, nearElev)) {
          const key = `${near.u.layerId}|${gap}`
          // TWO TIES IS TWO TIED CONTACTS (owner, 2026-08-21, verbatim): *"two
          // ties is two tied contacts, if you have two ties on the same contact
          // that means a layer tapers out to a pinch, right up to that
          // contact."* So a fan on ONE contact is ONE tie for this band — it
          // states that the far layer pinches out against that line, not that
          // this band has a second contact tied. Counting the rows read three
          // of his CS1 bands as two-tie bands that fail to span; they are
          // lawful one-tie onlaps.
          const contact = `${key}@${Math.round(nearElev * 1000)}`
          if (countedContacts.has(contact)) continue
          countedContacts.add(contact)
          tieCount.set(key, (tieCount.get(key) ?? 0) + 1)
          const list = tieLines.get(key) ?? []
          list.push([left, right])
          tieLines.set(key, list)
          // A tie whose far side is EMPTY states nothing about the mass —
          // then, and only then, the contact's FAN speaks run-wide: a
          // same-class end on another of its ties welds it (``weldedContacts``
          // above — the engine's fanWeldsSameMass). A real far end across
          // this gap keeps its own read: a band welds one way and onlaps the
          // other, and the weld must not erase the onlap.
          const far = bandsOnContact(farCi, farElev).find((b) => b.above === near.above)
          const fars = farForms.get(key) ?? []
          if (far !== undefined) {
            fars.push(far.u.formationId)
          } else if (weldedContacts.has(`${near.u.layerId}@${Math.round(nearElev * 1000)}`)) {
            fars.push(near.u.formationId)
          }
          farForms.set(key, fars)
        }
      }
    }
  }

  // THE COVER WELD (owner, 2026-08-26). A cover boundary to the SAME MASS is a
  // TIED CONTACT — see the module docstring, and ``coverWeld.ts`` for the rule
  // itself. Everything below reads the answer; nothing below re-decides it.
  const coverReads = coverReadsOf({
    columns: G.columns,
    lithoColumns: G.lithoColumns,
    lithoEdges: G.lithoEdges,
    alongM: G.alongM,
    classKeyOf,
    familyOfBand,
    parentOfBand: bandParents.parentOfBand,
    bandedColumnsByFamily,
    packingTiedContacts: countedContacts,
  })
  /** (layerId|gap) → the contacts whose line is the COVER'S own boundary. */
  const coverRidden = new Map<string, Set<'top' | 'base'>>()
  for (const [key, reads] of coverReads) {
    const layerId = key.slice(0, key.lastIndexOf('|'))
    const home = unitOf.get(layerId)
    if (home === undefined) continue
    for (const read of reads) {
      if (read.line !== null) {
        const lines = tieLines.get(key) ?? []
        lines.push(read.line)
        tieLines.set(key, lines)
        const sides = coverRidden.get(key)
        if (sides === undefined) coverRidden.set(key, new Set([read.side]))
        else sides.add(read.side)
      }
      if (!read.welds) continue
      tieCount.set(key, (tieCount.get(key) ?? 0) + 1)
      // A weld's far end is the band's OWN mass by definition of the weld, so
      // it can only ever say *"emit nothing"*: alone (one tied contact, same
      // mass — the band stays open and spans) or alongside a packing tie (two
      // tied contacts is a band).
      const fars = farForms.get(key) ?? []
      fars.push(home.u.formationId)
      farForms.set(key, fars)
    }
  }

  // LITHO APPROVAL CARRIES DOWN (owner ruling A, 2026-08-19). A band's parent litho unit's own
  // ties are lines drawn for this mass too, so the family flood follows them and the envelope has
  // to know that — otherwise every legitimate flood along a litho tie reads as a balloon here.
  //
  // They widen the ENVELOPE only. They are deliberately NOT counted in ``tieCount``: 2/1/0 is a
  // PACKING-tie count, and a litho-tied band whose far end is a DIFFERENT mass is still a 0-tie
  // band that must close its own loop. Only the WELD above — same litho, same packing — makes a
  // cover boundary a tied contact, which is the whole of the 2026-08-26 refinement.
  const { parentOfBand } = bandParents
  const lithoColumnOf = new Map<string, number>()
  const lithoElev = new Map<string, { top: number; base: number }>()
  for (let ci = 0; ci < G.lithoColumns.length; ci++) {
    const col = G.lithoColumns[ci]
    for (const u of col.units) {
      lithoColumnOf.set(u.layerId, ci)
      lithoElev.set(u.layerId, {
        top: col.surfaceElevM - u.topDepthM,
        base: col.surfaceElevM - u.baseDepthM,
      })
    }
  }
  const parentLine = new Map<string, [number, number][]>()
  for (const e of G.lithoEdges) {
    const ca = lithoColumnOf.get(e.a)
    const cb = lithoColumnOf.get(e.b)
    if (ca === undefined || cb === undefined || Math.abs(ca - cb) !== 1) continue
    const gap = Math.min(ca, cb)
    const at = (layer: string, side: 'top' | 'base'): number => {
      const el = lithoElev.get(layer)
      return el === undefined ? 0 : side === 'base' ? el.base : el.top
    }
    const elevA = at(e.a, (e.aSide ?? 'top') as 'top' | 'base')
    const elevB = at(e.b, (e.bSide ?? 'top') as 'top' | 'base')
    const [left, right] = ca < cb ? [elevA, elevB] : [elevB, elevA]
    // A CONTACT IS SHARED (the same principle that counts a band's ties on
    // contacts): the line drawn on one unit's top is the unit-above's base and
    // vice versa, so the envelope registers it under BOTH flanking units — a
    // clay whose base follows the sand-top tie line is inside its unit, not
    // ballooning out of it.
    for (const [layer, side] of [
      [e.a, (e.aSide ?? 'top') as 'top' | 'base'],
      [e.b, (e.bSide ?? 'top') as 'top' | 'base'],
    ] as const) {
      const ci2 = lithoColumnOf.get(layer)
      if (ci2 === undefined) continue
      const col = G.lithoColumns[ci2]
      const sorted = [...col.units].sort((a, b) => a.topDepthM - b.topDepthM)
      const idx = sorted.findIndex((u) => u.layerId === layer)
      const neighbour = side === 'top' ? sorted[idx - 1]?.layerId : sorted[idx + 1]?.layerId
      for (const owner of neighbour === undefined ? [layer] : [layer, neighbour]) {
        const key = `${owner}|${gap}`
        const list = parentLine.get(key) ?? []
        list.push([left, right])
        parentLine.set(key, list)
      }
    }
  }

  // Regions per (layerId, gapIndex), via the v2 layer-id attribution — the
  // MERGED surface (existence + span) and the PRE-MERGE surface (balloons).
  const regionsOf = new Map<string, SectionRegion[]>()
  for (const r of regions) {
    for (const layer of r.layerIds ?? []) {
      const key = `${layer}|${r.gapIndex}`
      const list = regionsOf.get(key) ?? []
      list.push(r)
      regionsOf.set(key, list)
    }
  }
  // CONSTRUCT LOOPS ONLY. A fill loop is the law's dominant-lithology step or
  // the least-dense leftover of 2026-08-26 — ground handed to a mass by an
  // OWNERSHIP rule, not a shape the law drew from a tie — so no pinch is owed
  // on it and measuring one would report the owner's own ruling as a defect.
  const preOf = new Map<string, (SectionRegion & { role: 'construct' | 'fill' })[]>()
  for (const r of G.preMerge) {
    if (r.role !== 'construct') continue
    for (const layer of r.layerIds ?? []) {
      const key = `${layer}|${r.gapIndex}`
      const list = preOf.get(key) ?? []
      list.push(r)
      preOf.set(key, list)
    }
  }

  const out: Violation[] = []
  for (let ci = 0; ci < G.columns.length; ci++) {
    const col = G.columns[ci]
    const surf = col.surfaceElevM
    for (const u of col.units) {
      const thickness = u.baseDepthM - u.topDepthM
      const gaps = [ci - 1, ci].filter((g) => g >= 0 && g < G.columns.length - 1)
      for (const gap of gaps) {
        // OUT OF SCOPE: the test facing this one across the gap has no packing
        // bands at all — it has not been divided. The owner's 2026-08-15 ruling
        // is that such ground reads visibly EMPTY until "4 · Divide boreholes"
        // is pressed, so a band emitting nothing into that gap is the RULE
        // being obeyed, not broken. Auditing it would bury a real regression
        // under hundreds of intended absences (measured: 350 across the five
        // sections that still carry un-divided tests).
        const facing = gap === ci ? ci + 1 : gap
        if ((G.columns[facing]?.units.length ?? 0) === 0) continue
        const ties = tieCount.get(`${u.layerId}|${gap}`) ?? 0
        const mine = regionsOf.get(`${u.layerId}|${gap}`) ?? []
        const tag =
          `${name} col${ci} gap${gap} class=${u.formationId.slice(0, 8)} ` +
          `band ${(surf - u.topDepthM).toFixed(2)}..${(surf - u.baseDepthM).toFixed(2)} ties=${ties}`
        if (ties >= 2) {
          // THE LAW's two-tie cases (owner: "what is a no span?"): far end the
          // SAME mass -> no emit, the mass is continuous, so the WELDED region
          // must reach the far column. A DIFFERENT mass -> the construct
          // terminates at the vertical line in the middle ("terminates at 0.5
          // Distance approximately"), so its own loops must reach ~the middle
          // and demanding the far column would contradict the ruling.
          const fars = farForms.get(`${u.layerId}|${gap}`) ?? []
          // CLASS identity, not row identity — the duplicate formation rows the
          // model keeps per geological parent are ONE mass (owner 2026-08-21).
          const sameMassFar = fars.every((f) => classKeyOf(f) === classKeyOf(u.formationId))
          // THE MIXED PAIR (owner, 2026-08-21): *"the D sand should fill that
          // gap ... which forms a closed loop in that gap that only the D sand
          // kan fill."* One end welds, the other reads a different mass — the
          // band emits NOTHING, stays open, and the fill hands it the loop. The
          // law asks it for no reach of its own, so the binary same/different
          // split this check was written on has no case for it. Existence is
          // still audited by the missing check above.
          if (!sameMassFar && !fars.every((f) => classKeyOf(f) !== classKeyOf(u.formationId)))
            continue
          const wantHigh = gap === ci // band on the LEFT column of the gap reaches right
          // TWO TIED CONTACTS IS A BAND (owner, 2026-08-21): it emits nothing,
          // stays open and SPANS, so its ground is read on the merged surface —
          // the mass — not on construct loops it no longer draws. Reading the
          // loops made every two-contact band look like it emitted nothing into
          // its gap, which is exactly what the law says it does.
          // ...and a WELD is a property of the MASS, not of one band's id: the
          // two bands of one mass each own their own half of the ground they
          // weld into (the attribution rule in ``mergeFaces``), so asking one
          // id to reach the far column asks for something the law never says.
          // What must arrive over there is the CLASS.
          const surface = sameMassFar
            ? regions.filter(
                (r) => r.gapIndex === gap && classKeyOf(r.formationId) === classKeyOf(u.formationId),
              )
            : mine
          let reach = wantHigh ? 0 : 1
          for (const r of surface) {
            for (const p of r.polygon) {
              reach = wantHigh ? Math.max(reach, p.fraction) : Math.min(reach, p.fraction)
            }
          }
          const need = sameMassFar ? SPAN_REACH : MIDDLE_REACH
          const ok = wantHigh ? reach >= need : reach <= 1 - need
          if (!ok)
            out.push({
              kind: 'nospan',
              detail: `${tag} reach=${reach.toFixed(2)} ${sameMassFar ? 'same-mass' : 'to-middle'}`,
            })
          continue
        }
        // THE TERMINATION CLAUSE (owner, 2026-08-20): *"an onlap can't paint over
        // ground near test itself, it terminates at 0.5 Distance approximately."*
        // A 0/1-tie construct owns its own half and no more, so its own loops
        // may not cross the middle by more than a grace. Without this the audit
        // could not tell a lens that reaches 0.45 from one that reaches 0.95 —
        // both stay inside their own elevation extent, so the balloon check is
        // blind to it (measured: sabotaging the reach to 0.95 left every count
        // at zero until this check existed).
        // "0.5 Distance" is the distance between the two TESTS the ground runs
        // between — the family's own run — not the frame gap. Where a family
        // has no bands on a column its run spans it (the 2026-08-15 EXCLUDED
        // ruling), so the middle can lie in a different frame gap altogether;
        // then this gap is wholly on one test's side and there is nothing to
        // check here.
        const banded = [
          ...(bandedColumnsByFamily.get(familyOfBand.get(u.layerId) ?? '') ?? []),
        ].sort((a, b) => a - b)
        let runLeft = -1
        let runRight = -1
        for (let k = 0; k + 1 < banded.length; k++) {
          if (banded[k] <= gap && banded[k + 1] >= gap + 1) {
            runLeft = banded[k]
            runRight = banded[k + 1]
          }
        }
        // A band whose tie shows the SAME mass at the other end emits NOTHING by
        // the law — it and its twin are one mass — so its ground runs the whole
        // way and the termination clause does not apply to it. The clause is
        // about a construct painting over ground ANOTHER mass measured. Since
        // 2026-08-26 a COVER WELD is one of those same-mass ends: *"follow the
        // tie, same nad class, emit nothing"* is the same sentence of the law
        // whether the line is a packing tie or the cover's own boundary.
        //
        // NO ONLAP IS EXEMPT (owner ruling 2026-08-25, *"no it has one tie on
        // top, so it should onlap that same tie"* — superseding the 2026-08-21
        // "clearly thicker wins" collision). This gate used to let a CLEARLY
        // THICKER band ride its tie past the middle unaudited; with the
        // collision retired every one-tie band onlaps and every onlap is a
        // closed loop that terminates at the middle, so the exemption has
        // nothing left to name and is deleted. The gate audits the law the
        // constructor was actually given.
        const sameMassAcross =
          ties >= 1 &&
          (farForms.get(`${u.layerId}|${gap}`) ?? []).length > 0 &&
          (farForms.get(`${u.layerId}|${gap}`) ?? []).every(
            (f) => classKeyOf(f) === classKeyOf(u.formationId),
          )
        // A CLOSURE EXISTS TO MEET THE FACING READING (owner 2026-08-21 late
        // night, on S7's interbeds pinching at short S7A: *"it should be a
        // continuous band starting from S7 but now it is interrupted at S7A's
        // column"*). With no band over there at these levels — sub-TD ground —
        // there is nobody to meet, the construct continues, and the
        // termination clause has nothing to say about it.
        const facingCi = ci <= gap ? gap + 1 : gap
        const myTop = surf - u.topDepthM
        const myBase = surf - u.baseDepthM
        const facingReads = (G.columns[facingCi]?.units ?? []).some((v) => {
          const top = G.columns[facingCi].surfaceElevM - v.topDepthM
          const base = G.columns[facingCi].surfaceElevM - v.baseDepthM
          return Math.min(top, myTop) - Math.max(base, myBase) > 0
        })
        if (runLeft >= 0 && !sameMassAcross && facingReads) {
          const middleX = (G.alongM[runLeft] + G.alongM[runRight]) / 2
          const width = G.alongM[gap + 1] - G.alongM[gap]
          const middle = Math.abs(width) < 1e-9 ? 0.5 : (middleX - G.alongM[gap]) / width
          const wantHighReach = ci <= gap // the band stands on the LEFT of this gap
          if (middle > -MIDDLE_GRACE && middle < 1 + MIDDLE_GRACE) {
            for (const r of preOf.get(`${u.layerId}|${gap}`) ?? []) {
              if (r.role !== 'construct') continue
              const far = wantHighReach
                ? Math.max(...r.polygon.map((p) => p.fraction))
                : Math.min(...r.polygon.map((p) => p.fraction))
              const crossed = wantHighReach
                ? far - (middle + MIDDLE_GRACE)
                : middle - MIDDLE_GRACE - far
              if (crossed > 0) {
                out.push({
                  kind: 'overreach',
                  detail:
                    `${tag} construct reaches ${far.toFixed(2)} past the middle ` +
                    `${middle.toFixed(2)} of run ${runLeft}|${runRight}`,
                })
                break
              }
            }
          }
        }
        // 0/1-tie constructs pinch at their own level: no region of theirs may
        // grow far taller than the band itself (the balloon family), and the
        // construct must EXIST (the spur-stripped-flank family).
        if (mine.length === 0) {
          out.push({ kind: 'missing', detail: tag })
          continue
        }
        // The allowed envelope: the band's own extent, UNIONED with every line
        // it RIDES — its tie line, its parent unit's approved litho line, and
        // (since 2026-08-26) the cover edge a welded contact follows — each
        // evaluated over the region's own fraction reach. A one-tie onlap
        // legitimately spans its tie's dip because it follows the line, but it
        // may never leave [own level ∪ the lines], which is exactly what the
        // balloons did (the 0.41 m crust reached the channel floor 1.4 m below
        // its tie's local level).
        const bandTop = surf - u.topDepthM
        const bandBase = surf - u.baseDepthM
        const parent = parentOfBand.get(u.layerId)
        const lines = [
          ...(tieLines.get(`${u.layerId}|${gap}`) ?? []),
          ...(parent === undefined ? [] : (parentLine.get(`${parent}|${gap}`) ?? [])),
        ]
        // A RIDDEN COVER CONTACT FOLLOWS THE COVER RING, NOT A CHORD. The
        // constructor draws no line of its own for a welded contact —
        // *"its line is the cover's own edge, which the arrangement already
        // carries as a cover-ring edge"* — and that edge is a POLYLINE the
        // litho stage drew, while ``coverEdge`` models it as the straight chord
        // between its two ends. Measured on CS1 gap 11: the chord reads +4.70 at
        // mid-gap where the cover's own base is +3.70, and the welded band's
        // face follows the base. So the ridden SIDE (and only that side) is
        // widened to the parent cover's own extent over the loop's fraction
        // window. A region carrying no ``layerIds`` cannot be attributed to this
        // parent and widens nothing, which keeps the relaxation to cover this
        // band's own soil demonstrably holds.
        const ridden = coverRidden.get(`${u.layerId}|${gap}`)
        const coverRings =
          ridden === undefined || parent === undefined
            ? []
            : G.lithoRegions.filter(
                (r) => r.gapIndex === gap && (r.layerIds ?? []).includes(parent),
              )
        // Balloons audit the PRE-MERGE loops: single owner each, so the welded
        // mass's shared attribution cannot echo here.
        for (const r of preOf.get(`${u.layerId}|${gap}`) ?? []) {
          let lo = Infinity
          let hi = -Infinity
          let f0 = 1
          let f1 = 0
          for (const p of r.polygon) {
            if (p.elevation < lo) lo = p.elevation
            if (p.elevation > hi) hi = p.elevation
            if (p.fraction < f0) f0 = p.fraction
            if (p.fraction > f1) f1 = p.fraction
          }
          let allowLo = bandBase
          let allowHi = bandTop
          for (const [l, rr] of lines) {
            const atF0 = l + f0 * (rr - l)
            const atF1 = l + f1 * (rr - l)
            allowLo = Math.min(allowLo, atF0, atF1)
            allowHi = Math.max(allowHi, atF0, atF1)
          }
          const cover = coverRings.length === 0 ? null : ringExtentOver(coverRings, f0, f1)
          if (cover !== null) {
            if (ridden?.has('base') === true) allowLo = Math.min(allowLo, cover.lo)
            if (ridden?.has('top') === true) allowHi = Math.max(allowHi, cover.hi)
          }
          const grace = thickness * (BALLOON_SLACK - 1) + BALLOON_GRACE_M
          if (lo < allowLo - grace || hi > allowHi + grace) {
            out.push({
              kind: 'balloon',
              detail: `${tag} region ${lo.toFixed(2)}..${hi.toFixed(2)} vs envelope ${(allowLo - grace).toFixed(2)}..${(allowHi + grace).toFixed(2)}`,
            })
            break // one balloon per (band, gap) is enough signal
          }
        }
      }
    }
  }
  return out
}

/**
 * Audit one section of the dump end to end.
 *
 * @param sec The dump's section.
 * @param packingClassOf Formation row id → canonical packing class key.
 * @param raw Audit the whole-section geotech partition (see {@link auditedPartition}).
 * @returns Every violation found.
 */
export function auditSection(
  sec: RawSection,
  packingClassOf: ReadonlyMap<string, string>,
  raw = false,
): Violation[] {
  return auditPartition(sec.name, auditedPartition(sec, packingClassOf, raw), packingClassOf)
}
