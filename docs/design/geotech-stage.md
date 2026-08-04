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
still cannot be created, dragged or deleted (`SectionsCanvas.geotechViewOnly`
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

## Open dogfeed items (owner)

Tracked in `CLAUDE.local.md` → Active Focus: visual/gesture dogfeed of the
connect flow, the fraction-refinement render, the NAD `gradient_snap` default
decision, and the NAD-boundary line weight call.
