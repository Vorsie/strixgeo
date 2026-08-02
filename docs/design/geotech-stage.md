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

⚠ **No staleness detection between a litho model and its geotech child** —
debt #266. Drag a litho contact and the geotech bands below it silently describe
a stack that no longer exists; nothing marks the geotech model stale until the
next Subdivide re-derives it.

## Open dogfeed items (owner)

Tracked in `CLAUDE.local.md` → Active Focus: visual/gesture dogfeed of the
connect flow, the fraction-refinement render, the NAD `gradient_snap` default
decision, and the NAD-boundary line weight call.
