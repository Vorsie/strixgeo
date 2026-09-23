/**
 * partitionFillV2/labelFaces.ts — face labelling (design §3 step 4, §2).
 *
 * Each traced arrangement face is a partition cell in metres×elevation space. This
 * module stamps it with:
 *
 *   - ``formationId`` — from the column units whose contact (column-vertical)
 *     segments bound the face (design §3: "formation comes from the column units
 *     whose contact segments bound the face").
 *   - ``bodyId`` — from the same bounding units' layer rows (never invented; body
 *     resolution stays the backend's job, design §3).
 *   - ``kind`` — BAND / ONLAP / LENS by BOUNDARY COMPOSITION (design §2), not tie
 *     counting: a boundary that runs tie->tie (or exits the section) -> BAND; one
 *     tied side + one synthesized closing -> ONLAP; no ties, closed via own
 *     contacts + closing curves -> LENS.
 *
 * The bounding column-vertical curve ids are ``col<ci>:u<ui>`` (see
 * ``emitCurves.emitColumnVerticals``); tie curve ids start ``tie``; closing curve
 * ids start ``close``. That id vocabulary is the labelling signal.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { channelMatrixRelabel } from './channelMatrix'
import { type LensLabel } from './emitLenses'
import { type BracketStrip } from './emitSubstrate'
import { faceLayerIds, withFaceLayerIds } from './faceLayerIds'
import { type ColumnGeom } from './sectionGeom'
import {
  buildSegCurveMap,
  buildVoidEnvelope,
  classifyFaceSeed,
  COL_LENS_SEED_RE,
  COL_SEED_RE,
  isMergeArtifactSeed,
  type SeedClass,
} from './seedClassifier'
import { twoSidedTerminationsEnabled } from './tileFlags'
import { type Arrangement, type Face } from './types'

/** BAND / ONLAP / LENS classification of a face. */
export type FaceClass = 'band' | 'onlap' | 'lens'

/**
 * A topology-defect record (SEED_FILL_MANDATE §B). A face whose column-edge seeds do NOT
 * resolve to exactly one formation carries this so the seed gate can pin it and Step 4 can
 * repair it defect-by-defect. INTERIM (until Step 4 empties the list): a defect face keeps its
 * CURRENT painted litho in the output regions (so the render never collapses and holes don't
 * explode mid-campaign) but carries this record — see the seed-path note in ``labelFaces``.
 */
export interface FaceDefect {
  reason: 'zero-seed' | 'multi-seed' | 'merged-minority'
  /** The ``col<ci>:u<ui>`` seed refs found on the boundary (may be empty for zero-seed). */
  seedRefs: string[]
  /** All input-curve ids bounding the face (provenance for the linework repair). */
  boundingCurveIds: string[]
  bounds: { xLo: number; xHi: number; elLo: number; elHi: number }
  /**
   * ``merged-minority`` only: the RECORDED minority litho of the enclosed lens whose own face this
   * is (the ``lensLabel`` formation that ``labelOneFace`` kept). The face's single seed is the
   * ENCLOSING MATRIX formation (``mergeArtifactSeed`` below), so the seed disagrees with the
   * recorded minority — the ruling-8r "lines before the merge" violation: a seed manufactured BY
   * the same-formation enclosed-lens merge is illegitimate linework, not a valid seed. Step 4's 8r
   * repair (emission on raw units) restores the true minority seed and ratchets this class to 0.
   */
  minorityFormation?: string
  /** ``merged-minority`` only: the matrix formation the merge-artifact seed resolved to. */
  mergeArtifactSeed?: string
}

/** A face with its litho label + classification. */
export interface LabelledFace {
  face: Face
  formationId: string
  bodyId: string | null
  klass: FaceClass
  /** The bounding column-vertical unit refs (colIndex, unitIndex). */
  units: { ci: number; ui: number }[]
  /**
   * The ``litho_layer`` ids of the drilled units that PRODUCED this face's paint:
   * the bounding units matching the face's own formation (plus, on the seed path,
   * a ``col<ci>:lens<j>`` seed's enclosed-lens unit; on an enclosed-lens face, the
   * lens's own layer). Deduped, deterministic order. ABSENT when empty and on
   * fallback faces — inferred fill names no layer. Forwarded onto the sliced
   * region (``slice.ts``) as ``SectionRegion.layerIds`` for the body recompute's
   * label-independent identity evidence (layer ids never change; body ids are the
   * labels the recompute itself rewrites).
   */
  layerIds?: string[]
  /**
   * Flag-ON seed path only (SEED_FILL_MANDATE §B): the ``col<ci>:u<ui>`` seed refs whose picked
   * unit's formation painted this face (kept for diagnostics + the 8j body merge provenance).
   * Absent on the flag-OFF path (byte-identical to before).
   */
  seedRefs?: string[]
  /**
   * Flag-ON seed path only: the seed classification of this face. ``single-seed`` faces are
   * painted from their column seed (the mandate's paint-bucket rule); ``topology-defect`` faces
   * (zero-seed / multi-seed) keep their INTERIM current paint but carry ``defect`` below.
   */
  seedClass?: SeedClass
  /**
   * Flag-ON seed path only: the topology-defect record for a zero/multi face (absent for a
   * single-seed or explicit-void face). Its presence marks a face whose OUTPUT litho is INTERIM
   * (the pre-seed paint), pinned by the seed gate's 151/9 ratchet until Step 4 repairs the
   * linework to a single seed.
   */
  defect?: FaceDefect
  /**
   * True when the face's paint came from a FALLBACK label authority — the sub-TD substrate
   * label (``emitBottomTieSubstrate``) or the flood-closure label (``emitLonePinch`` /
   * ``emitFloodWedge``): no column vertical bounds the face, so the litho is inferred fill,
   * not drilled data. Stamped by ``labelOneFace`` (the one place both label authorities
   * live), so the flag-ON seed path inherits it through its ``...base`` spreads and the
   * marker cannot flip with ``twoSidedTerminationsEnabled()``. Forwarded onto the sliced
   * region (``slice.ts``) as ``SectionRegion.fallback``.
   */
  fallback?: true
  /**
   * Internal marker: this is an ENCLOSED-LENS's OWN face (the ``lensLabel`` branch of
   * ``labelOneFace``). Such a face carries the collapsed lens's TRUE litho, which the seed
   * classifier CANNOT see — the lens's minority unit was merged out of ``col.units`` at the
   * column level (sectionGeom), so the face's only non-zero column edge belongs to the ENCLOSING
   * matrix. Reading that edge would repaint the lens as its matrix (the ``literalCorr`` col18
   * middle-clay / coherent-stack SILT-lens limitation). The seed path therefore KEEPS the lens
   * label here — this is the separately-pinned host-split rebuild (Step 4 / annulus-notch
   * splitter), NOT this session's paint override.
   */
  enclosedLens?: boolean
}

const COL_RE = /^col(\d+):u(\d+)$/

/**
 * Label every face of the arrangement.
 *
 * TWO PATHS (SEED_FILL_MANDATE):
 *
 *   - FLAG-OFF (``twoSidedTerminationsEnabled() === false``): the ORIGINAL length-weighted
 *     ``resolveLabel`` vote + flood/substrate/lens label authorities. BYTE-IDENTICAL to before
 *     the seed rewrite — the campaign safety line. Never touched here.
 *
 *   - FLAG-ON with an ``arrangement`` provided: the SEEDED paint-bucket path (mandate §B). Each
 *     face is classified by its NON-ZERO-LENGTH ``col<ci>:u<ui>`` boundary edges (the shared
 *     ``seedClassifier``). A ``single-seed`` face is painted from THAT column seed — never a
 *     vote, flood, enclosure, or facing sample. A ``zero-seed`` / ``multi-seed`` face is a
 *     topology-defect: INTERIM it keeps its current (pre-seed) paint so the render never
 *     collapses and holes don't explode mid-campaign, but it carries a ``defect`` record and the
 *     seed gate pins the exact 151/9 count as an identity ratchet Step 4 drives to 0. An
 *     ``explicit-void`` (geometric exterior) face is dropped (no litho), same as an unlabelled
 *     cell today. **This interim-output decision is the ONE deviation from "a defect is never
 *     painted" and it is TEMPORARY by construction** — voiding 151 faces now would break every
 *     holes gate mid-mandate; the mandate's gate-1..4 acceptance applies at LANDING (after
 *     Step 4). Flag-ON WITHOUT an arrangement (legacy 3-arg callers) falls back to the old path.
 *
 * Parameters
 * ----------
 * faces : readonly Face[]
 *     Traced arrangement faces (metres×elevation).
 * columns : readonly ColumnGeom[]
 *     The normalised columns, so a ``col<ci>:u<ui>`` id resolves to a unit.
 * lensLabels : optional lens/flood/substrate labels (flag-OFF + defect-interim authority only).
 * arrangement : optional built arrangement. REQUIRED to activate the flag-ON seed path — the
 *     per-edge curve provenance (half-edges) is the only way to measure a non-zero column-edge
 *     seed (``Face.boundingCurveIds`` cannot tell a seed from a vertex touch).
 *
 * Returns
 * -------
 * LabelledFace[]
 *     One entry per face that resolves to a litho unit; faces bounded by NO column
 *     vertical / geometric voids are dropped.
 */
export function labelFaces(
  faces: readonly Face[],
  columns: readonly ColumnGeom[],
  lensLabels?: ReadonlyMap<string, LensLabel>,
  arrangement?: Arrangement,
  bracketStrips?: readonly BracketStrip[],
): LabelledFace[] {
  // The seed classifier needs the per-edge curve provenance; build it once when the flag-ON
  // seed path is active. When the flag is OFF or no arrangement was threaded, ``segCurve`` stays
  // undefined and every face takes the original label path (flag-OFF byte-identity).
  const seedActive = twoSidedTerminationsEnabled() && arrangement !== undefined
  const segCurve = seedActive ? buildSegCurveMap(arrangement!) : undefined
  // The seed void test's per-column top-band + floor arrays depend only on the section, so build
  // them ONCE here and thread them through ``classifyFaceSeed`` instead of rebuilding per face.
  const voidEnvelope = seedActive ? buildVoidEnvelope(columns) : undefined

  const out: LabelledFace[] = []
  for (const face of faces) {
    // ---- BRACKETED JUMP-TIE STRIP (owner ruling 2026-08-18). ----
    // "2/1/0 is still the basis of the model — that VD quad has a top and a
    // bottom correlation so it should be there." A face bounded by BOTH curves
    // of a bracketed bridge pair IS the strip between the owner's two
    // correlations: a BAND of the bracketed formation, through every
    // pass-through column. This outranks the seed path and the column-edge
    // weighting alike — the pass-through column's own vertical bounds the
    // strip, but the tie pair, not the crossed band, is the authority here.
    const bracket = bracketFaceLabel(face, bracketStrips)
    if (bracket) {
      out.push(bracket)
      continue
    }
    // ---- FLAG-ON SEED PATH (mandate §B). ----
    if (seedActive && segCurve) {
      const seed = classifyFaceSeed(face, segCurve, columns, voidEnvelope)
      const base = labelOneFace(face, columns, lensLabels)
      // ---- RULING 8r DISCRIMINATOR (SEED_FILL_MANDATE Steps 2+3, 2026-07-19). ----
      // An ENCLOSED-LENS's OWN face carries the collapsed lens's TRUE minority litho
      // (``base.enclosedLens`` + ``base.formationId`` = the ``lensLabel`` minority). When the lens
      // was a SAME-COLUMN enclosed lens, ``sectionGeom.extractEnclosedLenses`` DELETED that minority
      // unit from that column's ``units`` (merging the enclosing matrix above+below into one band),
      // so the lens face's ONLY non-zero column edge is the ENCLOSING MATRIX on the SAME column — a
      // seed manufactured BY the merge. Ruling 8r ("lines before the merge"): the pre-merge is
      // illegitimate linework, so a seed produced by the merge is NOT a valid seed.
      //
      // The discriminator is STRUCTURAL, not a heuristic: a face is a genuine merge-artifact ONLY
      // when its single seed edge belongs to a column that HOSTS an enclosed lens whose formation ==
      // this face's minority label AND whose recorded ``matrixFormationId`` == the seed formation.
      // That triple (same host column + minority match + matrix match) is exactly the merge's
      // fingerprint. It correctly EXCLUDES a foreign lens biting into a matrix notch (CS1#11: a
      // KLEI lens emitted from a neighbour column bites the SILT matrix near col0 — col0 hosts NO
      // enclosed lens, so its col0:u0 SILT seed is a REAL seed, not a merge artifact -> paint SILT),
      // and INCLUDES the true same-column merge (coherentStack: col0's silt lens, col0:u1 ZAND seed
      // == the lens's matrixFormationId -> keep SILT). It also keeps literalCorr CLAY green (a
      // CLAY-seeded face whose seed IS the minority agrees -> ordinary single-seed path below).
      if (
        base?.enclosedLens === true &&
        seed.classification === 'single-seed' &&
        seed.seedFormations[0] !== base.formationId &&
        isMergeArtifactSeed(seed.seedRefs, seed.seedFormations[0], base.formationId, columns)
      ) {
        out.push({
          ...base,
          seedRefs: seed.seedRefs,
          seedClass: 'single-seed',
          defect: {
            reason: 'merged-minority',
            seedRefs: seed.seedRefs,
            boundingCurveIds: [...face.boundingCurveIds],
            bounds: seed.bounds,
            minorityFormation: base.formationId,
            mergeArtifactSeed: seed.seedFormations[0],
          },
        })
        continue
      }
      if (seed.classification === 'single-seed') {
        // Paint from the picked-unit column edge — the paint-bucket rule. The bodyId comes from
        // the SAME seed unit (the smallest (ci,ui) seed ref of the winning formation), preserved
        // for the 8j post-fill body merge. The kind (BAND/ONLAP/LENS) still comes from boundary
        // composition (geometry) via the original label path, so the region shape is unchanged;
        // only the formationId/bodyId are overridden to the seed.
        const { bodyId } = seedBody(seed.seedRefs, seed.seedFormations[0], columns)
        const entry: LabelledFace = {
          ...(base ?? { face, klass: 'band' as FaceClass, units: unitsOf(face) }),
          face,
          formationId: seed.seedFormations[0],
          bodyId,
          seedRefs: seed.seedRefs,
          seedClass: 'single-seed',
        }
        // ---- THE CHANNEL MATRIX OWNS THE VACANCY (owner, 2026-08-18). ----
        // The paint-bucket rule assumes the surviving column edge speaks for the face. On a
        // face that OTHER units pinched out of, it does not: the thick masses cut their own
        // edges away with their flanks and a sliver of a thin band can be the only edge left,
        // so a 0.38 m silt painted a 1 m channel and a 0.41 m sand crust painted 2.8 m. Such a
        // face takes the DOMINANT mass of its own column over its own elevation window
        // (``channelMatrixRelabel``, which returns null — keep the seed — whenever the seed
        // already is that mass, so every ordinary matrix face is untouched).
        // A seed spread over TWO columns is a real gap-spanning band, not a vacancy — it has
        // no single column to answer from, so ``seedColumnOf`` returns null and the face keeps
        // its seed paint (the deep-to-deep substrate bands live here).
        const seedCi = seedColumnOf(seed.seedRefs)
        const relabel =
          seedCi === null
            ? null
            : channelMatrixRelabel(face, columns, lensLabels, seed.seedFormations[0], seedCi)
        if (relabel) {
          out.push(
            withFaceLayerIds(
              { ...entry, formationId: relabel.unit.formationId, bodyId: relabel.unit.bodyId },
              [relabel.unit.layerId],
            ),
          )
          continue
        }
        // ``layerIds`` follows the OVERRIDDEN (seed) formation, never the base's — the
        // spread above may have inherited ids resolved under a different paint.
        out.push(
          withFaceLayerIds(
            entry,
            faceLayerIds(seed.seedFormations[0], entry.units, columns, seed.seedRefs),
          ),
        )
        continue
      }
      if (seed.classification === 'explicit-void') {
        // A geometric exterior / no-fill face — never invent a lithology (mandate). Drop it, the
        // same way an unlabelled cell is dropped on the flag-OFF path.
        continue
      }
      // zero-seed-defect / multi-seed-defect: INTERIM keep the current (pre-seed) paint so the
      // render + holes stay identical, but carry the defect record for the seed gate ratchet.
      if (!base) continue // no interim label either (a genuine hole) — drop, as before.
      // A ZERO-SEED face is pure vacancy — no column edge speaks for it at all, and its interim
      // paint is whatever flood label happened to bound it. The same owner ruling applies, read
      // from the ONE column the face reaches (``'nearest'``); a vacancy touching two columns is
      // a band and is refused there. MULTI-seed faces are left alone: their interim paint is
      // already the length-weighted vote across real bounding edges, not a single sliver.
      const vacancyRelabel =
        seed.classification === 'zero-seed-defect'
          ? channelMatrixRelabel(face, columns, lensLabels, base.formationId, 'nearest')
          : null
      out.push({
        ...base,
        ...(vacancyRelabel
          ? {
              formationId: vacancyRelabel.unit.formationId,
              bodyId: vacancyRelabel.unit.bodyId,
              layerIds: [vacancyRelabel.unit.layerId],
            }
          : {}),
        seedRefs: seed.seedRefs,
        seedClass: seed.classification,
        defect: {
          reason: seed.classification === 'zero-seed-defect' ? 'zero-seed' : 'multi-seed',
          seedRefs: seed.seedRefs,
          boundingCurveIds: [...face.boundingCurveIds],
          bounds: seed.bounds,
        },
      })
      continue
    }

    // ---- FLAG-OFF PATH (original vote/flood authorities — byte-identical). ----
    const labelled = labelOneFace(face, columns, lensLabels)
    if (labelled) out.push(labelled)
  }
  return out
}

/**
 * The bodyId of the seed formation on a single-seed face: the ``bodyId`` of the smallest seed ref
 * whose unit carries the winning formation. Resolves BOTH seed-ref forms so a face seeded by an
 * enclosed-lens sub-segment gets the lens's own drilled body, never null:
 *   - ``col<ci>:u<ui>``   -> ``columns[ci].units[ui].bodyId``          (a picked column unit)
 *   - ``col<ci>:lens<j>`` -> ``columns[ci].enclosedLenses[j].lens.bodyId`` (the raw interbed the
 *     ruling-8r id-split gave its own column edge; ``extractEnclosedLenses`` spliced the minority
 *     unit out of ``units``, so ONLY this form carries its body — a ``col:u`` lookup would miss it
 *     and return null, dropping the freedraw/apex override key ``bodyId@gap`` for that lens).
 * Deterministic (seed refs are sorted); matches the region's own drilled unit — never invented,
 * and body ownership stays separate from formation authority (SEED_FILL_MANDATE §B).
 */
function seedBody(
  seedRefs: readonly string[],
  formationId: string,
  columns: readonly ColumnGeom[],
): { bodyId: string | null } {
  for (const ref of seedRefs) {
    const mu = COL_SEED_RE.exec(ref)
    if (mu) {
      const u = columns[Number(mu[1])]?.units[Number(mu[2])]
      if (u && u.formationId === formationId) return { bodyId: u.bodyId }
      continue
    }
    const ml = COL_LENS_SEED_RE.exec(ref)
    if (ml) {
      const el = columns[Number(ml[1])]?.enclosedLenses[Number(ml[2])]
      if (el && el.lens.formationId === formationId) return { bodyId: el.lens.bodyId }
    }
  }
  return { bodyId: null }
}

/**
 * The COLUMN index a face's seed refs belong to, or ``null`` when they disagree / none parse.
 *
 * A single-seed face's refs all name one formation but may name several units of it; they sit
 * on ONE column in every real case. Returning ``null`` on disagreement keeps the channel-matrix
 * rule from guessing which column to read (it then leaves the seed paint alone).
 *
 * Parameters
 * ----------
 * seedRefs : readonly string[]
 *     ``col<ci>:u<ui>`` / ``col<ci>:lens<j>`` refs from the seed classifier.
 *
 * Returns
 * -------
 * number | null
 *     The shared column index, or ``null``.
 */
function seedColumnOf(seedRefs: readonly string[]): number | null {
  let ci: number | null = null
  for (const ref of seedRefs) {
    const m = ref.match(COL_SEED_RE) ?? ref.match(COL_LENS_SEED_RE)
    if (!m) continue
    const c = Number(m[1])
    if (ci === null) ci = c
    else if (ci !== c) return null
  }
  return ci
}

/** The bounding column-vertical unit refs of a face (fallback ``units`` when no interim label). */
function unitsOf(face: Face): { ci: number; ui: number }[] {
  const units: { ci: number; ui: number }[] = []
  for (const id of face.boundingCurveIds) {
    const m = COL_SEED_RE.exec(id)
    if (m) units.push({ ci: Number(m[1]), ui: Number(m[2]) })
  }
  return units
}

/**
 * Label ONE face by the ORIGINAL boundary-composition authorities (length-weighted
 * ``resolveLabel`` vote + flood/substrate/lens labels). This is the flag-OFF logic verbatim,
 * extracted so the flag-ON seed path can reuse it (a) as the interim paint for a topology-defect
 * face, and (b) as the kind/units source for a single-seed face (whose formation/body it then
 * overrides). Returns ``null`` when the face resolves to no litho (dropped).
 */
/**
 * The bracket-strip label for a face, or ``null`` when the face is not one.
 *
 * Membership is GEOMETRIC: every vertex of the face lies between the strip's
 * two lines (with millimetre slack) inside its x-range.  Curve identity is
 * deliberately not consulted — at the anchor columns the bridge is coincident
 * with the columns' own contact curves and the arrangement may hand the
 * boundary to either id, while corner-touching neighbours graze both curves
 * without lying between them.
 */
function bracketFaceLabel(
  face: Face,
  bracketStrips?: readonly BracketStrip[],
): LabelledFace | null {
  if (!bracketStrips || bracketStrips.length === 0) return null
  const eps = 2e-3 // the arrangement's 1 mm snap, doubled for interpolation noise
  for (const strip of bracketStrips) {
    const span = strip.hiX - strip.loX
    if (Math.abs(span) < 1e-9) continue
    let inside = true
    for (const p of face.polygon) {
      if (p.x < strip.loX - eps || p.x > strip.hiX + eps) {
        inside = false
        break
      }
      const t = (p.x - strip.loX) / span
      const upper = strip.upperLo + t * (strip.upperHi - strip.upperLo)
      const lower = strip.lowerLo + t * (strip.lowerHi - strip.lowerLo)
      if (p.y > upper + eps || p.y < lower - eps) {
        inside = false
        break
      }
    }
    if (inside) {
      return {
        face,
        formationId: strip.formationId,
        bodyId: strip.bodyId,
        klass: 'band',
        units: unitsOf(face),
        ...(strip.layerIds.length > 0 ? { layerIds: strip.layerIds } : {}),
      }
    }
  }
  return null
}

function labelOneFace(
  face: Face,
  columns: readonly ColumnGeom[],
  lensLabels?: ReadonlyMap<string, LensLabel>,
): LabelledFace | null {
  {
    const units: { ci: number; ui: number }[] = []
    let nTie = 0
    let nClose = 0
    let nLensCurves = 0
    // Any synthesized boundary curve that is NOT an enclosed-lens curve. An enclosed
    // lens's OWN triangle face is bounded ONLY by lens curves + its single emitting
    // column vertical; the enclosing MATRIX face (a concave notch touching the same
    // lens curves where the notch bites the column edge) is ALSO bounded by the
    // surface / close / floor / tie curves. This flag is what tells the lens triangle
    // (the small own-elevation face) from the matrix notch that shares its lens ids —
    // the ``face.holes.length === 0`` test alone cannot, because a NOTCH (lens riding
    // the matrix column edge, the pure-case shape) leaves BOTH faces hole-free
    // (adjacent-simple, not nested). See design §4 increment-12 row.
    let nonLensBoundary = false
    // A gap-crossing ANCHOR on the boundary — a real tie/bridge/substrate/flood/onlap curve
    // (nTie) OR a surface/band contour curve. STRICT 2/1/0 (ruling 8): the ``spansGap → band``
    // promotion (below) fires ONLY when such an anchor is present. A face that spans the gap
    // merely by touching two UNTIED column verticals (the retired geometric same-formation
    // auto-match) is NOT promoted — it falls to ``classifyFace`` and terminates (LENS).
    let hasAnchorSpan = false
    let lensLabel: LensLabel | undefined
    let substrateLabel: LensLabel | undefined
    let floodLabel: LensLabel | undefined
    for (const id of face.boundingCurveIds) {
      const m = COL_RE.exec(id)
      if (m) {
        units.push({ ci: Number(m[1]), ui: Number(m[2]) })
      } else if (id.startsWith('flood') || id.startsWith('bandseam')) {
        // A lone-side FLOOD-closure curve (emitLonePinch): the vacated wedge beyond a
        // pinch apex, bounded only by these curves + the interval brackets + the
        // pinch's own ``close`` curves (never a full facing column vertical — the wedge
        // triangles are corner->conv->apex). Its label carries the bracket/facing
        // matrix formation, so the wedge reads as a BAND. Same trick as the sub-TD
        // substrate wedge (btfloor/btcurtain) — a face with no column vertical is
        // stamped from the flood label below.
        //
        // ``bandseam`` is the RULING-8d mismatched-first-unit midpoint seam (emitEnclosingFlood).
        // It was ``flood``-prefixed until 2026-07-20, when it was re-roled to LINE ART for the paint
        // tool (its own prefix so ``phaseOf`` tags it phase-0, not phase-3 scaffold). It carries NO
        // label (``lensLabels.get`` returns nothing), so its ONLY effect here — nonLensBoundary /
        // hasAnchorSpan / nTie++ — is IDENTICAL to the old ``flood`` classification. Kept in this
        // exact branch so face labelling stays byte-identical (the re-role is export-only).
        const l = lensLabels?.get(id)
        if (l) floodLabel = l
        // PLAIN 2/1/0 (owner 2026-09-23, Cross-section 1 GEO-08/118-S13 -> GEO-23/116-S6: "the peat
        // has 0 correlations to the left but doesn't emit a lens"): the BARE shallow-TD floor
        // (emitEnclosingFlood's ``flood<gap>``, the one flood curve that carries NO label) cutting
        // through an enclosed lens does not un-lens the pieces. A lens closes at its own level,
        // below the far test's TD too, so the piece above the floor and the piece below it are
        // both the lens's own face (each bounded by a lens flank, the floor and the lens's column
        // vertical). A LABELLED flood (emitLonePinch's vacated-wedge closure, the sweep wedges)
        // still disqualifies, and the floor still anchors band classification below.
        if (!(id.startsWith('flood') && l === undefined)) nonLensBoundary = true
        hasAnchorSpan = true
        nTie++
      } else if (id.startsWith('btfloor') || id.startsWith('btcurtain')) {
        // A deep-to-deep flat-floor SUBSTRATE curve (emitBottomTieSubstrate): its
        // label carries the bottom-tie formation. The sub-TD wedge below every
        // column TD is bounded only by these curves (no column vertical reaches
        // there), so it is labelled from here as a BAND (the tie fill is authoritative).
        const l = lensLabels?.get(id)
        if (l) substrateLabel = l
        nonLensBoundary = true
        hasAnchorSpan = true
        nTie++
      } else if (id.startsWith('onlap')) {
        // A SURFACE-ANCHORED ONLAP pinch's BASE edge (emitLonePinch, increment 18): the
        // edge that laps the tied band. It carries NO litho label (the pinch face keeps its
        // own column-vertical litho) but counts as a TIE so the pinch face classifies as
        // ONLAP (``classifyFace`` needs nTie>0 AND nClose>0). The rising-apex surface onlap
        // does not touch the base tie/band directly, so without this marker its face — a
        // clean triangle bounded by a column vertical + closings — would misread as a LENS.
        nonLensBoundary = true
        hasAnchorSpan = true
        nTie++
      } else if (id.startsWith('tie') || id.startsWith('bridge')) {
        // A ``bridge`` is a deep-to-deep substrate jump tie (emitSubstrate) — it
        // anchors the face the same way an ordinary tie does, so it counts toward
        // BAND classification.
        nonLensBoundary = true
        hasAnchorSpan = true
        nTie++
      } else if (id.startsWith('surface') || id.startsWith('bandc')) {
        // The top-band (``surface``) line and a matched-pair band's own top/base contour
        // (``bandc``) are gap-crossing ANCHOR curves — they authorise a spanning face to
        // read BAND (ruling 8). They are NEITHER a tie (no nTie) NOR a closing (no nClose):
        // a band face bounded by a tie + these still reads BAND via ``classifyFace``, and an
        // adjacent fill merely abutting a contour is not mis-promoted to onlap. But when a
        // spanning face's ONLY gap-crossing evidence is a surface/bandc line (a seam-split
        // same-formation quad bracketed by the surface band), that anchor is what keeps it a
        // band rather than being retired to a lens.
        nonLensBoundary = true
        hasAnchorSpan = true
      } else if (id.startsWith('close')) {
        nonLensBoundary = true
        nClose++
      } else if (id.startsWith('lens')) {
        // A synthesized enclosed-lens curve (emitLenses / emitEnclosedLensCurves). It
        // appears on TWO faces: the lens's OWN triangle (bounded ONLY by lens curves +
        // its single emitting column vertical) AND the enclosing MATRIX face that the
        // lens bites into (a concave notch when the lens rides the matrix column edge —
        // the pure case — or a true annulus HOLE ring when the lens floats interior to a
        // gap-spanning band). Only the lens's own triangle wins the lens label; the
        // discriminator is ``nonLensBoundary`` (the matrix face always also carries a
        // surface/close/floor/tie curve) + ``!spansGap`` (the matrix notch spans the gap),
        // computed after the loop. See design §4 increment-12 row.
        const l = lensLabels?.get(id)
        if (l) lensLabel = l
        nLensCurves++
        nClose++
      }
    }

    // The enclosed lens's OWN face: it carries a lens label, its ENTIRE synthesized
    // boundary is lens curves (``!nonLensBoundary`` — no surface / close / floor / tie
    // curve), and it does NOT span the gap (it rides a single column, apex mid-gap).
    // The enclosing matrix face shares the SAME lens curve ids (where the lens bites its
    // edge) but is disqualified on both counts — it always carries the surface / floor /
    // close boundary and spans the gap. This replaces the old ``face.holes.length === 0``
    // test, which mislabelled the matrix NOTCH as the lens (a notch leaves both faces
    // hole-free — adjacent-simple, not nested; see the loop comment + design §4 incr-12).
    const spansGap = new Set(units.map((u) => u.ci)).size >= 2
    if (lensLabel && !nonLensBoundary && nLensCurves > 0 && !spansGap) {
      // The enclosed lens's OWN face — mark it so the seed path keeps this true lens litho rather
      // than repainting it from the enclosing-matrix column edge (the pinned host-split limitation).
      // ``layerIds``: the lens's OWN layer, from its label — its minority unit was spliced out of
      // ``col.units`` by the matrix merge, so the bounding refs (all matrix) cannot resolve it.
      return {
        face,
        formationId: lensLabel.formationId,
        bodyId: lensLabel.bodyId,
        klass: 'lens',
        units,
        enclosedLens: true,
        ...(lensLabel.layerId !== undefined ? { layerIds: [lensLabel.layerId] } : {}),
      }
    }
    // A sub-TD substrate wedge is bounded only by flat-floor + curtain curves — no
    // column vertical reaches below TD, so ``units`` is empty. Stamp it from the
    // bottom-tie label as an authoritative BAND (quad). A face that ALSO has a column
    // vertical is real drilled data — the column label wins (handled below), so the
    // substrate label only applies when there is no column vertical.
    if (substrateLabel && units.length === 0) {
      // ``fallback``: the paint is the substrate label's carry, not drilled data (see LabelledFace).
      return { face, formationId: substrateLabel.formationId, bodyId: substrateLabel.bodyId, klass: 'band', units, fallback: true }
    }
    // A lone-side flood wedge is bounded only by flood/close/bracket curves (its
    // corner->conv->apex triangles never carry a full facing column vertical), so
    // ``units`` is empty. Stamp it from the flood (bracket-matrix) label as a BAND — the
    // facing matrix claiming the width past a pinch apex (finding A). As with the
    // substrate label, a wedge face that ALSO has a real column vertical is drilled data;
    // the column label wins (handled below).
    if (floodLabel && units.length === 0) {
      // ``fallback``: the paint is the flood label's inference, not drilled data (see LabelledFace).
      return { face, formationId: floodLabel.formationId, bodyId: floodLabel.bodyId, klass: 'band', units, fallback: true }
    }
    if (units.length === 0) return null // no column vertical bounds this cell — skip.

    // The face's elevation extent — resolveLabel weights each bounding unit by how much
    // of its column edge falls on this face (overlap with [faceMinElev..faceMaxElev]).
    let faceMinElev = Infinity
    let faceMaxElev = -Infinity
    for (const p of face.polygon) {
      if (p.y < faceMinElev) faceMinElev = p.y
      if (p.y > faceMaxElev) faceMaxElev = p.y
    }
    const { formationId, bodyId } = resolveLabel(units, columns, faceMinElev, faceMaxElev)
    // A face bounded by column verticals on TWO OR MORE distinct columns SPANS the gap
    // — design §2's "exits the section as a column vertical on both sides -> BAND". STRICT
    // 2/1/0 (owner ruling 8, design §8): the promotion fires ONLY when a gap-crossing ANCHOR
    // (a tie/bridge/substrate/flood/onlap curve OR a surface/bandc contour) is on the boundary.
    // A face that spans the gap merely by touching two UNTIED column verticals is the RETIRED
    // geometric same-formation auto-match (v1's ``emitInterval`` connectivity inference) — it
    // is NOT promoted; it falls to ``classifyFace`` and terminates as a LENS. A legitimately
    // tied/substrate/surface-bracketed band still carries an anchor, so it stays BAND. A
    // lens/onlap face touches only its OWN column vertical, so it never enters this branch.
    const spanBand = spansGap && hasAnchorSpan
    const klass = spanBand ? 'band' : classifyFace(nTie, nClose)
    // ``layerIds``: the drilled same-formation bounding units that produced this paint
    // (absent when none match — never an empty array, so layerless pins stay byte-equal).
    const layerIds = faceLayerIds(formationId, units, columns)
    return { face, formationId, bodyId, klass, units, ...(layerIds.length > 0 ? { layerIds } : {}) }
  }
}

/**
 * Resolve the formation + body for a face from its bounding units. The formation is
 * the one whose column-vertical edge contributes the LONGEST boundary to this face —
 * measured as the overlap of each bounding unit's [base..top] elevation span with the
 * face's own elevation extent. A pure unit COUNT mis-picks when a face touches two
 * different-formation units of the same column (an interbedded onlap face at a
 * SILT/ZAND contact): both count once, and the count tie fell to an ARBITRARY
 * alphabetical id — which flipped a thin-ZAND / thick-SILT boundary face to ZAND and
 * overran the SILT band (increment 17, CS1 gap21). Length-weighting picks the
 * lithology that actually dominates the face's column face; ties (identical overlap)
 * break by smallest (ci, ui) for determinism.
 */
function resolveLabel(
  units: readonly { ci: number; ui: number }[],
  columns: readonly ColumnGeom[],
  faceMinElev: number,
  faceMaxElev: number,
): { formationId: string; bodyId: string | null } {
  const counts = new Map<string, number>()
  for (const { ci, ui } of units) {
    const u = columns[ci]?.units[ui]
    if (!u) continue
    // Boundary length this unit's column edge contributes to the face = the overlap of
    // its own [base..top] with the face's elevation extent. A unit fully spanning the
    // face weighs its whole thickness; a unit clipped by the face weighs the clipped part.
    const overlap = Math.max(0, Math.min(u.topElev, faceMaxElev) - Math.max(u.baseElev, faceMinElev))
    // A degenerate/zero overlap (a unit touching only at a corner) still counts a tiny
    // nonzero weight so a face bounded solely by corner-touching units resolves.
    const w = overlap > 0 ? overlap : 1e-9
    counts.set(u.formationId, (counts.get(u.formationId) ?? 0) + w)
  }
  let bestFormation = ''
  let bestCount = -1
  for (const [f, c] of counts) {
    if (c > bestCount + 1e-9 || (Math.abs(c - bestCount) <= 1e-9 && f < bestFormation)) {
      bestFormation = f
      bestCount = c
    }
  }
  // Body from the first (smallest ci,ui) bounding unit that has the winning
  // formation — deterministic, and matches the region's dominant lithology.
  const ordered = [...units].sort((a, b) => a.ci - b.ci || a.ui - b.ui)
  let bodyId: string | null = null
  for (const { ci, ui } of ordered) {
    const u = columns[ci]?.units[ui]
    if (u && u.formationId === bestFormation) {
      bodyId = u.bodyId
      break
    }
  }
  return { formationId: bestFormation, bodyId }
}

/**
 * Classify a face by boundary composition (design §2):
 *
 *  - no synthesized closing curve on the boundary -> BAND (the boundary runs
 *    tie->tie across the gap, or exits at the section edge as a column vertical
 *    on both sides).
 *  - at least one tie AND at least one closing -> ONLAP (one tied side, closes via
 *    a synthesized bracket-riding curve).
 *  - only closing curves, no ties -> LENS (closed via own contacts + closings).
 */
function classifyFace(nTie: number, nClose: number): FaceClass {
  if (nClose === 0) return 'band'
  if (nTie > 0) return 'onlap'
  return 'lens'
}
