# Known Architectural Debt

Items that need a focused session — bigger than a quick fix, smaller
than a phase. Tracked here so each one is visible in PR / commit
context without rediscovering it from grep. **Order is strict
priority — top is highest, bottom is lowest. Tiers are grouped, but
within each tier the order also matters.**

Priority is **milestone-gated**. The next build milestone is the
**Geotechnical-subdivision stage** (Phase 4 MVP step 4 —
lithostratigraphic unit → NAD packing class + CPT-derived indicators).
It cannot start until the **lithostratigraphic stage is finished** — so
the items that finish the litho stage are the top group, **above an
explicit gate**. Within every group the order is also strict priority.
This list is the canonical ordering, not the numeric order of the
sections that follow.

### ═══ G. Before the Geotech stage — finish the litho stage ═══

The litho ghost-review workflow must be solid before geotech
subdivision is built on top of it. Priority order:

* **#99** — litho drag-clamp must pass through rejected layers (bug)
* **#98** — litho "add a layer" discoverability + right-click Split (owner green-lit)
* **#102** — same-lithology boundary merge button
* **#76** — accept-all "splits" displayed layers — diagnostic

### ═══ GEOTECH-STAGE GATE — everything below waits ═══

* **B. Commercial launch gates + pre-distribution hardening:** #2, #3, #4, #5, #6, #7, #47, #112, #113
* **D. Phase-4 export step + post-launch / Phase 5:** #104, #105, #13, #106, #107, #108, #109, #110, #111, #115, #116, #44, #52, #56, #60, #11, #100b, #101, #70, #71, #79, #93, #95
* **E. Lower technical debt:** #16, #17, #22, #27, #41, #62, #64, #65, #68, #82, #114, #117, #124, #125, #126

*(Tiers A "Phase 4 engineering blockers" and C "current work" are
retired into this structure — the remaining Phase-4 work is the
explicit Geotech-stage gate above plus #104 the export-step gap. #28 /
#39 and most of the old Tier-E list resolved across the May 2026
campaign. #104–#117 filed 2026-05-22 from a six-agent full-codebase
audit. See git log on ``develop`` for history.)*

When an item is resolved, **delete it from this list** — its
implementation history lives in the relevant commit on ``develop``,
not here. Numbers stay stable through a debt-fixing campaign (do
not renumber after each fix); explicit cleanup passes (last done
**2026-05-16: six-agent codebase audit added #29–#50, #24 deleted
(Modal semantic-token migration shipped) + #51 (inspector token
migration, de-scoped from the same pass's quick-fix batch). Tier C
campaign began 2026-05-16: #30 resolved (Export stage hub shipped),
#52 filed (PDF report export), #29 resolved (Plaxis 2D per-section
exporter shipped), #31 resolved (section CRS allowlist guard),
#33 resolved (Geology empty-state CTA + 3-case copy), #32 resolved
(geotech-units round-trip already covered by
``test_bundle_carries_geotechnical_units`` — confirmed green, no code
change), #34 resolved (elevation PATCH stales dependent TINs in-
transaction), #35 resolved (pinned_order survives Build) — Tier C
fully cleared. **Same day re-tier:** Tier B (bundling/commercial)
deferred (app not feature-ready for packaging); Tier C reopened as
the "current work" tier — #37, #38, #12, #41, #43, #51, #40, #36
moved up from D/E (data-loss landmine + roadmap-gating
velocity/refactor work + cheap dogfeed friction); #37 + #38 + #51
+ #43 + #36 resolved same day (model-aware `delete_model`;
contact-mutation use cases unit-covered in the pre-commit suite;
inspector chrome migrated to semantic tokens; Data-stage Esc-to-map
peel restored; excluded_borehole_ids now filtered in TIN recompute).
**2026-05-17:** #12 R1–R5 shipped (App.tsx 3,200→1,001); then the
net-first step — useShellContextValue.test (renderHook net, written
first) + verbatim memo → useShellContextValue (App.tsx 1,001→833);
the shellContextValue silent-staleness risk + #53 NETTED. **#12
RESOLVED (deleted) on substantive completion + owner-approved revised
DoD**: 3,200→833, dangerous memo isolated+netted, Sidebar gone;
strict `<400` de-scoped (architect-optimistic literal vs the
documented coordinator-pattern floor ~480–520 — chasing it = low-value
churn). #53 reframed (net now exists; residual = hand-maintained dep
array). #41 un-folded → stands alone. **#40 resolved** — geology.py
monolith split into a per-cluster package (75 integration tests
green, 27 routes byte-identical). **#41 part (a) done + re-tiered to
E** (2026-05-17): the pure geometry (`cesiumGeometry.ts`) extracted
VERBATIM + 13 vitest cases — the 585c714 bug class is now netted; the
residual component-mount smoke needs a Cesium mock harness, far lower
value once the math is covered. **Tier C now empty** — current work
drops to Tier D/E. **#50 resolved 2026-05-17** (Virtuele Boring model
codes codelist-gated before fan-out). **#49 resolved 2026-05-17**
(crossings validator collapsed to one model-contacts query). **#46
resolved 2026-05-17** (shared `shell/ToolbarPrimitives.tsx` extracted
at the rule-of-three window + `busy` in-button spinner wired on every
long verb). **#45 partial 2026-05-17** (shared `EmptyState`/
`LoadingState` primitive shipped + GeotechnicalCanvas/DataCanvas
then **#45 fully resolved 2026-05-17** — DataInspector adopted the
shared primitive via a new `compact` variant). **#48 progress-logging
shipped 2026-05-17** (restore loops now have
[i/total] DEBUG + phase summaries; only the cosmetic procedural-logger
style remains — #48 stays open, rescoped). **#42 resolved
2026-05-17** — all three multi-class offenders split: formation_contact
→ package + re-export, tin_surface + geology_validator value objects
→ domain/value_objects/ (verbatim, importers unchanged). **#18
resolved 2026-05-17** — stale surfaces suppress crossings validation
(shared useCrossingsValidation hook + neutral pending-build banner;
auto re-validates on Build). 26 open items**) compact them. Commit messages and code comments written
before a cleanup pass continue to reference the OLD numbers — that's
an unavoidable cost of the renumber. Sections #2–#28 below remain in
their prior numeric order; #29+ are appended in numeric order — read
the five-tier list above for true priority.

---

## 2. Bundled Postgres distribution path not prototyped (medium → blocking before beta)

**What.** CLAUDE.md "Distribution model" plans an installer that
bundles Postgres + PostGIS (the Plaxis pattern). No prototype
exists. Failure modes are non-trivial for a solo dev: port
conflict on ``localhost:5433``, Windows Defender quarantine of the
Postgres binary, upgrade paths across Postgres major versions.
Distribution risk that hits before any geotech engineer sees the
UI.

**Why deferred.** Not blocking development; current dev flow uses
Docker Compose. User-deferred 2026-05-15: bundling waits until the
feature set is ship-ready (UI rework, geotechnical model,
parametrisation, PDF reports, 3D viewer all still open) — a
packaged installer is worthless ahead of what it wraps.

**Fork analysis already done** — see
[distribution-db-decision.md](distribution-db-decision.md):
embedded-Postgres vs SQLite+SpatiaLite costed against the real
codebase surface (Fork A ~1–2 days, zero Python blast radius;
Fork B ~1–2 weeks, touches the array-backed depth-series schema).
Recommendation recorded: Fork A, SQLite as a documented escape
hatch. Pick up from that doc when revisiting — no need to re-derive.

**When to revisit.** When the v1.0 feature set is ship-ready, and
before the first clean-box coworker install. Build the Fork A
prototype on a clean Windows machine without Docker per the
decision doc's "proposed build step".

## 3. License key + activation system (medium → blocking before paid release)

**What.** No licensing today; anyone with the binary can run it.
For a paid release we need a license token system. Suggested shape:

* Signed offline tokens (Ed25519). Token carries: license_id, user
  email, tier, issued_at, expires_at (or "perpetual"), optional
  machine fingerprint.
* App verifies the signature at launch against an embedded public
  key. No phone-home required for daily use — important for the
  offline-on-site use case.
* Online activation only once per machine (claim the token to the
  user's email), to prevent infinite resharing.
* A small backend (single endpoint, single signing key) issues
  tokens after Stripe webhook.

**Why deferred.** Pre-revenue. Building this before paying customers
exist is the wrong order of operations.

**When.** Before opening any paid checkout. Plan ~1 week of solo
work: token format + signing CLI + verifier in the Electron main
process + a thin "Activate license" UI.

## 4. Project-by-id endpoints rely on "only caller is local user" (medium → day-1 of #3)

**What.** ``POST /projects/{id}/duplicate`` (project.py) and
``PATCH /projects/{id}/view-state`` operate on the resolved row
without an identity check. Today that's correct (single user, no
auth). When debt #3 lands, these endpoints will need a
``user_owns(project_id)`` predicate threaded through.

**Resolved (2026-05-19) — IDOR scope-guard half**: All CPT and
borehole by-id endpoints (``GET /cpt/{id}``,
``GET /cpt/{id}/plot``, ``DELETE /cpt/{id}``,
``PATCH /cpt/{id}/elevation``, ``GET /borehole/{id}``,
``PATCH /borehole/{id}/elevation``) now require
``?project_id=UUID`` and reject cross-project ids with 404 via
``get_in_project_or_404`` (VULN-1..7). Application layer use
cases ``CreateFormationContact``, ``AcceptLithoSuggestions``,
``UncorrelateLithoUnits`` have defence-in-depth scope checks
(VULN-9..12). Frontend ``client.ts`` / ``useInvestigationData.ts``
/ ``useSectionData.ts`` updated in lockstep. Unit suite 895 green.

**What remains.** The auth-threading step (``user_owns`` predicate
on project-level endpoints) still waits on debt #3.

**Why deferred.** No auth shipped.

**When to revisit.** Day-1 of debt #3 license-token work — auth
scaffolding must thread ``current_user`` through these routes
before any token-gated call ships.

## 5. Tamper / reverse-engineering hardening (low — pragmatic posture, residual)

**What's still open.** The malformed-input audit pass landed: every
DOV XML parser uses ``defusedxml`` (billion-laughs + external DTD
guards); ``project:read-file`` and ``fs:read-file`` apply size caps
before allocating Buffers; the API has its own body-size + GEF-upload
caps. What's left is the licensing-side hardening tied to debt #3:

* Defeat casual bypass (renamed exe, deleted license file).
* Token store + verification on each launch (already in #3's scope).
* No anti-debug, no obfuscation, no DRM theatre.

**Why low priority.** Geotech engineers don't pirate software at
scale. The .strix format is also not inherently sensitive — losing
the geometry of someone's site investigation isn't catastrophic the
way leaking a movie pre-release is.

**When.** Folds into debt #3's license-key work before paid release.

## 6. Installer + code signing + auto-update (medium → blocking before paid release)

**What.** electron-builder produces .exe / .dmg / .deb / .AppImage,
electron-updater handles deltas. Windows requires EV code signing
(~€200–400/year for a hardware-token cert) to avoid SmartScreen
"untrusted publisher" warnings that scare off enterprise IT.
macOS notarization is similar (~€100/year Apple Developer
membership + signing + Apple notary upload). Linux can ship
unsigned today.

**Why deferred.** Same as #3 — pre-revenue, premature.

**When.** In parallel with #3, before the first paid release.
Auto-update is especially important because future .gmproj format
upgrades depend on every user reaching the build that introduced
the upgrade path.

## 7. Marketing site + market-facing name (medium → blocking before paid release)

**What.**

* Trademark search for the market-facing name. "Strix" is a
  codename only; check both word marks and design marks before
  committing.
* Domain (.com + .eu likely both needed for BE/NL audience).
* Landing page: hero with the 90-second demo video, three
  "what does it do" bullets, founding-member email signup, FAQ,
  privacy / terms. Tailwind on Astro or similar — keep it boring.
* Demo video: DOV bbox import → borelog → save → wipe DB → reopen.
  Under 90 seconds.

**Why deferred.** Useless without the v1.0 MVP gate behind it. A
landing page that promises features the app doesn't have is worse
than no landing page.

**When.** As soon as the v1.0 MVP gate is real (layer model +
exports). Start collecting emails before announcing pricing — the
list calibrates demand and the launch send is the conversion event.

**Naming collision to resolve.** "Strix" (our codename) sits one
letter off "`.stix`" (Deltares D-Stability file extension). Same
audience (BE/NL geotech), same tools shelf, and we will likely
ship a `.stix` exporter via GEOLib. Engineers searching for
"strix file" or "stix export" will confuse the two. Treat this as
a hard constraint when picking the market-facing name — neither
"Strix" nor any close phonetic variant survives this. Trademark +
domain search needs to clear against both word marks AND the
common-knowledge association with D-Stability files.

## 11. Pluggable regional stratigraphy catalog for NL / international (medium — Flanders covered, NL open)

**What.** G3Dv3 (shipped 2026-05-14) closes the Flanders side of
the canonical-stratigraphy question: ``infrastructure/codelists/
g3dv3_catalog.py`` resolves every named G3Dv3 formation / member
to a Dutch name, age_rank, color, and H3D code, with a JSON alias
map (``data/g3dv3_aliases.json``) bridging historical names
(Ieper / Ieperiaan → Kortrijk). Auto-populate uses age_rank when
every newly-created formation resolves in the catalog and falls
back to depth-derived ordering otherwise.

The open question: **NL** (BRO / TNO Dutch stratigraphic chart),
**FR/EN multilingual labels** for the BE bilingual market, and
the interface that lets a project carry a "regional catalog"
preference. Today's code hard-codes G3Dv3 — switching to BRO for
a NL project, or showing French/English names for a BE
francophone user, requires either a sibling catalog file +
loader, or a small abstraction over both.

**Why deferred.** Flanders is the v1.0 launch market and is fully
covered. NL expansion is a Phase 5+ direction (see CLAUDE.md
"Commercial Direction") — adding a catalog before there's a NL
customer is premature.

**When to revisit.**

1. **First NL pilot user** lands and reports formations from BRO
   not resolving.
2. **Multilingual UI work** kicks off — the catalog needs FR/EN
   name columns alongside name_nl.
3. **A second catalog file appears** (BRO export) — the third
   case for the "regional stratigraphic catalog" abstraction
   (per the rule of three).

**Implementation sketch when revisiting.** Add
``data/bro_units.json`` alongside G3Dv3. Refactor
``G3Dv3Catalog`` → ``RegionalCatalog`` with a constructor that
takes a catalog file path. Project metadata gains a
``regional_catalog`` field (default: ``"g3dv3"``). Consumers
(auto-populate, manual-create autocomplete) resolve the catalog
from the project's preference. ``name_nl`` becomes
``name_by_locale: dict[str, str]`` when the FR/EN need lands —
data migration is one-time on the existing JSON.

**Principle (user-confirmed 2026-05-14): stratigraphic ordering
must be CORRECT AT CREATE TIME, not via a repair button.** Today
G3Dv3 makes this true for Flanders projects; the NL extension
must follow the same rule.

## 13. Geotechnical units invisible to the section editor (medium — Phase 5 trigger)

**What.** ``geotechnical_unit`` rows (formation → unit
hierarchy) only surface in ``InterpretationPane``.
``FormationContact`` carries ``formation_id`` only — no
``geotechnical_unit_id``. The section editor and ``App.tsx`` never
receive the units. Section view cannot distinguish "weathered
crust of Boom Klei" from "undisturbed Boom Klei". Correct per MVP
scope ("subdivision — structure only") but the contact model has
no hook point for unit assignment.

**Why deferred.** MVP gate defers per-unit parameters and per-unit
visual distinction to Phase 5. Formation-level geometry is the
export target for v1.0.

**When to revisit.** When per-unit parameters land (Phase 5) and
downstream exporters (Plaxis material library) need unit-level
contacts. At that point ``FormationContact`` needs either
``geotechnical_unit_id`` FK or a separate ``GeotechnicalContact``
entity. Design the anchor before Phase 5 export work begins.

## 16. Telemetry / crash reporting (low)

**What.** No Sentry-equivalent. Frontend ``log.*`` calls go to the
devtools console; user-side crashes are invisible to us.

**When.** Before any non-solo user.

## 17. Legacy `dov_permkey = NULL` rows — documented recovery, no backfill code (low)

**What.** Refresh-on-duplicate keys per-row dedup on `dov_permkey`
(partial UNIQUE `(parent_id, dov_permkey) WHERE dov_permkey IS NOT
NULL`). Rows stored before that PR have `dov_permkey = NULL`;
`dov_dedup.py` filters NULL out, so they never dedup → the first
re-import of a previously-imported bbox creates duplicate observation
/ sample / lab-test rows for those legacy boreholes.

**Resolution (2026-05-17, system-architect review): document-and-defer,
do NOT build a backfill.** Rationale:

* **Affected population is currently zero.** Dev DB wiped 2026-05-10;
  all local rows are post-PR. Pre-ship distribution is coworker-only
  fresh installs (`project_coworker_distribution.md`) — nobody has a
  pre-PR DB.
* **A network-rematch backfill is more dangerous than the bug.** The
  true permkey is `last_path_segment(fiche_url)` — not reconstructable
  from stored domain values, so it needs a DOV re-fetch + heuristic
  re-match. NULL = visible recoverable duplicate; a *wrong* permkey =
  silent dedup against the wrong upstream identity (data corruption).
  The migration author already chose NULL-over-guess for this reason.
* **Folding the heal into the re-import dedup path is unsafe on the
  six lab families.** Their only unambiguous identifier *is* the
  permkey: a sample can carry multiple legitimate runs of the same
  test type, so a `(sample_id, test_type)` domain key collides and
  would silently merge genuinely-distinct lab tests. Permanent
  complexity on the critical ingest path for zero current users.

**Recovery runbook (if a legacy-NULL DB ever exists).** Per-project
re-import, not a script: open the affected project, delete the
permkey-less observations/samples/lab-tests (or wipe the project and
re-import the bbox). The import re-fetches from DOV and stamps
permkeys on every row; refresh-on-duplicate fills missing children.
Wipe-and-reimport sidesteps the match ambiguity entirely. For a
coworker-beta DB (a few dozen boreholes) this is a five-minute action.

**When (precise trigger).** Only if a build is handed to someone who
has been running a **pre-permkey-PR binary against a non-empty DB**
(not merely "a non-solo user" — a fresh install has no legacy NULLs).
If that fires and the runbook is judged too heavy, build the
**standalone one-off script** (`scripts/`, NOT an Alembic migration —
it does network I/O), dry-run default, with this safety bar baked in:

* Per parent, re-fetch + re-parse the DOV source; stamp ONLY on an
  unambiguous exact match (re-parsed child count == NULL-row count and
  stable-key sequence matches exactly). Any count mismatch / ambiguity
  → stamp nothing for that parent, log a WARNING with the parent id +
  affected row ids.
* Per-family stable match key (medium confidence): observation /
  sample = `(parent_id, type, depth_top_m, depth_base_m)` with ~1 mm
  float tolerance. **The six lab families MUST refuse to backfill** —
  domain-key collision risk is unacceptable; instruct wipe-and-reimport
  for those instead.
* Tests: SQLite-fixture unit tests — stamps the lone NULL match;
  leaves an already-stamped row untouched; count-mismatch (0 or 2
  parsed vs 1 NULL) → no stamp + WARNING; lab-family backfiller →
  always no-stamp + instruct-reimport. No live-DOV integration test
  needed before the trigger.

## 22. CPT detail chart conflates raw curves with Ic/SBT interpretation (low — Parameters-stage trigger)

**What.** The CPT detail chart (``CptChart.tsx``) renders the raw
measured curves (qc / fs / Rf / u2) AND the Robertson Ic curve +
SBT zone bands + zone labels + a second x-axis tick row in one
cramped column. Ic/SBT is *interpretation*, not raw data; on a
narrow detail pane it reads as clutter, and the pale domain SBT
pastels on the dark hero surface are unavoidably low-contrast
(domain hues — Tier 5 — can't be repainted; only the chrome over
them was de-flipped to dark in the dark-legibility pass).

**Why deferred.** The workflow-spine puts interpretation in the
Geotech / Parameters stage (Phase 5). Splitting Ic/SBT into its
own parameter view is naturally that stage's work, not a
standalone chart refactor now — doing it early duplicates effort
the stage will redo. The de-flip fix made the interim state
usable (Ic curve/labels legible again in both themes).

**When to revisit.** When the Geotech / Parameters stage is built
(Phase 5). Move the Ic curve + SBT zones + zone labels out of the
raw-curve detail chart into the parameter view there; the raw
CptChart then shows only measured curves.

**Related (litho slice 3, 2026-05-17):** the litho segmenter
classifies CPT lithology via a faithful port of Daniel Verastegui's
Robertson **2015** Qtn/F/Ic + **2009** chart-zone method
(``domain/services/robertson_2015.py``).

**Reconciliation shipped 2026-05-21.** The ``/cpt/{id}/plot`` endpoint
(and ``/cpt/plot-batch``) now sources Ic from
``robertson_2015.ic_series_2015`` — a thin wrapper around the same
2015 stress + Qtn/F/Ic pipeline the litho segmenter uses — instead of
the frozen Robertson **1990** preview in
``cpt_interpretation.calculate_ic_series``. Response shape unchanged
(still ``ic: list[float | None]``). Chart legend label + Parameters
``PerTestTab`` Ic̄ column header updated from "Robertson 1990" to
"Robertson 2015". 3 new unit pins on the wrapper (empty/length/None-
propagation); existing pins on the iterative Qtn/F/Ic core are
unchanged. 1046 vitest + 913 unit + tsc clean.

The two-method-disagreement-at-zone-boundaries note is now retired —
the whole app is consistent on Daniel's method. The frozen Robertson
1990 ``cpt_interpretation`` module stays in place as a domain peer
(other callers may exist for historical analysis); it just is no
longer the chart's data source.

**Still open under #22.** The FULL Ic/SBT-into-Parameters-stage split
remains a Phase 5 deliverable — that's the bigger work the original
entry calls out. The reconciliation above closes only the "two
methods diverging" half of the debt. CLAUDE.md Tier E keeps #22 until
the full split lands.

## 27. Bathymetry / water-surface DEM cells — no bed-elevation data (low — Tier E)

**What.** The DEM clip rule (§11.3) flags any vertex that lands on a
NoData cell as ``dem_cell_low_confidence``, which covers the known
bathymetric failure mode: LiDAR returns the water-surface elevation for
rivers, lakes, and canals rather than the bed, so a formation contact
beneath a water body gets clamped to the wrong surface. No bathymetric
data source (Vlaamse Hydrografische Atlas, AHN4 water-body mask, NGI)
is integrated today — the flag is a placeholder that tells the engineer
"check this vertex manually."

**Why deferred.** Ingesting a bed-elevation raster requires (a) a
second tile-cache provider wired into ``DemProviderFactory``, (b) a
water-body mask to route DEM queries to the bathymetric provider when
the (x, y) is within a water polygon, and (c) source data that covers
the same EPSG:31370 / EPSG:28992 footprints. None of the three pub-
lished Belgian or Dutch bathymetry services offer a convenient WCS
interface — the Vlaamse Hydrografische Atlas ships as shapefiles, not
a tile service, so this is a full ingestion project. The initial
``dem_cell_low_confidence`` flag still honours Data Integrity Rule §5
(flag, don't raise) and gives the engineer enough signal to act.

**When to revisit.** When a dogfooding user reports that a water-
adjacent project has unreliable formation tops and the ``low_confidence``
flags are insufficient. At that point evaluate: (a) a shapefile-backed
water-body mask that routes cells to a null sampler vs a bed sampler,
(b) a simple "depth below water surface" heuristic from
``BHVlaBathymetry`` data, or (c) accept the limitation and expose it
in the UI as "DEM accuracy may be reduced near water bodies."

## 28. Surface confidence signal — RESOLVED 2026-05-21 (true per-vertex gradient follow-up shipped same day)

**Follow-up ship 2026-05-21 (late evening — owner directive "geen half
werk").**  The original implementation rendered the continuous distance-
to-data signal as a BINARY split (>= 0.7 → full alpha; < 0.7 → faded).
A user-visible cliff at the threshold made the cue read as "two
distinct regions" instead of the smooth distance signal underneath.

Replaced with true per-vertex gradient end-to-end:

* **``utils/tinConfidence.ts``** gains:
  * ``computeVertexConfidence`` — averages incident triangle
    confidences onto each vertex.
  * ``confidenceToAlphaMultiplier`` — linear lerp
    ``[CONFIDENCE_FLOOR, 1.0] → [LOW_CONFIDENCE_ALPHA_MULTIPLIER, 1.0]``.
    Clamped at both ends.
  * ``partitionByConfidence`` kept as back-compat but no longer used
    by the production renderers.
* **``Geology3DViewer``** gains a custom Cesium ``Appearance`` with
  GLSL shaders that read a per-vertex ``color`` attribute (vs the
  one-color-per-primitive ``PerInstanceColorAppearance``).
  ``buildTinPrimitiveWithVertexColor`` packs per-vertex RGBA into the
  geometry attributes; the GPU interpolates per-pixel across each
  triangle. Result: a TRUE gradient — no bands, no cliff.
  ``rebuildSurfacePrimitives`` drops the high/low partition; emits one
  primitive per formation per render. When the confidence-fade toggle
  is OFF, falls back to the original ``PerInstanceColorAppearance``
  path (uniform alpha — visually disables the cue at zero perf cost).
* **``ContactsLayer``** drops the dHigh/dLow concatenated paths; emits
  ONE ``<path>`` per slice segment with per-segment opacity =
  ``baseOpacity × confidenceToAlphaMultiplier(segmentConfidence)``.
  ~50-200 SVG nodes per polyline; modern browsers handle thousands
  without issue. When the toggle is OFF, falls back to a single
  concatenated path with uniform opacity.
* **Split-mode caveat.**  In split (clipped) mode the Cesium triangle
  soup loses vertex sharing.  Each clipped triangle is rendered with
  a SOLID alpha = average of its three source vertices' alphas
  (within-triangle gradient lost in split mode; across-triangle
  continuity preserved).  Acceptable per "geen half werk" call: the
  user uses split for inspection, not gradient study.
* **Tests.**  A1-A6 on ``confidenceToAlphaMultiplier`` + V1-V4 on
  ``computeVertexConfidence``.  Existing ContactsLayer pins updated
  to query a child segment path (the testid now hangs off a ``<g>``
  wrapper, opacity lives on the children).
* **Result.**  1064/1064 vitest + tsc clean.  The visual shows
  continuous fading from data-backed regions out toward the hull;
  the section editor mirrors the same gradient per-segment.

## 28-orig. Surface confidence signal — RESOLVED 2026-05-21

Owner directives chosen:
* **Metric: hull-edge + edge-length gradient.** Hull-edge triangles
  (any edge appearing in only one triangle) get a fixed
  ``CONFIDENCE_FLOOR = 0.3``; interior triangles grade by
  ``maxEdgeLength / medianEdgeLength`` (1× median → 1.0, 2× → 0.5,
  clamped at floor). Edge length is horizontal-plane only — vertical
  spread is the signal we render, not the sparsity metric.
* **Render: opacity fade.** Low-confidence triangles render at
  ``LOW_CONFIDENCE_ALPHA_MULTIPLIER = 0.45`` × the default alpha.
  Threshold for the band split is ``CONFIDENCE_THRESHOLD = 0.7``.
* **Surface: 3D viewer + section editor.** Both consumers split into
  two render passes per formation — high band at full alpha, low band
  faded. Same testid pattern on both surfaces.

**Implementation.** Pure helper ``utils/tinConfidence.ts``:
``computeTriangleConfidence(vertices, triangles): number[]`` plus
``partitionByConfidence(confidence): { high, low }`` for the band
split. Cost is O(triangles) once per render.

**Degenerate-TIN escape hatch.** A triangulation with NO fully-
interior triangle (every triangle has at least one hull-edge) has
nothing to grade against — a 3-contact surface or a 4-corner square
split would otherwise render perpetually faded. The helper detects
this and returns uniform ``1.0`` for the whole surface. The signal
activates only once 5+ vertices form a triangulation with an
interior triangle, which matches the "model has enough data to
distinguish dense from sparse" intuition.

``Geology3DViewer.tsx``: each formation's TIN now builds TWO Cesium
primitives — high-band triangles at the existing ``ALPHA_FRESH``
/ ``ALPHA_STALE``; low-band triangles at the multiplied alpha. The
helper called on the un-offset vertices; the per-formation z-offset
applied to the position copy before primitive build. Ground-surface
render unchanged (the terrain layer is not an interpretation).

``sliceTin`` extended: each ``SlicePoint`` now carries
``triangleIdx?: number`` — the index of the triangle the crossing
came from. Two consecutive points in the sorted polyline are
crossings of the same triangle, so the segment between them inherits
that triangle's confidence band.

``ContactsLayer.slicedPolylines`` builds two SVG paths per formation
(``dHigh`` + ``dLow``) by walking consecutive point pairs and
appending each segment to the band matching the triangle's
confidence. Renders as two ``<path>`` elements inside a ``<g>``
keyed by formation id; the high path keeps the original testid
``formation-surface-{id}``, the low path adds ``-low`` for assertions.

**Tests.** T1-T6 + P1-P3 in ``utils/tinConfidence.test.ts`` (9
cases: empty input, degenerate single-triangle, degenerate 4-spoke
fan, interior triangle in a 3×3 grid, median threshold, zero-edge
degeneracy + partitionByConfidence boundary cases). S1 in
``utils/sliceTin.test.ts`` pins the new ``triangleIdx`` field on
every SlicePoint. ContactsLayer integration tests pass unchanged
because the degenerate-TIN escape hatch keeps small fixtures at
full confidence. 1045/1045 vitest + tsc clean.

**Documented residual (out of scope for #28 itself).** The
kriging / RBF interpolator (Phase 5) will provide a proper variance
metric; this distance heuristic becomes throwaway code at that
point. The ``method`` query param already scaffolds for it; the
``computeTriangleConfidence`` helper goes away cleanly when the
variance-based metric replaces it.

---

> The items below (#29–#50) were added by the 2026-05-16 six-agent
> codebase audit (senior-code-reviewer, system-architect,
> security-reviewer, staff-engineer, product-strategy-advisor, and
> ux-reviewer-as-general-purpose-proxy). They are in numeric order;
> their true priority is the five-tier list at the top of this file.

## 41. `Geology3DViewer.tsx` component-level smoke still absent (Tier E — residual; pure helpers extracted + netted 2026-05-17)

**What.** Part (a) is **done** (6c5389a): the pure coordinate math —
`computeBasemapBounds`, `sampleTinZ`, `clipTrisToHalfSpace`,
`clipTexTrisToHalfSpace` — was extracted VERBATIM into
`cesiumGeometry.ts` with 13 vitest cases (`cesiumGeometry.test.ts`)
covering the barycentric sampler, the footprint bbox/url math and the
Sutherland–Hodgman half-space clip incl. the textured st-lerp.
Geology3DViewer dropped 1,739→1,580 lines. **This is exactly the bug
class the 585c714 `flyToCutFace` ReferenceError was, and it is now
netted.** The remaining residual is part (b): a `Geology3DViewer.
test.tsx` mount smoke for the *component shell* (effect wiring, the
two-click split-line state machine, the `widgetRef.current == null`
guards).

**Why deferred / re-tiered to E.** The component smoke needs a Cesium
mock module or headless-WebGL harness — `new Cesium.CesiumWidget`
throws under jsdom and the mount effect sets `widgetRef.current` to
the constructed widget (the null guard only holds if construction is
intercepted), so the smoke needs a non-trivial inert-Cesium stub
(separate tooling investment). With the *pure math* now covered, the
marginal value of a shell-mount smoke is much lower than when this was
a Tier-C blocker — the named bug class no longer rides on it.

**When to revisit.** Before Phase 5 or first external release, OR
opportunistically when a Cesium test-mock is built for any other
viewer work. Fix: stand up `test/cesiumMock.ts` (inert
CesiumWidget/Scene/Camera/ScreenSpaceEventHandler + real math
classes), then `Geology3DViewer.test.tsx` mounting with empty props
(every builder early-returns on empty data) asserting no throw +
split-line click reducer transitions.

## 44. Cross-stage selection — per-stage visualisation of the carried scope (Tier D — follow-on from 2026-05-21 ship)

**What.** Owner decision 2026-05-21: selection carries across stages
(the "scope" semantic). The state-level work is **done** — the
`marqueeSelectedIds` set already persists structurally (owned by
App.tsx, above the stage-canvas `key={activeStageId}` boundary), and
the new `SelectionFooter` in `StageSpine` surfaces the carry to the
user as a small "N sel." badge visible from every stage with a clear
button.

The remaining work is each stage actually USING the carried set as
its scope:

* **Sections** — corridor source picks from the selection set; toolbar
  verbs that act on "selected investigation" gain a "selected set"
  mode.
* **Geology** — the model's `excluded_borehole_ids` toggle should be
  pre-seeded by the selection set (one-click "model only the selected
  boreholes"); the 3D viewer highlights selected investigations.
* **Lithology** — "Suggest all" / "Accept all" bulk verbs default to
  the selected set, not every visible borehole.
* **Parameters** — per-test table filters to the selected set when
  the set is non-empty.

**Why deferred.** The carry-feedback ship (footer + the bus already
exists) makes the metaphor honest. Each per-stage hookup is its own
small product call (e.g., does Geology's "in-model" toggle REPLACE
the set or ADD to it?) and should be designed alongside the next
substantive change to that stage.

**When to revisit.** When dogfeed flags a specific stage where
manual re-picking the same investigations after the carry-aware
walk feels redundant. At that point, ship the per-stage consumer for
THAT stage with the concrete workflow in front of you.

## 47. `project_bundle.py` column auto-enumeration → silent `.gmproj` format drift (Tier B — backwards-compat re-arm trigger)

**What.** `build_project_bundle` / `restore_project_bundle` enumerate
every ORM column via `__mapper__.column_attrs` so new columns "ride
along automatically." Convenient pre-ship; a forward-compat liability
once backwards-compat re-arms: adding any column to any bundled ORM
model silently changes the emitted `.strix` shape with no version
bump, no conscious decision, no round-trip test. The manual
`_SKIP_COLUMNS` set is the only gate.

**Why deferred.** Backwards-compat is suspended pre-ship (owner
directive 2026-05-16); the enumeration is a real time-saver during
rapid Phase-4 work and the risk is zero while no external `.strix`
file matters.

**When to revisit.** At the backwards-compat re-arm trigger (first
external distribution — ties to #3). Then: audit every bundled ORM
class for columns that should NOT be portable (caches,
server-managed timestamps) and promote them to `_SKIP_COLUMNS`; add a
fixture test per top-level bundle array asserting its exact column
set, so a new column forces a conscious format-version decision.

## 52. PDF report export (Tier D — Phase 5 reporting deliverable; slice 1 shipped 2026-05-21)

**Slice 1 shipped 2026-05-21.** Single-section PDF report. Engine
choice: ReportLab (layout + text) + matplotlib (figures, Agg headless
backend) — both deps added to pyproject.toml. The exporter
``infrastructure/exporters/section_pdf_report_exporter.py`` consumes a
``SectionSnapshot`` + a ``ReportMetadata`` bundle (title / author /
notes / date) and produces PDF bytes via ``SimpleDocTemplate``.

Content shipped:
* Title block with the user-editable title.
* Project metadata table (project, section, EPSG, vertical datum,
  section length, author, date).
* Optional free-text notes under the metadata table.
* Main figure (A4 portrait, ~180 mm × 130 mm):
  * Section drawing — depth × along-section distance, investigation
    columns at packed-but-nudge-capped positions (35 m cap per the
    owner directive — see ``infrastructure/exporters/pdf_layout.py``).
  * Formation contact polylines threaded across columns, formation
    name labels, colour-keyed legend.
  * **Location-map inset (top-right)** with the section line + every
    investigation as a dot + explicit **L / R end-of-line markers** so
    the engineer reads the orientation correctly off the figure.
* Footer: project + section + generation timestamp + page number.

Surfaces:
* Endpoint: ``GET /projects/{pid}/sections/{sid}/export/pdf`` with
  ``model_id`` required and ``title`` / ``author`` / ``notes``
  optional query params.  Same Content-Disposition pattern as the
  existing DXF / Plaxis 2D section endpoints.
* Frontend: new ``ReportMetadataDialog`` (title / author / notes —
  default title built from section name) opened from the Sections
  toolbar's ``Export ▾`` dropdown (third item, alongside Section DXF
  + Plaxis 3D script).  App-level ``handleExportSectionPdf`` owns
  the save-dialog + file-write flow.
* ``SectionSnapshot`` extended additively with ``start_x / start_y /
  end_x / end_y`` so the exporter can render the location-map inset
  without re-fetching the section row.  Pre-#52 test fixtures with
  the default ``0.0`` keep working (the map degenerates to a single
  point when endpoints are zero).

Tests:
* P1-P8 on ``packed_column_positions`` (empty / length-mismatch /
  no-nudge / pack-from-overlap / cap-binds / order-preserved / edge-
  gap / default-cap pin).
* Integration: ``test_pdf_export_happy_path`` +
  ``test_pdf_export_works_without_metadata`` — 200 OK,
  ``application/pdf`` content-type, ``%PDF`` magic header,
  Content-Disposition filename.
* D1-D4 vitest pins on ``ReportMetadataDialog`` (default title,
  trimmed-value submit, cancel = no submit, empty-title fallback).
* 924 unit + 6 cross-section integration + 1053 vitest green; tsc
  clean.

**Slices B / C / D still open under #52.**

* **Slice B — Project geometries report** (per the owner ask): all
  sections + investigation inventory + formation names, no parameter
  values.  One PDF for the whole project, not per-section.  Reuses
  the same exporter primitives (matplotlib figures + ReportLab
  layout); the main new piece is the section-list iteration + a top-
  level project location map.
* **Slice C — Full geological + lithological report**: slice B plus
  per-section pages for BOTH the geological model AND the litho
  model, plus per-borehole stratigraphy tables and per-CPT
  segmenter-derived layer stacks.  No parameter values yet.  Bigger
  paginator work than slice B.
* **Slice D — Full report with parameters (Phase 5)**: slice C plus
  per-unit parameter tables (φ′ / c′ / cu / E50 / OCR / Vs / G0 / M
  — Phase 5 backend work, not just a reporting layer).  Owner
  directive holds: parameter VALUES stay out of v1.0 (MVP scope is
  characterisation indicators only — Ic zone, Dr, NAD class,
  γ-estimate).  Slice D ships alongside the Phase-5 backend port.

**Original-entry residuals (kept for slice-B/C/D rationale).**

**What.** The Export stage hub (shipped with #30) surfaces machine
targets — DXF, Plaxis 3D (Plaxis 2D / D-Series / GeoStudio / IFC as
they land). It does NOT produce a human-readable **PDF report**: a
formatted document an engineer hands to a client / files in the
project dossier (project header, location map, investigation
inventory, borelogs, cross-section figures, the formation/geotech
model summary, derived parameters once Phase 5 lands). Every
incumbent (gINT, D-Series, GeoStudio) ships a report generator; its
absence is a credibility gap the moment a consultancy asks "can I
get a deliverable out of this?". CLAUDE.md "Build Sequence" already
lists "PDF reports" under Phase 5.

**Why deferred.** A report engine is a real subsystem (layout/
templating choice — ReportLab / WeasyPrint / headless-Chromium —,
figure rendering from the section + 3D views, a template the user
can brand, pagination). The v1.0 MVP gate is the *machine* export
path (layer geometry → design tools); the report is the *human*
output and is genuinely Phase 5 scope, not a launch-demo blocker.
Building it before per-layer parameters + statistics exist (also
Phase 5) means the report would have half its content blank.

**When to revisit.** Phase 5, alongside derived parameters +
statistics (the report's richest content depends on them). Pull
earlier ONLY if a pilot consultancy makes a signed PDF deliverable a
hard procurement requirement before then — in which case ship a thin
interim (project header + investigation inventory + section figures,
parameters section explicitly "not yet computed"). When built it
becomes another `ExportCard` in the Export hub (the #30 canvas was
designed so new targets are one card — no toolbar/inspector change).
Decide the engine on the renderer/back-end split: a Python-side
generator (ReportLab/WeasyPrint) keeps figures reproducible and
testable; a renderer-side print-to-PDF reuses the live Cesium/recharts
views but couples the report to Electron. Lean Python-side unless the
3D figure fidelity forces the renderer path.

## 60. SeedLithoFromGeologicalModel use case orphaned — no frontend verb calls it (Tier D)

**What.** The Sections editor's litho-axis toolbar verb "Seed from geology"
was rewired (2026-05-18, owner override #1) to call
`handleLoadBackdropSurfaces` → `GET .../surfaces` instead of
`POST .../contacts/seed-from-parent`.  The use case
`SeedLithoFromGeologicalModel` and its endpoint remain in the codebase
(backwards-compat suspended, future re-use), but nothing currently invokes
them from the frontend.

**Audit update 2026-05-22:** the orphan is a full 4-layer chain, not just
the use case — `useGeologicalModel.ts handleSeedLithoFromParent` (returned
but unconsumed), `api/client.ts seedLithoFromParent` + the
`SeedLithoFromParentResponse` type, and the
`POST .../contacts/seed-from-parent` endpoint. Whichever way this is
resolved (delete the chain vs keep-for-future), all four layers move
together.

**Why deferred.** The seed-contacts approach was superseded by the
geological surface backdrop — a read-only reference layer is lower-friction
and avoids polluting the litho model's contact set with seeded data the
user then has to curate.  Deleting the use case now would be premature;
a future automated litho-seed workflow (batch import, script, or a
re-introduced manual seed path) may want to call it.

**When to revisit.** If a future automated litho-seed workflow (batch
import, script) needs to copy geological contacts into a litho model — or
if the endpoint has been unreachable for two+ releases with no plan to call
it, at which point delete it cleanly.

---

## 56. Manual-lump cross-project reuse + standalone group editor (Tier D — deferred)

**What.** The manual stratigraphy lumping map (`stratigraphy_lumping.map` in
the `.gmproj` bundle, scope step 7) is per-project and entirely in the user's
hands — the system never infers synonymy.  Two things are missing from the
complete UX story:

1. **Cross-project reuse** — if a user lumped "Quartair: Holoceen veen" and
   "Vlaamse Vallei" → "Holoceen" for project A, they want to reuse that
   grouping for project B without re-doing the work.  The correct shape is an
   explicit **"Import lumping from project..."** action (opens a file-picker,
   merges the other project's `stratigraphy_lumping.map`).  NOT auto-import,
   NOT a shared user-global library — every merge is an explicit user decision.
2. **Standalone group editor** — a panel where the user can edit existing
   lumping groups (rename the target, drag raw names between groups, un-lump a
   name) outside of a live Fill-from-boreholes run.  Today the only edit
   surface is the FormationSelectionDialog triggered by "Fill from boreholes".

**Why deferred.** The per-project map is usable at v1.0; the cross-project
import and the standalone editor are convenience features.  They are non-trivial
UI (file-picker, merge strategy, drag-between-groups) and would delay the
stratigraphy-lumping slice without adding correctness.

**When to revisit.** When a user explicitly asks to reuse a project's
grouping elsewhere (i.e. the per-project constraint becomes friction in
real dogfooding).  Not before.

---

## 62. Pinch-out ghost-UX follow-ups (Tier E — post-slice review residue)

The pinch-out ghost-UX slice shipped 2026-05-18; senior + ux review
blockers were all fixed (stale-ghost-on-section-switch, 409 local-state
refresh, role/Esc/focus a11y, no-blank-overlay, loading flash, dark
mode, no-undo legibility, panel position, context-menu double-close).
Three reviewer items were deliberately deferred:

**What.**
1. ~~**`window.confirm` for contact delete** (`ContactsLayer.tsx`)~~ —
   **DONE 2026-05-20**: replaced with `DeleteContactConfirmDialog`
   (focused 2-button Modal + default-focus on Cancel + danger-variant
   "Delete contact" action button). 5 D-tests pin the contract; the
   pre-existing ContactsLayer tests were rewritten to drive the new
   dialog flow instead of `window.confirm` (53/53 green). Generic
   ConfirmDialog primitive deferred per "extract on the second copy"
   — wait until a 4th destructive confirm needs the same shape.
2. ~~**Pinch-out direction is hardcoded `'right'`** (`SectionsCanvas.tsx`)~~
   — **v1-min DONE 2026-05-20**: `handlePreviewPinchOut` now
   auto-retries the opposite direction on a 422 carrying the backend's
   `code: 'pinch_out_geometry_error'` discriminator. A west-pinching
   formation or R→L-drawn section is silently retried and the preview
   state carries the direction that actually worked (so the commit
   uses it too). 4 PO-tests pin the contract: happy path no-retry,
   geometry-error retry succeeds, geometry-error retry also fails,
   non-geometry error skips retry. **Residual:** the full
   target+direction picker before the dry-run (the user explicitly
   picks instead of relying on inference) stays Phase-5/post-v1
   per the original code comment.
3. ~~**`PinchOutResult` returns `CrossSectionOrm`** (infra type) into the
   application layer~~ — **DONE 2026-05-20**: `PinchOutResult` no
   longer carries an `updated_section: CrossSectionOrm | None`
   field. Section-seeding (the explicit-content invariant) moved
   from the use case into the router, matching the existing pattern
   in `AcceptLithoSuggestions` / `autoPopulate` / `discoverFromStrat`.
   Seed-id set equals `created_contact_ids` in both the happy +
   idempotent paths, so the router needed no extra info. The use
   case dropped the `CrossSectionRepository` import entirely;
   `CrossSectionOrm` is still imported but only for the geometry
   load (legitimate application-layer USE of an infra type, not
   RETURN). 15 pinch-out unit + 3 pinch-out integration + full
   120/120 API integration green.

**Why deferred.** (1) + (2) v1-min + (3) all shipped 2026-05-20
(above). Fixing (3) at the original session tail risked unreviewed
churn across already-large changes; here it landed alongside (2) as
the same-area cleanup.

**When to revisit.** (2)'s full target+direction picker — when a real
user wants to override the inference (the auto-retry covers the
opaque-422 case for now). Nothing left on (3).

## Historical note — 2026-05-13 security-reviewer audit pass

The remaining audit findings — #35 CORS, #36 CSP+window-open+
unpkg, #37 IPC paths, #38 bundle bounds, #39 GEF cap, #41
recent-projects, #43 error messages — landed in the same session.
Open items kept: the auth-threading work (now **debt #4**, was #40)
+ the ESLint reason-rule enforcement project (was #42, never broken
out as its own numbered entry — bigger than 30 min).

---

## Resolved — kept as design-rationale anchor

These entries are RESOLVED and live OUTSIDE the numbered priority
list. They stay in this file because the design rationale anchored
here is load-bearing context for anyone reading the relevant code,
not because they're still actionable.

### Contact selection toolbox (resolved 2026-05-13, refined 2026-05-13)

Implemented the day after the debt was filed. Cross-column drag,
Ctrl-toggle + Shift-range multi-select, box-marquee select,
multi-drag with preserved Δm offsets, ESC peel, batch backend
(``PUT /contacts/batch``) all shipped. Refined within the same
dogfooding session after the user hit two real friction points
that broke initial design assumptions:

* **Marquee vs pan conflict.** Original design: any plain drag on
  background = marquee. But pan is also plain drag → the marquee
  ate every pan attempt. Refined: marquee requires **Shift held**.
  Plain drag falls through to pan. Convention matches Figma /
  Plaxis Designer (navigation = default verb, selection = modifier
  verb). Shift-launched marquee is always additive — to "replace
  via marquee", ESC first then Shift-drag.
* **Cross-column drag should COPY, not MOVE.** Original design
  picked MOVE based on "drag = relocate" intuition. Real workflow
  is "stamp my known-good interpretation from borehole-A onto thin
  CPT-B nearby" — the user wants COPY. Refined: plain cross-column
  drag = **COPY** (creates new contacts at target via N parallel
  POSTs; originals stay). **Alt+drag = MOVE** (the original
  re-anchor behaviour, opt-in). Same-column drag stays MOVE
  (depth-only re-pick — copy makes no sense at same anchor).

The remaining v1 simplifications stand:

* **Cursor position.** Drop where the cursor releases — the section
  view behaves like a 2D drawing surface.
* **Multi-anchor selection collapses to one target column.** Rare
  case; intentional v1 simplification.
* **Out-of-bounds depths are allowed.** Contact rows simply record
  depth_top_m > investigation depth; the section renders them
  out of bounds. User can fix by re-picking or deleting.

**Open follow-ups under this anchor** (low priority, captured here
so they don't get re-filed as new items):

* COPY uses N parallel POSTs (Promise.all). Partial-failure leaves
  some contacts created and others missing; the toast warns. Promote
  to a real ``POST /contacts/batch-create`` endpoint with single-
  transaction commit when failure rates start to bite.

---

## 64. Litho 3D viewer — split-viewport mode deferred (Tier E)

**What.** `LithologyCanvas` renders `Geology3DViewer` in
`splitMode="single"` only. The split-line draw interaction (the
virtual cross-section cut through the 3D TIN) is disabled —
`onSplitPlaneDrawn` is a noop and `splitPlane` is always null.
If a user later wants side-by-side litho 3D view (3D left,
section slice right) or Phase 5 facies-interfingering geometry,
`Geology3DViewer` already supports `splitMode="split"` — the
prop exists, only the litho canvas wiring is missing.

**Why deferred.** No user-reported need (the single viewport is
adequate for model-management overview). Implementing it would
require a `splitPlane` state + section picker on the litho stage,
which duplicates `GeologyCanvas` logic — the rule-of-three is
not yet met (one concrete use in GeologyCanvas, zero in litho).

**When to revisit.** When a user asks for a split litho 3D view,
or when Phase 5 interfingering geometry adds a second concrete
use of the split-viewport in a non-Geology stage.

---

## 65. Excluded-boreholes UI for the Lithology inspector (Tier E)

**What.** The Lithology stage inspector has no "excluded boreholes"
UI — the litho model's `excluded_borehole_ids` is set only via
the backend, never surfaced. Mirrors the geological inspector's
toggle, which the engineer can flip when a borehole's stratigraphy
disagrees with the rest of the corridor.

**Litho crossings validator carved out (was the second half of #65,
2026-05-21):** the original entry claimed "litho surface crossings
are silently undetected" — incorrect. `ValidateModelCrossings`
DELIBERATELY returns `[]` for any model whose `kind` is in
`NON_STRATIGRAPHIC_KINDS` (lithostratigraphic + geotechnical),
because interfingering sand-and-clay is real geology, not a
superposition error. The frontend wiring would always show empty
banners (or a falsely-promising "Build to validate" pending banner
that resolves to no issues). Closed as wontfix — the deliberate
no-op is the correct behaviour.

**Why deferred.** The litho inspector is deliberately read-only
at v1.0 (formations are project-scoped shared vocabulary; CRUD
stays in GeologyInspector). An exclusion toggle is the first
mutation the litho inspector would carry, so it merits a small
product call: does it follow the geo pattern (PATCH the model's
`excluded_borehole_ids`, refresh, rebuild affected surfaces)? Or
does it need extra UI for "this borehole is excluded from
geo+litho" vs "litho-only" vs "geo-only" cases?

**When to revisit.** Next dogfeed session that flags a litho
unit polluted by a single anomalous borehole — at that moment
the exclusion-toggle UX is concretely informed by the case the
user wants to handle.

## 66. Admixture aggregation heuristic — RESOLVED 2026-05-21

The original entry only ever lived as a one-liner in CLAUDE.md's Tier E
("``_aggregate_admixtures`` uses >50% thickness-weighted majority;
owner-tunable at dogfeed; revisit if thin interbedded sequences produce
wrong dominant admixtures"). Resolved before that revisit became a
dogfeed report, so this is the canonical record.

Owner directives chosen:
* **Two-threshold + presence count.** Include an admixture when its
  total thickness >50% of the run (primary, dominant signal) OR
  thickness >25% AND present in >=3 source layers (secondary,
  pervasive-interbedded signal). The presence floor is what
  distinguishes "thin secondary signal that IS the geological
  character" (kept) from "concentrated in a couple of fat layers"
  (dropped — neither dominant nor pervasive).
* **Thickness-weighted dominant amount.** When the same ``soil_code``
  appears with different ``amount`` values (e.g. ``zwak`` siltig in
  some layers, ``sterk`` siltig in others), the output's amount is
  whichever variant has the larger summed thickness across
  contributing layers. Geotechnically honest: the merged label
  reflects the dominant strength.

**Implementation.** ``litho_segmentation._aggregate_admixtures``
refactored from canonical-key-by-(soil_code:amount) to grouping by
``soil_code`` alone, then resolving the dominant amount per soil_code
at the inclusion step. Thresholds hoisted to module constants
``ADMIXTURE_MAJORITY_THRESHOLD`` (0.5), ``ADMIXTURE_SECONDARY_THRESHOLD``
(0.25), ``ADMIXTURE_PRESENCE_FLOOR`` (3) so the owner can tune one
line at the next dogfeed report. ``locally`` inversion logic
unchanged (any global → result global; all local → result local).

**Tests.** A1-A6 + A1b/A4 boundary cases in
``tests/unit/domain/services/test_aggregate_admixtures.py``: primary
threshold included (66%) / excluded at exactly 50% / secondary
threshold included (30% across 3 layers) / excluded under presence
floor (30% across 2 layers) / below both thresholds (20%) / dominant
amount selection across mixed strengths / locally inversion both
directions. 913/913 unit + tsc clean. The 28 pre-existing
segmentation + accept tests still pass — the broader segmenter behaviour
is invariant under the heuristic change because the previous tests
used uniformly-attributed admixtures.

**Documented residual.** Tuning is a one-line edit to the three
module constants. The next dogfeed report of "wrong dominant
admixture in this particular borehole" is the natural trigger to
adjust — ship a real case alongside any further change.

## 68. CorrelationEdgesOverlay uncorrelate menu state lives inside a `pointerEvents:none` SVG `<g>` (Tier E — robustness)

**What.** The Slice-4 `CorrelationEdgesOverlay` owns its uncorrelate
context-menu state and renders the menu as a `<foreignObject>` inside
the overlay's root `<g style={{ pointerEvents: 'none' }}>`. It works
because `foreignObject` HTML children do not inherit the SVG
`pointer-events:none` — an SVG-spec oddity. The robust shape is the
existing `ColumnContextMenu` pattern: lift the menu state to
`SectionPanel` and render it as HTML above the SVG.

**Why deferred.** Functionally correct on the only runtime Strix ships
(Electron/Chromium, pinned). The reviewer's concern is a *speculative*
future Chromium-upgrade regression, not a present bug — the lift is a
non-trivial refactor (state ownership move + render relocation) not
worth the churn/risk pre-ship (review S6).

**When to revisit.** First sign the uncorrelate menu mis-behaves after
an Electron/Chromium bump, OR when the section context-menu surfaces
are next consolidated (fold the lift into that pass).

## 70. Decision-log table for ML training — schema scaffold + per-decision wiring (Tier D — post-MVP ML, owner-audited)

**What.** Ship a `user_decision_log` table that captures every manual
user decision in the app (litho suggestion accept, suggestion reject,
formation contact create / move / delete, formation rename / reorder /
pin, build trigger, sync geology, manual composition pick, cross-
section seed, geotech NAD assignment, …). Schema sketch: `id UUID PK`,
`project_id UUID FK`, `user_id UUID NULL` (filled once auth lands —
debt #3 / #4), `decision_type VARCHAR` (discriminator: `litho_accept`,
`litho_reject`, `contact_create`, `contact_move`, …),
`decision_at TIMESTAMP`, `before_state JSONB NULL` (the suggested /
prior state), `after_state JSONB NULL` (the committed state),
`context JSONB` (anchor ids, model id, section id, …).

**Suggestion-surface inventory (every one of these MUST instrument
`record_decision` when it ships).** Owner directive 2026-05-24: ML
training over user-made changes is a confirmed v1.0+ target across
**all** suggestion surfaces, not just the litho segmenter. Adding a
new suggestion gesture without wiring the decision log is technical
debt the moment it lands. Current and committed surfaces:

| Surface | When it fires | `decision_type` tokens |
|---|---|---|
| Litho segmenter (Suggest verb) | User accept/reject of ghost layer | `litho_accept`, `litho_reject`, `litho_modify_then_accept` |
| Litho segmenter — bulk accept | User clicks "Accept all (N)" | `litho_bulk_accept` (one row per ghost in the bulk, payload includes the bulk batch id) |
| Manual contact mutation | User creates / drags / deletes a contact | `contact_create`, `contact_move`, `contact_delete` |
| Manual composition picker | User picks lithology + admixtures on a layer | `composition_pick`, `composition_modify` |
| Formation rename / reorder / pin (drag stratigraphic column) | User mutates the formation ordering | `formation_rename`, `formation_reorder`, `formation_pin_toggle` |
| Build 3D model trigger | User clicks Build | `build_trigger` (context: which formations were stale) |
| Sync geology → litho seed | User runs "Fill from boreholes" / "Seed from stratigraphy" | `geology_sync`, `section_seed` |
| Pinch-out extrapolation (geology axis right-click) | User confirms ghost wedge | `pinch_out_commit` |
| **#101 Position 4 — formation_absence inference acceptance** | User confirms a `source='inferred'` absence → promotes to `'manual'` | `absence_confirm_inferred` |
| **#101 Position 4 — formation_absence override** | User overrides an inferred absence type (lens-edge → fault / unconformity / erosion) | `absence_override_type` (payload includes from / to source values) |
| **#101 Position 4 — name lens body** | User attaches a name to a body | `lens_name` |
| **#101 Position 4 — create perpendicular companion** | User accepts the auto-create offer | `companion_section_create` |
| **#127 auto-correlate — edge acceptance** | User confirms a `source='auto'` correlation edge → promotes to `'manual'` | `correlation_confirm_auto` |
| **#127 auto-correlate — edge rejection** | User deletes a `source='auto'` edge | `correlation_reject_auto` |
| **#127 auto-correlate — manual edge added** | User creates a correlation edge by hand (no auto suggestion to confirm or reject) | `correlation_manual_create` |
| Geotech stage (Phase 5 — NAD assignment, parameter values) | User commits NAD class or design parameter | `geotech_nad_assign`, `geotech_param_commit` |
| Parameters stage (Phase 5 — correlation formula vs Excel lookup pick) | User picks the method for a parameter | `parameter_method_pick` |
| Map / DataInspector — investigation review (hide / accept / flag) | User marks an investigation reviewed | `investigation_review` |

Owner caveat 2026-05-24: "there are a lot [other targets] I haven't
flagged yet" — this inventory is the current snapshot. When a new
suggestion gesture lands, append to this table in the same commit
as the gesture itself. The list is the contract; the implementation
catches up.

For each decision, store **only the suggested position and the last
committed position** (owner directive 2026-05-20). Intermediate drag
previews are NOT logged — transient UI state, not decisions.

Each relevant use case calls a shared `record_decision(decision_type,
before, after, context)` helper at its commit step. The helper
inserts the row in the same transaction so partial-decision failure
(use case rolls back) doesn't leave a phantom log row.

**Why deferred.** Owner explicitly asked the ML wiring to live in
post-MVP debt so the ML training pipeline can be audited rigorously
by hand after launch. The log table itself ships now (captures data
from day 1); the ML reader / training pipeline is the deferred half —
see #71 / #72.

**When to revisit.** As each use case lands or is touched, add the
`record_decision` call alongside its existing commit. Don't bulk-wire
in one pass — risks coupling unrelated paths. The log starts useful
the moment ONE use case is wired; broader coverage compounds.

## 71. ML training pipeline that consumes the decision log (Tier D — post-MVP, owner-audited)

**What.** Read `user_decision_log` rows and train **one model per
suggestion surface** (see the inventory in #70). Each surface gets
its own predictor that conditions on (suggested output + input
features + user's accept/reject/modify pattern). v1.0+ targets:

* **Litho segmenter** — predict which ghost layers the user will
  keep / move / reject. Inputs: segmenter output + (qc / Ic /
  soil_code at depth) + project metadata.
* **Position 4 absence inference** — predict which `'inferred'`
  absences the user will promote vs override-to-fault. Inputs:
  body geometry + neighbour observations + project geology.
* **Auto-correlate (#127)** — predict which `'auto'` correlations
  the user will confirm vs delete. Inputs: column geometry +
  depth window + dip features.
* **Composition picker** — predict the lithology + admixture
  combination the user is most likely to commit given the prior
  layers + the segmenter's per-layer Ic / qc context.

Outputs in every case: ranked refined suggestions. Re-trains as the
log grows. Each surface is trained INDEPENDENTLY (no cross-surface
joint model in v1.0+; future work) so a low-signal surface doesn't
contaminate a high-signal one.

**Why deferred.** Owner directive — audit ML rigorously by hand
before any pipeline ships. ML accuracy claims need a human-in-the-
loop validation round; the log table (#70) is the data plumbing for
that audit. The training itself is post-MVP — geotechs care about
deterministic, reviewable outputs first.

**When to revisit.** After the decision-log table has accumulated N ≥
200 litho accepts across ≥ 3 real projects AND the owner has spot-
audited a representative sample. Don't fit a model on toy data.

## 76. Accept-all sometimes "splits" displayed layers post-accept (Tier G — before the Geotech stage; diagnostic)

**What.** Owner observed (2026-05-20 dogfeed) that clicking `Accept
all` on a ghost overlay results in layers being visually "split"
into smaller layers post-commit. Two likely causes both worth ruling
out:

- **Straddle splits** (expected): a suggestion that crosses a
  geological-formation boundary is auto-split into TWO contacts by
  `_compute_straddle_splits` — one per parent formation. The ghost
  showed one layer; the committed result is two. Correct geological
  semantics.
- **Over-segmentation visible post-accept** (debt #74): the
  segmenter produces multiple thin same-lithology layers that all
  accept as separate contacts.

**Why deferred.** Needs an explicit `accept_litho_suggestions`
response log from a dogfeed session — the `straddle_split_count` +
`created_contact_ids.length` fields tell us which mechanism is
firing. Without that, "fix" is shooting in the dark.

**When to revisit.** Next time the dogfeed shows the symptom, look at
the backend log line `acceptAllLithoSuggestions ok created=N
found=M straddle=K …` — if K > 0 it's straddle-split (expected); if
K = 0 and N > the displayed-layer count it's #74 territory.


## 82. Drag-from-ghost-edge → correlation (Tier E — Phase 2.5 gesture follow-on)

**What.** When a ghost-layer boundary is being dragged, allow the
drag to leave the source column horizontally and land on a
neighbouring band — auto-accept the source ghost and create a
correlation edge in one gesture. Two sub-variants:

- **B.** Drop on an accepted band → auto-accept source ghost +
  fire `handleCorrelate(srcFormationId, targetFormationId)`.
- **C.** Drop on another ghost → auto-accept BOTH ghosts (target
  may straddle the parent geology, requiring a composition picker)
  + create the edge.

**Why deferred.** Owner scope decision 2026-05-20 (debt #78 split):
the smallest valuable slice — drag-INSIDE-correlate-mode on
accepted bands — shipped first because it doesn't overload the
existing ghost edge-resize handle. Variants B + C require
direction-dominance detection on the resize drag (horizontal-vs-
vertical motion), DOM-level hit-testing across ghost component
instances (acceptable, the data attribute pattern from #78 ports
directly), and an auto-accept code path that, for variant C, must
also handle straddle + composition-picker dialogs.

**When to revisit.** Next time the dogfeed user says "I wanted to
drag a ghost boundary to the next CPT" (the original 2026-05-20
dogfeed complaint, still active). The toolbar Correlate gesture
(now with the 1-drag enhancement from #78) is the workaround until
then. Variant B is the cleaner first slice — straddle handling on C
is non-trivial.


## 79. DOV Phase-2 parse-offload diagnostic + re-baseline (Tier E — performance investigation)

**What.** The current cold-import wall-clock for 316 deep CPTs is
~54 s (per `CLAUDE.local.md`). Benchmark says parse is ~170 ms per
CPT on the event loop, so 316 × 170 ms ≈ 53.7 s — the entire wall
matches parse, not network. Memory notes a `ProcessPoolExecutor`
parse offload is implemented (`PARSE_OFFLOAD_MIN_BYTES = 50_000`)
that should bring this to roughly `316 × 170 ms / Ncores ≈ 13 s
on a 4-core box`. The fact that we still see ~54 s suggests one
of: (a) the offload isn't firing for some reason, (b) the byte
threshold is too high in practice, (c) the baseline was measured
before the offload landed and was never re-run.

Plan when revisited:
1. Add per-CPT decomposition timing in Phase 2 — network wait,
   ElementTree parse, Polars frame build (3 timers, ~30 LOC).
2. Re-import the same 316-CPT bbox cold; log the split.
3. If parse is on the event loop → check why offload isn't firing
   (threshold, ProcessPool initialisation, single-import path
   that skips it).
4. If parse IS in the pool but wall is still high → check process
   start-up cost (cold-pool overhead is high; warm-pool reuse
   might be needed).

This bench-then-decide approach is cheap (3-min dogfeed import +
30 LOC) and avoids speculative refactor of the wrong layer.

**Why deferred.** Phase-2 throughput isn't a v1.0 MVP blocker — the
import works, just takes longer than ideal. The decomposition is a
prerequisite for any further work (local DOV mirror, parse-pool
warm-up, etc.) so it should land BEFORE the next attempt at speed.

**When to revisit.** Next time the dogfeed import noticeably annoys
the user with wait time; OR before the first external distribution
where speed-of-first-import shapes the trial experience. Local
DOV mirror is the ceiling-break above this (already noted in
`CLAUDE.md` "DOV Import" section).

ChatGPT cross-check 2026-05-20: confirmed the format-switch (JSON
vs XML) is marginal (<1 s) and HTTP/2 is irrelevant for this
workload (large single-document exports, not many small requests).
The real win is at the parse layer + eventual mirror.



## 85. Right-click insert layer — RESOLVED 2026-05-21

Owner directives chosen:
* **Sentinel 10 cm thickness, then drag** — inserted layer arrives
  thin; user immediately resizes via the standard drag handles. The
  upper neighbour keeps its base; the lower neighbour's depth_top is
  auto-edited to shared_boundary + sentinel so the three layers stay
  geometrically consistent.
* **Blank picker prefill** — composition picker opens with empty
  initial values (the existing normalisation defaults the main soil
  to ZAND; user picks from there).

**Implementation.** New ``LithoSuggestionGhostColumns`` props
``onInsertLayer(afterIdx, composition)`` (single-anchor) +
``handleInsertLithoLayer(anchorId, afterIdx, composition)`` callback
on ``useGeologicalModel``. The actual state mutation is the pure
helper ``utils/lithoLayerInsert.ts``: splices the new
``LithoLayerSuggestion`` at ``afterIdx + 1``, shifts every
accepted/rejected index above ``afterIdx`` by +1, shifts every edits
Map key above ``afterIdx`` by +1, and patches the (now-shifted) lower
neighbour's ``depth_top_m`` edit to ``shared_boundary + sentinel``.
Sentinel constant ``INSERT_LAYER_SENTINEL_THICKNESS_M = 0.1`` (10 cm).
The new layer inherits ``parent_formation_id`` from the upper
neighbour as a sensible default (backend re-resolves at accept time
via the standard contact/TIN path — debt #87).

A new 6 px transparent ``<rect>`` overlays each shared boundary
between two adjacent pending layers (skipped when either neighbour
is accepted/rejected, when ``onInsertLayer`` is not wired, or at the
last layer). ``onContextMenu`` opens the boundary menu (rendered via
``createPortal`` at the click position) with a single "Insert layer
here…" item. Clicking opens the existing
``LithoGhostCompositionEditor`` in insert mode (empty initial
values). The picker's Save fires the parent callback chain.

Wiring: ``SectionsCanvas`` puts ``onInsertLayer`` on both the
single-anchor ``lithoGhostState`` (with the focused anchor's id
captured at the call site) and the bulk ``bulkLithoGhostState``
(anchorId resolved at each per-anchor mount in ``SectionPanel``).
The bus interface accepts the optional prop on both bundle types —
zero regression on callers that don't opt in.

**Tests.** I1-I7 in ``lithoLayerInsert.test.ts`` (pure helper):
sentinel depth applied / lower neighbour's depth_top edit at
shared+sentinel / accepted+rejected indices shift / indices at-or-
below afterIdx unchanged / edits Map keys shift correctly / upper
neighbour's edited depth_base drives the boundary / new layer
inherits parent_formation_id. R1-R5 in
``LithoSuggestionGhostColumns.test.tsx``: boundary strip rendered
between adjacent pendings when onInsertLayer wired; not rendered
when opt-out; not rendered between pending and accepted; right-click
opens the boundary menu; Insert action opens picker and Save fires
onInsertLayer with afterIdx + composition. 1036/1036 vitest + tsc
clean.

## 83 cascade + 84 merge prompt — RESOLVED 2026-05-21

Owner directives chosen:
* Cascade behaviour: **Multi-collapse with prompt** — drag clamps walk
  through ALL same-parent pending neighbours; release opens a single
  confirm dialog naming the layers about to be absorbed.
* Merge wording: **Merge title with NAD fallback** — title morphs
  between "Merge N <Lithology> layers (NAD K)?", "Merge N <Lithology>
  layers?", and "Collapse N layers?" based on the shared
  ``suggested_lithology`` + ``suggested_nad_class`` of the dragged
  layer and the chain.
* Geological boundary rule: **Refuse across boundary** — the cascade
  hard-clamps at the first layer whose ``parent_formation_id`` differs
  from the dragged layer's parent OR whose ``spans_boundary`` is true
  (straddler). The geological signal beats the NAD signal.

**Implementation.** ``computeDragBounds`` returns ``collapseChainAbove``
+ ``collapseChainBelow: number[]`` (replacing the prior single
``collapseIdx{Above,Below}: number | null``).  Pure walk helpers
``findCascadeChainAbove`` / ``findCascadeChainBelow`` traverse same-
parent same-non-straddle pending neighbours; the gap-fill regime
(rejected between dragged and first pending) wins over cascade by
returning an empty chain; accepted barriers and geological barriers
also empty the chain.  The drag state's mouseup gate now defers to
``MergeConfirmDialog`` whenever ``snapped`` AND the chain contains
any non-self entry; Confirm fires the deferred ``onEdit(idx, depth)``
+ shared-boundary propagation + ``onReject(...)`` per chain entry;
Cancel drops the whole gesture (no edits, no rejections — the
pre-drag visual is restored on the next render because no commit
happened).  The #81 self-collapse path (chain == [own idx]) bypasses
the dialog — that gesture is the user's explicit "fold this layer"
intent and asking is friction.

The merge dialog title comes from a pure helper
``buildMergeConfirmTitle(dragged, chain)`` that computes the
commonality.  When all four checks agree (same litho, all NAD non-
null, same NAD), the title carries the NAD parenthetical; when any
NAD is null, the title drops the parenthetical; when lithology
mixes, the wording falls back to "Collapse".

**Tests.** Cascade chain pure tests C1-C6 + dialog title M1-M5 in
``LithoSuggestionGhostColumns.cascade.test.ts`` (11 cases — cascade
3-chain, geological boundary stop, spans_boundary barrier, accepted
barrier, rejected-gap inhibits cascade, top-drag mirror; title NAD
shared, NAD fallback, mixed-litho collapse, empty defensive, total-
count plural).  ``LithoSuggestionGhostColumns.test.tsx`` updated:
G32 + G33 now drive Confirm in the dialog (was: assert inline edit
+ reject); new G37 pins Cancel as a no-op.  Backwards-compat: all
pre-existing tests pass — non-snap drags, rejected-gap (#83 v1.2 G34),
self-collapse (#81) all still commit inline without the dialog.

**Documented residual (#85 still open).** Right-click on a shared
boundary to insert a layer between two pendings stays Tier E; the
gesture surface is different (insertion, not collapse) and the
deferred design pieces (where the new layer's thickness comes from,
composition prefill, hit zone) don't share infrastructure with the
cascade.  The cascade ship doesn't change #85's trigger condition.

## 86. Horizontal drag-to-copy composition — RESOLVED 2026-05-21

Owner directives chosen:
* Drag-start detection: **Alt/Shift modifier + drag** — Alt key
  disambiguates the copy-composition gesture from the existing
  edge-resize handles. No positional logic needed.
* Cross-investigation: **Same-column + cross-investigation** — drop
  on any pending ghost layer in any column. Valid targets highlight
  amber on hover.
* Overwrite semantics: **Confirm on overwrite** — if the target has
  an existing edit, open a confirm dialog naming source + target
  compositions; default-focus Cancel.

**Implementation.** `LithoSuggestionLayer` accepts an
``onCopyMouseDown`` callback fired only when ``e.altKey`` is held on
mousedown over a pending layer's body rect. The existing accept /
dbl-click / context-menu handlers stay on the same rect; the
preventDefault + stopPropagation on the Alt path suppresses the
click event that would otherwise fire onAccept.

Every pending layer rect stamps two data attributes —
``data-litho-anchor-id`` (the investigation id) + ``data-litho-idx``
(the suggestion index) — used by a document-level mousemove +
mouseup effect on the parent component to resolve the drop target
via ``document.elementsFromPoint``. Cross-investigation targets are
found purely by attribute lookup, no React context or shared state
needed. JSDOM-safe (the resolver guards on
``typeof document.elementsFromPoint``).

Drop target receives the dragged layer's
``(suggested_lithology, suggested_admixtures)``. Same-anchor drops
fire the existing ``onEdit(idx, edit)``; cross-anchor drops fire the
new ``onCrossColumnPaste(targetAnchorId, targetIdx, edit)`` callback,
which `SectionsCanvas` wires to ``handleEditBulkLitho`` (the existing
bulk edit handler that already routes to any anchor in the unified
``ghostsByAnchor`` Map — debt #77).

Overwrite detection: when the target's effective composition is
already overridden by an existing edit, the gesture defers to
``CopyCompositionConfirmDialog``. Confirm fires the deferred
``onEdit`` / ``onCrossColumnPaste``; Cancel drops the gesture. The
dialog names source + target compositions via the same
``formatLithoDisplayName`` helper the ghost rects use for their
in-place labels.

Drag preview: floating amber chip via createPortal at fixed
clientX/Y, follows the cursor. The hovered drop-target rect gets
an amber 2 px stroke override.

**Tests.** Q1-Q6 in ``LithoSuggestionGhostColumns.test.tsx``:
Q1 Alt+mousedown arms copy + renders preview chip (no onAccept).
Q2 same-column drop fires onEdit with composition.
Q3 drop on already-edited target opens dialog; Confirm commits.
Q4 dialog Cancel = no-op.
Q5 plain (non-Alt) mousedown does not arm copy.
Q6 cross-anchor drop fires onCrossColumnPaste (not onEdit).
1024/1024 vitest + tsc clean.

**Documented residuals.** Cross-column overwrite detection is
intentionally conservative: only same-anchor edits trigger the
confirm dialog. The bulk edits Map is not visible from inside the
source component instance; checking it would require lifting the
edits Map to a shared bus. Owner-pragmatic — same-column overwrite
is the common case (the user just edited a composition and is
pasting next door); cross-column overwrite without confirmation is
a one-step undoable action via re-opening the editor.

## 95. Lithology gesture cheatsheet + drag-and-drop discoverability (Tier D)

**What.**  Dogfeed 2026-05-21: "How do I drag-and-drop lithology?
shift click is select alt click and normal click just pan?"  The
section editor's bottom strip lists four gestures (drag = pan,
scroll = zoom, right-click = focus column, double-click = open) but
misses the rest of the surface — Shift+click marquee selection,
Alt-drag MOVE vs plain-drag COPY, the drag-resize handles on contact
rows in the inspector, and the row-reorder drag on the formation list.
None of these are discoverable except by reading docs/ux.md.

The fix has two layers:

1. **Per-stage gesture pill** (bottom-left corner) — always-on, lists
   the 5–6 gestures relevant to the current stage with a 3-letter key
   abbreviation (e.g. "Shift = marquee").  Same place as the section
   editor's current footer hint; just always-present and richer.
2. **Help → Cheatsheet** menu item that opens a full grid of every
   gesture across every stage.  Searchable, copy-pastable.

**Why deferred.**  Discoverability work is in-scope for the v1.0 polish
pass alongside debt #93 (first-use tutorial).  Both deliverables share
the "engineer reads tooltips when stuck" failure mode and benefit
from being authored together.  Content authoring (the actual gesture
list per stage) is the load-bearing piece, not the code.

**When to revisit.**  Same trigger as #93 — pre-coworker-binary.  The
first dogfeed user's "how do I X" questions become the cheatsheet's
top entries.

## 93. First-use tutorial + per-stage "next step" hinting (Tier D — onboarding)

**What.** No onboarding exists today. A new engineer opening Strix
for the first time sees an empty welcome screen, then a stage with
toolbar verbs whose preconditions are implicit ("Suggest litho" needs
a CPT focused; "Seed" needs formations defined; "Build" needs
contacts placed). The workflow IS discoverable by reading tooltips,
but reading every tooltip on every disabled button is a slow path to
the first useful action.

Two related deliverables under one entry:

1. **First-use tutorial** — a game-like guided walkthrough that fires
   the first time a user opens Strix.  Coach marks (numbered amber
   tooltips with arrows) point at the right control to click next.
   Example flow: "Welcome → click New project → enter a name → click
   Import DOV → draw a bbox → walk to Geology → define a formation →
   walk to Sections → draw a section → click Seed for new tests →
   Build → done."  Skippable with a top-right "skip tutorial" link;
   re-launchable from the Help menu.
2. **Per-stage "next step" hinting** — empty-state-driven guidance
   that surfaces the most useful next action whenever the user lands
   on a stage.  Examples:
   * Geology stage with no formations → "Define your first formation
     (the geological backbone of the project)" overlay on the empty
     formation list.
   * Sections stage with a section but no contacts → "Open this
     section and pick depths, OR click Seed for new tests to
     auto-populate from borehole stratigraphy."
   * Lithology stage with no litho model → "Create a litho model that
     refines your geological backbone."
   * Parameters stage with no per-test data → "Run Lithology first to
     get NAD packing class indicators."

   Each hint disappears when the precondition is met.  Persistent —
   not a one-time tutorial; the hint is always available when the
   precondition is unmet.

**Why deferred.** This is a v1.0-launch deliverable, not a v1.0-MVP
gate.  Three reasons:

* **Content authoring is the load-bearing piece**, not the code.  The
  tutorial copy + per-stage hints need to be written by an engineer
  who has dogfeed the workflow end-to-end and knows which steps the
  user gets stuck on.  We're still finding those steps.
* **Implementation is straightforward but boilerplate-heavy** — a
  small coach-mark library (or react-joyride) + ~12 hint surfaces
  across stages.  Maybe two days of code, three days of copywriting.
* **Premature shipping risks calcifying the wrong workflow.**  The
  litho gesture surface alone resolved 5 dogfeed-driven debts this
  week (#83, #84, #85, #86, #87).  Pinning a tutorial against today's
  shape before the workflow is stable creates churn.

**When to revisit.**  Pre-coworker-binary or pre-paid-revenue,
whichever lands first.  Trigger: the first dogfeed user other than
the owner.  The first 5 things that user gets stuck on become the
tutorial's first 5 coach marks; the next 5 stage-empty-states become
the persistent hints.  Until then, every dogfeed observation that
ends "the user didn't know they could click X" should be filed as a
candidate hint here (not as a separate debt) so the eventual
authoring pass has a ready list.

**Related shipped surfaces that already do part of this job.** Empty-
state cards exist (``EmptyState`` primitive in
``desktop/src/renderer/src/components/EmptyState.tsx``) and are used
in several places (LithologyInspector when no model, Geology3DViewer
when no surfaces, etc).  The hint system is the next-step evolution
of this primitive — same shape, but driven by stage-state instead of
hard-coded text and always visible (not just when the surface is
truly empty).

## 92. "New tests" workflow — RESOLVED 2026-05-21

**What.** When an engineer imports new CPTs or boreholes into a project
whose geology + lithology models are already built, incorporating the
new tests is fiddly: "Suggest all" re-runs the segmenter on every
visible investigation (idempotent server-side, but wastes time on
already-accepted ones), and "Seed from stratigraphy" places contacts
on every borehole (idempotent — skips duplicates — but the user has no
explicit "won't touch my work" affordance). The dogfeed workflow asked
for two new toolbar verbs scoped to "investigations not yet in the
active model's contacts" plus a confirmation that new tests
automatically appear on existing section profiles.

**Resolution shipped 2026-05-21.** Three pieces:

1. **Tests auto-draw on existing profiles — already true.** Verified
   in ``useSectionData.ts:242``: ``projectedCpts = useMemo(() =>
   investigationsOnSection(section, cpts, excludedCptIds), …)``. The
   section's investigation set is recomputed live against the current
   project investigation list, so newly-imported tests in the
   corridor buffer appear automatically with their data column
   (qc/fs curves, borehole log) — no contacts required. No code
   change needed.
2. **"Suggest for new tests" button** (SectionsToolbar litho axis,
   next to "Suggest all"). Computes ``newTestAnchors`` — the existing
   ``bulkAnchors`` filtered by the new helper
   ``filterAnchorsWithNoLithoContacts`` — and passes the filtered
   list to the existing ``handleSuggestAllLitho``. Tooltip names the
   count; toast on the empty case.
3. **"Seed for new tests" button** (SectionsToolbar geology axis,
   next to "Seed"). Computes ``newTestBoreholeIds`` — visible
   boreholes filtered by the new helper
   ``filterBoreholesWithNoGeologyContacts`` — and passes the filtered
   list to the existing ``handleAutoPopulateFromStratigraphy``.
   Tooltip names the count; toast on the empty case.

**Implementation.** New pure helpers in ``utils/newTestFilter.ts``
(``filterAnchorsWithNoLithoContacts`` / ``filterBoreholesWithNoGeologyContacts``)
both O(N+M), unit-tested in isolation. The two toolbar handlers
``handleSuggestNewTests`` / ``handleSeedNewTests`` are thin wrappers
that delegate to existing bulk handlers with a filtered list — zero
backend change, zero new endpoints. Both safe to click twice (second
click finds zero new tests + toasts). The synthetic-contact path
(``cpt_id`` AND ``borehole_id`` both null — pinch-out wedges) is
explicitly ignored: synthetic contacts can't make an investigation
"non-new" because they aren't anchored to one.

**Tests.** F1-F6 + G1-G4 vitest pins in
``utils/newTestFilter.test.ts`` (10 cases — empty inputs, excluded
investigations, synthetic-contact handling, input-order preservation,
elevation_m propagation, CPT-vs-borehole separation). 1059/1059
vitest + tsc clean.

**ux-review pass 2026-05-21** (`ux-reviewer` subagent on the diff).
Three should-fix items applied:

1. *Empty-state shape*: was "stay-and-toast" on zero count — required a
   click to learn there was nothing to do. Now: button disabled when the
   filtered count is zero, with the tooltip carrying the explanation.
   Matches ``docs/ux.md`` § "Loading + error feedback" pattern (the
   trigger should signal its operational state visually before a click).
2. *Toast kind*: zero-count toast was ``'success'`` which is wrong
   semantic — "success" means "the action completed". A no-op is not
   completion. Toast calls removed entirely once the button is disabled
   (handler keeps a defensive ``if (length === 0) return`` guard).
3. *Label shape*: ``(N)`` parenthetical now renders for ALL N when a
   model is active (including ``(0)``), instead of being suppressed at
   zero. Removes the ambiguity between "count is zero" and "count not
   yet computed" and reinforces the disabled visual.

Tooltip wording also revised to engineer-actionable: "All visible
investigations already have litho contacts — import new tests to use
this button" (vs the prior "No new tests — every investigation has
litho contacts already" which left the engineer wondering what to do
next).

Deferred (consider): the reviewer flagged button-order — "for new
tests" should lead because after the first dogfeed pass it becomes
the more-common click. Left for the owner; the existing-first order is
the safe default until the dogfeed user weighs in.

## 91. Stale-TIN straddle-fallback diagnostic — RESOLVED 2026-05-21

The original tracking was a one-liner in CLAUDE.md's Tier E that
collided with the existing ``#68`` (CorrelationEdgesOverlay). Resolved
under a fresh number to clean the bookkeeping at the same time.

**What.** ``AcceptLithoSuggestions._compute_straddle_splits`` falls
back to depth-ordered geology contacts when the parent geology TIN is
stale or absent. The fallback is geometrically correct but less
precise than a fresh TIN sample; the response carries
``stale_tin_fallback_count`` per the contract introduced with #87.
Frontend only logged the count to the debug log — the dogfeed user
never saw a signal that the geology model needed a rebuild.

**Resolution.** Three pieces:

1. ``useGeologicalModel`` accumulates a new ``lithoStaleTinSessionCount``
   state across every accept-litho-suggestions response in the current
   session. Cleared on (a) successful geology rebuild + (b) the
   existing ``clearLithoSuggestions`` reset.
2. Exposed via ``geoModel`` on the ShellContext bus alongside
   ``lithoStaleSurfaceCount`` (mirror surface).
3. ``LithologyInspector`` renders an amber pill
   (``litho-stale-tin-pill``) next to the existing stale-surface
   banner whenever the counter is non-zero, with copy "N stale-TIN
   straddle fallback(s) this session — rebuild geology for precision."
   Singular wording for N=1.

**Tests.** T1-T3 vitest pins in ``LithologyInspector.test.tsx``: pill
renders with the count when > 0 / hidden when 0 / singular wording
for 1. Hook-level integration covered through the existing accept-
litho test paths (all four accept sites bump the counter). 1049/1049
vitest + tsc clean.

**Bookkeeping note.** The previous CLAUDE.md Tier E note listed this
item as "#68" which collided with the docs/debt.md ``#68``
(CorrelationEdgesOverlay uncorrelate menu). Tier E in CLAUDE.md is
updated to drop the stale-TIN reference and the new #68/#91 numbers
no longer collide.

## 87. Orphan litho units — RESOLVED 2026-05-21

Owner directive: **extrapolate from TIN with engineer notification + a
final action to decide; backfill existing orphans on migration.**
Shipped end-to-end this session.

**Backend.** `_compute_straddle_splits` now falls through to TIN
extrapolation when `_parent_fid_for_depth` returns None AND geology
surfaces exist AND the investigation carries an `elevation_m`. New
`_extrapolate_parent_from_tins(target_z, surfaces, inv_x, inv_y)`
samples every non-stale TIN at the investigation, converts the
suggestion's depth-below-ground to absolute z via
`inv.elevation_m - depth_top_m`, and picks the youngest formation
(smallest surface elevation still `>= target_z`) — that's the
formation "active" at the target elevation. The result rides on
`_StraddleResult.extrapolated`. Stale TINs are skipped (the safer
"no parent" over a possibly-wrong extrapolation; engineer rebuilds
to retry). When extrapolation can't resolve (above all surfaces,
outside every footprint, no elevation), the row falls back to the
orphan path with `parent_formation_id=NULL`.

**Schema.** New `geological_formation.parent_extrapolated` boolean
column (NOT NULL DEFAULT false). Stamped at creation by
`_create_litho_formation`; never toggled on find. Cleared by the
inspector's confirm/reassign/detach PATCH. Alembic migration
`d4e5f6a7b8c9` adds the column AND backfills existing orphan litho
units: for each, picks one of its contacts, loads the investigation
+ parent geology model surfaces, runs the same youngest-above-target
extrapolation as the runtime path, and on success sets
`parent_formation_id` + `parent_extrapolated=True`. The migration
inlines its own `evaluate_tin_at` (Alembic must stay independent of
evolving app code) and prints a backfill diagnostic with fixed /
unfixable counts.

**API.** `AcceptLithoSuggestionsResponse` carries
`extrapolated_formation_ids` + `orphan_formation_ids` (additive,
default `[]` for backward compat). `GeologicalFormationResponse`
carries `parent_extrapolated`.
`GeologicalFormationUpdateRequest` accepts `parent_extrapolated` +
`parent_formation_id` so the inspector dialog can Confirm
(clear the flag), Reassign (set new parent + clear flag), or Detach
(parent_formation_id=null + clear flag) in one PATCH.

**Frontend.** New `formatAcceptParentSummary` helper drives one
warning toast per accept ("N parents extrapolated, M unassigned —
review in Lithology inspector"). `useToasts` widened to a third
`warning` kind (amber background). The four accept handlers
(single, all-focus, single-bulk, all-bulk) emit the summary; the
bulk-all variant aggregates across anchors so the user sees ONE
toast at end-of-pass. `LithologyInspector` renders an amber dot
(`Circle` filled) on extrapolated OR orphan unit rows; clicking
opens a new `ConfirmParentDialog` (parent select default-focused,
button label morphs Confirm/Reassign/Detach based on the
selection). Submitting PATCHes both fields in one call and
refetches formations.

**Tests.** 7 new unit tests on `_compute_straddle_splits` (E1 no
geology → orphan; E2 TIN finds parent; E3 above all surfaces →
orphan; E4 outside footprint → orphan; E5 stale TIN skipped; E6 no
elevation disables; E7 contact-based wins over extrapolation). 3
integration tests on the accept endpoint (X1 extrapolated path +
flag + response list; X2 orphan path; X3 PATCH clears the flag).
6 unit tests on `formatAcceptParentSummary` (A1-A6: empty / single /
plural / orphan-only / combined wording). 3 vitest pins on
LithologyInspector (P1 clean rows skip the dot; P2 extrapolated
rows render the dot + open the dialog; P3 Confirm PATCHes both
fields). Existing fixtures got `parent_extrapolated: false`
auto-inserted after `parent_formation_name`.

**Documented residuals (out of scope for #87 itself).**
* The dogfeed user's existing 1 reparented + 2 unfixable orphans
  are now classified — the unfixable ones need engineer review via
  the Detach UX before they enter a `.gmproj` bundle handoff.
* A `CHECK` constraint
  `litho_main_soil_code IS NULL OR parent_formation_id IS NOT NULL`
  is still NOT added — the migration backfilled what it could, but
  the orphan path is intentionally kept open (TIN unavailable, no
  elevation, suggestion above youngest formation). Adding the
  constraint would force engineer-side resolution before commit,
  which the owner has not asked for.

---

> The items below (#97–#103) were filed 2026-05-22 from a litho
> ghost-review dogfeed session. They are a related cluster — the
> "add / edit / merge a litho layer" surface — best done as one or
> two focused passes, not scattered micro-patches.


## 98. Litho ghost-review: "add a layer" discoverability + right-click Split (Tier G — before the Geotech stage)

**What.** Adding a litho layer during ghost review has no discoverable
home. The only path today is the #85 boundary insert-strip — a 6 px
hover-only `<rect>` on the shared boundary *line* between two pending
layers. The owner, dogfeeding, could not find it. Left-click on the
column cannot be the answer — single-click on a ghost layer is
deliberately inert (misclick safety, owner directive 2026-05-22) and
the suggestion overlay covers the click-to-place-contact path beneath.

Owner-approved fix (2026-05-22): add **"Split layer"** to the
pending-layer right-click context menu (alongside Accept / Edit
composition / Reject). It splits the layer in two at its midpoint;
both halves inherit the original composition; the user drag-resizes the
new boundary and edits whichever half differs. A `splitLithoLayer` pure
helper mirrors `insertLithoLayer` (`utils/lithoLayerInsert.ts`);
`onSplitLayer` wires through SectionPanel → SectionsCanvas →
`useGeologicalModel`. The hover boundary-strip stays as the quick
precise option.

Splitting at the exact right-click depth (vs the midpoint) was
considered — deferred as a refinement; it needs screen-coord→depth
math, and midpoint+drag is robust and consistent with how the user
resizes everything else.

**Why deferred.** A real feature (helper + tests + the menu item + a
four-component prop chain). Owner green-lit but surfaced at the tail of
a long session; deserves its own focused implementation.

**When to revisit.** Immediately — owner explicitly green-lit it. The
first task of the next litho-workflow pass.

## 99. Litho drag-resize clamp does not pass through rejected layers — investigated, code correct in the obvious reading (Tier G — verify with owner; G34b pins the mirror)

**What.** Dogfeed 2026-05-22: the user rejected a litho ghost layer,
then tried to drag the boundary of the sand layer below it *up* and
reported they could not pull it past the rejected layer to reach the
layer above.

**Investigation 2026-05-23.** The hypothesis from the original entry —
"clamp picks the bounding neighbour by raw index (`idx±1`) instead of
the next *non-rejected*" — does NOT match the code.
`findCascadeChainAbove` / `findCascadeChainBelow`
(`LithoSuggestionGhostColumns.tsx:243` / `:278`) already skip rejected
layers (`continue` on `rejectedIndices.has(i)`), return the next
non-rejected as the barrier, and `computeDragBounds` clamps at its
NEAR edge — i.e. the layer-above's BASE. A new test **G34b** mirrors
the existing G34 (which only covered base-drag DOWN) for the exact
owner scenario — top-drag UP through a rejected layer — and passes on
first run. The code is correct for the obvious interpretation.

Two remaining possibilities for what the owner actually hit: (a) the
clamp at A.BASE is correct but the visual ("touches A's bottom edge
but does not enter A") read as "couldn't pull onto A"; (b) the actual
topology was different (an accepted layer in the chain, more than one
rejected, or a same-parent cascade case that fired the merge dialog
and was cancelled).

**Why deferred.** Cannot fix what is not reproducing. G34b is the
regression net for the obvious interpretation.

**When to revisit.** Next time the owner hits the symptom — capture
the exact layer set (lithologies, accepted/rejected/pending, parent
formations) so the scenario can be re-modelled. If (a) is the real
answer, the followup is a UX nudge (e.g. a visible boundary glyph at
the clamp) rather than a logic change.

## 100b. Inspector-select sticky reveal of correlation edges (Tier D — follow-on to #100)

**What.** #100 shipped the hover-to-reveal half of the design (chip
hover → that body's edges + same-body chip halo appear). The other
half — clicking a formation in the `LithologyInspector` to STICKY-
reveal that body's edges across the section — was scoped out because
it needs new cross-component state: `selectedFormationId` shared
between the inspector and the `CorrelationEdgesOverlay`. Hover is the
exploratory gesture; sticky-select is for STUDYING a body without
keeping the cursor parked on a chip.

Shape when picked up: extend `useShellContextValue` (or equivalent
shell context) with `selectedFormationId: string | null` and a setter;
add an `onClick` handler on each `LithologyInspector` formation row
that flips it (toggle if already-selected); add `selectedBodyOrdinal:
number | null` prop on `CorrelationEdgesOverlay` that ORs with the
local hover state when deciding which body's edges to render. Visual
treatment is identical to the hover path (halo + lines); only the gate
shape changes.

**Why deferred.** v1 shipped hover-only to keep the change focused.
Adding a shared selection state is small (~30 lines) but spreads
across three files (inspector, shell context, overlay) and deserves
its own commit.

**When to revisit.** Next litho-workflow UX pass, or when a dogfeed
session has the user wanting to "pin" a body's edges to study them
without holding the cursor.

## 101. Litho lens / pinch-out body representation — Position 4: correlation-implies-absence + inference (Tier G — session 2026-05-24 blocker)

**⚠ ARCHITECTURAL PIVOT (owner directive 2026-05-24, late session).**
The Slices 1-7 build that landed earlier today (46 commits on
``develop``, reviewer-clean) implemented Approach C — explicit
lens-as-entity with a "Mark as lens" gesture and per-lens absence
rows. Mid-build the owner identified the design dissonance: **for
Flanders without faulting/folding, lens-ness is implied by the
correlation topology + corridor-scoped observation data — the user
should not have to declare a lens, only correlate normally**. The
"Mark as lens" gesture is redundant ceremony for the common case
and only earns its keep for naming, perpendicular-companion
attachment, and overriding inferred absences when complex geology
(faulting / unconformity / erosion) makes the inference wrong.

The decision: **Position 4 — auto-infer lenses from correlation
topology + observation data; keep the explicit gesture as an
override/naming layer.** The Approach C build gets refactored on
top of the just-landed clean base. The section-local wedge
geometry from Slice 2 carries forward unchanged; the use case +
schema + dialog get rebuilt around the inference model.

### Position 4 architecture

**Inference engine.** A new pure-domain service in
``src/groundmodel/domain/services/lens_inference.py``. Runs after
every correlation-edge mutation and observation-data mutation.
For each body (a connected component in the
``litho_correlation_edge`` graph, identified by
``(parent_formation_id, litho_main_soil_code, body_ordinal)`` from
the existing resolver), for each in-corridor investigation that
lacks a contact for the body, the engine checks
``ObservationLayerOrm`` rows at that investigation against the
body's depth range. If a different lithology is observed at the
overlapping depth, the engine writes a
``formation_absence(formation_id, investigation_kind,
investigation_id, source='inferred')`` row. Idempotent:
re-running produces the same set. Preserves rows with
non-``'inferred'`` ``source`` (does not overwrite user intent).

**Schema reshape.**

| Before (Approach C) | After (Position 4) |
|---|---|
| ``litho_lens(id, app_project_id, model_id, parent_formation_id, name, primary_section_id, ...)`` — lens IS the body | ``litho_lens(id, model_id, formation_id, body_ordinal, name, primary_section_id, companion_section_id, ...)`` — lens is METADATA attached to a body identified by ``(formation_id, body_ordinal)`` |
| ``litho_lens_absence(id, lens_id FK, investigation_kind, investigation_id)`` — absence scoped to a specific lens | ``formation_absence(id, formation_id, investigation_kind, investigation_id, source)`` — absence scoped to a formation; bodies derive their absences via corridor-membership of the body's contacts vs the formation's absence rows |
| ``formation_contact.lens_id`` FK column | **DROPPED.** Body identity is computed by the resolver, not stored on the contact. |

The ``source`` enum starts at v1.0 with ``'inferred' | 'manual' |
'observed'``. Phase 5+ extensions: ``'fault' | 'unconformity' |
'erosion'`` — when present, the absence is NOT a lens-edge
absence and wedge geometry does NOT apply at that investigation.

**Q1/Q2/Q3 owner directives (re-checked under Position 4):**

* **Q1 (multi-lens-per-formation) — STILL HOLDS.** Two clay
  drapes at different elevations within the same parent
  formation become two distinct ``body_ordinal`` values via the
  existing resolver. Each can have its own slim ``litho_lens``
  metadata row attached (name, companion) or stay unnamed.
* **Q2 (absent-investigation auto-prepopulation) — REPLACED BY
  AUTO-INFERENCE.** Under Approach C, Q2 was "the dialog
  pre-populates checkboxes from segmenter output". Under Position
  4, the inference engine writes ``formation_absence`` rows
  directly — no dialog needed for the common case. The original
  positive-evidence guard from Q2 stays: the engine ONLY infers
  an absence when there's a different lithology observed at the
  body's depth range. No data → no inference (UNKNOWN, not
  ABSENT).
* **Q3 (perpendicular companion fallback length) — UNCHANGED.**
  ``max(2 × buffer_m, 100m)`` when no investigation is found on
  a side. The companion-creation gesture moves from the lens
  creation flow to the "Inspect lens body" panel.

**Gesture surface.**

* **Default (Flanders, zero friction):** user correlates; the
  inference engine writes ``source='inferred'`` rows; wedge
  synthetic contacts materialize via the existing Slice 2
  geometry; section renders inferred wedges with a PROVISIONAL
  visual style (dashed outline, ~40% fill opacity, small "auto"
  badge).
* **Explicit gestures (override / naming / companion):**
  right-click on a body in the section view → **"Inspect lens
  body"** panel. Shows the body's present columns, inferred /
  manual / other absences with their ``source``, wedge tip
  locations. Actions:
  - **Name this lens** → creates a ``litho_lens`` metadata row
    attaching the name to ``(formation_id, body_ordinal)``.
  - **Create perpendicular companion section** → existing Slice
    4 endpoint, re-keyed by ``(formation_id, body_ordinal)``.
  - **Confirm absences** → promotes ``source='inferred'`` rows
    to ``source='manual'``; the wedges re-render with solid
    style. Lock-in gesture.
  - **Override absence at column X** → change ``source`` to
    ``'fault'`` / ``'unconformity'`` / ``'erosion'`` (Phase 5
    enum extension); wedge geometry no longer applies at that
    column. v1.0 ships ``'inferred' | 'manual' | 'observed'``
    only — extending the enum is a small follow-up migration.

**Visual treatment in the section view.**

* ``source='inferred'`` absences → dashed wedge outline, ~40%
  opacity, "auto" badge near the body
* ``source='manual'`` absences → solid wedge outline, ~70%
  opacity, no badge (user-confirmed)
* ``source='observed'`` absences → same as ``'manual'`` for
  rendering (observed = positive evidence the user can review
  but doesn't need to confirm)
* Phase 5+ non-lens absence types render with their own iconography
  (fault tick, unconformity squiggle) and no wedge tip

**The "Mark as lens" dialog goes away.** Replaced by the right-
click "Inspect lens body" panel. The companion-offer modal stays
(triggered from the panel's "Create perpendicular companion"
action).

**Why this is better than Approach C.**

1. **Matches LeapFrog UX feel** — model emerges from data; no
   redundant gesture
2. **Single source of truth** — body identity comes from the
   resolver; lens metadata is decoration, not authority. Editing
   correlation → lens topology updates automatically.
3. **Future-proof for complex geology** — the ``source`` enum
   extends to fault / unconformity / erosion as Phase 5
   geology-aware features land
4. **Flanders-first scoping** — the inference engine is
   geologically sound for subhorizontal Cenozoic strata; complex
   geology gets the override path

### What from Approach C carries forward

| Slice | Fate |
|---|---|
| Slice 1 — ``litho_lens`` table | **Slim.** Drop ``parent_formation_id``; keep id / model_id / formation_id / body_ordinal / name / primary_section_id / companion_section_id. Drop ``formation_contact.lens_id``. |
| Slice 1 — ``litho_lens_absence`` table | **Rename + reshape** to ``formation_absence`` with ``source`` enum; drop ``lens_id`` FK, add ``formation_id`` + ``source``. |
| Slice 2 — ``lens_pinch_out_geometry.py`` + 24 unit tests | **KEEP UNCHANGED.** Section-local wedge math is exactly what the inference engine triggers. |
| Slice 3 — ``CreateLithoLens`` use case | **Replace** with ``RecomputeFormationAbsencesForBody`` (driven by the inference engine) + a thin ``NameLensBody`` for the explicit naming gesture. Wedge-tip materialization moves to a separate ``MaterializeWedgeTipsForFormation`` triggered by absence-mutation hooks. The atomicity + scope-leak + modelId fixes from the post-reviewer pass port to the new use cases. |
| Slice 4 — perpendicular companion endpoint | **Re-key.** Lookup by ``(formation_id, body_ordinal)`` instead of ``lens_id``. Logic unchanged. |
| Slice 5 — ``MarkAsLensDialog.tsx`` + menu wiring | **Throw out.** Replaced by ``InspectLensBodyPanel.tsx`` triggered from right-click on a body. The ``CompanionOfferDialog.tsx`` from the fix-up pass survives — same trigger, different upstream. |
| Slice 6 — list endpoint | **Adapt.** Returns auto-detected (every body with absences in corridor) + named (with metadata row) lenses. |
| Slice 7 — bundle persistence | **Refactor schema** to match new tables (``formation_absences[]``, slim ``litho_lenses[]``, no ``lens_id`` on contacts). |

### Honest cost

Estimated ~3 days of focused work. The Slice 2 geometry + Slice 4
companion endpoint logic + Slice 7 bundle structure carry
forward unchanged or near-so. The refactor target is the schema +
the use cases + the dialog UX.

### Why blocking now (unchanged)

Without lens support the litho model is a half-truth for any real
BE/NL dataset. Every other litho-stage UX fix is downstream of the
lens architecture. Now is the right time to land Position 4 — pre-
ship amnesty is in effect (no upgrade chain needed), the schema can
be cleanly reshaped, no external users to break.

### When to revisit

Now. Sequence: refactor in place on top of the just-landed clean
base. The 46 existing #101 commits stay on ``develop``; the
refactor is additive + subtractive on top.

---

## 101 (historical — superseded by Position 4 above). Litho lens / pinch-out body representation — Approach C scoped (was Tier G blocker, now historical)

**What.** The litho (and geological) model currently assumes
layers / surfaces are laterally continuous across the investigation
set. Real geology has **lenses** — a body present at some
investigations that pinches out laterally before reaching others.
There is no model representation for "this sand unit is present here
and here, absent there." The user-invoked pinch-out wedge tool (shipped
2026-05-18) does deterministic dip-extrapolation-to-crossing for a
*single terminal wedge edge* — it is NOT a general lens; true
interfingering lens geometry between control points is the harder
facies-geometry problem.

Open question to resolve before building: how is a lens stored — a unit
flagged absent at certain investigations? a unit whose surface may
terminate inside the corridor? — and how do the TIN build, the section
slice, and the exporters treat a body that is not everywhere.

**Idea — perpendicular section auto-create (owner, 2026-05-22).** A lens
is a 3D body; a single cross-section only constrains it in one
direction. When the user draws a lens on a section, pop up an offer to
**auto-create a perpendicular cross-section** through it — perpendicular
to the original section, centred on the lens. The perpendicular section
auto-extends its length until it reaches an investigation — ideally one
on *each* side of the lens, so a real test brackets the lens extent in
the orthogonal direction (fall back to one side, or a default reach, if
the other side has no test in range). Two perpendicular sections then
give orthogonal control points and make the lens body genuinely
3D-modellable.

Guard: **at most one perpendicular section per lens.** Before offering
the popup, check whether the lens already has a perpendicular section
and suppress / disable the offer so the user cannot create two. This
implies the lens is a first-class entity that *owns* its sections — a
concrete pull on the "how is a lens stored" question above: the store
needs a lens id that a cross-section can point back at, plus a flag
marking a section as the lens's perpendicular companion.

**Resolved design questions (owner, 2026-05-24).** Dogfeed surfaced
that real BE/NL fluvial-deltaic data cannot be modelled as continuous
units — the user reports "before lens is wired, I can't make a litho
model." Three open questions answered, picking **Approach C — skinny
Lens entity, deferred TIN/export**:

* **Q1. Multi-lens-per-formation.** Two clay lenses at different
  elevations in the same column → **two LithoLens entities sharing
  the same parent formation**. Each lens has its own id, own bracket
  of contacts, own perpendicular companion section. The formation's
  ``litho_main_soil_code`` stays a property of the formation; the
  lens carries identity and absence semantics.
* **Q2. Absent-investigation pre-population.** When the user clicks
  "Mark as lens" on a clay unit in column A, the dialog
  **auto-pre-populates** the absent set from the segmenter result:
  any in-corridor investigation with positive evidence of a
  different lithology at the same depth range is flagged ABSENT by
  default. Columns with no test in range or with the same lithology
  default to PRESENT/UNKNOWN. The user overrides with per-
  investigation checkboxes before submit. Auto-detection MUST require
  positive evidence (different lithology at overlapping depth) — never
  guess absence from no data.
* **Q3. Perpendicular-section auto-extension fallback.**
  ``max(2 × buffer_m, 100 m)`` when no investigation is found on a
  side. Ensures the companion section is always meaningful at
  section-view scale even when the lens sits at the corridor edge.

**Approach C scope (the build):**

| Layer | Change |
|---|---|
| Schema | New ``litho_lens(id, project_id, model_id, parent_formation_id, name)``. ``formation_contact`` gets nullable ``lens_id`` FK. ``cross_section`` gets nullable ``companion_lens_id`` FK + ``is_lens_companion bool``. New join ``litho_lens_absence(lens_id, investigation_id, investigation_kind)``. |
| Backend | ``CreateLithoLens(contacts[], absent_investigation_ids[])`` use case — creates lens, tags contacts, records absences. ``CreatePerpendicularCompanion(lens_id)`` use case — computes perpendicular bearing through the lens centroid, auto-extends per Q3 fallback, creates the section, links via ``companion_lens_id``. ``ExtrapolatePinchOut`` extended to accept optional ``lens_id`` so wedge tips inherit lens identity. |
| Frontend | Right-click menu item on a litho unit: **"Mark as lens"** → dialog with the corridor's investigations + pre-populated absence checkboxes (Q2) + lens name field. Submit → POST lens + offer to auto-create the perpendicular companion. Sections marked ``is_lens_companion=true`` get a small badge in the header so the user knows their origin. |
| TIN | Untouched in this pass — lens contacts contribute to the parent formation's surface as today. Lens-aware TIN math (closed body geometry) stays Phase 5. |
| Export | Untouched. DXF / Plaxis still emit lens as a continuous formation that pinches via wedges — engineering-defensible, not geologically airtight. Lens-aware export is Phase 5. |
| Rendering | Polygon-ribbon correlation (#121) becomes lens-aware: edges tagged with ``lens_id`` get stronger fill (~35% opacity) + dashed top/base boundary (signals "closed body"). Ribbon endpoints respect pinch-out tip contacts so a ribbon reaching an absent column thins to zero at the wedge tip. |
| Bundle | ``litho_lenses[]`` + ``litho_lens_absences[]`` arrays in ``.gmproj`` v3. ``companion_lens_id`` on every section; ``lens_id`` on every contact. Additive — opens cleanly in builds that ignore it (still in pre-ship amnesty window). |

**Pre-build pinch-outs: section-local math at mark-time, no
deferred resolve (owner, 2026-05-24 dogfeed, revised after the
LeapFrog comparison).** The first design — ghost contacts with
null synthetics resolved at Build time — was rejected: it forces
the user to revisit after build to see the lens materialise, and
the partial-geometry state pollutes the bundle round-trip and the
section renderer. LeapFrog's UX promise is "enter data, see
results, no revisit"; ghost-resolve violated it.

The revised design: **compute the wedge tip section-locally at
mark-time, in 2D, using only the data already in front of the
user.** The lens-marking gesture has far more context than the
geology right-click "Extrapolate pinch-out…" gesture and does NOT
need a TIN:

* The section line geometry (start/end (x, y), EPSG) is on the
  cross-section row.
* The present-column contacts for the pinching lithology on this
  section, projected onto the section line, give a 2D polyline
  for the formation in (along_m, elevation_m) space.
* The present-column contacts for the deeper *target* lithology
  (parent formation's next-older neighbour by `display_order`)
  give a parallel polyline.
* The absent-column section position is a known scalar (the
  column's along_m).
* Linear regression / dip-along-section between the two adjacent
  present contacts on the pinching side gives the local dip;
  intersect with the target polyline → wedge tip in (along_m,
  elevation_m). Project back to world (x, y) using the section
  line direction vector → `synthetic_x`, `synthetic_y`.
  Elevation comes straight from the intersection. **All three
  synthetic-* fields populated at mark-time.**

New use case `ComputeLensPinchOutTipsSectionLocal(lens_id,
section_id)` — frontend or backend, doesn't matter for the math
(the inputs are all in the cross-section's already-loaded state).
Backend is cleaner for atomicity: one transaction commits the
lens + absences + synthetic contacts in one POST. Result:
**marking a lens commits a fully-resolved synthetic contact row
with non-null synthetics; the section renderer shows the wedge
immediately; no revisit.**

When the user later clicks Build, `compute_tin` includes the
lens synthetic contacts as ordinary FormationContact rows — no
special resolver, no second compute path, no flag to track. The
two computation methods (TIN-based for geology right-click,
section-2D for lens-mark) produce comparable rows; the lens path
just doesn't gate on TIN existence.

**Why this is cleaner than ghost-resolve:**

| Concern | Ghost-resolve (rejected) | Section-local at mark (chosen) |
|---|---|---|
| Revisit after Build | Required | None |
| Synthetic-contact states | Two (ghost + resolved) | One |
| Build step special path | `resolve_ghost_pinch_outs` | None — synthetics are ordinary rows |
| Bundle carries partial geometry | Yes | No |
| User mental model | "Marked → wait → resolved" | "Marked → done" |
| Math source of truth | TIN (for resolve) | Section-2D at mark; TIN at slice (independent) |

**Edge cases.** Lens at corridor edge (only one adjacent present
column): dip-extrapolation toward the absent side using the same
direction-heuristic the geology pinch-out uses today, just on
the section polyline instead of the TIN slice. Target lithology
missing on this section: explicit error at mark time, same as
the TIN path produces today. New investigation added later:
existing lens synthetics stay valid (they're real (x, y, elev)
rows tied to the lens id); the user can edit the lens to
recompute if the new column changes the inferred geometry.

**The post-#118 bandage stays.** The disabled-state on the
geology right-click `Extrapolate pinch-out…` gesture is correct
for that gesture (it is genuinely TIN-dependent — single
contact, no lens, no explicit target). After #101 ships, that
gesture remains TIN-gated; the lens-marking path is the new
primary affordance for pre-build pinch-outs.

**What Approach C buys immediately.** Lens has identity; the
perpendicular companion section is auto-created with the right
geometry; pinch-outs are tagged with the lens; multiple distinct
lenses of the same lithology don't collide; lens pinch-outs are
computed at mark-time in section-2D so the user sees the wedge
immediately with no revisit required after Build; the bundle
round-trips.

**What it does NOT yet do.** Lens-aware closed-body TIN (Phase 5),
lens-aware DXF/Plaxis export (Phase 5), cross-section lens correlation
("lens A on section 1 = lens B on section 2 because they're the same
3D body" — Phase 5 — until then the user manually correlates each
lens body via the perpendicular companion).

**Why blocking now.** Without lens support the litho model is a
half-truth for any real BE/NL dataset. Every other litho-stage UX
fix is downstream of the lens entity (the polygon-ribbon
rendering, the body-hover, the section header chrome all want to
know about lens identity).

**When to revisit.** Now — this is the lead session-2026-05-24
blocker. Sequence: #118 (pinch-out for Litho — half day) → this
(~5–7 days) → #119 / #120 / #121 / #122 in any order.

## 102. Merge button for a same-lithology boundary (Tier G — before the Geotech stage)

**What.** Dogfeed 2026-05-22: after "Suggest litho", the segmenter
sometimes produces adjacent layers with the *same* lithology stacked on
each other (sand on sand). This is by design — the segmenter splits on
Robertson zone integer changes, which correlate with packing-density
(NAD-class) transitions, and the no-auto-merge directive (#74 history)
keeps those splits because the geotechnical model needs them. But the
user wants a way to merge them when a split is *not* wanted.

Owner directive (2026-05-22): **not** automatic — a user-initiated
**Merge** action. When a boundary (ghost or committed contact) has the
same lithology on both sides, offer a "Merge" affordance; the user
decides, layer by layer. This reconciles with the no-auto-merge
directive: the splits are still produced (the geotech model needs
them); merging is an explicit user choice.

Shape: a small merge button / context-menu item that appears only on a
same-lithology boundary; merging removes the boundary and unions the
two layers. The resulting composition / NAD handling (dominant or
re-aggregated) is a sub-decision for the implementing pass.

**Why deferred.** A new gesture on the boundary surface; small but needs
the merge-composition rule decided. Not a blocker — the user can already
drag-resize one layer to absorb the other.

**When to revisit.** The litho-workflow UX pass — natural companion to
#98 (the boundary is the shared surface).

---

> The items below (#104–#117) were filed 2026-05-22 from a six-agent
> full-codebase audit (code-quality+logging+tests / architecture+future-
> proofness / security / cleanliness / UX / documentation). ~67 raw
> findings consolidated into 14 items. None overlap the existing
> backlog. All sit BELOW the Geotech-stage gate — they are tech debt,
> hardening and polish, not litho-stage-finishing work.

## 104. Three-level export gap — snapshots carry geological-level data only (Tier D — Phase-4 MVP export step)

**What.** `GroundModelSnapshot` and `SectionSnapshot` carry only
`formation_id` / `formation_name` from the geological model. Neither
carries `litho_main_soil_code`, `nad_class`, `instance_ordinal`, or the
three-level hierarchy. So `PlaxisExporter`, `DxfSectionExporter`,
`PlaxisSectionExporter` export the geological level only — the
lithostratigraphic level is not in any exporter output, and the
geotechnical level will not be either once it lands. ("The litho
stage isn't done until a user can build a litho without annoyances" —
owner 2026-05-23. The build path works; the dogfeed papercuts in
Tier G + this export gap are both part of finishing it.)

**Why deferred.** The v1.0 MVP gate's step 5 is "export the three-level
model geometry with unit identifiers". The build paths for litho /
geotech contacts exist; the snapshot-assembly step does not project
them into the export contract. Not yet built because the geotech stage
itself is not built — but the litho-level gap is real today.

**When to revisit.** Phase-4 MVP export step, after the geotech stage.
Extend `SectionSnapshot` + `BuildSectionSnapshot` to include litho-level
contacts keyed by `model_id`; `SectionFormation` gains optional
`litho_main_soil_code` / `nad_class`; exporters pick the level from the
`model_id` argument they already take. No schema change.

## 105. UX contract violations — confirm dialog, dark mode, focus contrast (Tier D — pre-coworker-binary)

**What.** The UX audit found three standing contract violations:
- `SectionsInspector.tsx:470` (`SectionRow.handleDelete`) uses native
  `window.confirm` for an irreversible cross-section delete — default
  focus on OS "OK", no action-named button. The contact-delete and
  toolbar-delete paths were already fixed (#62); the inspector row was
  missed. `SectionsToolbar.tsx` has the modal pattern to copy.
- `WelcomeScreen.tsx`, `UnsavedChangesDialog.tsx`, `NewProjectDialog.tsx`
  use raw Tailwind palette tokens (`bg-white`, `text-gray-800`, …) with
  no `dark:` variants — the three primary entry-point surfaces render
  white-on-white in dark mode (WCAG AA contrast fail). `docs/ux.md`
  mandates semantic tokens / `dark:` pairs.
- `Button.tsx:12` hardcodes `focus-visible:ring-blue-500` — ~2.8:1 on
  dark surfaces, fails the WCAG 2.2 AA 3:1 UI-component requirement;
  should be the theme-aware `ring-accent`. `DeleteContactConfirmDialog`'s
  cancel `<button>` has no focus ring at all.

**Why deferred.** Real accessibility / contract bugs but not a blocker
on a current commit; grouped so the modal-pattern + token-migration are
done once. The dark-mode-on-WelcomeScreen one is the most user-visible
("white on white" on a dark-OS machine).

**When to revisit.** Before the coworker binary — first impression +
accessibility floor.

## 106. Application layer is welded to the ORM (Tier D — clean-architecture leak)

**What.** ~20+ geology use cases (`accept_litho_suggestions.py`,
`create_formation_contact.py`, `rebuild_model_surfaces.py`,
`recompute_formation_surface.py`, `validate_model_crossings.py`, …)
import ORM classes, run `select(...Orm)` queries inline, and in several
cases RETURN `*Orm` objects as their public type (`create_formation_
contact -> FormationContactOrm`, `update_formation_contact`,
`extrapolate_pinch_out -> list[FormationContactOrm]`). The router then
hands the ORM object straight to FastAPI serialisation. The domain
layer is clean (zero infra imports — verified); the application layer
is the leak. Returning ORM types also means a new ORM column silently
appears on the API wire (the live-API analogue of #47).

**Why deferred.** The geology use cases grew alongside the ORM;
`GeologyRepository` exists but covers ~30% of the query surface. Not a
runtime bug — a structural deviation from the stated layer rule.

**When to revisit.** Before Phase-5 statistics work (which adds bulk
queries that must be testable in isolation). Cheapest first step: add
`FormationContactResult` dataclasses for the three ORM-returning use
cases so the API boundary stops leaking.

## 107. Schema integrity hardening — constraints, FKs, indexes (Tier D)

**What.** The architecture audit found the schema relies on
application-layer convention where a DB constraint should hold:
- `geological_model.kind` has no `CHECK (kind IN (...))` — an unknown
  kind from a future build restores silently as `'geological'`.
- `geological_formation` has no constraint co-nullating its litho-only
  columns; the documented `litho_main_soil_code IS NULL OR
  parent_formation_id IS NOT NULL` CHECK (#87 residual) is still unbuilt.
  A geological row that ever acquired a `litho_main_soil_code` would be
  silently matched as a litho unit by the accept find-or-create scan.
- `cpt.app_project_id` / `borehole.app_project_id` are `nullable=True`
  (Phase-1 leftover) and no table has a real FK to `project` — orphan
  rows are possible.
- `geological_model.is_active` has no `UNIQUE(app_project_id, kind)
  WHERE is_active` partial index — two actives render non-deterministically.
- Missing read indexes: `formation_contact(model_id, cpt_id)`,
  `litho_correlation_edge(model_id, formation_a_id)` + `(…_b_id)`.

**Why deferred.** No current correctness failure under single-user use;
each fix is one Alembic migration. Several must be coordinated with the
backwards-compat re-arm (#47) and a one-time orphan/NULL backfill.

**When to revisit.** Bundle a single "schema hardening" migration
alongside the next geology migration; the FK + NOT NULL work folds into
the backwards-compat re-arm (#3 / #47).

## 108. Documentation refresh — docs/ + CLAUDE.md drifted from the shell + Phase-4 (Tier D)

**What.** Python docstring coverage is good (DoD §2 broadly honoured);
the debt is the prose layer:
- `docs/desktop.md` documents a pre-shell app — `Sidebar.tsx` (deleted),
  a flat `components/` layout; says `projectFile.ts` is "format v1" (v3).
- `docs/api.md` covers ~61 of ~93 routes — misses the whole litho
  correlation/segmenter workflow, SSE streaming import, PDF export, DEM
  sample; says the bundle is ".gmproj v2" (v3).
- `docs/parsers-dov.md` claims HTTP/2 multiplexing (proven false — DOV
  is HTTP/1.1-only; `dov_http.py:17` docstring repeats it), omits the
  `parsers/dov/` package + borehole/lab/Virtuele-Boring import paths,
  and quotes a retired "500 CPTs in 4-10 s" (real: ~54 s / 316 deep).
- CLAUDE.md's Project Structure tree + Domain Model show a Phase-2-era
  layout and imply `Pressuremeter`/`SPT`/`VST` classes that don't exist.
- `docs/geology-stage-architecture.md` + `docs/ui-shell-architecture.md`
  still say "pre-implementation" for shipped code.
- `InterpretationPane` (deleted) is cited as live in `api.md`, `ux.md`
  and ~5 source comments; `project_bundle.py:3` docstring says "v2".

**Why deferred.** A real refresh pass; the source-code docstrings are
fine, so this is not a DoD campaign — it is the orientation docs.

**When to revisit.** Before the coworker binary — docs are the second
contributor's map. Trivial standalone fixes (do anytime): the
`.gmproj v2`→v3 errors and the false HTTP/2 claim.

## 109. BaseExporter ABC split — ProjectExporter vs SectionExporter (Tier D)

**What.** `BaseExporter.export(snapshot: GroundModelSnapshot) -> bytes`
is the declared contract, but `DxfSectionExporter`,
`PlaxisSectionExporter` and `SectionPdfReportExporter` all override
`export()` with a `SectionSnapshot` parameter — three of five concrete
exporters break the ABC at the type level (suppressed with an
unexplained `# type: ignore[override]`).

**Why deferred.** Callers instantiate concrete types directly, never via
the ABC, so no runtime bug today. But Phase-5 adds D-Stability /
D-Sheet / GeoStudio exporters and every author has to infer the
convention from context.

**When to revisit.** Phase-5 exporter work — the third section exporter
already exists, so this is the "split on the second concrete use"
moment. Split into `ProjectExporter(GroundModelSnapshot)` and
`SectionExporter(SectionSnapshot)` ABCs.

## 110. Export-path duplication — Plaxis exporters + section-export boilerplate (Tier D)

**What.** The cleanliness audit found heavy duplication on the export path:
- `plaxis_exporter.py` (322 lines) and `plaxis_section_exporter.py`
  (361 lines) are ~85% identical — `_emit_imports_and_connect`,
  `_emit_materials`, `_material_variable_name`, `_py_str` byte-identical;
  the borehole bottom-up cascade-fill differs only in the column key.
- Three `cross_section.py` export endpoints (`export_section_dxf` / `_pdf`
  / `_plaxis2d`) + `geology/exports.py` repeat the same build→ParseError-
  404→CRS-guard→`safe_name` slug→`Response` tail; the slug logic exists
  in 4 places.
- `App.tsx`'s three `handleExportSection*` handlers (~45 lines each)
  repeat the slug + save-dialog + fetch + write + toast flow; the
  filename-slug regex is duplicated 4× in the frontend too.

**Why deferred.** Works correctly; but #52's report slices B/C/D each
add another export target and currently copy ~25-45 lines per target —
this compounds.

**When to revisit.** Before #52 slice B. Extract a `PlaxisScriptEmitter`
shared module, a `_section_export_response(...)` router helper, a
`runSectionExport(...)` frontend helper, and a `safeFilenameStem` util.

## 111. useGeologicalModel duplication — litho-accept block + bypassed helper (Tier D)

**What.** In `useGeologicalModel.ts`:
- The four litho-accept handlers (`handleAcceptLithoSuggestion`,
  `…AllLithoSuggestions`, `…BulkLitho`, `…AllBulkLitho`) each repeat the
  same ~40-line post-success block (parent-summary toast, stale-TIN
  count, `onSectionUpdated`, ghost accept-marking, two refetches,
  `pushAcceptLithoUndo`). #87 and #91 each had to be hand-wired into all
  four sites — the next response-field addition repeats that 4×.
- The `setGhostsByAnchor` accept-marking immutable-update is spelled out
  inline at 5 sites despite a purpose-built `_updateGhostEntry` helper
  that the reject/unreject/edit handlers also bypass.

**Why deferred.** No bug; but it is exactly the "extract on the second
copy" target, and the 4× hand-wiring is a proven drift risk.

**When to revisit.** Next time a litho-accept response field is added —
extract `applyAcceptResult(...)` and route the ghost mutations through
`_updateGhostEntry` first.

## 112. Bundle / restore + API input bounds (Tier B — pre-distribution hardening)

**What.** The security audit found the bundle-bounds story (started
2026-05-13) has gaps:
- CPT/borehole depth-series arrays are typed `dict[str, Any]` in
  `ProjectBundleRequest` — uncapped element counts. A single CPT with a
  5 M-element `depths_m` array fits the 256 MiB body cap (~35 MB as
  JSON) but allocates ~280 MB of Python heap on restore. The
  `_MAX_TIN_ARRAY_LEN = 200_000` cap on TIN blobs is the pattern; series
  arrays are the gap.
- `FormationSurface.vertices` / `.triangles` JSONB has no structural
  validation on restore — a hand-edited `.gmproj` with malformed tuples
  passes the size cap and crashes the TIN code at an unpredictable point.
- `export_section_pdf`'s `title` / `author` / `notes` query params have
  no length cap — query strings bypass `BodySizeLimitMiddleware`.

**Why deferred.** All DoS-class with self-impact only (localhost,
single-user) — but the `.gmproj` file is the user-owned, shareable,
tamper-accessible surface, and bounds exist everywhere else.

**When to revisit.** Before the coworker binary. Add `_MAX_SERIES_ROWS
= 100_000`, a `_validate_tin_payload` structural check in the restore
path, and `Query(max_length=…)` on the PDF params.

## 113. Security pattern-risk cleanup (Tier B — pre-coworker-binary)

**What.** Five not-currently-exploitable pattern risks that become
load-bearing when auth (#3/#4) or any server-sourced UI data lands:
- `Settings.secret_key` defaults to `"change-me"` — silent weak-key
  footgun the moment the auth layer reaches for it. Add a startup
  assertion or drop the default.
- `dov_scalar_observation_client.py` `_build_cql_filter` interpolates
  parameter strings with single-quote delimiters on a comment-only "no
  quotes in values" assumption — add a module-load assertion against
  `DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS`.
- `DOV_VALID_PERMKEY_RE` uses `^`/`$` (line anchors) not `\A`/`\Z` —
  inconsistent with `virtuele_boring.py` which already uses `\A`/`\Z`.
- `MapView.tsx` passes Leaflet `attribution` as raw HTML — fine for
  today's hardcoded constants; an XSS path if attribution ever becomes
  dynamic. Add a comment at the binding site.
- IPC `window:set-title` has no string length cap — the one unbounded
  renderer→main string left after the 2026-05-13 IPC hardening.

**Why deferred.** None exploitable under today's single-user, hardcoded-
data deployment. Cheap, mechanical fixes.

**When to revisit.** Fold into the #3 license/auth work, or knock out as
a batch before the coworker binary.

## 114. Large-file readability — bundle restore fn + ContactsLayer (Tier E)

**What.** Two maintenance hotspots flagged by the cleanliness audit:
- `_restore_project_bundle_impl` (`project_bundle.py`) is a ~560-line
  function with 9 near-identical idempotent-insert blocks (CPTs,
  boreholes, formations, units, models+contacts, surfaces, sections,
  reviews, edges). Each block builds a different ORM with genuinely
  different validation — a full generic extractor would be over-
  abstraction — but it should be decomposed into 9 named `_restore_*`
  helpers for reviewability.
- `ContactsLayer.tsx` is a 2756-line component with 7 overlapping
  polyline/geometry `useMemo`s and is the locus of recurring section
  bugs (#28, #62, #99). The memos likely share a "project contacts →
  sorted SVG path" core extractable to a unit-testable `utils/` helper.

**Why deferred.** Both work correctly — pure readability / reviewability
cost, no behaviour change.

**When to revisit.** Decompose the restore function opportunistically
the next time it is touched; the ContactsLayer extraction deserves its
own focused pass (it is a recurring bug site).

## 115. UX polish batch (Tier D)

**What.** The UX audit's should-fix / consider tier:
- `SectionsInspector` `InspectorSection` blocks are not collapsible —
  the 420 px inspector overflows on a project with many sections +
  formations + the Virtuele Boring strip. gINT/LeapFrog use collapsible
  accordions; persist collapse state to localStorage.
- `DataInspector.tsx:488` "Remove" uses `bg-status-danger` (red) for a
  *reversible* project-local hide — red should be reserved for
  irreversible intent.
- `BoreholeLog.tsx:564` track header shows the translated label with no
  raw-token `title` tooltip — violates the translate-at-boundary rule
  ("show the source token so experts can verify the mapping").
- `WelcomeScreen` dismiss + recent-project buttons have no focus ring.
- `PerUnitTab` Phase-5 placeholder columns have no `aria-disabled` /
  descriptive label — a screen-reader user tabs into a dead column.
- `StageSpine` `SelectionFooter` has a dead `count===1 ? 'sel.' : 'sel.'`
  ternary and an opaque "sel." label with no `aria-label`.
- Tab bars are inconsistent — `ParametersCanvas` has proper
  `role="tablist"` ARIA, `DataInspector` uses plain buttons; extract a
  shared `TabBar` primitive with arrow-key nav.

**Why deferred.** Polish — none blocking; batched so the inspector /
token / ARIA work is done coherently.

**When to revisit.** A Sections/Data-stage UX pass, or when the next tab
surface is added (do the `TabBar` primitive then).

## 116. Test coverage gaps — RebuildModelSurfaces + SectionPdfReportExporter (Tier D)

**What.** Two non-trivial modules have no unit tests (DoD §4):
- `application/rebuild_model_surfaces.py` — the user's manual TIN-repair
  escape hatch; the contact→formation grouping logic has no CI gate.
- `infrastructure/exporters/section_pdf_report_exporter.py` — #52 slice
  1; a substantial ReportLab/matplotlib layout engine. `test_pdf_layout.py`
  covers the `packed_column_positions` pure helper but not the exporter,
  and slices B/C/D will land on top of untested code.

**Why deferred.** Both work; the gap is a regression net, not a bug.

**When to revisit.** Add `test_rebuild_model_surfaces.py` (no-contacts,
two-formation, one-formation-raises) opportunistically; add the exporter
test before #52 slice B.

## 117. Audit cleanup batch — logging gaps, conventions, quick fixes (Tier E)

**What.** Small, mechanical fixes from the audit, grouped:
- **Logging:** `import_samples_dov.py` `_persist_caco3` / `_persist_organic`
  / `_persist_water_content` / `_persist_atterberg` loops have no
  `[i/total]` progress prefix (DoD §1) — those import phases are
  invisible in the log. `_persist_scalar_lab_tests` is the correct model.
- **Conventions:** module-level constants live in class files —
  `section_pdf_report_exporter.py` (6 layout constants) and
  `litho_segmentation.py` (the `ROBERTSON_ST_TO_LITHOLOGY` /
  `DOV_HOOFDNAAM_TO_LITHOLOGY` dicts, Phase-5 tuning targets) — move to
  `*_constants.py` siblings.
- Stub exporters `geostudio_exporter.py` / `dsheet_exporter.py` raise
  `NotImplementedError` → reaches the client as a 500; the router should
  translate to 501.
- `import_samples_dov.py:330` — dead `result.grain_sizes_skipped_no_sample
  += 0` no-op; delete it (the real `_failed` increment is the next line).
- Two `eslint-disable` reason comments cross-reference another handler
  instead of standing alone (`App.tsx:654`, `useGeologicalModel.ts:3604`)
  — `check_eslint_reason.py` only checks for the token, so they pass CI.
- Mid-module import block in `import_interpretations_dov.py` (wedged
  below `_FLAG_TO_TYPE`) — move above the constant.
- `plaxis_section_exporter.py` `# type: ignore[override]` has no inline
  reason.

**Why deferred.** All trivial; batched so they are one tidy commit pass,
not 8 micro-commits.

**When to revisit.** Any low-focus session — knock the batch out in one
sitting.

## 118. Wire pinch-out gesture for the Litho axis (Tier G — session 2026-05-24 blocker)

**What.** `SectionsCanvas.tsx:984` gates `pinchOutGhostState` behind
`if (isLitho || !activeGeologicalModel) return undefined`, so the
right-click → "Extrapolate pinch-out…" gesture is unreachable on the
Litho axis. Backend (`POST .../contacts/pinch-out`,
`ExtrapolatePinchOut`) is formation-id-keyed and works fine for litho
formations — only the frontend gate needs to flip. The
target-formation derivation (next-older by `display_order`) already
runs against `axisFormations` which is axis-swapped, so it should
drop in unchanged.

**Tests to add.** Litho ghost-preview → confirm → contact rows
appear with `source='pinch_out_extrapolation'` on the litho model.
When #101 lands, extend the test: pinch-out with `lens_id` carries
the lens tag onto the synthetic contacts.

**Why deferred.** Phase-4 carve-out — pinch-out was scoped to the
geological model when shipped 2026-05-18. Dogfeed 2026-05-24
surfaced that litho models genuinely require it (clay wedges, sand
pinch-outs in fluvial-deltaic sequences are everywhere in BE/NL
data) and #101's lens entity assumes pinch-out wedges can ride on
litho contacts.

**When to revisit.** First step of the session-2026-05-24 sequence.
Prerequisite for #101. Half-day with tests.

## 119. Litho segmenter: same-lithology auto-merge (Tier G — session 2026-05-24 blocker)

**What.** `segment_cpt` in `litho_segmentation.py` currently splits
on every Robertson SBT zone integer change. Zones 5/6/7/8 all map to
ZAND via `ROBERTSON_ST_TO_LITHOLOGY`, so a uniform sand column gets
stacked Z6 ZAND → Z7 ZAND → Z8 ZAND layers (one per density step).
Add a post-pass after the greedy-merge step that collapses adjacent
runs of the same `suggested_lithology` into one suggestion. The
merged layer's `mean_qc_mpa` and `dr_pct` become thickness-weighted
aggregates; `suggested_nad_class` becomes the dominant class by
thickness. Real lithology transitions (ZAND → KLEI) keep their
boundary.

**Reverses** the 2026-05-20 owner directive ("we accept the
over-split shape in the litho stage… no auto-merge of adjacent
same-lithology layers"). New directive (owner 2026-05-24): **no
AUTO segmentation based on packing density**. The user's manual
Split gesture (`utils/lithoLayerSplit.ts`) is unchanged and still
creates same-lithology sub-units when the engineer wants them — the
over-split shape is accepted **only if user-picked**.

**Implications for the MVP gate.** CLAUDE.md's MVP gate step 4 lists
per-unit Ic / Dr / NAD class / γ-estimate as litho-stage outputs.
After this change those indicators MOVE from litho to geotech (the
geotech stage runs its own segmentation pass with a density-aware
merge rule). CLAUDE.md needs the corresponding edit when this lands:
litho = lithology only; density goes with geotech. Litho inspector
still shows AGGREGATE Dr/NAD on the unit for context.

**Migration.** Already-accepted litho contacts in existing projects
are unaffected — change is to the suggest path, not the persisted
shape.

**Why deferred.** Architectural reversal — needed sign-off + the
user-pick-still-allowed nuance.

**When to revisit.** Session 2026-05-24 declared this a litho-stage
prerequisite. Half-day + bench update.

## 120. Section band-rect extends past investigation depth (Tier G — bug)

**What.** `CorrelationEdgesOverlay.tsx:217-220`'s `buildBandMap`
falls back to `plotBottomLevel` for the deepest formation's
`botLevel`:

```typescript
const botLevel =
  i + 1 < sorted.length
    ? surface - sorted[i + 1].depth_top_m
    : plotBottomLevel   // ← runs to the section's bottom, not the test's
```

so the click-target rectangle (and any future fill / outline) extends
to the bottom of the entire section view, not to the bottom of the
actual CPT/borehole. Visible as the blue dashed selection rectangle
in Correlate mode extending well below the data column (dogfeed
2026-05-24, image 4 showed clay band's blue outline going ~5 m past
the test bottom on every column).

**Fix shape.** Thread per-investigation `maxDepthM` into
`buildBandMap` (already available on the section's column projection
shape) and use `surface - maxDepthM` for the deepest band's
`botLevel`. ~30-line diff plus a regression test (pick an
investigation with a deepest formation; assert the band closes at
the data bottom, not at `plotBottomLevel`).

**Why deferred.** Same-day fix; queued with the session batch so
the lens/correlate UX renders correctly on first commit.

**When to revisit.** Session 2026-05-24 batch. Trivial.

## 121. Correlation rendering: polygon ribbon, lens-aware (Tier G — session 2026-05-24 blocker)

**What.** `CorrelationEdgesOverlay.tsx:1104-1113` renders a
committed correlation edge as a **single dashed line** at
band-midpoint. Replace with a **filled quadrilateral** spanning
`(xA, top_A) → (xB, top_B) → (xB, base_B) → (xA, base_A)` per edge,
coloured with the lithology hue at ~25% opacity. When 3+ columns
share a `body_ordinal`, render ONE continuous ribbon through them
all (not three separate quads — overlapping fills at chained
columns are ugly). Group edges by body ordinal and emit a
polyline-style ribbon per body.

**Lens-aware composition.** Edges/ribbons tagged with `lens_id`
(from #101) get stronger fill (~35% opacity) + a dashed top/base
boundary — visually signals "closed body, not continuous formation".
The ribbon endpoints respect pinch-out tip contacts (from #118 +
#101's lens-absent semantics): a ribbon reaching an absent column
thins to zero at the wedge tip, not at the column itself.

**Why deferred.** Real new UI work, ~1 day with tests. Depends on
#101 for lens-awareness — non-lens version could ship first then
upgrade, but cleaner to land the lens dependencies first.

**When to revisit.** After #118 + #101.

## 122. Correlation edge opacity fade + body-hover spike (Tier G — session 2026-05-24)

**What.** Committed correlation edges render at full opacity today,
producing visual noise when N×M layers × columns. Dogfeed
2026-05-24 reported "too many suggestion lines" for what is
actually a fully-committed correlation set (not suggestions). Drop
default opacity to ~20%; spike to ~80% on body-hover (the chip-hover
halo already does this for the body's chips — extend the gate to the
body's edges/ribbons). Optionally hide edges entirely when zoomed
out below a threshold (e.g. section length > 500 m per 100 px).

**Why deferred.** Polish; smaller scope than the architectural
items. Natural to land alongside #121 since both touch the
rendering pass.

**When to revisit.** After #121; same rendering pass absorbs the
opacity logic.

## 123. Correlation suggestion bug: clay → silt cross-lithology pair (Tier G — needs reproduction)

**What.** Dogfeed 2026-05-24 user-reported: at least one committed
correlation edge connects a KLEI unit on one column to a SILT unit
on another, despite `correlate_litho_units.py:145` rejecting
cross-lithology pairs at the server. Hypotheses:

* (a) Frontend bypassed the validator on a specific gesture path
  (e.g. drag-from-ghost-edge variant — see #82) and posted a
  cross-lithology pair the server accepted because the frontend
  signalled OK before the body validator ran.
* (b) A formation's `litho_main_soil_code` was set wrong at
  creation (e.g. via "Mark as lens" or a bulk-rename action),
  making two formations that *display* as different lithologies
  actually share the same `litho_main_soil_code` and pass the
  server check.
* (c) The chip/band rendering uses a different `formation_id` than
  the edge data references (visual mismatch only — no real
  cross-lithology edge in DB).

**Diagnosis path.** Query the `litho_correlation_edge` table for
the user's project and join through both endpoints'
`geological_formation` to detect any pair with mismatched
`litho_main_soil_code`. If a real cross-lithology edge exists,
trace the create path; if not, the bug is in the renderer.

**Why deferred.** Cannot diagnose blind — needs a specific
reproduction point in the user's project. Owner asked to file it as
debt with the others; expected to be re-opened with a screenshot
zoom or column-name pair.

**When to revisit.** Owner provides a reproduction. Otherwise pick
up at the end of the session-2026-05-24 batch as a sweep —
diagnostic SQL across the dogfeed project is cheap.

## 124. CreateLithoLens — split into geometry service + DB-loading layer (Tier E)

**What.** `create_litho_lens.py` is 780+ lines. The wedge-tip geometry
(`_load_formation_contacts_on_section`, `_commit_wedge_tips_for_absent`,
`_project_to_along`, `_load_target_contacts_on_section`) is pure
section-geometry logic that mixes with ORM session calls. A thin
`LithoLensGeometryService` (domain-layer, session-free) holding the
pure math + a DB-loading layer above it would make the geometry unit-
testable in isolation without needing an async session mock.

**Why deferred.** The 780-line file is well-structured internally;
the split is a refactoring exercise, not a correctness fix. Slicing it
now would widen the PR without delivering user value.

**When to revisit.** When a Phase 5 lens-geometry variant (e.g.
interfingering shape, multi-section aggregation) forces the geometry
logic to grow. At that point the split pays for itself immediately.
Filed from #101 senior-code-reviewer pass, 2026-05-24.

## 125. SectionHeader companion badge: replace ↻ (U+21BB) with text label (Tier E)

**What.** `SectionHeader.tsx` uses `↻` (U+21BB) as the companion-
section badge icon. This character does not render reliably on Windows 11
with some CJK font fallbacks; it may display as a tofu square. Replace
with a short text label ("perp") or a simple dot (•) inside the badge.

**Why deferred.** Purely cosmetic; does not affect functionality.

**When to revisit.** Any UX polish pass. Half-line change.
Filed from #101 senior-code-reviewer pass, 2026-05-24.

## 126. LithoLensOrm.name: change from VARCHAR(120) to TEXT (Tier E)

**What.** `LithoLensOrm.name` is mapped as `String(120)` (PostgreSQL
`VARCHAR(120)`). Per CLAUDE.md conventions, free-form label columns
should be `TEXT` — `VARCHAR(N)` is for fixed-spec values (codes, enums,
IDs). A lens name entered by the user is free-form; a 120-char cap
invites surprise truncation.

**Why deferred.** Backwards-compat rule is suspended (pre-ship). A
small migration to `ALTER COLUMN name TYPE TEXT` is the fix; it is
mechanical and non-breaking.

**When to revisit.** Any migration-bearing session while the backwards-
compat suspension is still in effect. One migration line.
Filed from #101 senior-code-reviewer pass, 2026-05-24.

## 127. Auto-correlate litho bodies on accept / import (Tier G — fold in after #101 Position 4 lands)

**What.** When the user accepts litho suggestions per CPT / borehole
or imports new tests, the system should **automatically propose
``litho_correlation_edge`` rows** for same-lithology contacts on
adjacent columns within a distance-aware depth threshold. The
inference engine + wedge materialisation from #101 Position 4
then runs over the auto-correlated graph, so the model emerges
from imported data with minimal user gestures. Manual override
remains: user can delete auto-edges, add edges the algorithm
missed, and any manual edge is preserved across re-runs.

**Owner directive 2026-05-24 (post-#101 Position 4 lock-in).**
Identified mid-refactor as the missing trigger that makes the
inference engine actually pay off in practice — without
auto-correlate, the user still has to manually create every
correlation edge before the engine sees anything to work with.

**Algorithm (v1.0) — bottom-up sweep with dip transfer.**

Owner refinement 2026-05-24: process formations in stratigraphic
order from deepest (lowest ``display_order`` = oldest) to
shallowest. In Flanders deep = Tertiary marine deposits, which
correlate cleanly because they're laterally extensive, subhorizontal,
and sharply-contrasting lithologies. Each formation's accepted edges
feed a per-column-pair dip estimate that **predicts the centre of
the next-shallower formation's candidate window** — so by the time
the algorithm reaches the Quaternary (where lens-prone shallow
geology produces wild variability), the search window is centred at
the geologically-expected depth rather than naïvely "same depth at
A as at B".

**Tertiary-base is NOT required (owner caveat 2026-05-24).** Many
BE/NL sites have no Tertiary contact in the dataset: polders with
thick Holocene over Pleistocene where CPTs refuse before Tertiary;
Brabant Massif edges with Palaeozoic bedrock under thin Quaternary;
urban / shallow investigations that never reach Tertiary even when
it exists deeper. The algorithm degrades gracefully — "bottom-up"
means **deepest-available first**, not Tertiary-specific. The sort
is ``display_order ASC`` regardless of what's in the dataset; if
the deepest formation here is Pleistocene fluvial sand, the
algorithm processes that first.

What changes without a Tertiary base is the **magnitude of the
dip-transfer benefit**, not whether the algorithm runs. To stop a
noisy dip estimate from sparse deep edges propagating false
predictions upward, use **confidence-weighted dip transfer**: the
dip predictor only kicks in for a column-pair once that pair has
``min_edges_for_dip_transfer = 3`` accumulated correlated edges.
Below that threshold, fall back to naïve "same depth" centre with
the full distance-scaled window for the next formation. Tertiary-
rich sites get the benefit immediately; Quaternary-only sites get
it once enough Quaternary edges accumulate; sparse / heterogeneous
sites gracefully degrade to mutual-nearest-on-wider-window without
contamination from a poorly-estimated dip.

The compounding effect: false positives drop sharply on the
Quaternary because the dip baseline (Tertiary OR sufficiently-rich
deep Quaternary) is calibrated from below. Matches how a geotech
engineer correlates by hand — deep markers first, then work up.

Algorithm:

```
sort formations by display_order ASC  (oldest/deepest first)
estimated_dip = {}  per column-pair

for F in formations:
    for (A, B) in all column pairs within max_distance_m:
        # Predict where F's contact at B should be given A's
        if estimated_dip[(A, B)] is set:
            predicted_b_depth = contact_a.depth + dip * dist(A, B)
        else:
            predicted_b_depth = contact_a.depth  (naïve fallback)

        window = base_threshold + distance_factor * dist(A, B)
        candidates = {
            (C_a, C_b) on (A, B) :
                C_a.formation_id == C_b.formation_id == F.id
                AND |C_b.depth - predicted_b_depth| < window
        }

        edges += mutual_nearest_neighbour(candidates)

        # Update dip from accumulated correlated pairs on (A, B).
        # robust_slope_fit = Theil-Sen / median-of-pairs (NOT OLS) —
        # one shallow outlier mustn't contaminate the Tertiary baseline.
        estimated_dip[(A, B)] = robust_slope_fit(edges_between(A, B))
```

Defaults: ``base_threshold_m = 2.0``, ``distance_factor = 0.01`` (so
5m apart → ~2.05m window, 500m → ~7m window), ``max_distance_m =
500`` (configurable per-project).

**Same-formation constraint.** Auto-correlate operates strictly
within a single formation per loop iteration — the resolver already
groups by ``(parent_formation_id, litho_main_soil_code)`` so cross-
formation edges would be rejected by the use case anyway. Filtering
at candidate generation avoids wasted candidate computation.

**Disambiguation — mutual nearest neighbour.** A column-pair
(A, B) may have multiple candidates within threshold within a
single formation (e.g. two thin sand layers at A correlate-able
with two at B). For each C_a, find the closest C_b by predicted-
depth-residual; for each C_b, find the closest C_a; correlate ONLY
when they are each other's mutual nearest. Drops the many-to-many
fan-out cleanly.

**Idempotency.** Add ``source`` enum to ``litho_correlation_edge``
(``'manual' | 'auto'``). Re-running auto-correlate is additive on
non-existing pairs only — never overwrites manual edges. Deleted
auto-edges DO get recreated on re-run for v1.0 (no per-edge
suppress list yet); Phase 5 adds a "rejected by user" flag so
deletions stick.

**Provisional rendering.** ``source='auto'`` edges render
dashed/~40% opacity (same treatment as ``source='inferred'``
absences from #101 Position 4). User confirms → promote to
``'manual'``, edges render solid/~70%.

**Refinements deferred to Phase 5.**

* **Cross-formation dip-transfer guard.** v1.0's bottom-up sweep
  assumes subparallel surfaces between adjacent formations (true
  in Flanders Cenozoic — Boom Klei dips at roughly the same
  angle as Diest Sand above it). Angular unconformities (BE-
  Limburg Pre-Tertiary / Tertiary contact, some southern-Dutch
  outcrops) violate this; the dip transferred forward from below
  is wrong above the unconformity. Phase 5 detects the
  discontinuity (large per-column-pair dip jump between adjacent
  formations) and resets the dip estimator at the unconformity.
* **Stratigraphic ordering constraints.** Reject correlation
  pairs whose connected component would imply layer inversion
  (ZAND-on-CLAY at A vs CLAY-on-ZAND at B for the same bodies).
* **Per-formation override of thresholds.** Some formations (peat
  drapes, thin clay markers) need tighter windows than thick
  sand units. v1.0 has one global threshold + dip-predicted
  centre; Phase 5 allows per-formation window overrides.
* **User-rejected edge suppress list.** When the user deletes an
  auto edge, remember and don't re-propose it on the next run.

**Where it fires.**

* After ``acceptLithoSuggestions`` use case commits (the
  natural moment — new contacts just landed)
* After ``importCpt`` / ``importBorehole`` use case commits (when
  raw data arrives — though contacts only exist after accept, so
  this might be redundant)
* Explicit toolbar trigger on the Litho axis: ``Auto-correlate
  now`` button (or a Suggest dropdown item)
* User toggle in Settings: ``Auto-correlate on accept`` default
  ON (per-project, ``view_state.litho_auto_correlate.enabled``)

**Composition with #101 Position 4.**

Position 4's inference engine fires off correlation-edge
mutations. Auto-correlate creates those mutations. Zero conflict
with the running refactor; this slice is additive on top.

**Estimated cost.** ~2 days post-#101 Position 4 (was 1.5 — the
bottom-up sweep + dip estimator adds ~half a day for the loop
refactor + the Theil-Sen / robust-slope fit + tests covering dip
transfer accuracy and degenerate column-pairs):
* Pure domain service ``auto_correlate_litho_bodies(contacts,
  formations, investigations, params) → list[CorrelationEdge]``
  iterating formations in ``display_order`` ASC with per-column-
  pair dip state accumulated across the loop
* Pure domain helper ``robust_slope_fit`` — Theil-Sen / median-
  of-pairs (NOT OLS) so a single shallow outlier can't poison
  the deep-baseline dip
* Confidence gate ``min_edges_for_dip_transfer = 3`` — dip
  predictor only used after the column-pair has accumulated
  enough deep correlations; falls back to naïve same-depth
  centre below the threshold (handles Tertiary-less sites
  gracefully)
* Heavy unit tests (~25 cases): threshold scaling, mutual-NN
  tie-breaking, same-formation filter, idempotency, edge cases,
  **dip transfer between formations (Tertiary→Quaternary)**,
  **Tertiary-less sites: degenerate Quaternary-only correlation**,
  **dip-transfer confidence threshold (< 3 edges → fallback)**,
  degenerate column-pairs with no shared formations, outlier
  resistance in the dip estimator
* Constants in sibling ``auto_correlate_constants.py``
* Application use case + POST endpoint + frontend client method
* Settings entry for the thresholds (fits the existing Settings
  dialog from the locale-tolerant numeric input work)
* Toolbar button + toast announcing "N auto-correlations created
  — review or confirm" in the LithologyInspector
* Hook into ``acceptLithoSuggestions`` for the on-accept fire

**Why deferred.** #101 Position 4 must land first — the inference
engine + correlation-edge source enum + provisional rendering
treatment are prerequisites. After #101 + **#128 (Playwright
e2e)** land, this slice ships next.

**Sequencing change (owner directive 2026-05-25):** **#128 ships
BEFORE #127**, not after. Rationale: the #101 Position 4 build
generated three post-merge bug fix-up rounds (initial fix-up
post-Approach-C reviewer, Position-4 fix-up #2, materialiser
``ground_level_m``, then the #129 dogfeed batch). Every one of
those was a cross-boundary integration bug — passed unit + tsc +
reviewer, surfaced only at owner smoke-test. Building #127 on
top of the current unblocked-but-still-leaky stack means more of
the same. Land #128 first → the auto-correlate work inherits the
6-flow smoke set as its own regression net.

**When to revisit.** After #128 ships (Playwright harness +
initial 6-flow smoke set running). Single slice, ~1.5-2 days
including the bottom-up sweep + dip transfer + Tertiary-less
safeguards from above.

## 128. Playwright end-to-end smoke harness for the main user flows (Tier B — pre-coworker-binary quality investment)

**What.** Add Playwright (or equivalent — Cypress is the
alternative) wired to the Electron app via the existing
``electron-smoke.cjs`` scaffolding, with a small set of always-
on end-to-end "happy path" smoke tests that exercise the cross-
boundary user flows. These tests catch the class of bug that
Vitest (frontend unit), Python unit, and Python integration all
miss: **a UI click that hits a backend endpoint that hits a wrong
ORM attribute name and 500s**.

**Why this class of bug keeps surfacing.** Owner smoke-test
2026-05-25 surfaced ``BoreholeOrm.ground_level_m`` not existing —
the materialiser was wired in fix-up #2, all 989 unit + 1179
Vitest tests + tsc + the reviewer pass were green, but the FIRST
real click on Accept-all (bulk) hit the AttributeError because
no test ever exercised the call chain through to the actual DB
column. This is the **third** class-of-bug repeat in #101 alone:
- Approach C reviewer pass: dead-wired Mark-as-lens menu
  (frontend prop never threaded through)
- Position 4 reviewer pass: ``InspectLensBodyPanel`` was never
  built (frontend surface missing entirely)
- Position 4 fix-up #2 owner smoke-test (THIS one): wrong ORM
  attribute name in the materialiser

Each previous instance was caught only by manual review / manual
smoke-test, never by automated tests. A click-driven harness
would catch all three at fix-up commit time, before they reach
the owner.

**Minimum viable smoke set (v1.0+).** Six flows that exercise the
critical cross-boundary paths:

1. **Boot + open .gmproj** — open the dogfeed Oudenaarde
   project; assert the section list populates, the Litho
   inspector renders, no console errors, no 500s in network log
2. **Import a DOV CPT + accept litho per CPT** — single-anchor
   accept; assert FormationContact rows exist post-commit
3. **Bulk suggest + bulk accept** — the flow that broke today;
   assert all 70 anchors accept without 500s (catches every
   materialiser / inference-hook regression)
4. **Correlate two same-lithology contacts across columns** —
   assert ``litho_correlation_edge`` row + ``formation_absence``
   rows materialise (catches the R7 hook chain end-to-end)
5. **Right-click body → Inspect Lens Body panel opens** —
   assert the panel renders + the actions are clickable
   (catches the InspectLensBodyPanel-unreachable class)
6. **Save + close + reopen .gmproj** — round-trip; assert every
   row count matches pre-save (catches bundle persistence
   regressions; #101 R6 ships ``formation_absences`` array)

**Harness shape.** Playwright Electron driver
(``@playwright/test`` with ``electron`` config). Launch the
packaged dev build, drive the UI, capture network traffic,
assert DOM + DB state (read-only Postgres connection to the
integration DB for assertions on the persisted rows).

Tests run:
- Pre-commit (the 1-flow smoke that opens the app + clicks
  one button) — fast, ~10s
- Pre-PR / nightly (the full 6-flow set) — slower, ~2-3 min

**Estimated cost.** ~3-4 days:
- Day 1: Playwright + electron-playwright setup, headless mode,
  the boot-and-open smoke
- Day 2: bulk suggest/accept flow + correlate flow (the two
  highest-payoff)
- Day 3: Inspect Lens Body panel + bundle round-trip
- Day 4: CI integration, pre-commit speedup, documentation

**Why Tier B (pre-coworker-binary).** Every external user we
distribute to is one click away from the next ``ground_level_m``-
class bug. The investment compounds: the harness catches future
regressions in the same flows the dogfeed has already burned
hours on. The pattern of "three reviewer passes + three fix-up
passes + still finding bugs at smoke-test" means our existing
test gates aren't sufficient on their own for the cross-boundary
surfaces. Pre-distribution is the cutoff because shipping a 500
to a real user is much worse than catching it in dogfeed.

**Why deferred until now.** Originally filed (2026-05-25 morning)
as deferred until after #127 with the rationale "let the litho
workflow stabilise, then build the smoke set on top of stable
flows".

**Sequencing change (owner directive 2026-05-25 afternoon):**
**#128 ships BEFORE #127.** Rationale: the #101 Position 4 build
generated four post-merge bug fix-up rounds in 24 hours (initial
fix-up, Position-4 fix-up #2, materialiser ``ground_level_m``,
then the #129 dogfeed batch). Every single one was a
cross-boundary integration bug — passed unit + tsc + reviewer
gates, surfaced only at owner smoke-test. Pattern is clear:
existing test gates aren't sufficient for cross-boundary
surfaces, and shipping #127 (which adds another suggestion
surface) before #128 means more of the same. Land the harness
first; #127 inherits the 6-flow smoke set as its regression net
from day one.

**When to revisit.** Immediately after #129 fix-up lands (the
last bug from this session — currently in flight). Before
#127 auto-correlate. Before the first external/paid distribution
(debt #3 license keys trigger). Filed 2026-05-25 from the
materialiser-bug dogfeed; sequencing escalated same day after
#129 surfaced three more cross-boundary bugs.

## 129. Position-4 dogfeed batch (2026-05-25 #2) — three concrete bugs (Tier G)

Three issues surfaced in the second dogfeed pass after the
``ground_level_m`` fix landed. All visible in the same session;
file as one batch with a single fix-up dispatch.

**129a — ``GET .../lenses`` 500s at boot.** The
``LithologyInspector`` fetches the lens metadata list on mount;
the response 500s (browser shows CORS-mask because CORS headers
don't attach to error responses). Likely root cause: the .strix
file the user re-opened was created before R1's schema reshape;
restore writes lens rows with the old shape, the new
``LithoLensListItem`` Pydantic schema rejects them (e.g.
``body_ordinal`` missing), validation 500s. OR the dev DB has
schema drift the user's last ``alembic upgrade head`` didn't
cover. Diagnose with a manual curl + a backend log scrape.

**129b — Bulk accept is catastrophically slow.** ``Accept all
(bulk)`` on 70 anchors takes ~70-140 seconds. Cause: the
frontend fans out one HTTP call per anchor, and each call's R7
hook re-runs ``RecomputeFormationAbsencesForFormation`` +
``MaterializeWedgeTipsForFormation`` for **every** affected
formation × every section. With ~8 formations × 2 sections × 70
anchors = ~1100 inference passes, each ~30-70ms = catastrophic.

**Fix shape (chosen design):** add a new ``defer_inference: bool
= False`` parameter to ``AcceptLithoSuggestions.execute()``. When
true, the R7 hook is **skipped** for this call. Frontend's
``handleAcceptAllBulk`` passes ``defer_inference=True`` on every
per-anchor call inside the batch, then makes one final POST to a
new lightweight endpoint
``POST .../models/{model_id}/recompute-all-absences`` that runs
the inference engine once over every affected formation in the
model. Net result: ~70 fast accepts (no inference math) + ~1
inference pass = ~5-10 seconds total instead of 70-140.

Reject alternative — per-formation diff in the R7 hook (compute
which formations actually have new contacts and recompute only
those). Architecturally cleaner but more invasive; the defer +
single final call is simpler and matches the user's mental model
("I'm doing a bulk operation, optimize for the batch").

**129c — Correlation gesture has no immediate visual feedback.**
After Correlate-mode click-1 + click-2, no toast, no flash, no
new dashed line. User: "I have no idea if something is correlated
after 2 clicks." The orange "59 investigations still have pending
suggestions" warning in the section toolbar tells the user the
gesture is BLOCKED until all suggestions are committed (the
gesture only operates on committed bands), but the warning is
easy to miss given the busy interface around it.

**Three fixes overlap here:**
1. On successful correlate → immediate toast ("Correlated
   [formation] across [N] columns") + brief flash on the source
   + target band (200ms accent-color halo)
2. On rejected correlate (pending suggestions, cross-formation,
   etc.) → red toast with the specific reason — don't make the
   user inspect the small orange warning
3. The CorrelationEdgesOverlay should refresh its edge list
   immediately after the POST commits (today: relies on a refetch
   that may lag). Confirm in the frontend hook chain.

**Estimated cost.** ~1 day for the three fixes plus a brief
investigation pass on 129a's root cause. The bulk-defer is the
biggest change (~3 hours including backend test + frontend wire).

**Why Tier G.** All three actively block the litho-stage smoke-
test. Without 129b in particular, the workflow is unusable on a
project with >20 investigations.

**When to revisit.** Immediately — dispatch the fix-up batch in
the same session as the materialiser fix. Filed 2026-05-25 from
the post-materialiser-fix dogfeed.

