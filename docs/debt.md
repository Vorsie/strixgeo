# Known Architectural Debt

Items that need a focused session — bigger than a quick fix, smaller
than a phase. Tracked here so each one is visible in PR / commit
context without rediscovering it from grep. **Order is strict
priority — top is highest, bottom is lowest. Tiers are grouped, but
within each tier the order also matters.**

Five tiers (priority order WITHIN each tier matters too — the list
below is the canonical ordering, not the numeric order of the
sections that follow):

* **A. Phase 4 engineering blockers** *(none open — #1 resolved 2026-05-14; the MVP gate's "DXF and/or Plaxis" is satisfied by the DXF + Plaxis-3D exporters that shipped)*
* **B. Commercial launch gates — pre-paid-revenue:** #2, #3, #4, #5, #6, #7, #47
* **C. Current work — dogfeed correctness / velocity / friction (pre-external-users, 2026-05-16 re-tier):** #41 (Geology3DViewer untested — residual after pure-helper extract) *(#55 litho peer-stage scaffolding RESOLVED 2026-05-18: LithologyStage StageDescriptor + LithologyCanvas [single-viewport Geology3DViewer when hasLithoSurfaces, guided EmptyState otherwise, module-level resetLithoCameraCallback, ground-surface useEffect keyed on lithoModelId] + LithologyInspector [ModelKindPicker + stale-surface info banner + read-only formation roster with contact counts + workflow guidance footer] + LithologyToolbar [Reset Camera visible when hasLithoSurfaces] + `lithoStaleSurfaceCount` useMemo + `handleRebuildLithoSurfaces` useCallback in useGeologicalModel; SectionsToolbar litho-axis Build button with stale-count amber badge. L1–L5 hook + BL1–BL4 toolbar + I1–I3 inspector + C1–C2 canvas vitest green; 808 unit total. #58 formal/informal bridge resolved 2026-05-18: `build_formal_informal_bridge` + `_resolve_bridge_key` threaded into the shared scan/execute pipeline; 12 new unit tests B1–B6/R1–R4/I1–I3 + 49 integration green; Gavere dogfeed has 22 dual-stream boreholes — bridge actively helps. One-time stale-lump gap: pre-bridge formal-keyed `stratigraphy_lumping` entries silently skip on first run; user re-lumps once. No #59 "also known as" hint in dialog — post-confirmation scope. #57 dedupe survivor-swap now seeds the survivor id into the section on the 409 path — shared `_seed_section_contacts` helper across the 201/409/Seed sites, unit + integration green, resolved 2026-05-18; #12, #36, #37, #38, #40, #43, #51 resolved 2026-05-16/17 — #12 resolved on substantive completion + revised DoD: App.tsx 3,200→833, the dangerous shellContextValue memo isolated + netted, Sidebar gone; strict `<400` de-scoped as low-value coordinator-pattern churn — see #53 for the residual dep-array tracking)* *(launch-demo blockers #29–#35 all cleared 2026-05-16; bundling/commercial Tier B deferred — owner directive: app not feature-ready for packaging. This tier front-loads a data-loss landmine + the velocity-multiplier test/refactor work that gates the UI-rework / geotech-model / parametrisation roadmap, then the cheap dogfeed-friction fixes.)*
* **D. Post-launch / Phase 5:** #11, #13, #28, #39, #44, #52, #60
* **E. Lower technical debt:** #15, #16, #17, #18, #22, #23, #26, #27, #42, #45, #46, #48, #49, #50, #53, #64, #65, #66, #67

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

## 56. Manual-lump cross-project reuse + standalone group editor (Tier C — deferred)

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

**What.** Read `user_decision_log` rows for `decision_type =
litho_accept` (initially) and train a model that predicts which
ghost layers the user will keep / move / reject. Inputs: segmenter
output + investigation features (qc / Ic / soil_code at depth) +
project metadata. Outputs: refined layer suggestions, ranked. Re-
trains as the log grows.

**Why deferred.** Owner directive — audit ML rigorously by hand
before any pipeline ships. ML accuracy claims need a human-in-the-
loop validation round; the log table (#70) is the data plumbing for
that audit. The training itself is post-MVP — geotechs care about
deterministic, reviewable outputs first.

**When to revisit.** After the decision-log table has accumulated N ≥
200 litho accepts across ≥ 3 real projects AND the owner has spot-
audited a representative sample. Don't fit a model on toy data.

## 76. Accept-all sometimes "splits" displayed layers post-accept (Tier E — diagnostic needed)

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

