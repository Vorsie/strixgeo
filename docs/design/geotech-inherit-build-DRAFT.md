# Geotech 3-D build — INHERIT the litho geometry (DRAFT)

> **STATUS: DRAFT — owner approval pending. Nothing here is built.**
> **STALE BASELINE (2026-09-21): this draft cites `refineLithoPartition`, which was DELETED (debt #270 RESOLVED); the shipped geotech render is the constructive hierarchical fill (geotech-stage.md §2). Re-base on the current engine before any approval decision.**
> Written 2026-08-04 against the Q1 ruling recorded in
> [geotech-stage.md](geotech-stage.md) §7:
>
> > *"We already built the framework — keep the litho bodies and subdivide them
> > in 3-D based on packing, with the same rules and mechanisms as the litho
> > voxel builder."*
>
> This doc proposes HOW. It supersedes nothing yet; `geotech-stage.md` stays the
> current-state record until this ships.

---

## 0. The problem in one paragraph

The geotech axis produces three geometries from two different computations.
The **section render** is the litho partition refined internally by NAD packing
class (`refineLithoPartition`, litho boundaries invariant). The **3-D voxel
build** and the **3-D fence panels** each run `computeSectionFill` a second
time, over the GEOTECH `litho_layer` rows and GEOTECH correlation edges — a free
re-partition that is free to put a packing boundary anywhere, including across a
litho contact. Measured on the owner's model, the render and the build disagree
over **44.13 %** of the section plane (`geotech_agreement_baseline.json`,
2026-08-04, engine v2). At the columns the two arms are identical (0 straddlers,
worst offset 0.5 mm) — every square metre of the divergence is in how the gaps
were banded. The Q1 ruling retires the free re-partition.

---

## 1. The invariant this design has to establish

**GI — the geotech inherit invariant.**
For every litho body `B`, the union of the geotech bodies whose litho parent is
`B` is *exactly* `B` — voxel for voxel, in 3-D. Equivalently: every geotech body
boundary is either (i) a litho body boundary, inherited unchanged, or (ii) a
packing surface strictly interior to one litho body.

GI is the 3-D statement of the render's own rule ("litho boundaries are
INVARIANT; the NAD packing sub-bands subdivide each region internally"). It is
the property that must hold **by construction**, not by measurement — because a
property that only holds by measurement is a property that drifts back.

Two consequences worth stating up front, because they decide the architecture:

* GI cannot be checked by the current agreement gate. That gate measures two
  2-D polygon sets against each other on a section plane. GI is a 3-D volumetric
  claim. The gate's successor is named in §8.
* GI rules out any design in which the between-section interpolation runs on
  GEOTECH bodies. If two sections both carry litho body `B` but their packing
  sub-bands do not pair, `_blend_stacks`' one-sided rule pinches the unmatched
  sub-body toward nothing — leaving a VOID inside `B`. That is the #244 failure
  mode reproduced one level down, and it violates GI directly. **The blend must
  run on litho bodies; the packing subdivision must be applied to the result.**

---

## 2. Candidates considered

### (a) Two-pass voxel — label litho, then subdivide voxels by packing, in Python

Run the litho pipeline unchanged to produce the litho `LabelGrid`, then walk each
voxel column and split each litho interval into packing sub-intervals with a
Python implementation of the fraction-space rule; re-label; mesh with the same
extractor.

* **For:** GI by construction. Every litho mechanism inherited literally —
  footprint hull, honor-borehole precedence, true-position re-seat, cross-section
  body merge, greedy meshing, watertight extraction. Q3 ("build sections with
  <2 divided columns") resolves for free. Puts geotech geometry server-side,
  which is where Tier-D export (#104) needs it.
* **Against — decisive:** it requires a **second implementation of the
  owner-locked rev-8 rule**. `refineLithoPartition.ts` is 849 lines of guards
  each forced by a real defect the owner caught; its header says so explicitly.
  §6 of `geotech-stage.md` already refused exactly this trade for the borehole
  preview: *"There is deliberately no second implementation of the rules. A
  preview that re-stated them could show one packing class and write another,
  and the engineer would have no way to notice."* The same sentence applies here
  with the word "preview" replaced by "3-D model". And the agreement gate would
  degrade from "zero by construction" to "two implementations that currently
  agree".

### (b) Ship the RENDER's refined polygons as the labelling input

POST `refineLithoPartition`'s `RefinedPolygon[]` as `RegionInput[]`, with
`formation_id` = the geotech (NAD) formation, and let the existing labeller
consume them unchanged.

* **For:** the render is literally the source of truth. Zero drift.
* **Against, as-is — four hard blockers:**
  1. **The refined output is not a true partition.** `hlens` and `enclens` are
     documented OVERLAYS that paint over the fills beneath them
     (`refineLithoPartition.ts:59-71`), and the gate counts **212 self-overlapping
     polygon pairs**. `_section_stack_at` slices every region of a gap at one
     fraction and sorts by top elevation; overlapping regions produce a stack
     with overlapping intervals, which `_layout` re-stacks cumulatively — the
     output is not wrong-ish, it is meaningless.
  2. **It loses material.** The litho partition covers 59,853.3 m²; the refined
     render covers 58,043.2 m² — **−1,810.1 m² (−3.02 %)** — plus **696.13 m²**
     of interior voids, worst hole 17.0 m across. Feeding that to the labeller
     violates GI by 3 % on day one.
  3. **It carries no body identity.** `RefinedPolygon` has `formationId` and
     `tag` and nothing else; `GeotechSubBand.bodyId` is populated at
     `PartitionFillOverlay.tsx:1924` and then read by nothing —
     `bodyId` appears exactly once in `refineLithoPartition.ts`, on its own
     declaration. Without it there is no mesh grouping key, no cross-section
     body merge, no exportable unit.
  4. **It is polygon-shaped, which is *why* it loses material.** `emitBand`
     emits each band independently, with midpoint-apex clamping and
     triangle-closing; nothing in it is required to tile the region. The
     coverage loss is not a bug to fix inside it, it is the shape of the
     computation.

  Taken far enough to fix all four, (b) becomes (c).

### (c) CHOSEN — one refinement engine, two consumers: ship the PROFILE, not the polygons

Lift the rule out of polygon emission into a **1-D packing profile** — a tiling
of a litho region's thickness-fraction axis — and let both arms sample it. The
render samples it across the gap to draw; the build ships it to the backend,
which labels litho geometry with the litho machinery and subdivides the resulting
stack.

This is the same architectural move that made the litho stage work:
`computeSectionFill` is ONE engine, and `PartitionFillOverlay` renders it while
`buildVoxelRequest` posts it (`section-fill.md`: *"The 2D partition is the single
source of truth for interpreted geometry. The 3D voxel build LABELS space from
it"*). The geotech stage never got its equivalent. This gives it one.

---

## 3. The chosen architecture

### 3.1 The profile — the thing both arms share

New pure module, `desktop/src/renderer/src/utils/packingProfile.ts`:

```ts
/** One packing interval of a litho region, in thickness-fraction space. */
interface PackingCut {
  fTopL: number; fTopR: number      // fraction of the region's thickness at each column
  fBaseL: number; fBaseR: number
  formationId: string               // GEOTECH formation (carries nad_class)
  bodyIdL: string | null            // geotech body identity from the left span
  bodyIdR: string | null            //  ... and the right
  source: 'band' | 'bracket' | 'seam'
  soilConflict: boolean             // the Q4 soil-guard fired here
}

/** The tiling of ONE litho region, plus its overlay lenses. */
interface RegionPackingProfile {
  gapIndex: number
  cuts: PackingCut[]                // monotone, contiguous, [0,0]→[1,1]: TILES BY CONSTRUCTION
  lenses: PackingLens[]             // hlens / enclens — see OQ-3
  degraded: 'none' | 'single-sided' | 'borrowed' | 'fallback'
}

computeRegionPackingProfile(region, L, R, meta, policy): RegionPackingProfile
profileAt(profile, x): Array<{ fTop, fBase, formationId, bodyId }>   // tiles [0,1] exactly
```

**This is a refactor, not a rewrite.** Everything in `cuts` already exists inside
`refineLithoPartition`, one level down: the monotone `anchors` array
(`refineLithoPartition.ts:404-413`), the pair/gap interval walk (`:580-675`), the
bracket split (`:641-651`), the mid-seam split (`:661-674`) and the `lenses` list
(`:378-400`). Today they are consumed immediately by `emitBand` and discarded.
Lifting them into a returned value is mechanical. The existing suites
(`refineLithoPartition.test.ts`, `.render.test.ts`, `.cs1frozen.test.ts`,
`.overlap.ts`) pin the emitted output, so the refactor is verifiable to
byte-identity before anything else changes.

Two policy knobs are named parameters on the builder rather than hard-coded, so
the pending owner questions plug in without a second code path (§7):

* `borrowPolicy: 'outward' | 'either-side'` — Q2. `'outward'` reproduces today's
  `scanSpans` (`:318-326`) exactly.
* `interiorBasis: 'full-gap' | 'region-extent'` — Q6. `'full-gap'` reproduces
  today's shipped choice, which is pinned by a test.

Both are read once, from `geotechSubdivisionPrefs` (which already round-trips
`litho_snap_tolerance_m`), and passed to **both** arms — so a flip moves the
render and the build together, which is the entire point of this design.

### 3.2 The render consumer

`refineLithoPartition` keeps its signature and its output type. Internally it
becomes `computeRegionPackingProfile` + an emitter.

The emitter can then be rebuilt as *"walk consecutive samples, emit the quad
strip between consecutive fraction cuts"* — gap-free and overlap-free by
construction, because the cuts tile. That retires the **1,810 m² coverage loss**
and the **696 m² of interior voids** as a side-effect, and makes the honest 0.0 %
target of `refineLithoPartition.cs1frozen.test.ts` reachable. It is listed as a
late phase (§6, Phase 6) because it is not *required* for the build to inherit —
but it is the second-largest win in this document and it costs nothing extra
once the profile exists.

### 3.3 The build consumer — payload

`RegionInput` gains ONE optional field, additively (the payload is stored
verbatim in `litho_build_generation`, and a pre-#256 payload must still load —
`voxel_types.py:82-88`):

```python
@dataclass(frozen=True)
class RegionInput:
    ...
    packing: RegionPackingInput | None = None   # NEW — None = a litho build
```

The geotech "Build model" then posts **the litho regions** — byte-identical to
what the litho build posts — each carrying its own packing profile. The geotech
arm of `assembleLithoSectionInputs` / `computeSectionFillActive` is retired.

Note what this means for the payload's column set: the geotech build gains the
**18 undivided-borehole columns** it does not have today (§7 of
`geotech-stage.md`), because it now ships the LITHO column set. That single
change removes the input asymmetry the fallback diagnostic identified as the
driver of the between-column divergence.

### 3.4 The build consumer — backend

Three small, local changes to a pipeline that is otherwise untouched:

1. **`_section_stack_at`** (`label_voxels.py:352`) already slices every region of
   a gap at fraction `f` and carries the region's classification onto the
   `_Entry`. It additionally carries the region's `packing` profile and the
   fraction `f` it was sliced at. No geometry change.

2. **A new pure domain module**,
   `domain/services/voxel_litho/subdivide_stack_by_packing.py`:

   ```python
   def subdivide_entry(entry, profile_cuts_at_f) -> list[_Entry]:
       """Split one litho interval into packing sub-intervals.

       The cuts tile [0, 1], so the sub-intervals tile [base, top] EXACTLY.
       """
   ```
   Because the cuts tile, the sub-intervals tile the litho interval exactly, and
   the union of the sub-entries is the entry. **GI holds at every voxel column,
   by construction, with no tolerance and no reconciliation pass.**

3. **`_blend_stacks`** (`label_voxels.py:592`) blends the two nearest sections'
   LITHO stacks exactly as it does today — paired by `body_id`, one-sided bodies
   pinched, `reach_to_evidence` unchanged. Then, for each blended entry, the two
   sides' fraction-cut lists are blended with the SAME weight `w1`, in fraction
   space, pairing cuts by geotech `body_id` where both sides have one and by NAD
   class otherwise. An unmatched cut collapses to zero *fraction* thickness — so
   the remaining cuts still sum to 1 and the litho interval stays fully tiled.
   The blended cuts are then mapped onto the blended litho interval.

**This ordering is the load-bearing decision of the whole design.** Blend litho
first, subdivide second. The reverse — blending geotech bodies directly — is
candidate (b)'s failure mode and violates GI, as argued in §1.

### 3.5 Why the section-plane divergence collapses to ~0 BY CONSTRUCTION

A voxel whose `(x, y)` lies on section `S` projects onto `S` with perpendicular
distance `d1 = 0`, so `w1 = d2 / (d1 + d2) = 1` (`label_voxels.py:869-870`) and
the blend returns `S`'s own stack and `S`'s own cuts. The geotech label at that
point is therefore `profileAt(profile_S, f)` — which is, by definition, the
polygon the render draws there. Not "agrees with" — *is*.

Residual on the section plane, after Phase 5, is exactly four things:

| residual | cause | size on this model |
|---|---|---|
| voxel quantisation | 2 m × 0.5 m grid vs the gate's 0.25 m along-sample | bounded by half a cell |
| honor-column override | the honored log wins inside its own cell, by design | ~1 cell per investigation |
| under-column substrate | `refineSubstrateQuads` is a SECOND rule the build must also inherit (Phase 4) | see §5 |
| hand-drawn boundaries | Q5 — the render clears `lensBoundaries` on non-litho axes; the build applies them | 1 stored boundary → nil today, **but see §5** |

Target for the re-frozen baseline: **≤ 1 % model-wide**, from 44.13 %.

### 3.6 Honor-borehole, footprint, geo-bounding, meshing — all inherited unchanged

* **Footprint** — `build_domain_from_sections` unchanged; it now sees the litho
  column set for the geotech build too, so the hull stops being narrower than the
  litho model's.
* **Honor-borehole** — `load_body_picks(geotech_model_id)` already returns the
  geotech bands as `InvestigationColumn.intervals`, and `honor_precedence`
  already decides collisions. Unchanged. At an honored column the packing comes
  from the investigation's OWN geotech bands, not from interpolation — which is
  exactly what the render draws at a column.
* **Geological bounding — GONE, both levels.** The litho voxel build has been
  geology-independent since 2026-07-30 (`build_voxel_litho_model.py:640-670`,
  owner ruling: A2 geo-decoupling in 3-D), and the geotech stage's own
  geo-bounding was deleted on 2026-08-26 (owner: *"just drop the wall
  everywhere, user wil have to manually do it"*). `SubdivideAllBodies` Phase 3
  no longer cuts anything; `divide_picks_by_geology` is deleted.

  ⚠ **A geotech 3-D build must NOT assume geo-bound bands.** A packing band may
  now span a geological contact, so "a packing boundary never crosses a
  geological one" is no longer true of the evidence and cannot be relied on as
  a precondition. `source_geo_formation_id` survives as a derived LABEL
  (thickness-weighted majority over the band, i.e. its midpoint's unit) — it
  answers "which geological unit is this band mostly in", never "where does
  this band stop". Any geological bounding the geotech build wants is its own
  to apply, explicitly, and is an open design question rather than something
  inherited.
* **Cross-section body merge, true-position re-seat, greedy meshing, watertight
  extraction, the checksum short-circuit, `litho_build_generation`** — all
  operate on the litho regions and are untouched. `plan_body_aliases` merges the
  LITHO bodies; geotech sub-bodies inherit their parent's alias.

---

## 4. What happens to the geotech columns and the geotech correlation edges

Traced honestly, because the answer is not what the current code shape suggests.

### 4.1 Geotech columns (the per-investigation NAD sub-band stacks) — unchanged, and now the ONLY geometric evidence

They feed `makeClassSlicesElev` → `spansOf` → the L/R span lists → the profile.
Both arms read them. `SubdivideAllBodies` and `DivideBoreholes` remain their sole
producers. Nothing about how they are made changes.

### 4.2 Geotech correlation edges — they leave GEOMETRY and become IDENTITY

Today, geotech edges have exactly these consumers:

| consumer | what the edge does | fate under inherit |
|---|---|---|
| `ResolveLithoInstances` (approved only) → `litho_layer.body_id` + `BodyOrm` | **identity** | **kept, and promoted** |
| **build arm** `fetchApprovedEdgesBySection` → `assembleLithoSectionInputs` → `computeSectionFill` → region `kind` / `overlay_tier` / `tied_band_base` | **geometry** | **RETIRED** |
| **3-D fence arm** `useBody3DViewState` → `buildProjectFence` | **geometry** | **RETIRED** (see §5) |
| `CorrelationEdgesOverlay` ribbons + right-click gestures (unfiltered — pending and approved both drawn) | UI only | kept |
| `GeotechTieReanchor`, `load_existing_geotech_edge_pairs_by_section`, `AutoCorrelateGeotechEdges` dedup, band-edit class re-validation delete, bundle I/O | bookkeeping | kept |

**The 2-D geotech render does not consume geotech edges at all.**
`refineLithoPartition`'s five inputs are litho regions, column order, geotech
sub-band stacks, NAD metadata and the litho soil map — no edge list. Band
connectivity is re-derived from scratch by a client-side weighted LCS on NAD
class + fraction position (`pairWeight` / `lcs`, `:227-257`). It never looks at a
persisted tie.

That produces today's sharpest asymmetry, and it is worth naming plainly because
this design makes it worse before it makes it better:

> On the geotech axis, accepting a packing tie changes the 3-D model and the body
> roster, and changes **nothing the engineer sees in the section**.

Under inherit, the build stops reading edges for shape — so unless something
changes, accepting a tie would change *nothing geometric anywhere*, only
identity. Two ways forward, and the choice is the owner's (OQ-1, §7):

* **(i) Edges seed the pairing.** `computeRegionPackingProfile` takes an optional
  `forcedPairs` argument; an approved tie between two sub-bands forces a `band`
  cut and outranks the LCS. The gesture regains a visible meaning, on both arms
  at once.
* **(ii) Edges stay identity-only.** The LCS remains the sole geometric
  authority; "Correlate packing" is a naming/grouping verb, exactly as
  `body_id` is "identity, not shape" for litho (`body-model.md`).

Either plugs into the same parameter. The design does not decide it.

### 4.3 `GeotechSubBand.bodyId` must stop being dropped

Currently populated and never read. Under inherit it must be threaded
`GeotechSubBand → Span → PackingCut → RegionInput.packing → _Entry → label`,
because it is the mesh grouping key: it decides which voxels become ONE geotech
body, one solid, one exportable unit, one row in the inspector. This is a
required change, not an option.

---

## 5. Impact assessment

### `SubdivideAllBodies` — unchanged, and structurally de-risked

Its policy-B aggregator, TIN split surface, geo-bounding, materialisation and
Phase 9 edge derivation all stay. One real improvement: Phase 9's
`same-position-edges-only` rule and the derivation's dedup no longer affect build
GEOMETRY, only identity — so a change there can no longer silently reshape the
3-D model. The §4 hand split/merge verbs likewise only move packing surfaces
*inside* a litho body, which is now enforced in 3-D as well as in the 2-D
clamp (`clampSplitDepth` / `canMergeBands`).

⚠ Unchanged and still true: **"Subdivide all bodies" deletes and rebuilds the
entire geotech model**, destroying every hand split and merge, and nothing warns.
Out of scope here; already recorded in §4.

### Borehole packing preview — DB5 / DB6 / DB7 stay green untouched

`plan()` / `execute()` write and read geotech `litho_layer` rows; the build does
not touch them. The three parity gates assert preview ≡ commit on those rows and
are unaffected.

**Add DB8:** *an undivided borehole must still receive geotech material in the
3-D build.* Today it cannot — it is not in the build arm's column set at all.
Under inherit it contributes its litho column and borrows packing, so this
becomes assertable, and it is the direct 3-D counterpart of §6's ghost bands.

### Exports — no breakage; a genuine unlock

No export path emits geotech geometry today. All four exporters (DXF section,
PLAXIS 2D section, PLAXIS 3D project, section PDF) consume formation CONTACTS
through `SectionSnapshot` / `GroundModelSnapshot`; `build_section_snapshot.py`
references neither `LithoLayerOrm` nor `LithoBodySolidOrm`, and `ExportCanvas`
hardwires `activeGeologicalModel`. So inherit breaks nothing.

It also improves the Tier-D story (#104). `body-model.md` records that the
partition geometry "lives only in client-side TS", so an exporter must either
port it or export client-side. Under inherit, the geotech geometry is fully
described by *(litho partition) + (packing profiles)* — both already serialisable
payloads that cross the API boundary and are stored verbatim in
`litho_build_generation`. That is the first time geotech geometry exists
server-side in a form an exporter could read. Recorded as a consequence, not a
deliverable.

### Watertight gates — GVW-1..4 survive; two new cases carry the invariant

`test_geotech_voxel_watertight.py` POSTs a hand-authored ZAND-only rectangle
partition, built from a **geotech** layer's `formation_id` / `body_id`, to the
model-agnostic `build-voxel` endpoint. Under inherit the payload becomes a LITHO
region carrying a packing profile. The four assertions survive in substance:

* **GVW-1** (0 flagged, `method='voxel'`, no sampled overlap) — verbatim;
  watertightness comes from the labeller, which is untouched.
* **GVW-2** (honor-borehole beats the partition at BH-1) — verbatim.
* **GVW-3** (partition drives the label away from investigations) — verbatim.
* **GVW-4** (the KLEI body materialises as a persisted solid) — verbatim.
* **NEW GVW-5 — GI.** For each litho body `B`, the union of geotech solids whose
  litho parent is `B` equals `B`'s litho solid, by vertical-ray sampling over the
  footprint grid (reusing `vertical_ray_intervals` /
  `assert_no_overlap_sampled`). This is the gate that makes GI enforceable rather
  than asserted.
* **NEW GVW-6 — no straddlers in 3-D.** No geotech body's vertical interval
  crosses a litho contact at any sampled column.

### Bundle round-trip — unaffected, with one pre-existing defect to record

The desktop saves `.strix` with `includeSolids = false`, so no geotech mesh has
ever survived save/open — unchanged. The payload change touches
`litho_build_generation`, which stores the section payload verbatim; the profile
becomes part of it, so `scripts/diag_build_generations.py --reproduce` must
round-trip it (add to Phase 2's verification).

⚠ **Pre-existing, not caused by this work, but now worth fixing:**
`litho_body_solid.generation_id` is serialised into the bundle and re-applied on
restore, while `litho_build_generation` is **not** in `BUNDLE_COLLECTION_KEYS`.
A cross-DB restore therefore reinstates an FK whose target row was never shipped.

### The 3-D fence panels — a THIRD arm nobody has been counting

`useBody3DViewState` → `buildProjectFence` runs `assembleLithoSectionInputs` +
`computeSectionFillActive` over the geotech layers and geotech edges — the same
free re-partition as the build, on a separate call path. Wall panels in the
geotech 3-D view therefore disagree with the section render for the same reason
the solids do, and no gate measures it. It must switch to the same inputs
(Phase 3) or the convergence is only two-thirds done.

### The frozen agreement baseline — and what the gate becomes

Today: `totalDisagreementPct` **44.13 %**, `buildableDisagreementPct` 42.40 %,
engine v2, 14 sections. Expected after Phase 5: **≤ 1 %**, residual per §3.5.

Be honest about what that number then means. Under inherit the build's
section-plane geometry IS the render's, so the gate becomes near-tautological on
the section plane. It keeps real value as a **regression detector** — it goes red
the moment anyone reintroduces a second path — but it stops being a measurement
of geological quality. Its successor is the pair of 3-D gates:

* **GVW-5 / GVW-6** (GI, above) — the volumetric invariant.
* **`eval_strat_fidelity.py` pointed at the geotech model** — the drilled-column
  gate, which asks the only question that survives convergence: *does the model
  reproduce what was logged?*

Propose re-freezing the agreement baseline at the new number and re-labelling the
gate in its own header from "how far the invariant is from holding" to "the
invariant holds; this proves nobody broke it".

### ⚠ Q5 stops being hypothetical the moment both arms share one partition

`geotech-stage.md` §7 records that `SectionsCanvas` clears `lensBoundaries` on
any non-litho axis, so the geotech render derives **zero** apex overrides, while
both voxel builds apply the stored boundaries. Today the two arms consume
different partitions, so this is invisible on this model (1 stored boundary).

Under inherit **both arms consume the same litho partition**, and
`deriveSectionApexOverrides` is applied by one of them and not the other. That is
then a *direct, permanent* divergence floor: the gate can never reach 0 while it
holds. **Q5 must be resolved — the geotech axis must apply the litho boundaries —
as part of this work, not after it.** Sequenced as Phase 1 precisely because
resolving it changes the render, and that change should land against the OLD
baseline where it is measurable in isolation.

### `refineLithoPartition.cs1frozen.test.ts` — its ratchet must be re-frozen DOWN

It currently caps the frozen CS1 slice's coverage loss at 2.2 % (measured 2.11 %,
399.5 m² of 18,920.6 m²) with the honest target stated as 0.0 %. The tiling
emitter (Phase 6) should reach it. The ratchet must be tightened in the same
commit that improves it, or the improvement is not defended.

---

## 6. Phased implementation plan

The agreement gate is the arbiter throughout. Every phase names what must stay
green. No phase is allowed to move the gate in the wrong direction without the
owner being told the number.

**Gates that must stay green in EVERY phase** (baseline, before anything):
`partitionFill.cs1void` (`CS1_GATE=1`), `partitionFill.cs1sandbody`,
`partitionFill.cs1lensdisjoint`, `partitionFillV2.cs1gates.diag`,
`refineLithoPartition.cs1frozen`, `refineLithoPartition.test`/`.render.test`,
`geotechAgreementFreeze`, `test_geotech_voxel_watertight` GVW-1..4, DB5/DB6/DB7,
both `tsc`, the unit suites, and the e2e baseline (117 passed / 1 known
pre-existing red / 5 skipped).

### Phase 0 — extract the profile (pure refactor, zero behaviour change)

Split `refineLithoPartition` into `computeRegionPackingProfile` + emitter.
Thread `GeotechSubBand.bodyId` into `Span` and `PackingCut` (carried, not yet
read). Add the two policy parameters, defaulted to today's behaviour.

*Verify:* every existing `refineLithoPartition.*` test green **with byte-identical
emitted polygons** — diff the emitted arrays, do not trust the assertions. Run
the agreement gate: `totalDisagreementPct` must be **exactly** 44.13059146625271.
A single-digit change here means the refactor was not a refactor.

### Phase 1 — resolve Q5: the geotech axis applies the litho hand-drawn boundaries

Stop `SectionsCanvas` clearing `lensBoundaries` on the geotech axis.

*Verify:* agreement gate re-run — the render arm moves (on this model, nil: 1
boundary). Re-freeze the baseline deliberately, with the delta stated. The
TRACKED SUSPECT line in `geotechEngineAgreement.diag.test.ts` is removed and its
§7 Q5 entry is answered.

### Phase 2 — the build inherits, behind a flag

`RegionInput.packing` (additive, optional). The geotech `makeVoxelRequestBuilder`
posts litho regions + profiles. Backend: profile carried onto `_Entry`;
`subdivide_stack_by_packing.py`; fraction-space cut blending in `_blend_stacks`.
Gated on `STRIX_GEOTECH_INHERIT=1` + a device pref, exactly like the v2 partition
engine's cutover, with the old path as fallback.

*Verify:* GVW-1..4 green under **both** flag states; new GVW-5 + GVW-6 green
under the new one and RED under the old one (a gate that passes on the old code
is not testing the invariant); agreement gate under the new flag — expect the
step change, report it; `eval_strat_fidelity.py` on the geotech model; the
generation-payload round-trip via `diag_build_generations.py --reproduce`; DB5/6/7
untouched-green; the payload diag `geotechVoxelPayload.diag.test.ts` updated to
the new shape.

### Phase 3 — the fence arm

`useBody3DViewState` / `buildProjectFence` consume the same litho regions +
profiles.

*Verify:* a fence-panel-vs-section-render comparison on the same section (a
throwaway diag in the shape of `geotechEngineAgreement`, then deleted or frozen);
the `strix-section-geometry-check` skill on every touched overlay.

### Phase 4 — the under-column substrate

`refineSubstrateQuads` gets the same profile treatment, so the build inherits the
under-TD packing subdivision rather than leaving it to the litho substrate alone.

*Verify:* `refineSubstrate.test.ts`; the agreement gate's substrate residual line
goes to ~0.

### Phase 5 — cutover

Flip the default. Retire the geotech arm of `assembleLithoSectionInputs` /
`computeSectionFillActive` and the geotech `fetchApprovedEdgesBySection` build
call. Re-freeze the agreement baseline at the new number. Rewrite the gate's
header from "measures how far the invariant is from holding" to a regression
guard, and point `geotech-stage.md` §7 at GVW-5/6 as the successor gate.

*Verify:* full suite; owner dogfeed (§ below).

### Phase 6 — the tiling emitter (optional, high value)

Rebuild the render's emitter as a quad-strip walk over the profile cuts.

*Verify:* `refineLithoPartition.cs1frozen` coverage ratchet re-frozen DOWNWARD
(target 0.0 %); `detectRefinementOverlaps` self-overlap count 212 → the by-design
lens overlays only; interior voids 696 m² → 0.

### Owner dogfeed after Phase 5 (no test can drive it)

1. Geotech axis, 2-D: the packing render is unchanged from today apart from
   Phase 1's boundaries and Phase 6's seams. If it changed anywhere else, the
   convergence went the wrong way — the build was supposed to move to the render,
   not the reverse.
2. Build the geotech model. Slice the 3-D view on a section line; the cut face
   must match the 2-D render on that line.
3. A borehole you have NOT divided must now carry geotech material in 3-D
   (borrowed packing) instead of a hole.
4. Tie-section 11 and Tie-section 13 (1 and 0 divided columns) must appear in the
   3-D model at all — today they contribute nothing.

---

## 7. Open questions

### Genuinely the owner's — geological semantics

* **OQ-1 — does an accepted packing tie force a band? ANSWERED (owner,
  2026-08-04 evening): YES — option (i), edges seed the pairing**, with the
  litho-faithful no-tie default (no tie → no band; the untied span pinches out
  instead of meeting at a mid-gap seam). SHIPPED in the RENDER arm ahead of this
  design — `refineLithoPartition` takes `options.packingEdges` and counts the
  two bounding contacts exactly as `classifyTermination` does; see
  `geotech-stage.md` §2b for the shipped rule, the deferred 1-tie onlap, and the
  borrow/mirror carve-out.
  **What that measurement then proved about the BUILD arm, and it belongs in
  this design:** making the render obey ties moved render/build divergence
  39.1 → 39.7 %, because `computeSectionFill` (the build arm) does NOT apply the
  same default — `pairScore` still matches same-class spans on geometric overlap
  alone (tier 1) when no edge exists, and the contact count only picks the
  termination shape. So the profile of §4.2 must apply ONE rule to both arms:
  either the profile's `forcedPairs` also becomes the build's only pairing
  authority, or the render's no-tie default is relaxed to "match on geometry,
  shape by tie count". Convergence to 0 is impossible while the two arms answer
  "does an untied span connect at all?" differently.
* **OQ-2 = existing Q2 — may a region borrow packing from the far side of its
  gap?** PENDING; the visual aid is delivered (960.3 → 212.0 m² of plain
  lithology if bidirectional). Designed as the `borrowPolicy` parameter — either
  answer is a default flip that moves both arms together.
* **OQ-3 — do packing lenses exist in 3-D?** `hlens` / `enclens` are OPAQUE
  OVERLAYS in the render — deliberately outside the tiling. A voxel has exactly
  one label, so there is no "overlay" in 3-D. Either the lens takes its fraction
  interval over its reach (joining the tiling, and then it must also join the
  render's tiling) or it is a 2-D-only annotation that the 3-D model does not
  carry. This is the one place where the render's model and a voxel model are
  genuinely incompatible, and it needs a geological answer.
* **OQ-4 = existing Q4 — soil-guard conflict.** Under inherit this becomes
  presentation-only: the profile carries `soilConflict` and both arms decide
  together. Still an owner call on what to DRAW.
* **OQ-5 — between two sections, do packing interfaces interpolate in FRACTION
  space or in ABSOLUTE ELEVATION?** Fraction space (proposed) means a packing
  surface follows the litho unit as it thickens and thins — the same claim the
  render already makes across a gap. Elevation space means it stays flat while
  the unit thickens. Consistent ≠ correct; this is a geological claim and it is
  the single assumption on which §3.4's blend rests.
* **OQ-6 — a litho body with packing evidence on NO section anywhere.** The
  render draws plain lithology (`fallback`). Should the 3-D model carry it as an
  unclassified body, or leave it void? Today the build simply has no material
  there, which is not a decision anybody took.
* **OQ-7 = existing Q7 — priority** of the render's own holes relative to this
  work. This design folds them into Phase 6 rather than treating them as a
  separate campaign, because the profile makes them nearly free. Owner may still
  want them first.

### Engineering choices, made here, not owner questions

Profile extraction as a byte-identical refactor; the additive optional
`RegionInput.packing` field; blend-then-subdivide ordering; the feature flag +
device-pref cutover shape mirroring the v2 engine; the gate rewrite and its
GVW-5/6 successor; which ratchets tighten and when.

---

## 8. What this design does NOT do

* It does not change how packing classes are DERIVED. `SubdivideAllBodies`,
  `DivideBoreholes`, the NAD classifier, the median statistic (ruling 6) and the
  hand split/merge verbs are all untouched.
* It does not add geological bounding to the 3-D build. The litho build is
  geology-independent by owner ruling (2026-07-30); the geotech evidence is
  already geo-bound upstream in `SubdivideAllBodies` Phase 3.
* It does not fix the staleness gap between a litho model and its geotech child
  (debt #266) — arguably it raises the stakes, since the geotech build now reads
  the litho partition directly and a moved litho contact moves the 3-D geotech
  model with it. Worth re-reading #266 after Phase 2.
* It does not make any export emit geotech geometry (#104 stays open); it only
  puts the geometry somewhere an exporter could reach it.
