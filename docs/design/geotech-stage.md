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

### 2b. The gap fill obeys the packing correlations (owner ruling 2026-08-04 evening)

> *"correlate by hand between CPTs, so we can reuse the litho's 2/1/0 ruling"*
> — with the litho-faithful no-tie default: **NO tie → NO band.**

Until this ruling the refinement paired left/right packing spans AUTOMATICALLY
by class + stack position (rule 4's weighted LCS) and consumed no edges at all,
so the "Correlate packing" gesture changed body identity and nothing the
engineer could see. Now `refineLithoPartition` takes
`options.packingEdges` — **the same approved geotech edge rows the 3-D build arm
is fed** (`fetchApprovedEdgesBySection` filters `user_approved` the same way), so
one hand correlation moves the render and the build together.

The counting is litho's, transposed onto packing spans
(`utils/geotechPackingTies.ts`, mirroring `partitionFill/matcher.ts`):

| correlated bounding contacts | packing span pair |
|---|---|
| 2 | **BAND** across the gap (still requires the two spans to be the same NAD class) |
| 1 | **treated as 0 — DEFERRED**, see below |
| 0 | **no band** — the spans pinch out through the unmatched-span machinery |

* **top contact** — a top-keyed edge between the two spans' own topmost layer ids;
* **base contact** — a top-keyed edge between the layers immediately BELOW each
  span in its own column (a layer id keys the contact at its top, so the layer
  below owns this span's base — read off the column's FULL stack, which is what
  the build reads too), or a bottom-tie (`base`/`base`) edge on the spans
  themselves.

An explicit tie outranks position: a tied pair bands at ANY elevation (the litho
matcher's own rule for a correlated bed that dips), and overlap only breaks ties
between crossing candidates in the monotone LCS.

**Where the tie rule does NOT apply, deliberately.** A side with no packing of
its own borrows the nearest donor or mirrors the other side (§7 Q2 / the S10
rule). A borrowed span carries a DONOR column's layer ids and has nothing of its
own to tie, so those regions keep the shipped class+position pairing untouched.
On the frozen CS1 slice that is **81 of 163 quad regions** — "no ties" is
nowhere near "no bands" (pinned in `refineLithoPartition.cs1frozen.test.ts`).

**Untied intervals no longer meet at a mid-gap seam.** With spans left unmatched
on BOTH sides, the interval is filled by the THICKEST class present *in* it and
every other span pinches out from its own column as an overlay lens. The
bracket-bulge rule
stays what it always was — the ONE-SIDED case, where the far column has no
packing at those fractions to contradict it. Letting a bracket win the two-sided
case floods: measured, it put the thin n22 crust over 619 m² of n23 clay on
Cross-section 1 and cost 3.7 pp of agreement.

`packingEdges: undefined` (an un-threaded caller) keeps the legacy pairing
byte-for-byte; an empty array means "no ties exist here" and pinches honestly.
Both statements are pinned by `refineLithoPartition.edges.test.ts`.

**F1 RESOLVED 2026-08-05 — the lens no longer blends with the fill it covers.**
The defect was real and measured: on the two-sided untied scene 65 of 1 521
probe points were painted by BOTH the interval fill and the pinch-out lens at
0.62 opacity each (n7 `#b8963a` over the n5 fill `#e8d48a`), so the thin side
read as a third colour belonging to neither class.

Mechanism chosen: **carve the lens footprints out of the fill**, in
`utils/carveOverlayLenses.ts`, applied by `PartitionFillOverlay` to the
refinement's output. Both inputs are convex by construction (the emitter
produces trapezoids between two sample fractions, and its tapers are triangles
already clipped by convex half-planes), so `A − B` decomposes into at most one
convex piece per edge of `B` — `piece_i = A ∩ outside(e_i) ∩ inside(e_0..e_{i-1})`,
disjoint by construction, each a Sutherland–Hodgman clip. Exact, not
approximate; a non-convex subject is left alone rather than mangled.

The alternative — rendering geotech-axis `hlens`/`enclens` opaque — was
rejected: it removes the blend by giving those bands a different apparent
colour from every other band of the same class on the section, trading one
dishonest colour for another.

Painter order decides the winner, and it has to: a FILL is carved by every
overlay of its gap (the anchor walk emits interval fills and their lenses
interleaved, so a lens can precede a fill it still covers), while an OVERLAY is
carved only by the overlays drawn AFTER it — so the topmost lens is never
carved and a lens-over-lens patch belongs to exactly one class.

**It is a RENDER-layer transform, deliberately.** `refineLithoPartition`'s
output stays byte-identical, so the owner-locked rule suite and the frozen CS1
gate keep their pins, and the watertightness detector's by-design overlay
exclusion is untouched. Verified: 0 blended points after the carve, no coverage
lost (every point the raw refinement covered is still covered), and the lens
polygons pass through unchanged. Negative-controlled — with the carve disabled
the render gate `PartitionFillOverlay.refinement.test.tsx::F1` reports the 65
blended screen points by name.

**The real-data gate is where the carve earned its keep.**
`refineLithoPartition.cs1frozen.test.ts` now runs `crossClassOffenders` over the
carved output with the overlay tags RETAGGED so they are checked rather than
excused — the exclusion that let F1 ship in the first place. It went red on the
frozen CS1 slice (`GAP-2 SILT:15 x SILT:16: 44 cells`) and named a second, real
defect: the refinement emits rings with a REPEATED final vertex
(`[…, [0.6, -2.6304], [0.6, -2.6304]]`), and a zero-length edge's half-plane
test is identically 0 — so "outside that edge" evaluates to the whole plane and
the subtraction handed back a piece covering the region it was removing. The
cutter is deduplicated before use; the case is pinned as its own unit test. The
coverage ratchet for the carved arm has to sum EVERY tag, because after the
carve a lens footprint belongs to the lens alone and a fill-only measure reads
the fix as a 4.4 pp loss of section that was never lost.

**DEFERRED — a JUMP tie cannot band in the fill yet.** Pipeline step 2 proposes
ties across borehole columns that carry no packing (§9), so an accepted tie can
name two CPTs with an undivided borehole between them. The refinement pairs PER
GAP — A|M then M|B — and neither gap holds both endpoints, so the tie is not
read and the fill behaves as if it did not exist. Not papered over: the
workflow answer already exists, since step 4 divides the borehole and the two
now-ADJACENT pairs band through the ordinary 2 → BAND path. Pinned by
`refineLithoPartition.edges.test.ts` ("DEFERRED — a JUMP tie over an undivided
borehole cannot band yet"), so the day the engine spans a gap it goes red
rather than changing silently.

**DEFERRED — the 1-tie ONLAP.** Litho's middle case has no primitive in fraction
space: the anchor walk strictly alternates *unmatched interval* / *pair band*,
and a half-anchored band cannot enter it without redesigning the machinery every
guard in it was forced by. One tie is therefore treated as none. Pinned by a
test so the day the onlap lands, it goes red rather than silently changing.

**Measured cost against the build (see §7).** Render/build divergence
**39.1 → 39.7 %** — it went UP, and the reason is the BUILD, not the render: the
build runs `computeSectionFill` over the geotech stack, whose `pairScore` still
MATCHES same-class spans on geometry alone when no edge exists (an edge is tier
3/4, geometric overlap tier 1) and uses the contact count only to choose the
termination SHAPE. So the two arms now disagree about a different thing: whether
an untied span connects at all. Split of the +0.6 pp: +0.5 from the pairing
precondition, +0.1 from the pinch-out replacing the seam. Everything else moved
the right way — interior voids 15.7 → 12.2 m² on CS1, carve loss −19.0 → −15.5 m²,
plain-lithology fallback unchanged at 172.9 m². **The baseline was NOT re-frozen**
(the rule says re-freeze only when the number shrinks); closing the rest is the
inherit design's job — the build arm must stop requiring nothing.

## 3. Connecting geotech units (built 2026-06-25, develop UNPUSHED)

All four phases shipped (~31 commits, subagent-driven, two-stage-reviewed):

* (A) auto rule = **NAD-class LCS match within a litho body**
  (`derive_geotech_edges_from_litho` + pure helper
  `domain/services/geotech_packing_edges.py`). Since 2026-08-06 the LCS
  reconstruction takes matches as EARLY (shallow) as possible: when
  equally-long alignments exist, the tops-together pairing wins — it is the
  litho tie restated (§4a), and the old bottom-up traceback could tie a
  surface band to a deep band (the same deep↔shallow mispairing the
  renderer's weighted LCS in `refineLithoPartition.ts` was built to avoid);
* (B) render connects sub-bands by resolver `body_id` — since the
  direct-partition rewrite this happens inside `refineLithoPartition.ts`
  consuming the accepted edges (`geotechPackingTies.ts`), no separate
  connect module;
* (C) `ReSubdivideConfirmDialog` prompts before a re-subdivide clears
  connections;
* (D) manual "Correlate packing" gesture reusing the litho correlate machine
  pointed at the geotech model (`useGeotechPackingCorrelation.ts`,
  `requestGeotechLayersRefetch` nonce, toolbar verb). The client-side
  same-class/same-litho-body guard was dropped per the R1 ruling (tie freely,
  like litho); the surviving guard is server-side —
  `domain/services/litho_body_guard.py` refuses only ties whose bands share
  no adjacent litho body, and the refusal toast names both judged bands.

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

## 4a. Only RESTATED ties are born accepted (owner ruling A 2026-08-05, refined 2026-08-06)

Owner's rule, in his words: *"all ties are born unaccepted except those that
are already ties in the litho model."* A derived tie is born
``user_approved=True`` ONLY when it RESTATES a litho tie — its litho pair is
a DIRECT approved litho edge (not a bridged jump pair) and its endpoints are
the TOPMOST packing sub-band of each stack, so it joins the very contact
surfaces the engineer tied at the litho level. The litho approval already
vouches for exactly that connection; re-reviewing it would ask the same
question twice.

Everything else is a NEW machine claim and arrives PENDING for the
accept/reject flow, the pending chip, and the divide gate:

* the packing-density pairs at machine-invented boundaries inside the body
  (the loose/dense boundary tie in the canonical example — the ONE ghost the
  engineer sees in an unsubdivided↔subdivided sand pair);
* every bridged jump pair (inferred by walking the litho chain across a
  bandless column — not "already a tie in the litho model").

``source='auto'`` on ALL derived ties regardless of approval (hand and
machine stay distinguishable; the 2026-08-01 bug of stamping derived ties as
manual must never return). Consequences: bodies union across a derived tie
only once it is accepted (the resolver ignores pending edges); only accepted
ties are carried across a re-subdivide; the borehole preview ghosts wait for
pending = 0 with ≥1 accepted tie. The 2026-08-05 interim form of ruling A
(every litho-backed tie born accepted, step 3 usually a no-op) is
superseded by this refinement.

## 4b. The packing-tie litho-body guard is a SURFACE rule (owner, 2026-08-04)

A contact touches the band above it and the band below it — up to TWO litho
bodies. The guard (`shares_litho_body` + `_resolve_litho_bodies_for_geotech`)
compares BOTH adjacent bodies of each contact and allows the tie when the two
sides share at least one ("if one matches it matches"): the tie is then a
surface tie of the shared body's boundary, mirroring the litho stage's own
cross-lithology surface ties. Disjoint sets still refuse — two separate sand
bodies never merge by this gesture — and body formation stays safe because the
resolver never unions cross-class bands. The refusal toast names both judged
bands ("KLEI (NAD 23) on GEO-22/115-S10 and SILT (NAD 13) on GEO-10/170-S6
are in different litho bodies"), because the click that provoked this ruling
had silently landed one band below its target (thin-band hit area, debt #158).

**Geometry consequence recorded for the 2/1/0 fill (owner, same evening): a
HALF-matched surface tie constrains the pinch.** When only one adjacent body
matches across the tie, the unmatched band (e.g. the clay below the clicked
clay-base) must taper out to a point AT the tied contact — the tie tells the
fill exactly where the pinch lands.

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

Since §2b both arms at least read the SAME edge rows (approved geotech edges,
section-scoped). They still read them differently — the render requires two
correlated contacts before it bands, the build matches on geometry and uses the
count only for the termination shape — which is now the single largest named
cause of the residual and an input to the inherit design (OQ-1 there).
`GEOTECH_AGREE_NOEDGES=1` re-measures the pre-ruling render arm for comparison
and enforces nothing; the mode is printed on the header line of every run.

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
   **ANSWERED (owner, 2026-08-04, after the visual aid): "just take the nearest
   test that does have packing." SHIPPED same day.** The donor rule for a side
   with no packing of its own is now the NEAREST test with same-soil packing at
   its elevations, in either direction — distance in along-metres (the same
   array the partition ran on), column steps when the caller passes none; an
   exact tie prefers the outward side. One collision surfaced and was resolved
   in the owner-locked rule's favour: when the nearest donor IS the test the
   other side already reads, the side fraction-mirrors instead of taking
   elevation-clipped spans, so the S10 rule ("stripes follow a tapering
   envelope and vanish at the apex together") is preserved verbatim.
   Measured on the real model: total plain-lithology area 960.3 → 212.0 m²
   (748.3 m² gained a class, matching the 749.2 m² direction-miss figure);
   Tie-section 11 416.4 → 164.4 m². The residual is the Q4 soil-guard area
   plus genuine no-data. Agreement baseline ratcheted 44.13 → 43.5 % (the
   newly painted area mostly counts as *different-class* against the build's
   free re-partition — the Q1 inherit work is what collapses that).
   Rule pinned by `refineLithoPartition.test.ts` rule 6b; visual aid built by
   `geotechQ2Visual.diag.test.ts` (Claude artifact `q2-borrow-visual`).
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
   **RESOLVED BY THE Q1 ANSWER AND FIXED (2026-08-04).** Q1 = inherit makes the
   render the build's geometry source, so the holes stopped being cosmetic and
   were fixed the same day (diagnose → TDD fix → adversarial review). Three
   mechanisms closed in `refineLithoPartition.ts`: the sample grid spans the
   region's own fraction extent (a 1e-6 gap-edge inset no longer guts the two
   end strips — 1,681 m² of the loss, and 105 "interior" regions / 9,404 m²
   were this artifact, not geology); the grid brackets every polygon vertex
   (slice topology changes resolve exactly, not to a strip midpoint); taper
   triangles clip to their own band's boundary segments (double-paint
   2.67 → 0.00 m² on CS1). Model-wide after: coverage loss 1,820.6 → 64 m²
   (0.11 %), interior voids 679 → 57 m² (worst run 7.9 → 0.7 m), non-overlay
   overlap pairs → 0, agreement baseline re-frozen 43.5 → 39.1 %. Invariants
   pinned by `refineLithoPartition.partition.test.ts` (7 RED-first cases).
   Costs and residuals, owner-visible:
   * the refinement is ~2× slower and emits ~⅓ more polygons (memoised, not
     per-frame; watch geotech-axis pan/zoom smoothness on dogfeed);
   * **M5 residual, folds into OQ-3 of the inherit DRAFT:** a litho `lens`
     region emits ONE overlay and no tiling polygon (695 m² model-wide) —
     invisible on screen, but a 3-D inherit consuming tiling-only would see
     it as void; must be decided before the inherit build;
   * the side stacks of a both-ends-degenerate region are read at its own
     extreme fractions now (105 regions changed which packing they inherit —
     net improvement on the model, but it is a geometry-rule change, flagged
     for dogfeed);
   * 64 m² irreducible under the defect-forced 2 cm/1 cm filters and
     `clampReach` — deliberately untouched.

## 8. Where a borehole's packing comes from — the flanking CPTs (2026-08-04)

**Owner ruling, dogfeed of §6:** *the borehole's packing must come from the CPT
to the right and to the left on the cross section.*

Rule (`domain/services/borehole_flank_donors.py`, applied by
`DivideBoreholes._plan_borehole_bands_litho_confined`):

1. A **donor** is a CPT that shares the borehole's body group AND reads packing
   inside its own litho extent for that group.
2. Donors are ranked **along a section line**: nearest at a smaller
   along-position = left flank, nearest at a larger one = right flank.
3. Both flanks, same ordered class list → their band boundaries are paired and
   blended in **thickness-fraction space** of each donor's own litho extent,
   weighted inversely to along-distance, then re-laid on the borehole's extent
   (`mode = flank_interpolated`).
4. One flank → that donor's stack, fraction-mapped (`single_donor`).
5. No section places the borehole beside a donor → nearest donor by map
   distance (`nearest_fallback`).
6. Depth the donors leave unclassified still falls to `body_min` /
   `absolute_min`, unchanged.

Each planned band carries its `mode`, the donor names with along- and
map-distances, and the section that decided — additive optional fields on the
preview payload, for the hover provenance.

**What it replaced.** `transition_surfaces[k]` TIN-blended the k-th band
boundary of EVERY CPT in the body group, whatever class pair each boundary
separated, and voted the class by majority across the same crowd. On the real
model that mixed up to ten class pairs (inversions included) over CPTs as far
as 777 m away, and any borehole outside the TIN footprint fell to the body-wide
mean. 1411-GEO-23/126-B4 came out 6→7→6 — a sequence no CPT reads — with the
dense sand at −1.11; its nearest three donors (4.7 / 78 / 78 m, all in its own
body) read 6→7→8 with the dense top at ≈ −0.9. The module
`geotech_split_surface.py` is DELETED; it had no other caller.

**Two interpretations, owner veto pending:**

* *Mismatched flank sequences* → the nearer flank's stack verbatim. There is no
  honest pairing between two different class lists; this follows the earlier
  "nearest test that does have packing" ruling.
* *Several sections* → the section whose flanking pair is tightest (least
  extrapolation). **This one is consequential**: on B4's shallow sand body,
  Tie-section 11 (lone left flank GEO-23/125-S34 at 78 m, all NAD 6) beats
  Cross-section 1 (lone right flank GEO-23/125-S13 at 90 m, NAD 7 from +1.26)
  by 11.6 m of along-distance — and that is what decides whether the borehole
  reads dense sand there. Candidate alternative if the owner disagrees: prefer
  the section that draws the most donors of the group.

## 9. The four-step packing pipeline (owner ruling 2026-08-04, late evening)

**Owner ruling.** "Subdivide all bodies" did too much at once: it subdivided the
CPTs *and* derived packing ties, and those ties arrived ALREADY ACCEPTED. It is
replaced by four verbs mirroring the litho stage's suggest → accept rhythm.

| step | verb | endpoint | what it does |
|---|---|---|---|
| 1 | subdivide CPTs into packing | `POST .../geotech/subdivide-cpts` (litho model) | packing bands on the CPTs, **no** edge derivation |
| 2 | auto-correlate packing | `POST .../geotech/auto-correlate` (geotech model) | PROPOSES ties (`user_approved=false`), jumping across borehole columns |
| 3 | accept | `POST .../contact-correlations/accept` (all) · `.../{edge_id}/accept` (one) | promotes proposals; `GET .../geotech/tie-status` reports what is left |
| 4 | divide boreholes | `POST .../geotech/divide-boreholes` (litho model) | gated on step 3; optional `borehole_ids` subset |

The accept verbs are the litho axis's own — `AcceptContactCorrelations` has
never been litho-specific, and the router applies no kind guard — so step 3 is
reuse, not a second implementation. Nothing was duplicated for the geotech axis.

`POST .../geotech/subdivide-all-bodies` still works and now declares what it is:
the COMBINED verb, running steps 1 + 2 in one press, answering
`edges_derived: true` and `proposed_tie_count`. Its derived edges have been
proposals since 2026-08-01; the response is what changed.

### Jump ties — the pairing crosses undivided borehole columns

Step 2 runs BEFORE step 4, so every borehole column is deliberately empty of
packing. The derivation aligns packing stacks inside a correlated litho unit, so
a litho edge with a bandless endpoint finds nothing to align and is skipped: a
section drawn CPT – borehole – CPT proposed **nothing at all**.

`domain/services/geotech_edge_bridging.py` walks the litho correlation graph:
a layer whose column carries packing bands is a TERMINAL, one whose column does
not is TRANSIT. From every terminal it walks through transit layers only,
stopping at the first terminal reached, and adds that pair. Expansion stops at
terminals on purpose — a chain A–B–C of three divided columns already has its
own two correlations, and an A→C shortcut would tie bands the engineer never put
beside each other. It ADDS; the approved set is never reduced.

Applied by all three derivation callers (`SubdivideAllBodies`,
`AutoCorrelateGeotechEdges`, `DivideBoreholes` phase 8.5) via
`geotech_edge_derivation.bridge_edges_over_bandless_columns`. It is a no-op once
every column is divided, and still earns its place in `DivideBoreholes`: a
`borehole_ids` subset run leaves some columns undivided.

**Real-model measurement (dev DB, read-only):** 418 approved litho edges across
6 sections; the bridge adds **90 jump pairs, 76 of which straddle at least one
borehole column**.

### The gate

`divide-boreholes` answers `422 geotech_ties_pending` while any tie is still
proposed, carrying `pending_tie_count` / `accepted_tie_count` /
`geotech_model_id`. It is not bureaucracy: an accepted tie spanning a borehole
decides which CPTs that borehole's packing comes from (below), so dividing on
unreviewed proposals throws away evidence the engineer is one press from
supplying. `ignore_pending_ties: true` is the deliberate escape. The PREVIEW is
ungated — it writes nothing, and refusing it would only hide information.

The gate lives at the endpoint, not in the use case: it is a workflow policy,
and `DivideBoreholes.execute` stays callable by the tests and by any future
caller that has its own reason.

### Tie-informed donors (`mode = tie_interpolated`)

**Owner ruling:** when an accepted tie's span crosses the borehole's column on a
section and both endpoints are CPTs in the borehole's body group, THAT tied pair
becomes the donor pair, replacing the nearest-flank guess. §8's flanking rule
stays as the fallback wherever no tie spans.

`domain/services/geotech_tie_donors.py` returns a `FlankSelection` — the same
shape §8 produces — so both rules feed one laying-out function. Beyond naming
the donors, the tie supplies the band CORRESPONDENCE: both donors are reduced to
exactly the bands the engineer tied, in depth order, and everything else is left
for the conservative fill rather than invented. That is why a tied pair can pair
where the flanking rule refuses: §8 needs the two whole class sequences to
match, a tie says which band is which. A tie drawn across two different packing
classes is a surface tie, not a correspondence, and is left to the fallback.
Candidate pairs rank tightest-span first; a share below 0.5 % degrades to
`single_donor` exactly as F10 decided.

### "Check if the ties stay in the litho body" — the fraction rule

**Owner ruling:** *check if the ties stay in the litho body otherwise rescale
based on the litho thickness at that location.* A tied surface is read as a
fraction of each donor's own litho extent and re-laid at that fraction of the
BOREHOLE's extent (`flank_packing_surfaces`, unchanged from §8), so a litho body
that thins at the borehole rescales the surfaces instead of letting them walk
out of the envelope. Pinned by `test_geotech_tie_donors.py::T5` (2 m body) and
`test_divide_boreholes_plan.py::P8`, which runs the same donors against a 2 m
and a 1 m extent and requires 40 % of *whatever thickness is there*.

### What this changes on the dev model today: nothing, and why

All 217 accepted ties in the dev DB are CPT↔CPT and **none of them straddles a
borehole column** — they join adjacent CPTs, because the derivation that made
them stopped at borehole columns. So `diag_divide_borehole_explain.py "126-B4"`
is byte-identical before and after: 15 bands, 12 `single_donor` + 3
`flank_interpolated`, no `tie_interpolated`; model-wide the census is unchanged
at 139 `single_donor` / 32 `flank_interpolated` / 4 `nearest_fallback` / 9
`absolute_min` / 2 `body_min`. The rule only bites once the engineer re-runs the
new pipeline: the 76 straddling jump pairs are exactly the ties that can then
name a donor pair.

### The renderer half (2026-08-05)

The four verbs are four numbered toolbar buttons on the geotech axis, in press
order, replacing the single "Subdivide all bodies" press:

| button | testid | verb | gating |
|---|---|---|---|
| **1 · Subdivide CPTs** | `geotech-subdivide-cpts` | `subdivide-cpts` | needs a litho model; a RE-run still opens `ReSubdivideConfirmDialog` |
| **2 · Auto-correlate** | `geotech-auto-correlate` | `auto-correlate` | needs the geotech model + an open section |
| **3 · Accept all ties** | `geotech-accept-correlations` | `contact-correlations/accept` | needs the geotech model + an open section; amber while ties are pending |
| **4 · Divide boreholes** | `geotech-divide-boreholes` | `divide-boreholes` | **disabled while `pending > 0`** |

`GET .../geotech/tie-status` feeds `useGeotechTieStatus`, re-read after EVERY
verb (steps 1–4 and each single-tie accept). Its `pending` count renders as an
amber chip (`geotech-pending-tie-chip`) beside step 3 and names itself in step
4's tooltip. Because Chromium fires no mouse events on a `disabled` element,
step 4's explanation lives on a `role="presentation"` span wrapper — the same
device the axis toggle uses.

**The gate falls OPEN on an unanswered tie-status.** Only a LOADED count blocks:
a 404, a network failure, or a backend predating the endpoint would otherwise
disable step 4 permanently. The server enforces the gate regardless, so falling
open costs a 422 at worst — whose structured `message` is surfaced verbatim in
the error toast — and never a dead button.

Steps 2 and 3 were PROMOTED out of the "Correlate packing" caret; that control
is now a plain button owning only the manual gesture. Two ways to press the same
verb in one toolbar is the clutter debt #23 warns about, and a pipeline step
hidden behind a caret is a step the engineer skips.

**Per-tie accept** reuses the litho path unchanged (`acceptSingleContactCorrelation`
→ `handleAcceptGeotechPackingCorrelation`, which refetches the packing edges and
the geotech layers so the 2/1/0 fill re-renders with the new band). Only the
wording is axis-specific: `acceptEdgeLabel="Accept tie"`, so the row names the
same object as "3 · Accept all ties".

**Jump ties render honestly.** An edge whose endpoints are non-adjacent columns
draws a polyline that BENDS at each column it crosses (`warpAwareEdgeVertices`).
The accepted seam has done so since 2026-07-10; the PENDING proposal's dashed
outline and its right-click hit polygon did not, and now do
(`warpAwareRibbonOutline`). Drawing the proposal straight and the accepted tie
bent told the engineer the surface moves when he accepts it — and on this axis a
jump tie is the ordinary case, not the exception. Residual: the two
drag-to-retarget grab lines on a pending edge are still straight; they are
invisible and split at the screen midpoint, so warping them is its own change.

**Ghost-accept.** Right-clicking an undivided borehole's ghost bands offers
"Accept these bands (divide this borehole)", which POSTs `divide-boreholes` with
`{borehole_ids: [id]}` — the subset the preview was drawn from (backend gate
GP9). Per COLUMN, never per band: one borehole's bands are a single plan (its
donors, its litho extents, its ties), so accepting a band out of the middle
would ask the planner a question it was never asked. A subset commit does NOT
clear the `boreholesStale` amber — the columns it left out are still out of
date. The committed rows then drop that column's ghosts and leave every other
column's alone.

## Open dogfeed items (owner)

Tracked in `CLAUDE.local.md` → Active Focus: visual/gesture dogfeed of the
connect flow, the fraction-refinement render, the NAD `gradient_snap` default
decision, the NAD-boundary line weight call, and the two §8 interpretations.
