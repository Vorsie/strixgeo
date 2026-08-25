/**
 * THE 2/1/0 CONFORMANCE GATE — owner ask 2026-08-18 ("how are we still making
 * errors against the 2/1/0 rule ... sure get the systematic fix done").
 *
 * The 2/1/0 rule is the model's law: a band with 2 ties BANDS across its gap,
 * with 1 tie ONLAPS following the tie, with 0 ties closes as a LENS at its own
 * level. Every render defect of the 2026-08-18 dogfeed marathon violated it in
 * a way no existing gate could see: the litho-consistency gate compares SOILS,
 * and all of these were wrong CLASS inside the right soil. This gate checks
 * the rule per BAND on the real model, using the v2 regions' own layer-id
 * attribution:
 *
 *   V-BALLOON  a 0/1-tie band's region grows far taller than the band itself
 *              (the 0.41 m crust that painted 2.8 m; the silt riding a tie).
 *   V-MISSING  a 0/1-tie band emits NOTHING into an adjacent gap — its loop
 *              never closed (the spur-stripped onlap flank).
 *   V-NOSPAN   a band tied >= 2x into a gap does not reach the far column.
 *
 * A gap whose FACING test carries no bands at all is out of scope: an
 * un-divided test shows empty ground by ruling (2026-08-15), so nothing being
 * emitted there is the law working. Everything else is audited.
 *
 * COUNTING, ruled 2026-08-21 (verbatim): *"two ties is two tied contacts, if
 * you have two ties on the same contact that means a layer tapers out to a
 * pinch, right up to that contact. 0.5x distance to next test (so half of the
 * line width it onlaps on)."* A fan on one contact is ONE tie here, and a band
 * with two tied contacts is a BAND — it emits nothing, spans, and is audited on
 * the merged mass rather than on construct loops it no longer draws.
 *
 * A tie is counted on the contact it lands on whatever family the band at its
 * far end belongs to (the same ruling). That is the half of debt #273's
 * silently-dropped ties whose near end is in-family; the other half — a tie
 * whose near band's family has no COVER in the gap it crosses — is what the one
 * surviving CS1 nospan is, and it needs an owner ruling, not a code guess.
 *
 * RATCHET, not absolute truth: the oracle is deliberately coarse (a dipping
 * one-tie onlap can legitimately exceed the height cap by its tie's dip), so
 * violations are COUNTED per section against a frozen baseline and may only
 * shrink. Freeze/refresh with GEOTECH_210_FREEZE=1 — only commit a refresh
 * whose numbers you can explain.
 *
 * Baseline 2026-08-21: CS1 nospan=3, everything else zero. The 3 hang on ONE
 * unruled question — do "two ties" mean two TIES or two tied CONTACTS? Each of
 * the three bands carries a fan of two ties on a single contact: this gate
 * counts ties (reads 2 -> must span), the constructor counts tied contacts
 * (reads 1 -> pinching onlap). The owner's S12 sentence ("it has a top and
 * bottom tie to the right though?") reads as contacts, but he has not ruled.
 * When he does, either the gate re-scopes to contacts or the constructor
 * changes — both return this to zero. Do not chase these three as defects.
 *
 * Dormant unless GEOTECH_210=1. Env: GEOTECH_AXIS_INPUT (input override,
 * same as the consistency gate). Report: scripts/throwaway_geotech_210.txt.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import { deriveSectionApexOverrides } from './buildVoxelRequest'
import { frameAlignedColumns } from './frameAlignedPartition'
import { buildLithoFamilies } from './geotechHierarchicalFill/families'
import { resolveBandParents } from './geotechHierarchicalFill/bandParents'
import { computeHierarchicalGeotechFill } from './geotechHierarchicalFill'
import { buildPackingClassOf } from './geotechHierarchicalFill/packingClassOf'
import { computeSectionFillActive } from './partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from './partitionFill'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = process.env.GEOTECH_AXIS_INPUT
  ? resolve(REPO_ROOT, process.env.GEOTECH_AXIS_INPUT)
  : resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')

// Formation row → canonical class key, lazily from the dump's own nadMeta.
// The gate must compare masses exactly as the fill does — by CLASS (owner
// 2026-08-21: one mass one body) — or it audits a law the fill was not given.
let packingClassCache: Map<string, string> | null = null
function loadPackingClassOf(): Map<string, string> {
  if (packingClassCache === null) {
    const raw = existsSync(INPUT)
      ? (JSON.parse(readFileSync(INPUT, 'utf8')) as {
          refinementBundle?: {
            nadMeta?: Record<string, { nadClass: number | null; soilCode: string | null }>
          }
        })
      : {}
    packingClassCache = buildPackingClassOf(Object.entries(raw.refinementBundle?.nadMeta ?? {}))
  }
  return packingClassCache
}
function classKeyOf(formationId: string): string {
  return loadPackingClassOf().get(formationId) ?? formationId
}
const OUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_210.txt')
const BASELINE = resolve(HERE, '__fixtures__/geotech_210_conformance_baseline.json')

/** A 0/1-tie construct may be this many times taller than its own band. */
const BALLOON_SLACK = 2.0
/** Slack on "terminates at 0.5 Distance approximately" — his own word. */
const MIDDLE_GRACE = 0.06

/** Elevation tolerance (m) at which two contacts are the same contact. */
const CONTACT_EPS = 1e-6

/** Absolute grace on the balloon cap (m) — snap grain and label strokes. */
const BALLOON_GRACE_M = 0.05
/** How close to the far column a same-mass welded span must reach (fraction). */
const SPAN_REACH = 0.99
/** How close to the middle a 2-tie-different construct must reach. The law
 * says the vertical stands "in the middle ... at 0.5 Distance approximately",
 * so the check carries the same tolerance both ways. */
const MIDDLE_REACH = 0.4

interface RawUnit {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}
interface RawColumn {
  investigationId: string
  surfaceElevM: number | null
  units: RawUnit[]
}
interface RawArm {
  columns: RawColumn[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
  alongM: number[]
}
interface RawSection extends RawArm {
  name: string
  geotech: RawArm
}
interface Violation {
  kind: 'balloon' | 'missing' | 'nospan' | 'overreach'
  detail: string
}
type Counts = { balloon: number; missing: number; nospan: number; overreach: number }

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
 * The partition the gate audits.
 *
 * By default it is the RENDERED one — the hierarchical fill, on the LITHO
 * FRAME's column axis (the axis the render and the build both use). Set
 * ``GEOTECH_210_RAW=1`` to audit the pre-hierarchical whole-section geotech
 * partition instead, which is what the committed baseline was frozen on; the
 * two agree column-for-column wherever every borehole is divided (Cross-section
 * 1), and the raw arm simply has FEWER gaps elsewhere because a column with no
 * bands is dropped from its axis.
 */
function auditedPartition(sec: RawSection): {
  columns: PartitionColumn[]
  alongM: number[]
  edges: CorrelationEdge[]
  regions: SectionRegion[]
  preMerge: (SectionRegion & { role: 'construct' | 'fill' })[]
  lithoColumns: PartitionColumn[]
  lithoEdges: CorrelationEdge[]
  lithoRegions: SectionRegion[]
} {
  const G = assemble(sec.geotech)
  const empty = new Map<string, BodyBoundaryResponse>()
  if (process.env.GEOTECH_210_RAW === '1') {
    // The RAW arm audits the whole-section geotech partition, which has no litho frame at all —
    // so it carries no parent litho lines and the envelope stays the packing ties' alone.
    const raw = computeSectionFillActive(
      G.columns,
      G.edges,
      deriveSectionApexOverrides(G.columns, G.edges, G.alongM, empty, true),
      G.alongM,
    )
    const tagged = raw.map((r) => ({ ...r, role: 'construct' as const }))
    return { lithoColumns: [], lithoEdges: [], lithoRegions: [], ...G, regions: raw, preMerge: tagged }
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
    packingClassOf: loadPackingClassOf(),
  })
  return {
    columns: geotechColumns,
    alongM: L.alongM,
    edges: G.edges,
    regions: out.regions,
    // The PRE-MERGE surface, role-tagged. Balloons audit only the CONSTRUCT
    // loops — the geometric shapes the law drew from the ties, structurally
    // inside their own envelope, so the expected count is ZERO and any hit is
    // a constructor bug (owner: "there shouldn't be pre merge ballooning
    // anywhere ... not untill we do the geometrical fill"). Fill loops are the
    // law's dominant-lithology step and legitimately exceed one band's extent.
    // Existence and span audit the MERGED surface: a same-mass band emits
    // NOTHING by the law, so its only appearance is the welded mass.
    preMerge: out.preMergeRegions,
    lithoColumns: L.columns,
    lithoEdges: L.edges,
    lithoRegions,
  }
}

function auditSection(sec: RawSection): Violation[] {
  const G = auditedPartition(sec)
  const regions = G.regions

  // layerId → owning column index.
  const columnOf = new Map<string, number>()
  for (let ci = 0; ci < G.columns.length; ci++) {
    for (const u of G.columns[ci].units) columnOf.set(u.layerId, ci)
  }
  // FAMILY MEMBERSHIP, computed exactly as the fill computes it (same two
  // helpers, same inputs) so the audit counts the ties the constructor kept.
  const bandParents = resolveBandParents(G.columns, G.lithoColumns)
  const { familyOfLithoLayer } = buildLithoFamilies(
    G.lithoColumns,
    G.lithoEdges,
    G.lithoRegions,
  )
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

  // LITHO APPROVAL CARRIES DOWN (owner ruling A, 2026-08-19). A band's parent litho unit's own
  // ties are lines drawn for this mass too, so the family flood follows them and the envelope has
  // to know that — otherwise every legitimate flood along a litho tie reads as a balloon here.
  //
  // They widen the ENVELOPE only. They are deliberately NOT counted in ``tieCount``: 2/1/0 is a
  // PACKING-tie count, so a litho-tied band with no packing tie is still a 0-tie band that must
  // close its own loop, and a deleted packing tie is still deleted.
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
      const neighbour =
        side === 'top' ? sorted[idx - 1]?.layerId : sorted[idx + 1]?.layerId
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
        const tag = `${sec.name} col${ci} gap${gap} class=${u.formationId.slice(0, 8)} ` +
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
        const banded = [...(bandedColumnsByFamily.get(familyOfBand.get(u.layerId) ?? '') ?? [])].sort(
          (a, b) => a - b,
        )
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
        // about a construct painting over ground ANOTHER mass measured.
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
        // The allowed envelope: the band's own extent, UNIONED with its tie
        // line evaluated over the region's own fraction reach — a one-tie
        // onlap legitimately spans its tie's dip (it follows the line), but
        // it may never leave [own level ∪ the line], which is exactly what
        // the balloons did (the 0.41 m crust reached the channel floor 1.4 m
        // below its tie's local level).
        const bandTop = surf - u.topDepthM
        const bandBase = surf - u.baseDepthM
        const parent = parentOfBand.get(u.layerId)
        const lines = [
          ...(tieLines.get(`${u.layerId}|${gap}`) ?? []),
          ...(parent === undefined ? [] : (parentLine.get(`${parent}|${gap}`) ?? [])),
        ]
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

describe('2/1/0 conformance gate', () => {
  if (process.env.GEOTECH_210 !== '1' || !existsSync(INPUT)) {
    it.skip('dormant (set GEOTECH_210=1)', () => {})
    return
  }
  it('every band obeys 2/1/0, ratcheted against the frozen baseline', () => {
    process.env.STRIX_PARTITION_V2 = '1'
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
    const perSection: Record<string, Counts> = {}
    const lines: string[] = []
    for (const sec of raw.sections) {
      const violations = auditSection(sec)
      const counts: Counts = { balloon: 0, missing: 0, nospan: 0, overreach: 0 }
      for (const v of violations) counts[v.kind]++
      perSection[sec.name] = counts
      lines.push(
        `${sec.name.padEnd(18)} balloon=${counts.balloon} missing=${counts.missing} ` +
          `nospan=${counts.nospan} overreach=${counts.overreach}`,
      )
      for (const v of violations) lines.push(`    [${v.kind}] ${v.detail}`)
    }
    writeFileSync(OUT, lines.join('\n') + '\n')
    console.log(lines.filter((l) => !l.startsWith('    ')).join('\n'))

    if (process.env.GEOTECH_210_FREEZE === '1') {
      writeFileSync(BASELINE, JSON.stringify(perSection, null, 1) + '\n')
      console.log(`froze baseline → ${BASELINE}`)
      expect(true).toBe(true)
      return
    }
    if (!existsSync(BASELINE)) {
      console.log('no baseline committed — report-only run (freeze with GEOTECH_210_FREEZE=1)')
      expect(true).toBe(true)
      return
    }
    const frozen = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, Counts>
    const regressions: string[] = []
    for (const [name, counts] of Object.entries(perSection)) {
      const base = frozen[name]
      if (!base) continue // a new section has no baseline yet
      for (const kind of ['balloon', 'missing', 'nospan', 'overreach'] as const) {
        if (counts[kind] > base[kind]) {
          regressions.push(`${name}: ${kind} ${base[kind]} → ${counts[kind]}`)
        }
      }
    }
    expect(regressions, `2/1/0 violations may only shrink; details in ${OUT}`).toEqual([])
  })
})
