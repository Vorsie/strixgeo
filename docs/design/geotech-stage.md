# Geotech Stage — current design (ACTIVE MILESTONE)

> Current state only. The 2026-06-24 "connected NAD-band section render"
> (`subdivideRegionsByGeotech` / `carveRegionByGeotech`) is SUPERSEDED by the
> fraction-space refinement below.

Sequencing decision (owner, 2026-06-29): **the geotech subdivision stage is
worked out FIRST**; the provenance-based parameter-suggestion slice is a noted
future MVP candidate revisited only after this stage (rationale in
`CLAUDE.local.md` → Active Focus).

## 1. Subdivision (shipped 2026-06-24, develop)

Body-centric Option A: `SubdivideAllBodies` use case — policy-B aggregator +
TIN split-surface + geotech `litho_layer`/edge/`BodyOrm` materialisation via
the litho machinery, **same-position-edges-only** to prevent NAD-class
over-merge. Surface: "Subdivide all bodies" toolbar verb +
`GeotechnicalCanvas` + `GeotechnicalInspector` roster.

Real-data validated on `test.strix`: 14 sections, 273 body groups, 20 %
consistent-split / 73 % one-class / 7 % borehole-only.

Deferred: e2e spec/fixture (F6); `parameter_group` analytical layer (#223,
Slice 3, waits for lab-test import).

## 2. Fraction-space refinement — the geotech render model (shipped 2026-07-07)

Worktree `feat-geotech-fraction-refinement` off `feat-geotech-body-samples-3d`,
**UNPUSHED**. Owner-locked after the 8-rev CS1 brainstorm — handoff doc:
`docs/superpowers/2026-07-06-geotech-fraction-refinement-handoff.md`.

**The geotech partition is the LITHO partition refined in thickness-fraction
space** — litho boundaries INVARIANT; each region subdivided internally by NAD
packing class.

* The geotech axis builds the partition from the LITHO model (layers + edges)
  and refines it via the pure
  `desktop/.../utils/refineLithoPartition.ts` (`refineLithoPartition` +
  `refineSubstrateQuads`; a faithful port of the accepted rev-8 `carvePanel`,
  plus pinch/lens→single-dominant-class + apex-reach void clamp).
* **Invariant = the always-on frozen-CS1 gate at ZERO cross-class overlap**
  ("one packing class per point").
* In-app wiring: SectionsCanvas flip + a `geotechRefinement` bundle →
  SectionPanel → `PartitionFillOverlay` (refined render; view-only apart from
  the two verbs in §4).
  ⚠ **Visual is owner-dogfeed-pending** — green vitest/tsc don't catch this
  god-component's TDZ/visual bugs.
* Backend fix that rode along: geotech edges were derived before boreholes
  materialised (S13↔B4↔B6↔S6 got 0 edges); `DivideBoreholes` now re-runs the
  shared `application/geotech_edge_derivation.py` after borehole-band fill +
  re-resolves `body_id` (fixes the B6 NULL orphan).

Deferred: rule-8 geo policy-b (needs a per-formation `lithology_content`
attribute); #227 manual geotech edits; #228 litho engine slivers (parallel
session).

## 3. Connecting geotech units (built 2026-06-25, develop UNPUSHED)

All four phases shipped (~31 commits, subagent-driven, two-stage-reviewed):

* (A) auto rule = **full NAD-class-SEQUENCE match within a litho body**
  (`_derive_geotech_edges_from_litho` rewrite + pure helper
  `domain/services/geotech_packing_edges.py`);
* (B) render connects sub-bands by resolver `body_id` (`geotechSubdivide.ts`);
* (C) `ReSubdivideConfirmDialog` prompts before a re-subdivide clears
  connections;
* (D) manual "Correlate packing" gesture reusing the litho correlate machine
  pointed at the geotech model (same-class + same-litho-body guard
  `utils/geotechPackingConnect.ts`, `requestGeotechLayersRefetch` nonce,
  toolbar verb).

META-RULE real-data verified: 226 auto edges, 0 cross-class, 0 null-class.
See `memory/project_geotech_stage_body_centric.md`.

## 4. Hand split / merge of packing sub-bands (2026-08-01, develop UNPUSHED)

The geotech axis is view-only **except** for splitting a packing sub-band and
merging two adjacent ones. Everything else stays shut: contacts on this axis
still cannot be created, dragged, copied or deleted (`SectionsCanvas.geotechViewOnly`
pins that, and `SectionsCanvas.geotechBandEdit` pins that the hole is exactly
two verbs wide). The two verbs are allowed because they do not move a contact —
they go through their own endpoints, which re-derive the NAD class from the qc
over each resulting interval.

Owner rulings driving the shape are recorded in full in `docs/debt.md` #227.
The four that constrain the code:

* **Hard bounds (ruling 2).** A packing boundary moves freely inside its litho
  body and clamps at the edge; it never moves a litho contact and never crosses
  a geological one. A litho body here is already geo-bounded, so "inside one
  litho body" enforces both walls in one test
  (`components/sections/geotechBandEdit.ts` — `clampSplitDepth`,
  `canMergeBands`). This is the ONE refusal that is correct rather than a
  defect.
* **The class is derived (ruling 3), locally (ruling 4).** The server re-derives
  each resulting interval from qc and re-scopes nothing beyond the edited
  column; correlations whose partner no longer matches the new class are
  dropped, and the toast names how many went.
* **Manual override always wins (ruling 5).** The consequence sheet
  (`GeotechBandEditDialog`) never disables its action, whatever the warnings
  say, and is deliberately not styled as an irreversible confirmation — focus
  lands on the verb, not on Cancel.
* **The statistic must not lie (ruling 6).** The warning is computed on the
  MEDIAN, because `geotech_subdivision.py:444` classifies on `median(in_band)`.
  Label it "representative qc" in the UI, never "average qc", even though the
  owner's phrasing was "avg".

The view-only line is enforced by handler ABSENCE, not by an axis check inside the
overlays, so every gesture that needs a handler has to be gated where the handler is
passed. `SectionsCanvas` withholds `onCreateContact`, `onUpdateContactDepth`,
`onDeleteContact` and the batch pair (`onBatchUpdateContacts` /
`onBatchCreateContacts`, the multi-select and cross-column-copy drags) on this axis.
`ContactsLayer` in turn draws no affordance it has no handler for — its drag hit-strip,
its per-column band "Remove this litho unit" menu and its per-column "Add new suggestion
here" capture rect all gate on the relevant handler, because
`perColumnBandsFromContacts` is true on the geotech axis too and those surfaces
otherwise render over packing bands (`ContactsLayer.viewOnly.test.tsx`).

Gesture (mirrored from the litho axis, `LithoSuggestionGhostColumns`):
right-click a band → "Split band…", right-click the boundary between two bands
→ "Merge bands". Choosing to split ARMS a placement — the boundary follows the
cursor, clamped, with a readout naming the wall — and a click puts it down.
It is armed-and-click rather than press-and-drag because left-drag on this
canvas pans the section: a band-wide press target would either swallow the pan
or fight it. `GeotechBandEditOverlay` therefore listens for nothing but a
right-click at rest, and owns the canvas only while a placement is armed.

⚠ **Owner-dogfeed pending, and no integration test exists** — the DB-level
behaviour of these endpoints (mirror trigger, no-overlap exclusion, contiguity
trigger, edge FK cascade) is reasoned from migration SQL, not exercised.
⚠ **Ruling 7 (selectable representative statistic: median / arithmetic /
harmonic / geometric, per geotech model) is NOT built.** Until it is, the
warning and the classifier both read the median; when it lands, both must read
the model's choice from the same place or the warning starts lying.
⚠ **"Subdivide all bodies" deletes and rebuilds the entire geotech model**, so
it silently destroys every hand split and merge. Nothing warns today.

## 5. Carrying accepted ties across a re-subdivide (2026-08-02, develop UNPUSHED)

"Subdivide all bodies" throws every geotech band away and rebuilds it with a
fresh `uuid7`, and both endpoint FKs on `litho_contact_correlation_edge` are
`ON DELETE CASCADE`. So Postgres deletes every correlation edge as a side effect
of the layer wipe — silently, without passing through application code. Sparing
accepted edges in the reset's own `WHERE` clause makes no difference at all: the
cascade takes them anyway. Accepted ties survive only because
`GeotechTieReanchor` captures them before the wipe and re-creates them after the
rebuild, in the same transaction.

**Owner rule (2026-08-02):** *"i don't want accepted edges to just disappear
without any user explicitly deleting it."*

Three tiers, tried in order per endpoint:

| tier | condition | outcome |
|---|---|---|
| 1 | same investigation, same depth interval (to the mm), same NAD class | carried clean |
| 2 | exactly one band of the SAME class overlaps where the old band was | carried clean — the band was resized by a litho drag |
| 3 | anything else overlaps | carried, stamped `review_reason` |
| — | nothing overlaps anywhere | lost, logged at WARNING |

Tier 2 exists because tier 1 alone dropped 13 accepted ties on the real model:
12 of them had exactly one same-class band overlapping 72–100 % of the old
interval, with boundaries that had moved by as little as 4 cm. Tier 3 covers the
13th, whose packing class had genuinely re-derived.

`review_reason` is `'class_changed'` or `'ambiguous_band'`, free text on the edge
so a new reason needs no migration. A flagged edge stays `user_approved` **on
purpose** — demoting it to a proposal would hand it to the next rebuild's
dirty-delete pass, which is the silent disappearance this whole path prevents.

Real-data measurement (`scripts/measure_geotech_tie_reanchor.py`, dev model):
**217 of 217 accepted ties survive**, one flagged `class_changed`. The script
re-derives the rule independently from the band tables and cross-checks the use
case's counts, so a disagreement is a loud failure rather than a silent one.

**UI.** A flagged tie renders its accepted styling plus a violet `!` badge
(`components/sections/edgeReviewFlag.tsx`) — deliberately not amber, which
already means "auto-proposed, pending acceptance", and never colour alone. The
badge is right-clickable and its menu carries **Confirm tie** above **Delete**.
Confirming clears the flag (`ConfirmCorrelationEdgeReview`, per-edge and
model-wide endpoints); deleting is the other answer. A `warning` toast after
Subdivide reports the count, because the badges only reach someone looking at the
section they sit on and a re-subdivide is model-wide.

**"Divide boreholes" carries ties the same way.** Phase 7 of `DivideBoreholes`
deletes every borehole `litho_layer` in the geotech model, so the same cascade
takes every accepted tie with a borehole endpoint — and the button is one click,
ambered on purpose after any packing correlation, so re-clicking it is the normal
flow. It therefore runs the SAME `GeotechTieReanchor`: `capture(...,
restrict_to_anchor_kind='borehole')` before the delete, `reanchor(...)` after the
borehole fill and BEFORE the Phase-8.5 derivation (so that pass's per-section
dedup set already holds the carried ties). CPT↔CPT ties are deliberately not
captured — Phase 7 does not touch their endpoints, so their rows survive
untouched and counting them would overstate what the verb did. The re-anchor sees
both the surviving CPT bands and the freshly written borehole bands, because both
live in the `geotech_layer_by_inv_depth` index the phase already builds.
`DivideBoreholeResult` / `DivideBoreholeResponse` carry `reanchored_tie_count`,
`review_tie_reasons`, `lost_tie_count` and `lost_tie_reasons`, and
`handleDivideBoreholes` reports all three outcomes in the same three toasts
Subdivide uses.

This is also why `REASON_BOREHOLE_DEFERRED` exists: Subdivide materialises CPT
bands only, so a borehole endpoint finds no band there. That is a build-order
fact, not geology the rebuild stopped drawing — the borehole bands come back one
verb later.

⚠ **No staleness detection between a litho model and its geotech child** —
debt #266. Drag a litho contact and the geotech bands below it silently describe
a stack that no longer exists; nothing marks the geotech model stale until the
next Subdivide re-derives it.

## 6. Seeing the packing before committing it (2026-08-04, develop UNPUSHED)

**Owner ruling (dogfeed 2026-08-04):** *"correlation bands aren't plotted over
boreholes so it is impossible to see how divide-all-boreholes will act — what
gets what packing — before you click the button."*

The gap is structural, not cosmetic. `SubdivideAllBodies` materialises CPT bands
only; every litho edge with a borehole endpoint is skipped there
(`skipped_empty_stack=229` on the dev model, "deferred to DivideBoreholes"), so a
borehole column on the geotech axis is genuinely blank until `DivideBoreholes`
runs — and that verb deletes and rebuilds every borehole band while it is at it.
The engineer had to commit to find out.

**The engine is now callable as a dry run.** `DivideBoreholes.plan()` is
everything up to the first write — load litho picks, geo-bound, group, read the
CPT geotech layers, TIN-interpolate each borehole, assign class / provenance /
body — returning a `DivideBoreholePlan`. `execute()` calls it and transcribes the
result (`_persist_planned_segment` decides nothing); `POST
.../geotech/divide-boreholes/preview` calls it and reports it. **There is
deliberately no second implementation of the rules.** A preview that re-stated
them could show one packing class and write another, and the engineer would have
no way to notice.

`plan()` issues only `SELECT`s. It does NOT read the prior borehole bands, so
planning before or after the Phase-7 delete produces identical bands.

**The gate.** Integration `test_db5_preview_equals_commit` runs preview, then
commit, on one fixture and asserts the committed bands EQUAL the previewed ones —
depth interval, NAD class, confidence — per borehole, not a tolerance and not a
count. `test_db6` asserts the same for the tie-carry counts. On its first run the
gate caught a real divergence: the preview reported a `body_id`, but the commit
re-runs `ResolveLithoInstances` after the borehole-mediated edges exist and
re-stamps `body_id` on every band. **The preview therefore reports no body_id at
all** — only fields the plan genuinely owns are promised.

`test_db7_preview_between_two_divides_equals_the_second_divide` is the same gate
on an ALREADY-divided model — the case the plan/execute split actually
introduced, since `plan()` now runs before the Phase-7 delete. It asserts the
preview mutates none of the first divide's rows and that its bands are what the
second divide commits. (`_committed_borehole_bands` orders in SQL, so two bands
sharing a top depth cannot make the comparison depend on physical row order.)

**Render.** `components/sections/GeotechBoreholePreviewGhosts.tsx` draws the plan
as ghost bands on the geotech axis: translucent `nadClassColor` fill, dashed
outline, 45° hatch — the litho pending-suggestion convention
(`LithoSuggestionLayer`), so "hatched = not committed" means one thing across the
editor. Geometry uses `col.nudgedX` like every other overlay.

*Confidence is visual, not only textual.* A class a neighbouring CPT resolved
(`cpt_interpolated` → `high`) and a conservative fallback (`body_min` /
`absolute_min` → `low`) must not carry the same weight on a feature whose whole
point is "what packing does this borehole get", so the low tier draws with a
lighter fill and a denser hatch. The `<title>` naming the provenance is the
second channel: the band rect stays hit-testable for it (a `pointer-events:none`
ancestor kills every `<title>` beneath it), while the hatch and label are
`none`. Accepted trade-off — a click on a ghost is swallowed rather than reaching
the fill underneath, and a ghosted column is an undivided borehole with no
geotech gesture of its own. Unknown provenance tokens are quoted verbatim rather
than described, so a future engine token cannot be given a false evidence claim.

*Nothing is dropped silently.* A band thinner than a pixel is drawn at a 1 px
floor; a band entirely outside the depth window cannot be drawn at all and is
COUNTED, surfaced by the toolbar next to the legend. Absence must never read as
"nothing is planned at this depth".

**Scope: this previews the FIRST divide of a column, not a re-divide.** A column
carrying committed bands drops its ghosts, so pressing `Divide boreholes` a
second time is as blind as before — `boreholesStale` says the bands are out of
date, not what they would become. Deliberate: drawing a plan over the rows it
would REPLACE needs a diff render (outline-only against the committed bands),
which is its own design question. The backend is already ready for it (DB7).
Tracked as a small item in `docs/debt.md`.

**Refresh + legend.** `useGeotechBoreholePreview` fetches while the geotech axis
is showing and a geotech model exists, keyed on `geotechLayersVersion` — a
counter `useGeologicalModel` ticks once per SUCCESSFUL load of the committed
rows, i.e. once after Subdivide (which invalidates every planned band) and once
after Divide (which turns the ghosts into rows). It is deliberately not the
`geotechLayers` array: the bus clears that to a fresh `[]` before every refetch,
so keying on its identity ran the whole planner — TIN interpolation included —
twice per mutation, and left a window in which the overlay read the empty array
as "no borehole is divided". `geotechLayersLoaded` closes that window: while the
committed rows are unknown, the last known answer holds. The planner's snap
tolerance (`geotech_subdivision.litho_snap_tolerance_m`) is a key too, since
`plan()` reads it — and `geotechSubdivisionPrefs` now round-trips that key, which
the patch builder used to drop.

Only the 404 carrying `detail.code = "geotech_model_not_found"` is silent (it
means Subdivide has not run). Every other 404 — a broken litho-model reference
404s with a plain-string detail — toasts like any other error, because an empty
borehole column otherwise reads as "this borehole gets no packing".

The toolbar's `geotech-preview-legend` is gated on what the overlay ACTUALLY
drew, published through `utils/geotechPreviewRenderStore`. Recomputing "is any
in-corridor borehole undivided" in the toolbar said "Hatched = preview" over an
empty axis whenever the overlay had declined to draw — no collar elevation,
still loading, or a failed request with the error toast already up.

⚠ **Visual dogfeed pending** — hatch weight at dense column spacing (now two
densities), and whether the NAD abbreviation is legible in a thin ghost band.

## 7. The render/build agreement gate (2026-08-04, develop UNPUSHED)

**The geotech axis draws one geometry and builds another.** The section render is
the LITHO partition refined by NAD class (§2, litho boundaries invariant); "Build
model" runs `computeSectionFill` a second time on the GEOTECH layers and GEOTECH
edges (`makeVoxelRequestBuilder` → `buildVoxelRequest`) and posts THAT. Different
engine inputs, so what the engineer sees is not what the 3-D model is labelled
from — and until this gate nothing measured the difference.

* **The gate** — `desktop/.../utils/geotechEngineAgreement.diag.test.ts`
  (`GEOTECH_AGREE=1`). Both geometries are mapped into ALONG-METRES × ELEVATION —
  never paired by region index, which is the rank-pairing error that produced a
  phantom result once already — and compared by packing CLASS and by AREA at
  every point.
* **Who can run it, and on what.** Not CI, and not a fresh clone. The input is
  `scripts/throwaway_geotech_axis_inputs.json`, an UNTRACKED read-only dump of
  the owner's dev DB, regenerated with
  `uv run python scripts/dump_geotech_axis_inputs.py`; a missing input FAILS the
  run with that recipe rather than skipping. The committed half is the baseline
  (`__fixtures__/geotech_agreement_baseline.json`), which records the model ids
  and the engine it was frozen on. The ACTIVE engine is read at run time from
  env / device localStorage, so **a v1 device enforces nothing** — read the
  engine line before reading a green run as a pass.
* **It is frozen.** `geotechAgreementFreeze.diag.ts`: a section that drifts more
  than 0.5 pp FAILS, an improvement prints and asks to be re-frozen
  (`GEOTECH_AGREE_FREEZE=1`), and a section whose column / edge counts moved is
  reported as not-comparable rather than enforced. The **enforced** model-wide
  number is accumulated over the comparable sections only and names the excluded
  ones — enforcing the all-sections total would re-admit exactly what the
  per-section skip just refused.
* **Where the divergence comes from** — `scripts/diag_geotech_arm_input_divergence.py`
  and `geotechFallbackCause.diag.test.ts` (`GEOTECH_FALLBACK=1`) answer that on the
  input side. On the dev model the two arms agree EXACTLY at the columns (44
  investigations, 322 litho units, 0 geotech bands straddling a litho contact,
  worst boundary offset 0.5 mm), so **every divergence is interpolation BETWEEN
  columns**, driven by two input differences: the build arm has 65 of the 83 litho
  columns (all 18 missing are undivided boreholes — §6) and 216 of the 480 ties
  (104 of the missing ties join two columns the build arm does have).
* **One real defect found and fixed:** `refineLithoPartition` sampled the packing
  only at gap fractions 0 and 1, so a region that reaches NEITHER column — which
  engine v2 emits routinely — was never sampled and short-circuited to the
  `fallback` tag, whose documented meaning is "no packing data in the whole
  section at these elevations". It samples the region's own extent instead:
  model-wide disagreement 55.2 % → 44.1 %, and the area drawn in plain lithology
  while the build assigned a class 9,851 m² → 168 m². The fix carried a COST and a
  CHOICE, both below.

### What the remaining 44.1 % actually decomposes into

The earlier claim "the remaining ~44 % is NOT plumbing" was too strong. Re-run on
the 2026-08-04 extract, model-wide, section-plane m²:

| bucket | m² | share of the 26,371 m² that does NOT agree |
|---|---:|---:|
| different LITHOLOGY at the same point | 9,480.6 | 35.9 % |
| same lithology, different NAD packing class | 8,971.8 | 34.0 % |
| drawn on the section, absent from the build | 6,036.8 | 22.9 % |
| present in the build, blank on the section | 1,714.0 | 6.5 % |
| *(of the above, carrying the render's `fallback` tag)* | *960.6* | *3.6 %* |

So **96.4 % of the residual is both arms assigning a class and disagreeing, or
one arm having material the other has not** — the architectural question (Q1).
The remaining **3.6 % (960.6 m², 1.6 pp of the 44.1 pp headline) is still
plumbing-class**, and `GEOTECH_FALLBACK=1` splits it further:

| fallback cause | m² | verdict |
|---|---:|---|
| same-soil packing exists only in the direction the one-directional scan does not search | 749.2 | **defect, but the direction rule is owner-locked (Q2)** — worst single polygon 252.0 m² on Tie-section 11 |
| no column carries same-soil packing inside the region's EDGE envelopes although bands overlap its bounding box | 37.1 | unexplained residual defect (37.0 m² of it is one polygon on Tie-section 14) |
| the refinement SHOULD have found data | 1.0 | unexplained residual defect |
| SOIL GUARD firing correctly — the only packing at those elevations is another soil | 173.0 | **not a defect** (Q4) |

The 749.2 m² is NOT fixed here on purpose: making the outward scan bidirectional
changes the owner-locked rev-8 rule ("borrow the NEAREST classified column
OUTWARD") into "may a region borrow packing from the far side of the gap?", which
is a geological question, not a null-guard.

### Render-arm defects the owner question does not cover

These are inside `refineLithoPartition` alone — no build-arm input difference can
explain them, and they are visible on screen as holes and wrong-colour overlaps
on the packing render:

* **Coverage loss.** The litho partition covers 59,853.3 m²; the refined render
  covers 58,043.2 m² — **−1,810.1 m² (−3.02 %)** of a geometry the design rule
  says is INVARIANT. Worst sections: Tie-8 −4.53 %, Tie-10 −4.43 %, Tie-6
  −4.30 %, CS2 −4.27 % (−572.6 m²), CS1 −2.86 % (−538.4 m²), CS3 −2.78 %.
* **Interior voids.** Litho partition 0.00 m², render **696.13 m²** — worst hole
  **17.0 m across** (Tie-section 4); CS2 205.11 m² / worst 7.94 m, CS1 185.46 m² /
  worst 4.07 m.
* **Carve overlaps.** Render 212 self-overlapping polygon pairs from the carve
  (plus 13 the litho engine itself owns); the build arm has 8, totalling ~1e-5 m².
* **The fallback fix made two of the three worse**, stated plainly: coverage loss
  962.3 → 1,810.1 m², carve overlaps 152 → 212, interior voids 727.45 → 696.13 m².
  Refining previously-unrefined interior regions carves them imperfectly.
* **Gated, so it cannot grow silently:** `refineLithoPartition.cs1frozen.test.ts`
  now asserts coverage as well as escape — the frozen CS1 slice loses 2.11 %
  (399.5 m² of 18,920.6 m²) and the ratchet sits just above it. The honest target
  is 0.0 %.

### Two things the frozen 44.1 % does NOT cover

* **The hand-drawn-override path is unexercised on this model** — 1 stored litho
  boundary, 0 geotech, and every section reports `overrides=0` on both arms. The
  gate now calls the real builder's `deriveSectionApexOverrides` instead of a
  hand-copy of it, so the two cannot drift; but the number does not test it.
* **⚠ TRACKED SUSPECT — the geotech render applies no hand-drawn boundaries at
  all.** `SectionsCanvas` clears `lensBoundaries` on any non-litho axis, so the
  geotech axis derives zero overrides, while the LITHO render and BOTH voxel
  builds apply them. The gate measures what is on screen (that is its job) and
  prints this as a TRACKED SUSPECT line every run rather than burying it in the
  baseline as "correct". Impact on this model is nil, so it is a rule question
  (Q5), not a bug report.

### The owner questions

1. **Does the 3-D geotech build inherit the litho geometry, or re-derive it?**
   **ANSWERED (owner, 2026-08-04): INHERIT.** "We already built the framework —
   keep the litho bodies and subdivide them in 3-D based on packing, with the
   same rules and mechanisms as the litho voxel builder." The geotech build must
   stop re-partitioning geotech layers freely: it takes the litho bodies as the
   envelope and subdivides each internally by packing, exactly as the render
   treats the geotech partition as the litho partition refined internally. This
   is candidate (a) — the free re-partition path is retired for the build.
   (Context that motivated the question: the two arms disagreed over 44.1 % of
   the section plane; at the columns they were identical — 0 straddlers, 0.5 mm
   worst offset — so the divergence was entirely in how the gaps were banded.)
2. **May a region borrow packing from the far side of its gap?** Today the left
   side scans only leftward and the right only rightward (your rev-8 "nearest
   classified column OUTWARD"), so 749.2 m² paints plain lithology while the data
   exists — worst case 252.0 m² on Tie-section 11, where the section's only
   classified column is on the side the scan will not look.
   **PENDING — owner asked for a visual aid (2026-08-04) before deciding.**
   The aid is built and delivered (Claude artifact `q2-borrow-visual`, from
   `geotechQ2Visual.diag.test.ts` run on the real extract twice — shipped rule
   vs a cross-gap borrow patch). Measured what-if: total plain-lithology area
   960.3 → 212.0 m² (748.3 m² flips, matching the gate's 749.2 m² direction-miss
   figure); Tie-section 11 416.4 → 164.4 m² (Δ 252.0 — the worst case above);
   the 212 m² residual is the Q4 soil-guard area plus genuine no-data.
3. **Should a section with fewer than 2 divided columns be built at all — and
   should the canvas say so?** Tie-section 11 (1,774.1 m²) and Tie-section 13
   (21.6 m²) are drawn in full and dropped entirely by the build: 1,795.7 m² of
   the 6,036.8 m² "drawn, not built", with nothing on screen telling the engineer
   the section contributes nothing.
   **ANSWERED (owner, 2026-08-04): BUILD THEM.** "Of course — this is common in
   tie sections, and without those how else would you go from 2-D to 3-D." A
   section with fewer than 2 divided columns must still contribute to the build;
   dropping it silently is a defect. (Under the Q1 ruling this resolves
   naturally: the build inherits the litho partition — which those sections have
   in full — and subdivides it, so no section is dropped for lacking divided
   columns.)
4. **When the litho region says one soil and the only packing at those elevations
   is another (173.0 m² — e.g. 110.1 m² of SILT region over KLEI+VEEN+ZAND
   packing on Tie-section 11), should the render keep showing plain lithology, or
   mark it as a conflict?**
5. **When you reshape a lens boundary by hand on the litho axis, should the
   geotech axis draw the reshaped boundary too?** Today it does not, while the
   litho render and both voxel builds do. On this model 1 boundary is stored, so
   nothing visibly moves either way — this is a rule call, not a defect report.
6. **Inside a region that touches NEITHER borehole (203 regions, 10,796 m², 18.0 %
   of the section plane), should the packing interfaces be interpolated across
   the whole gap (what ships today) or across only the region's own width?** They
   differ by up to a metre where the region sits far from both columns: 1,335 m²
   is inset more than 10 % of the gap, worst 80 %. The shipped choice is pinned by
   a test so it cannot change by accident.
7. **Priority:** the render's own holes — 696 m² of interior voids (worst 17.0 m
   across) and 1,810 m² (3.02 %) of the litho partition dropped by the NAD carve —
   fix now, or after the build/render question above is settled?

## Open dogfeed items (owner)

Tracked in `CLAUDE.local.md` → Active Focus: visual/gesture dogfeed of the
connect flow, the fraction-refinement render, the NAD `gradient_snap` default
decision, and the NAD-boundary line weight call.
