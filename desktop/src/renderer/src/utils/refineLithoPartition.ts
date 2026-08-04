/**
 * Geotech fraction-space refinement of the litho partition (owner-locked
 * design, 2026-07-06 — see
 * ``docs/superpowers/2026-07-06-geotech-fraction-refinement-handoff.md``).
 *
 * THE RULE: the geotech partition is the LITHO partition refined in
 * thickness-fraction space. Litho boundaries are INVARIANT — every litho
 * region keeps its exact envelope; the NAD packing sub-bands subdivide each
 * region internally. Packing surfaces are expressed as fractions of the litho
 * unit's thickness at each side column and interpolate in fraction space, so
 * stripes follow lens shapes and vanish at an apex together.
 *
 * Ported from the owner-accepted rev-8 reference implementation (`carvePanel`
 * in the untracked ``partitionFill.geotechBrainstorm.test.ts``, iterated 8
 * times against the owner's eyes on the real CS1). Every non-obvious guard
 * below was forced by a real defect the owner caught — the WHY comments name
 * them. Do not "simplify" a guard away without re-running the CS1 gate.
 *
 * This module is PURE (no I/O, no screen space): geometry is emitted in
 * (gap-fraction, elevation) coordinates, exactly like the engine's
 * ``SectionRegion.polygon``, so the renderer maps it with the same
 * warp-aware transforms and the result is memoizable independent of pan/zoom.
 * Two screen-space concerns intentionally live in the RENDERER, not here:
 *  - the degenerate-gap guard (skip drawing when a gap's screen width < 1 px —
 *    a negative-width gap MIRRORS the fraction mapping and spills polygons
 *    over the neighbouring gap);
 *  - the substrate strip midpoint clip (pixel-width strips of coincident
 *    columns otherwise overlap visibly).
 */

import type { SectionRegion, UnderColumnFill } from './partitionFill'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One persisted geotech NAD sub-band (a geotech-model ``litho_layer`` row). */
export interface GeotechSubBand {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}

/** One investigation's geotech sub-band stack. */
export interface GeotechColumn {
  investigationId: string
  surfaceElevM: number
  units: readonly GeotechSubBand[]
}

/** NAD metadata of one geotech formation (``nad_class`` + soil code). */
export interface NadFormationMeta {
  nadClass: number | null
  soilCode: string | null
}

/**
 * Provenance of a refined polygon:
 *  - ``band``     — an aligned pair band (or a mid-seam share of a mismatched
 *                   interval);
 *  - ``bracket``  — interval void fill by a bracketing class;
 *  - ``hlens``    — unmatched-span horizontal overlay lens (by-design overlay
 *                   over its own gap's fills);
 *  - ``enclens``  — enclosed-minority lens inside its merged pack (overlay);
 *  - ``fallback`` — no packing data in the whole section at these elevations:
 *                   the litho region itself, coloured by lithology
 *                   (``formationId`` is the LITHO formation id here).
 */
export type RefinedTag = 'band' | 'bracket' | 'hlens' | 'enclens' | 'fallback'

export interface RefinedPoint {
  fraction: number
  elevation: number
}

/** One refined polygon, in the same gap-local space as ``SectionRegion``. */
export interface RefinedPolygon {
  gapIndex: number
  /** The litho region kind this polygon was carved from (lens = overlay). */
  regionKind: SectionRegion['kind']
  /** Geotech formation id (litho formation id when ``tag === 'fallback'``). */
  formationId: string
  tag: RefinedTag
  points: RefinedPoint[]
}

/** A constant-elevation donor class slice for one substrate quad. */
export interface SubstrateSlice {
  formationId: string
  topElev: number
  baseElev: number
}

/** Donor class slices for one under-column substrate quad. */
export interface RefinedSubstrateQuad {
  columnIndex: number
  quadIndex: number
  /** ``null`` → no classified donor anywhere: render in litho colour. */
  slices: SubstrateSlice[] | null
}

// ---------------------------------------------------------------------------
// Internal shapes
// ---------------------------------------------------------------------------

/** A packing span in fraction space (0 = region top, 1 = region base). */
interface Span {
  formationId: string
  cls: number
  fTop: number
  fBase: number
}

/** A packing slice in absolute elevations (shared with the substrate pass). */
interface ElevSlice {
  formationId: string
  cls: number
  topElev: number
  baseElev: number
}

/** Vertical slice of a region polygon: flattened envelope + solid parts. */
interface Slice {
  env: [number, number]
  parts: [number, number][]
}

const DEFAULT_SAMPLES = 20
/** Horizontal reach of an unmatched-span overlay lens (litho lens convention). */
const LENS_REACH = 0.45
/**
 * Fractions every region's sample grid must contain, because ``emitBand`` is
 * called with them as ``xFrom`` / ``xTo``: the mid seam of a class-mismatched
 * interval and the two lens reaches. Without them the sample grid can straddle
 * a split and leave a strip-wide vacancy between the two halves.
 */
const SPLIT_FRACTIONS: readonly number[] = [LENS_REACH, 0.5, 1 - LENS_REACH]

// ---------------------------------------------------------------------------
// Refinement
// ---------------------------------------------------------------------------

/**
 * Refine the litho partition by NAD packing class, in thickness-fraction space.
 *
 * @param regions engine output (``computeSectionFill``) for the LITHO model —
 *   consumed as-is, never modified (litho boundaries are invariant).
 * @param columnOrder ordered investigation ids of the NON-EMPTY columns the
 *   engine ran on — index i corresponds to ``gapIndex`` i's left column, so it
 *   must be the same filtered/ordered list the caller passed to
 *   ``computeSectionFill``.
 * @param geotechColumns geotech sub-band stack per investigation id.
 * @param nadMeta geotech formation id → NAD class + soil code.
 * @param lithoSoilByFormationId litho formation id → soil code (the hard guard:
 *   a sand region may only carry ZAND-coded sub-bands).
 */
export function refineLithoPartition(
  regions: readonly SectionRegion[],
  columnOrder: readonly string[],
  geotechColumns: ReadonlyMap<string, GeotechColumn>,
  nadMeta: ReadonlyMap<string, NadFormationMeta>,
  lithoSoilByFormationId: ReadonlyMap<string, string | null>,
  options?: { samples?: number; alongM?: readonly number[] },
): RefinedPolygon[] {
  const N = options?.samples ?? DEFAULT_SAMPLES
  // Along-metre positions parallel to ``columnOrder``; when present, donor
  // distance (rule 6b) is measured in metres, else in column steps.
  const alongM = options?.alongM
  const out: RefinedPolygon[] = []

  /**
   * Vertical slice of a region polygon at fraction f. Returns the flattened
   * envelope PLUS the actual solid intervals (even-odd pairing) — a CONCAVE
   * region's slice has interior voids that the carve must never fill (they
   * belong to the neighbouring region).
   */
  const sliceAt = (
    poly: readonly { fraction: number; elevation: number }[],
    f: number,
  ): Slice | null => {
    const hits: number[] = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      const df = b.fraction - a.fraction
      if (Math.abs(df) < 1e-9) continue
      const t = (f - a.fraction) / df
      if (t >= -1e-9 && t <= 1 + 1e-9) hits.push(a.elevation + t * (b.elevation - a.elevation))
    }
    if (hits.length < 2) return null
    hits.sort((p, q) => q - p) // descending: pair as solid [top, base] runs
    const parts: [number, number][] = []
    for (let i = 0; i + 1 < hits.length; i += 2) {
      if (hits[i] - hits[i + 1] > 0.02) parts.push([hits[i], hits[i + 1]])
    }
    if (parts.length === 0) return null
    return { env: [parts[0][0], parts[parts.length - 1][1]], parts }
  }

  /** Merge vertically adjacent same-class spans (one class = ONE sub-band). */
  const mergeAdjacent = (spans: Span[]): Span[] => {
    const merged: Span[] = []
    for (const sp of spans) {
      const last = merged[merged.length - 1]
      if (last && last.cls === sp.cls) last.fBase = sp.fBase
      else merged.push({ ...sp })
    }
    return merged
  }

  const classSlices = makeClassSlicesElev(columnOrder, geotechColumns, nadMeta)

  /** Fraction-space view of the packing slices, for the region carve. */
  const spansOf = (colIx: number, top: number, base: number, soil: string | null): Span[] => {
    const H0 = top - base
    if (H0 <= 0.02) return []
    return classSlices(colIx, top, base, soil).map((sl) => ({
      formationId: sl.formationId,
      cls: sl.cls,
      fTop: (top - sl.topElev) / H0,
      fBase: (top - sl.baseElev) / H0,
    }))
  }

  /**
   * Position-aware pair weight: same class AND vertically near in fraction
   * space. A class-only LCS pairs a DEEP n7 with a SHALLOW n7 across an n8
   * (the steep climbing-band artifact, B3↔S9) — position-blindness is the
   * bug. Weight = fraction overlap + a dip slack (a quarter of the mean
   * thickness + 0.1), so genuinely dipping beds still band but same-class
   * spans at wildly different stack positions do NOT match (each onlaps in
   * its own interval instead). Mirrors the litho engine's own matchColumns
   * lesson: monotonic WEIGHTED LCS, overlap as confidence.
   */
  const pairWeight = (a: Span, b: Span): number => {
    if (a.cls !== b.cls) return 0
    const ov = Math.min(a.fBase, b.fBase) - Math.max(a.fTop, b.fTop)
    const slack = 0.25 * (a.fBase - a.fTop + (b.fBase - b.fTop)) + 0.1
    const w = ov + slack
    return w > 0 ? w : 0
  }

  const lcs = (a: Span[], b: Span[]): [number, number][] => {
    const n = a.length
    const m = b.length
    const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) {
        const w = pairWeight(a[i], b[j])
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1], w > 0 ? w + dp[i + 1][j + 1] : -Infinity)
      }
    const pairs: [number, number][] = []
    let i = 0
    let j = 0
    while (i < n && j < m) {
      const w = pairWeight(a[i], b[j])
      if (w > 0 && Math.abs(dp[i][j] - (w + dp[i + 1][j + 1])) < 1e-12) {
        pairs.push([i, j])
        i++
        j++
      } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
      else j++
    }
    return pairs
  }

  // Non-lens regions first, lens overlays after (litho render convention: the
  // carve of an engine lens region paints OVER its matrix region's carve).
  const ordered = [...regions].sort(
    (a, b) => (a.kind === 'lens' ? 1 : 0) - (b.kind === 'lens' ? 1 : 0),
  )

  /**
   * Fractions to slice a region at.
   *
   * THREE RULES, each forced by a measured defect (2026-08-04 taxonomy):
   *
   * 1. **The grid spans the REGION's own fraction extent, not [0, 1].** The v2
   *    arrangement snaps vertices to a 1 mm grid while the column along-metres
   *    are not snapped, so a region that reaches its gap edge carries vertices
   *    at 1e-6 / 1-1e-5 rather than 0 / 1. Slicing at exactly 0 then found no
   *    crossing, the end sample came back ``null``, and the whole end strip
   *    degenerated to a midpoint triangle: 1,681 m2 of the owner's model — 91 %
   *    of all carve coverage loss and the thickest interior void (7.94 m). It
   *    also mislabelled 105 regions / 9,404 m2 as "reaches NEITHER column".
   *    Sampling the region's own extent resolves both ends by construction and
   *    never touches the region polygon, so no neighbour geometry moves.
   * 2. **Every ``emitBand`` split fraction is in the grid** — see
   *    ``SPLIT_FRACTIONS``.
   * 3. **Each polygon vertex fraction is bracketed by a sample.** A region's
   *    slice changes topology only at a vertex; between two samples that
   *    straddle one, unpaired pieces close as midpoint triangles and the rest
   *    of the strip is lost (~141 m2 model-wide, worst single strip 11.5 m2
   *    where three notch tips terminate at the same fraction). Two samples a
   *    hair either side of the vertex confine that to a hairline strip.
   */
  const sampleFractions = (poly: readonly RefinedPoint[]): number[] => {
    let fmin = Infinity
    let fmax = -Infinity
    for (const p of poly) {
      if (p.fraction < fmin) fmin = p.fraction
      if (p.fraction > fmax) fmax = p.fraction
    }
    fmin = Math.max(0, Math.min(1, fmin))
    fmax = Math.max(0, Math.min(1, fmax))
    const width = fmax - fmin
    // Degenerate horizontal extent — keep the historic full-gap grid rather
    // than collapsing every sample onto one fraction.
    if (!(width > 1e-9)) return Array.from({ length: N + 1 }, (_, k) => k / N)
    const eps = width * 1e-6
    const raw: number[] = []
    for (let k = 0; k <= N; k++) raw.push(fmin + (width * k) / N)
    for (const s of SPLIT_FRACTIONS) if (s > fmin + eps && s < fmax - eps) raw.push(s)
    for (const p of poly) {
      const v = p.fraction
      if (v > fmin + eps && v < fmax - eps) raw.push(v - eps, v + eps)
    }
    raw.sort((a, b) => a - b)
    const out: number[] = []
    for (const v of raw) if (out.length === 0 || v - out[out.length - 1] > width * 1e-9) out.push(v)
    return out
  }

  for (const r of ordered) {
    const soil = lithoSoilByFormationId.get(r.formationId) ?? null

    // Envelope samples across the region's own horizontal extent.
    const sampleF = sampleFractions(r.polygon)
    const samples: (Slice | null)[] = sampleF.map((f) => sliceAt(r.polygon, f))
    let s0 = samples[0] ?? null
    let s1 = samples[samples.length - 1] ?? null
    if (s0 === null && s1 === null) {
      // Both ends of the region's own extent slice to nothing — a wedge that
      // tapers to a point at BOTH ends, or a sliver thinner than the 2 cm part
      // filter there. Fall inward to the first and last fractions that do
      // resolve, so the region is still carved rather than short-circuiting to
      // the ``fallback`` tag — which asserts "no packing data in the whole
      // section at these elevations", a claim the data contradicts. (Before the
      // own-extent sample grid this branch also swallowed every region whose
      // gap-edge vertices sat 1e-6 inside the gap: 105 regions / 9,404 m2 of
      // the owner's model, measured 2026-08-04. Those now resolve at their own
      // edges and never reach here.)
      //
      // ⚠ THE GEOMETRY RULE THIS IMPLIES, stated because it is a CHOICE and not
      // a null-guard. ``s0`` / ``s1`` end up sampled at the region's own first
      // and last non-empty fractions (say 0.2 and 0.8), while ``emitBand``
      // interpolates L -> R over the FULL gap (``xFrom = 0``, ``xTo = 1`` — the
      // default every non-lens call site below passes). So a class interface
      // measured at f = 0.2 is placed as if it belonged at f = 0, and the
      // interfaces inside the region sit on a stretched basis rather than at the
      // fractions they were read at. Interpolating over the region's own extent
      // instead would put them elsewhere; which one is right is a geological
      // call about how packing carries into a region that touches no borehole,
      // so it is NOT decided here. It applies to every GENUINELY inset region
      // (~101 regions / 1,394 m2 of the owner's model once the false interiors
      // above are excluded), because ``emitBand`` interpolates over
      // ``xFrom``..``xTo`` = the full gap for every non-lens call regardless of
      // where the region sits. The shipped choice is pinned by
      // ``refineLithoPartition.test.ts`` ("interpolates an interior region
      // packing across the FULL gap") and the open question is §7 of
      // ``docs/design/geotech-stage.md``.
      const firstIx = samples.findIndex((s) => s !== null)
      if (firstIx >= 0) {
        let lastIx = samples.length - 1
        while (lastIx > firstIx && samples[lastIx] === null) lastIx--
        s0 = samples[firstIx]
        s1 = samples[lastIx]
      }
    }
    let L = s0 ? spansOf(r.gapIndex, s0.env[0], s0.env[1], soil) : []
    let R = s1 ? spansOf(r.gapIndex + 1, s1.env[0], s1.env[1], soil) : []

    // Horizontal extrapolation — classes connect horizontally, same mental
    // model as the litho below test depth: a side with no data borrows the
    // NEAREST test with same-soil packing at its elevations, in EITHER
    // direction (Q2 owner ruling 2026-08-04: "just take the nearest test that
    // does have packing"). Distance is along-metres when the caller passes
    // them, column steps otherwise; an exact tie prefers the outward side,
    // which preserves the pre-ruling outward behaviour on symmetric scenes.
    // The rule until 2026-08-04 scanned OUTWARD only, which left 749 m² of
    // the owner's model in plain lithology while data sat across the gap
    // (Tie-section 11 worst, 252 m²). No "unclassified" state exists.
    const nearestDonor = (
      sideIx: number,
      outwardDir: -1 | 1,
      top: number,
      base: number,
    ): { ix: number; dist: number; spans: Span[] } | null => {
      let best: { ix: number; dist: number; spans: Span[] } | null = null
      let bestOutward = false
      for (let ix = 0; ix < columnOrder.length; ix++) {
        if (ix === sideIx) continue
        const sp = spansOf(ix, top, base, soil)
        if (sp.length === 0) continue
        const dist = alongM ? Math.abs(alongM[ix] - alongM[sideIx]) : Math.abs(ix - sideIx)
        const outward = Math.sign(ix - sideIx) === outwardDir
        if (
          best === null ||
          dist < best.dist - 1e-9 ||
          (Math.abs(dist - best.dist) <= 1e-9 && outward && !bestOutward)
        ) {
          best = { ix, dist, spans: sp }
          bestOutward = outward
        }
      }
      return best
    }
    const dL = L.length === 0 && s0 ? nearestDonor(r.gapIndex, -1, s0.env[0], s0.env[1]) : null
    const dR = R.length === 0 && s1 ? nearestDonor(r.gapIndex + 1, 1, s1.env[0], s1.env[1]) : null
    // Same-donor coherence — the S10 mirror stays owner-locked. When a side's
    // nearest donor IS the test the other side already reads (its own column
    // or its own borrow), assigning elevation-clipped spans here would break
    // "stripes follow a tapering envelope and vanish at the apex together";
    // leaving the side empty routes it through the fraction-space mirror
    // below instead. When BOTH sides borrow the same test, the side nearer to
    // it reads the elevations and the far side mirrors.
    const lSrc = L.length > 0 ? r.gapIndex : null
    const rSrc = R.length > 0 ? r.gapIndex + 1 : null
    if (dL && dR && dL.ix === dR.ix) {
      if (dL.dist <= dR.dist) L = dL.spans
      else R = dR.spans
    } else {
      if (dL && dL.ix !== rSrc) L = dL.spans
      if (dR && dR.ix !== lSrc) R = dR.spans
    }

    if (L.length === 0 && R.length === 0) {
      // Still nothing in the ENTIRE section at these elevations (rare) —
      // litho colour as the last-resort fallback.
      out.push({
        gapIndex: r.gapIndex,
        regionKind: r.kind,
        formationId: r.formationId,
        tag: 'fallback',
        points: r.polygon.map((p) => ({ fraction: p.fraction, elevation: p.elevation })),
      })
      continue
    }
    // Single-sided data → mirror: stripes follow the envelope (lens stripes
    // vanish at the apex together — the S10 broad-sand-lens case).
    if (L.length === 0) L = R.map((x) => ({ ...x }))
    if (R.length === 0) R = L.map((x) => ({ ...x }))

    // A pinch / lens litho region is a thin wedge that converges to a point;
    // stratifying it internally by packing class produces the "small dark
    // sliver wedges" the owner circled (rev-8 §5) and the ONLY cross-class
    // carve overlaps on the real CS1 (all four lived in pinch regions — proven
    // by the overlap classifier, 2026-07-07). A pinching wedge is too thin to
    // meaningfully show internal packing — fill it with its single DOMINANT
    // (thickest) class, coloured like a normal band. The full fraction carve
    // is reserved for quad regions, which have the vertical room to stratify.
    if (r.kind !== 'quad') {
      const all = [...L, ...R]
      let fatty = all[0]
      for (const sp of all) if (sp.fBase - sp.fTop > fatty.fBase - fatty.fTop) fatty = sp
      // A `pinch` is a DISJOINT partition wedge (tag `band` — it tiles with its
      // neighbours). A `lens` is an OPAQUE OVERLAY drawn OVER the gap's matrix
      // fill (the engine floods the vacated span with the bracket matrix behind
      // it) — that is exactly `hlens`. Tagging it `band` made a 0-tie cross-
      // lithology lens (e.g. gap-22's ZAND over the SILT matrix, produced by the
      // 2/1/0 model) read as a real cross-class polygon and trip the
      // watertightness gate; the same-class case (SILT lens over SILT matrix)
      // was merely tolerated as self-overlap. Tag it `hlens` so the gate treats
      // it as the by-design overlay it is (render z-order is unchanged — lens
      // regions are already sorted last and paint on top).
      out.push({
        gapIndex: r.gapIndex,
        regionKind: r.kind,
        formationId: fatty.formationId,
        tag: r.kind === 'lens' ? 'hlens' : 'band',
        points: r.polygon.map((p) => ({ fraction: p.fraction, elevation: p.elevation })),
      })
      continue
    }

    // Reduce enclosed minorities → lenses; merge their brackets.
    type LensRec = { span: Span; side: 'left' | 'right' }
    const lenses: LensRec[] = []
    const reduceSide = (spans: Span[], other: Set<number>, side: 'left' | 'right'): Span[] => {
      let w = spans.map((x) => ({ ...x }))
      let changed = true
      while (changed) {
        changed = false
        for (let i = 1; i < w.length - 1; i++) {
          if (w[i - 1].cls === w[i + 1].cls && w[i].cls !== w[i - 1].cls && !other.has(w[i].cls)) {
            // Pulling a minority merges its brackets, and the merged span can
            // itself look enclosed on the next pass — so the SAME footprint
            // gets a second lens drawn over the first, hiding it (8 pairs /
            // 0.86 m2 on the owner's model). A span that contains a lens this
            // side already pulled is that merged bracket: leave it in the
            // stack, where it onlaps as an ordinary unmatched span.
            const wrapsPulled = lenses.some(
              (l) =>
                l.side === side &&
                l.span.fTop >= w[i].fTop - 1e-9 &&
                l.span.fBase <= w[i].fBase + 1e-9,
            )
            if (wrapsPulled) continue
            lenses.push({ span: { ...w[i] }, side })
            const merged = { ...w[i - 1], fBase: w[i + 1].fBase }
            w = [...w.slice(0, i - 1), merged, ...w.slice(i + 2)]
            changed = true
            break
          }
        }
      }
      return w
    }
    // Post-reduce merge: pulling an enclosed minority leaves its same-class
    // brackets adjacent — collapse them so LCS sees one span per class run.
    const Lr = mergeAdjacent(reduceSide(L, new Set(R.map((x) => x.cls)), 'left'))
    const Rr = mergeAdjacent(reduceSide(R, new Set(L.map((x) => x.cls)), 'right'))
    const pairs = lcs(Lr, Rr)

    // Anchor interfaces (fL, fR), monotone, bracketing pair bands.
    const anchors: [number, number][] = [[0, 0]]
    for (const [ai, bi] of pairs) {
      anchors.push([Lr[ai].fTop, Rr[bi].fTop])
      anchors.push([Lr[ai].fBase, Rr[bi].fBase])
    }
    anchors.push([1, 1])
    for (let i = 1; i < anchors.length; i++) {
      anchors[i][0] = Math.max(anchors[i][0], anchors[i - 1][0])
      anchors[i][1] = Math.max(anchors[i][1], anchors[i - 1][1])
    }

    /**
     * Emit the band between fraction curves fTop(x) and fBase(x), clipped
     * per-slice to the region's ACTUAL solid parts. Emits per-sample-pair
     * QUADS over ALL pieces (a dropped piece = a black hole), pairing pieces
     * across samples by a MONOTONE two-pointer; unpaired pieces close as
     * triangles at the midpoint.
     */
    const emitBand = (
      fTopL: number,
      fTopR: number,
      fBaseL: number,
      fBaseR: number,
      formationId: string,
      xFrom = 0,
      xTo = 1,
      tag: RefinedTag = 'band',
      bounds?: [number, number, number, number],
    ): void => {
      const emitPts = (pts: RefinedPoint[]): void => {
        out.push({ gapIndex: r.gapIndex, regionKind: r.kind, formationId, tag, points: pts })
      }
      type Piece = [number, number]
      /**
       * ``eT`` / ``eB`` are the band's OWN boundary elevations at that sample,
       * recorded even where the band is degenerate or carries no piece: the
       * die/born triangles below are CLIPPED to the straight segments between
       * them. Vertically adjacent bands share their anchor fraction and this
       * same ``mapF``, so a neighbour's quad edge IS this segment — clipping
       * makes "no two tiling polygons cover the same point" true by
       * construction instead of by hope.
       */
      const colsB: { sx: number; eT: number | null; eB: number | null; pieces: Piece[] }[] = []
      for (let k = 0; k < sampleF.length; k++) {
        const x = sampleF[k]
        if (x < xFrom - 1e-9 || x > xTo + 1e-9) continue
        const sl = samples[k]
        if (!sl) {
          colsB.push({ sx: x, eT: null, eB: null, pieces: [] })
          continue
        }
        const xn = xTo > xFrom ? (x - xFrom) / (xTo - xFrom) : 0
        let ft = fTopL + (fTopR - fTopL) * xn
        let fb = fBaseL + (fBaseR - fBaseL) * xn
        if (bounds) {
          ft = Math.max(ft, bounds[0] + (bounds[1] - bounds[0]) * x)
          fb = Math.min(fb, bounds[2] + (bounds[3] - bounds[2]) * x)
        }
        // MATERIAL-SPACE mapping: fractions map through the slice's SOLID
        // thickness (skipping concave voids), so stacked bands land in
        // DISJOINT elevation ranges by construction — envelope mapping
        // bunched multiple bands into the same solid part.
        let totalSolid = 0
        for (const [t2, b2] of sl.parts) totalSolid += t2 - b2
        const mapF = (f: number): number => {
          let m = Math.max(0, Math.min(1, f)) * totalSolid
          for (const [t2, b2] of sl.parts) {
            const th = t2 - b2
            if (m <= th + 1e-12) return t2 - m
            m -= th
          }
          return sl.parts[sl.parts.length - 1][1]
        }
        const eT0 = mapF(ft)
        const eB0 = mapF(fb)
        if (fb - ft < 1e-5) {
          colsB.push({ sx: x, eT: eT0, eB: eB0, pieces: [] })
          continue
        }
        const pieces: Piece[] = []
        for (const [pt2, pb2] of sl.parts) {
          const t2 = Math.min(eT0, pt2)
          const b2 = Math.max(eB0, pb2)
          if (t2 - b2 > 0.01) pieces.push([t2, b2])
        }
        colsB.push({ sx: x, eT: eT0, eB: eB0, pieces })
      }
      for (let i2 = 0; i2 + 1 < colsB.length; i2++) {
        const A3 = colsB[i2]
        const B3 = colsB[i2 + 1]
        const midX = (A3.sx + B3.sx) / 2
        // Monotone two-pointer pairing (pieces sorted top→bottom) — a greedy
        // best-overlap pairing can produce CROSSING quads.
        let ai3 = 0
        let bi3 = 0
        // A die/born triangle may only reach toward the midpoint if its apex
        // stays INSIDE the region polygon — else it pokes into the
        // neighbouring region (the cross-region overlaps the brainstorm's
        // detector caught). Outside → the piece closes vertically at its
        // sample.
        const insideAt = (fx: number, e: number): boolean => {
          let inside = false
          const poly = r.polygon
          for (let q2 = 0, q3 = poly.length - 1; q2 < poly.length; q3 = q2++) {
            const pa = poly[q2]
            const pb = poly[q3]
            if (
              pa.elevation > e !== pb.elevation > e &&
              fx <
                pa.fraction +
                  ((e - pa.elevation) / (pb.elevation - pa.elevation)) *
                    (pb.fraction - pa.fraction)
            )
              inside = !inside
          }
          return inside
        }
        // A die/born piece tapers to an apex toward the midpoint. The apex must
        // stay INSIDE the region polygon — reaching past the boundary pokes
        // into the neighbour region (the cross-region overlap the reference's
        // guard prevented). But the reference SUPPRESSED the whole triangle
        // when the midpoint apex fell outside, which left the die-out wedge as
        // a dark VOID (rev-8 §5 "small dark sliver wedges"). Instead CLAMP the
        // apex back along source→midpoint to the region boundary (binary
        // search: the source sample is inside, the midpoint may be outside), so
        // the taper FILLS the wedge up to the boundary and never crosses it.
        const clampReach = (srcF: number, e: number): number => {
          if (insideAt(midX, e)) return midX
          let lo = srcF // inside — the piece belongs to the region's solid here
          let hi = midX // outside
          for (let it = 0; it < 14; it++) {
            const mid = (lo + hi) / 2
            if (insideAt(mid, e)) lo = mid
            else hi = mid
          }
          return lo
        }
        // A triangle's apex sits at the dying piece's MID-ELEVATION, which says
        // nothing about where the band itself is at that fraction. When the
        // band above plunges (or the one below climbs) across the strip, the
        // triangle crosses its own boundary curve and paints inside the
        // neighbour's quad — 205 pairs / 8.46 m2 on the owner's model, 77 of
        // them between different NAD classes and therefore VISIBLE. Clip the
        // triangle to the wedge between its own two boundary segments. Clip,
        // never suppress: the rev-8 reference dropped the whole triangle and
        // left the die-out wedge as the dark sliver the owner circled (§5).
        const clipToOwnBand = (pts: RefinedPoint[]): RefinedPoint[] => {
          if (A3.eT === null || A3.eB === null || B3.eT === null || B3.eB === null) return pts
          const span = B3.sx - A3.sx
          if (Math.abs(span) < 1e-12) return pts
          const at = (ea: number, eb: number, f: number): number =>
            ea + ((f - A3.sx) / span) * (eb - ea)
          const tTop = Math.max(A3.eT, A3.eB)
          const bTop = Math.max(B3.eT, B3.eB)
          const tBot = Math.min(A3.eT, A3.eB)
          const bBot = Math.min(B3.eT, B3.eB)
          const clipHalf = (poly: RefinedPoint[], g: (p: RefinedPoint) => number): RefinedPoint[] => {
            const kept: RefinedPoint[] = []
            for (let q = 0; q < poly.length; q++) {
              const pa = poly[q]
              const pb = poly[(q + 1) % poly.length]
              const ga = g(pa)
              const gb = g(pb)
              if (ga >= -1e-12) kept.push(pa)
              if (ga >= -1e-12 !== gb >= -1e-12) {
                const t = ga / (ga - gb)
                kept.push({
                  fraction: pa.fraction + t * (pb.fraction - pa.fraction),
                  elevation: pa.elevation + t * (pb.elevation - pa.elevation),
                })
              }
            }
            return kept
          }
          const below = clipHalf(pts, (p) => at(tTop, bTop, p.fraction) - p.elevation)
          if (below.length < 3) return []
          const inside = clipHalf(below, (p) => p.elevation - at(tBot, bBot, p.fraction))
          return inside.length < 3 ? [] : inside
        }
        /** Shoelace area in (fraction x elevation) — the degenerate-shape guard. */
        const shape = (pts: RefinedPoint[]): number => {
          let a2 = 0
          for (let q = 0; q < pts.length; q++) {
            const pb = pts[(q + 1) % pts.length]
            a2 += pts[q].fraction * pb.elevation - pb.fraction * pts[q].elevation
          }
          return Math.abs(a2) / 2
        }
        const emitTaper = (pts: RefinedPoint[]): void => {
          const clipped = clipToOwnBand(pts)
          if (clipped.length >= 3 && shape(clipped) > 1e-12) emitPts(clipped)
        }
        const closeTri = (a: Piece): void => {
          const e = (a[0] + a[1]) / 2
          const apexF = clampReach(A3.sx, e)
          if (apexF - A3.sx < 1e-4) return // no room to taper (degenerate)
          emitTaper([
            { fraction: A3.sx, elevation: a[0] },
            { fraction: apexF, elevation: e },
            { fraction: A3.sx, elevation: a[1] },
          ])
        }
        const openTri = (b: Piece): void => {
          const e = (b[0] + b[1]) / 2
          const apexF = clampReach(B3.sx, e)
          if (B3.sx - apexF < 1e-4) return // no room to taper (degenerate)
          emitTaper([
            { fraction: apexF, elevation: e },
            { fraction: B3.sx, elevation: b[0] },
            { fraction: B3.sx, elevation: b[1] },
          ])
        }
        while (ai3 < A3.pieces.length && bi3 < B3.pieces.length) {
          const a = A3.pieces[ai3]
          const b = B3.pieces[bi3]
          const ov = Math.min(a[0], b[0]) - Math.max(a[1], b[1])
          if (ov > 0.005) {
            emitPts([
              { fraction: A3.sx, elevation: a[0] },
              { fraction: B3.sx, elevation: b[0] },
              { fraction: B3.sx, elevation: b[1] },
              { fraction: A3.sx, elevation: a[1] },
            ])
            ai3++
            bi3++
          } else if (a[1] > b[0]) {
            // a sits entirely ABOVE b → a dies here.
            closeTri(a)
            ai3++
          } else {
            openTri(b)
            bi3++
          }
        }
        for (; ai3 < A3.pieces.length; ai3++) closeTri(A3.pieces[ai3])
        for (; bi3 < B3.pieces.length; bi3++) openTri(B3.pieces[bi3])
      }
    }

    // Walk intervals: even index = gap interval (unmatched), odd = pair band.
    for (let j = 0; j < anchors.length - 1; j++) {
      const [aL, aR] = anchors[j]
      const [bL, bR] = anchors[j + 1]
      const isPairBand = j % 2 === 1
      if (isPairBand) {
        const pair = pairs[(j - 1) / 2]
        emitBand(aL, aR, bL, bR, Lr[pair[0]].formationId)
        continue
      }
      // Gap interval: unmatched spans onlap onto the bracketing interfaces.
      const hL = bL - aL
      const hR = bR - aR
      if (hL < 1e-5 && hR < 1e-5) continue
      // CLIP spans to the interval (never drop a straddler — the interval
      // must stay fully tiled or holes/stray wedges appear).
      const clip = (spans: Span[], lo: number, hi: number): Span[] =>
        spans
          .map((x) => ({ ...x, fTop: Math.max(x.fTop, lo), fBase: Math.min(x.fBase, hi) }))
          .filter((x) => x.fBase - x.fTop > 1e-5)
      const leftIn = clip(Lr, aL, bL)
      const rightIn = clip(Rr, aR, bR)
      // Unmatched-span termination (owner rule, third pass — "never render
      // both the taper AND the lens"):
      //  1. a span whose class MATCHES a bracketing pair band merges into
      //     that band's fill (clean onlap — no separate shape, no fan);
      //  2. every other span pinches HORIZONTALLY as an overlay lens at its
      //     own stratigraphic position;
      //  3. the interval's void fills with the two BRACKETING classes bulging
      //     in and meeting at the mid-curve — ONE smooth wedge per side,
      //     never per-span taper fans.
      if (hR < 1e-5 || hL < 1e-5) {
        const side: 'left' | 'right' = hR < 1e-5 ? 'left' : 'right'
        const spansIn = side === 'left' ? leftIn : rightIn
        // Bracketing pair bands (interval j is even; pair above = j/2-1,
        // below = j/2).
        const pairAbove = j >= 2 ? pairs[j / 2 - 1] : null
        const pairBelow = j / 2 < pairs.length ? pairs[j / 2] : null
        const clsAbove = pairAbove ? Lr[pairAbove[0]].cls : null
        const clsBelow = pairBelow ? Lr[pairBelow[0]].cls : null
        const fillAbove = pairAbove ? Lr[pairAbove[0]].formationId : null
        const fillBelow = pairBelow ? Lr[pairBelow[0]].formationId : null
        const lensSpans = spansIn.filter((sp) => sp.cls !== clsAbove && sp.cls !== clsBelow)
        // Interval void fill — bracket classes meet at the HOME-side class
        // boundary carried across (NOT a 50/50 split: a thin n22 crust must
        // stay thin; the basal n23 clay stays continuous — owner, S13).
        const [lo2, hi2] = side === 'left' ? [aL, bL] : [aR, bR]
        let splitTop = lo2 // end of the contiguous clsAbove run from the top
        for (const sp of spansIn) {
          if (sp.cls === clsAbove && sp.fTop <= splitTop + 1e-4) splitTop = sp.fBase
          else break
        }
        let splitBot = hi2 // start of the contiguous clsBelow run from the bottom
        for (let si = spansIn.length - 1; si >= 0; si--) {
          const sp = spansIn[si]
          if (sp.cls === clsBelow && sp.fBase >= splitBot - 1e-4) splitBot = sp.fTop
          else break
        }
        const splitHome = Math.min(Math.max((splitTop + splitBot) / 2, lo2), hi2)
        const relSplit = hi2 - lo2 > 1e-9 ? (splitHome - lo2) / (hi2 - lo2) : 0.5
        const midL = side === 'left' ? splitHome : aL + relSplit * (bL - aL)
        const midR = side === 'left' ? aR + relSplit * (bR - aR) : splitHome
        if (fillAbove != null && fillBelow != null && fillAbove !== fillBelow) {
          emitBand(aL, aR, midL, midR, fillAbove, 0, 1, 'bracket')
          emitBand(midL, midR, bL, bR, fillBelow, 0, 1, 'bracket')
        } else if (fillAbove != null || fillBelow != null) {
          emitBand(aL, aR, bL, bR, (fillAbove ?? fillBelow) as string, 0, 1, 'bracket')
        } else if (spansIn.length > 0) {
          // No pair bands at all — fill with the thickest class, rest lens.
          let fatty = spansIn[0]
          for (const sp of spansIn) if (sp.fBase - sp.fTop > fatty.fBase - fatty.fTop) fatty = sp
          emitBand(aL, aR, bL, bR, fatty.formationId, 0, 1, 'bracket')
        }
        // Overlay lenses — horizontal pinch at own stratigraphic position.
        for (const sp of lensSpans) {
          const mid = (sp.fTop + sp.fBase) / 2
          const bounds: [number, number, number, number] = [aL, aR, bL, bR]
          if (side === 'left')
            emitBand(sp.fTop, mid, sp.fBase, mid, sp.formationId, 0, LENS_REACH, 'hlens', bounds)
          else
            emitBand(mid, sp.fTop, mid, sp.fBase, sp.formationId, 1 - LENS_REACH, 1, 'hlens', bounds)
        }
      } else {
        // Both sides populated but class-mismatched → meet at a mid seam:
        // each side keeps its proportional share up to x=0.5.
        const midF = (f: number, side: 'l' | 'r'): number => {
          const rel = side === 'l' ? (f - aL) / hL : (f - aR) / hR
          const mA = (aL + aR) / 2
          const mB = (bL + bR) / 2
          return mA + rel * (mB - mA)
        }
        for (const sp of leftIn)
          emitBand(sp.fTop, midF(sp.fTop, 'l'), sp.fBase, midF(sp.fBase, 'l'), sp.formationId, 0, 0.5)
        for (const sp of rightIn)
          emitBand(midF(sp.fTop, 'r'), sp.fTop, midF(sp.fBase, 'r'), sp.fBase, sp.formationId, 0.5, 1)
      }
    }

    // Enclosed lenses: home-side span pinches to a point ~45 % across, at its
    // proportional position inside the containing pair band.
    for (const Lx of lenses) {
      const { span, side } = Lx
      const mid = (span.fTop + span.fBase) / 2
      // Containing pair (post-merge bracket): the pair whose home fractions
      // bracket the lens.
      let farMid = mid
      for (const [ai, bi] of pairs) {
        const home = side === 'left' ? Lr[ai] : Rr[bi]
        const far = side === 'left' ? Rr[bi] : Lr[ai]
        if (mid >= home.fTop - 1e-6 && mid <= home.fBase + 1e-6) {
          const rel = (mid - home.fTop) / Math.max(1e-6, home.fBase - home.fTop)
          farMid = far.fTop + rel * (far.fBase - far.fTop)
          break
        }
      }
      const apexF = mid + (farMid - mid) * 0.45
      if (side === 'left')
        emitBand(span.fTop, apexF, span.fBase, apexF, span.formationId, 0, LENS_REACH, 'enclens')
      else
        emitBand(apexF, span.fTop, apexF, span.fBase, span.formationId, 1 - LENS_REACH, 1, 'enclens')
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// Substrate refinement (rule 6 — under-TD quads, class-subdivided)
// ---------------------------------------------------------------------------

/**
 * Build the shared elevation-space class-slice primitive.
 *
 * Packing class slices of column ``colIx`` overlapping [top, base] elevations,
 * restricted to soil code, CLIPPED to the range, tiled, same-class-merged.
 * Absolute elevations — shared between the region carve AND the substrate's
 * horizontal extrapolation ("classes connect horizontally").
 */
function makeClassSlicesElev(
  columnOrder: readonly string[],
  geotechColumns: ReadonlyMap<string, GeotechColumn>,
  nadMeta: ReadonlyMap<string, NadFormationMeta>,
): (colIx: number, top: number, base: number, soil: string | null) => ElevSlice[] {
  return (colIx, top, base, soil) => {
    const g = geotechColumns.get(columnOrder[colIx] ?? '')
    if (!g || top - base <= 0.02) return []
    const list = g.units
      .map((u) => ({
        formationId: u.formationId,
        cls: nadMeta.get(u.formationId)?.nadClass ?? -1,
        soil: nadMeta.get(u.formationId)?.soilCode ?? null,
        tE: g.surfaceElevM - u.topDepthM,
        bE: g.surfaceElevM - u.baseDepthM,
      }))
      // Soil-code guard (never a foreign lithology's class — "silt
      // transitioning into a sand lens") + any-overlap-then-clip.
      .filter((u) => (soil == null || u.soil === soil) && u.tE > base + 0.02 && u.bE < top - 0.02)
      .sort((a, b) => b.tE - a.tE)
    if (list.length === 0) return []
    const slices: ElevSlice[] = list.map((u) => ({
      formationId: u.formationId,
      cls: u.cls,
      topElev: Math.min(top, u.tE),
      baseElev: Math.max(base, u.bE),
    }))
    // Force tiling: stretch ends to the range, close interior gaps at midpoints.
    slices[0].topElev = top
    slices[slices.length - 1].baseElev = base
    for (let i = 1; i < slices.length; i++) {
      const mid = (slices[i - 1].baseElev + slices[i].topElev) / 2
      slices[i - 1].baseElev = mid
      slices[i].topElev = mid
    }
    const merged: ElevSlice[] = []
    for (const sl of slices) {
      const last = merged[merged.length - 1]
      if (last && last.cls === sl.cls) last.baseElev = sl.baseElev
      else merged.push({ ...sl })
    }
    return merged.filter((x) => x.topElev - x.baseElev > 1e-3)
  }
}

/**
 * Class-subdivide the under-TD substrate quads by HORIZONTAL extrapolation.
 *
 * Owner rule (B4): the donor's class boundaries extend at CONSTANT elevation
 * into the quad — n22 extrapolated sideways, denser n23 below. The donor is
 * the nearest column (scanning outward both ways) with classified sub-bands
 * of the quad's soil code at these elevations. ``slices: null`` means no
 * donor exists anywhere → the renderer falls back to the litho colour.
 *
 * The renderer clips each sloped quad by the slice bounds (see
 * ``clipPolygonToElevBand``) at the midpoint-clipped strip x-range — the
 * pixel-space half of the rule stays in the overlay.
 */
export function refineSubstrateQuads(
  fills: readonly UnderColumnFill[],
  columnOrder: readonly string[],
  geotechColumns: ReadonlyMap<string, GeotechColumn>,
  nadMeta: ReadonlyMap<string, NadFormationMeta>,
  lithoSoilByFormationId: ReadonlyMap<string, string | null>,
): RefinedSubstrateQuad[] {
  const classSlices = makeClassSlicesElev(columnOrder, geotechColumns, nadMeta)
  const out: RefinedSubstrateQuad[] = []
  for (const f of fills) {
    const i = f.columnIndex
    for (let qi = 0; qi < f.quads.length; qi++) {
      const q = f.quads[qi]
      const soilQ = lithoSoilByFormationId.get(q.formationId) ?? null
      const qTop = Math.max(q.topLeftElev, q.topRightElev)
      const qBase = Math.min(q.baseLeftElev, q.baseRightElev)
      let donor: ElevSlice[] = []
      for (let d = 1; d < columnOrder.length && donor.length === 0; d++) {
        for (const ix of [i - d, i + d]) {
          if (ix < 0 || ix >= columnOrder.length) continue
          const sl = classSlices(ix, qTop, qBase, soilQ)
          if (sl.length) {
            donor = sl
            break
          }
        }
      }
      out.push({
        columnIndex: i,
        quadIndex: qi,
        slices:
          donor.length === 0
            ? null
            : donor.map((sl) => ({
                formationId: sl.formationId,
                topElev: sl.topElev,
                baseElev: sl.baseElev,
              })),
      })
    }
  }
  return out
}

/**
 * Clip a polygon (any x unit, elevation vertical) to the horizontal band
 * [baseElev, topElev]. Used by the renderer to cut a sloped substrate quad
 * into its donor class slices; exported for the render harness + tests.
 */
export function clipPolygonToElevBand<P extends { e: number; x: number }>(
  pts: readonly P[],
  topElev: number,
  baseElev: number,
): { x: number; e: number }[] {
  const clipHalf = (
    poly: readonly { x: number; e: number }[],
    bound: number,
    keepBelow: boolean,
  ): { x: number; e: number }[] => {
    const clipped: { x: number; e: number }[] = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      const ia = keepBelow ? a.e <= bound + 1e-9 : a.e >= bound - 1e-9
      const ib = keepBelow ? b.e <= bound + 1e-9 : b.e >= bound - 1e-9
      if (ia) clipped.push({ x: a.x, e: a.e })
      if (ia !== ib) {
        const t = (bound - a.e) / (b.e - a.e)
        clipped.push({ x: a.x + t * (b.x - a.x), e: bound })
      }
    }
    return clipped
  }
  return clipHalf(clipHalf(pts, topElev, true), baseElev, false)
}
