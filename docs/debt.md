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

**What.** ``POST /projects/{id}/duplicate`` (project.py:281-300)
and ``PATCH /projects/{id}/view-state`` (router-resolved via the
project id) operate on the resolved row without an identity
check. Today that's correct (single user, no auth). When debt
#3 lands, these endpoints will need a ``user_owns(project_id)``
predicate threaded through. The geology + cross-section + review
routers already use a two-stage ``get_in_project_or_404`` pattern
— mirror that.

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

## 15. WFS client base class — remaining wrapper duplication (low)

**What.** The big-three shared blocks are now extracted:

* ``collect_wfs_features_recursive`` — bbox-split + dedup recursion.
* ``wfs_count`` / ``wfs_features_json`` — WFS HTTP + CQL-bbox folding.
* ``parallel_download_and_process`` — cache + semaphore + per-row
  error funnelling, used by the 3 download clients (boring,
  interpretation, grain-size).

What's left duplicated is small-grained per-client wrapper
boilerplate: the WGS84→Lambert72 transform at entry, the bound
``_wfs_count`` / ``_wfs_features`` method pair on each client, and
the typed-row ``_build_row`` body (which CORRECTLY differs — each
WFS layer ships different properties).

**Why deferred.** The remaining duplication is mostly per-client
convention (different field constants, different skip-counter
warnings) rather than logic. A base class would have to model both
download flavours (with cache + parse callback) and WFS-only
flavours (sample / scalar), plus single-layer (boring, sample) and
multi-layer (interpretation × 8) variants. Net win is small.

**When.** When a 6th or 7th DOV WFS source lands (DMT / pressuremeter
/ monitoring) and the same WGS→Lambert + partial-binding plumbing
gets typed for a fourth time. At that point the abstraction shape is
obvious from a wider sample.

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
(``domain/services/robertson_2015.py``). The ``CptChart.tsx`` Ic
panel still shows the older Robertson **1990** preview
(``cpt_interpretation.py``, deliberately frozen). The two methods can
disagree at zone boundaries — a known, accepted divergence. Reconcile
when this item is actioned: repoint the chart panel at the 2015/2009
path so the whole app is consistent on Daniel's method (owner
decision 2026-05-17 — option "port 2015, switch chart later").

## 23. Stage toolbars clip silently at narrow window widths (low — Tier E)

**What.** `StageToolbar`'s left zone is `flex items-center flex-1
overflow-hidden`. The SectionsToolbar carries ~7 verb buttons (New /
Delete / Export DXF / Plaxis 3D / Build / Auto-populate / Dedupe);
DataToolbar and future stage toolbars are similar. Below roughly
900px window width the rightmost buttons are clipped with no scroll
and no overflow indicator — the same failure class as the original
debt #14 InterpretationPane action overflow that triggered the whole
shell rework.

**Why deferred.** At the Phase-4 target desktop widths (1280px+) all
verbs fit comfortably; the clip only triggers on a deliberately
narrow / split-screen Electron window. Fixing it well (a responsive
overflow-into-a-"More ▾"-menu, or horizontal scroll affordance, or a
`min-w-0` label-shrink budget) is its own focused piece, not worth
pre-building before a user actually hits it.

**When to revisit.** First time a real user reports clipped toolbar
buttons on a narrow window, OR when a stage toolbar gains enough
verbs that it overflows at typical widths. The fix shape is known
(overflow menu); the trigger is a real width complaint.

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

## 26. 3D viewer — blank basemap in offline mode (low — Tier E)

**What.** When no network is available, the Cesium tile layers in
``Geology3DViewer`` return 404 errors and the 3D canvas shows formation
surfaces against a blank black globe. The surfaces are still rendered
correctly (geometry and colours are local); only the geographic context
(road network, orthophoto, topo labels) is missing.

**Why deferred.** Implementing an auto-fallback to the 2D ``MapView``
on tile failure requires detecting all tile-provider failures and toggling
the canvas, adding state to ``GeologyCanvas`` that complicates the 3D/2D
decision path. For v1.0 the offline blank-globe case is documented as
known degradation — the engineer still sees the model geometry, which is
the primary use of the 3D view during offline fieldwork.

**When to revisit.** When a user reports confusion ("the 3D viewer is
broken, I see nothing") during on-site use without network. The fix shape:
detect the first tile-fetch failure via Cesium's imagery tile-error event
→ set a ``tileLoadFailed`` flag → ``GeologyCanvas`` renders ``<MapView>``
instead of ``<Geology3DViewer>`` → show a "No network — 3D view requires
internet access" toast. A simpler first step is a persistent help tooltip
on the viewer explaining the offline case.

## 28. Formation surfaces carry no interpolation-confidence signal (medium — Phase 5 model quality)

**What.** The TIN surfaces are an unconstrained Delaunay interpolation
over the contact points. Near the data-sparse boundary — the convex
hull edge, or any region far from a borehole/CPT contact — the surface
is pure extrapolation and frequently misbehaves: younger formations
dip below older ones, surfaces fan out into spikes, and the model
looks visibly "unsure" at the edges (observed while dogfeeding the
3D split view, 2026-05-16). The crossings validator (#18) flags WHERE
two surfaces cross, but nothing quantifies or *shows* that a vertex is
low-confidence because there is no nearby data — the edge artifact and
a genuine geological crossing look identical to the user.

**Why deferred.** A confidence signal is a model-quality feature, not
a v1.0 geometry/export gate deliverable. Doing it properly means: (a)
a per-vertex confidence metric (e.g. distance to nearest contact, or
local contact density / kriging variance once a non-TIN interpolator
lands), (b) persisting it alongside the surface vertices, (c) a render
treatment in the 3D viewer + section editor (fade / hatch / stipple
low-confidence regions so extrapolation reads differently from
data-backed surface), and (d) deciding whether to *clamp*
extrapolation past the hull rather than just flag it. The cleaner
metric (kriging variance) is naturally a Phase 5 deliverable since v1
enforces ``method=tin``; building a TIN-only distance heuristic now
risks being thrown away when the real interpolator arrives.

**When to revisit.** Phase 5, alongside the kriging / RBF interpolator
(the ``method`` query param already scaffolds for it) — variance falls
out of those methods for free. Pull earlier if a dogfeeding user
mistakes an edge extrapolation artifact for a real geological crossing
and acts on it, or if the v1.0 launch demo's model edges look
unprofessional enough to hurt the Flanders pitch — in that case ship
the cheap interim: a distance-to-nearest-contact heuristic driving a
fade on hull-edge triangles, explicitly labelled "low confidence —
no nearby data".

---

> The items below (#29–#50) were added by the 2026-05-16 six-agent
> codebase audit (senior-code-reviewer, system-architect,
> security-reviewer, staff-engineer, product-strategy-advisor, and
> ux-reviewer-as-general-purpose-proxy). They are in numeric order;
> their true priority is the five-tier list at the top of this file.

## 39. No batch borehole-detail endpoint — N parallel GETs on section open (Tier D — latent perf cliff)

**What.** `useSectionData.ts` fetches every in-buffer borehole via
`Promise.allSettled(ids.map(id => api.borehole.get(id)))`. Each
`GET /borehole/{id}` returns the full child tree (6 lab-test
families, ~12 `selectinload` queries) even though the section column
only needs header + observations. The CPT path already has
`POST /cpt/plot-batch`; the borehole path has no equivalent and no
`include=` filter on the section call. A dense corridor (50+
boreholes) is 50+ round-trips, each over-fetching lab data the
section never renders. The hook's own comment flags this.

**Why deferred.** Typical Phase-4 sections (10–30 boreholes) complete
before the user notices.

**When to revisit.** When a 50+-borehole corridor shows a >1 s load
during dogfeed. Two-part fix: (a) pass `include=` to drop lab trees
the section doesn't use; (b) add `POST /boreholes/detail-batch`
mirroring `plot-batch` — one query replaces N.

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

## 44. Cross-stage selection model is inconsistent with the spine metaphor (Tier D — product/interaction decision)

**What.** The Data → Geology → Sections → Geotechnical → Export spine
trains the user that a selected investigation persists across stages.
It doesn't: map-marquee + CPT/borehole selection live in the
coordinator bus but only DataInspector/DataCanvas consume them, and
`StageCanvas`'s `key={activeStageId}` unmounts the previous stage so
any in-progress marquee is discarded with no indication. A
gINT/LeapFrog user who marquee-selects "the holes I'm modelling" then
steps to the next stage expects that scope to carry; here it
evaporates.

**Why deferred.** The Geology "boreholes in model" toggles and the
section corridor are the actual v1 scoping mechanisms, so cross-stage
carry isn't functionally required — it's an expectation mismatch the
metaphor creates. Resolving it is a product-semantics call (does
selection mean "inspect" or "scope"?), not a bug fix.

**When to revisit.** When the Geotechnical (subdivision) stage is
built — that stage forces a concrete "which formations/units am I
working on" selection and therefore the cross-stage semantics
decision. Settle it there and document the chosen model in
docs/ux.md's selection section.

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

## 48. `project_bundle.py` procedural logger style — residual (Tier E; progress logging shipped 2026-05-17)

**What.** **Done (c6678e0):** `restore_project_bundle`'s CPT/borehole
loops now log phase-start + phase-summary INFO and per-row
`[i/total]` DEBUG, including what was SKIPPED and why (no-id payload /
already-present) — the DoD bulk-loop rule. A stuck 500-CPT restore is
no longer indistinguishable from a running one.

**Residual.** The ~880-line module still uses a module-level
`LoggerFactory.get_logger(__name__)` rather than the
`self.info()` `GroundModelLogger` convention. This is legitimate
(it's procedural, not a class) and purely a style-consistency gap —
the observability half that actually mattered is closed.

**Why deferred.** Wrapping the whole module in a
`ProjectBundleService(GroundModelLogger)` is a non-trivial refactor of
the `.gmproj`-contract critical path for zero behaviour gain — not
worth the regression surface blind.

**When to revisit.** Only if the module is being substantially
restructured for a functional reason anyway; fold the class-ification
into that change. Otherwise leave as-is — a working procedural logger
is not a defect.

## 52. PDF report export (Tier D — Phase 5 reporting deliverable)

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

## 53. `shellContextValue` dep array will silently drift as the coordinator grows (Tier E — latent correctness)

**What.** App.tsx's `shellContextValue` `useMemo` lists ~60 individual
bindings in its dependency array (it depends on individual stable
fields, NOT the hook-return objects, because most hooks return a fresh
object literal each render — depending on those would defeat the memo
and re-render every `useShell()` consumer every render). Every new
field added to any slice must be hand-added to this array. Omitting
one → the context serves a **stale value** for that field: a silent
app-wide correctness bug. It is invisible to the App smoke test
(catches mount crashes / TDZ), the filtered tsc gate (catches missing
*names*, not missing *deps*), and the unit suite (mocks the context).
The documented S7 infinite-render-loop incident lived in exactly this
class of dep-array hazard. Flagged by system-architect (R-plan
pushback #3).

**Net now EXISTS (2026-05-17).** The #12 net-first step shipped: the
memo is isolated in `hooks/useShellContextValue.ts` and
`hooks/useShellContextValue.test.tsx` (renderHook) pins T1 assembly /
T2 no-stale per-slice / T3 referential stability. The "invisible to
every check" part of this hazard is **solved** — the failure mode now
has a detector and a home. Severity drops accordingly.

**Residual (why still open, Tier E).** The dep array is still
hand-maintained. Adding a field to a slice now requires (1) adding
its dep to the verbatim array in `useShellContextValue.ts` AND (2)
extending the net's T2 with a case for it — the net only catches
omission of fields it explicitly exercises. The deeper architect fix
(restructure to depend on hook-return objects) stays deferred: only
safe if EVERY contributing hook memoises its return (several don't;
adding `useMemo` changes identity for every consumer) — a
behaviour-change not worth the surface pre-revenue while the array is
correct and now netted.

**When to revisit.** First time a coordinator/slice field is added
without a matching T2 case and a "stale after I changed X" bug slips
(now far less likely), OR when the hook-return-identity audit becomes
worthwhile (the restructure). Trigger to escalate out of Tier E:
unchanged — any session adding >2 new fields to the coordinator slice
should also extend the net + audit the dep array.


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

## 60. Consolidate `_seed_section_contacts` into CrossSectionRepository (Tier E — DRY/layer)

**What.** The seeded-set union helper now exists in THREE places: the
module-level `_seed_section_contacts` in `api/routers/geology/contacts.py`
(used by create-201, dedup-409, seed-from-parent) and a re-implemented
copy on `ExtrapolatePinchOut` (the application layer can't import the
router's). Senior-review S1 of the pinch-out slice (2026-05-18) flagged
this as past the extract-on-second-copy threshold.

**Why deferred.** It works correctly in isolation; consolidating means
moving the logic (incl. the non-fatal rollback-on-fail semantics) onto
`CrossSectionRepository` as `async def union_seeded_contact_ids(...)`
and repointing 4 call sites. Doing that blind at the tail of an already
very large pinch-out session risked breaking the seed/dedup paths
without room to re-verify; it is not a correctness blocker.

**When to revisit.** Next time any seed-path code is touched, or a 4th
call site appears — fold the consolidation into that change.

---

## 61. No end-to-end test of the pinch-out endpoint / idempotent path (Tier E — test gap)

**What.** The pinch-out slice's pure crossing geometry is exhaustively
unit-tested (`tests/unit/domain/test_pinch_out_geometry.py`, 11 cases
incl. the B1 last-endpoint regression) and the synthetic-anchor
RecomputeFormationSurface branch + migrated XOR constraint are
integration-tested (`tests/integration/api/test_pinch_out_synthetic_contacts.py`).
But the `ExtrapolatePinchOut` orchestration use case and the
`POST .../contacts/pinch-out` endpoint — including the senior-review
B2/B3 idempotent-path fixes (seed-on-409, stored-geometry reporting) —
have no direct end-to-end test.

**Why deferred.** A faithful test needs the heavy fixture chain (a
section + two formations with built TINs whose slices make
`compute_pinch_tip` succeed). The B2/B3 fixes were implemented exactly
to the senior-review spec and are small/reviewed; the documented
project boundary (CLAUDE.md #38) already integration-tests
orchestration use cases rather than mock-forcing them. Writing a
rushed flaky fixture at the session tail was the worse risk.

**When to revisit.** Before the pinch-out frontend ghost-UX slice
ships (that slice will need the endpoint exercised anyway) — add one
integration test that drives the endpoint end-to-end and re-invokes it
to assert the 409 + section-seed + stored-geometry contract.

---

## 62. Pinch-out ghost-UX follow-ups (Tier E — post-slice review residue)

The pinch-out ghost-UX slice shipped 2026-05-18; senior + ux review
blockers were all fixed (stale-ghost-on-section-switch, 409 local-state
refresh, role/Esc/focus a11y, no-blank-overlay, loading flash, dark
mode, no-undo legibility, panel position, context-menu double-close).
Three reviewer items were deliberately deferred:

**What.**
1. **`window.confirm` for contact delete** (`ContactsLayer.tsx`) — the
   pre-existing delete gate is an OS-native `window.confirm`, which
   violates `docs/ux.md §Destructive actions` (can't default-focus
   Cancel, can't name the button "Delete contact"). Not introduced by
   this slice, but the new context menu surfaces it to more users.
   Replace with the project's styled confirm pattern (same shape as
   `PinchOutConfirmPanel`).
2. **Pinch-out direction is hardcoded `'right'`** (`SectionsCanvas.tsx`)
   — no UI affordance/override. A formation terminating on the west
   (left) side, or a right-to-left-drawn section, gets an opaque 422.
   v1-min: auto-retry the opposite direction on a direction-inconsistent
   422 before surfacing the error; full target+direction picker before
   the dry-run is the post-v1 enhancement (the code comment notes this).
3. **`PinchOutResult` returns `CrossSectionOrm`** (infra type) into the
   application layer — pre-existing pattern across seed/auto-populate
   use cases; refactor `updated_section` to a dict/domain type and
   serialise inside the use case.

**Why deferred.** None are correctness blockers; (1) and (3) are
pre-existing and out of this slice's scope; (2) is self-correcting via
the backend 422 (just opaque). Fixing them at the session tail risked
unreviewed churn across already-large changes.

**When to revisit.** (1) next time the section context-menu / delete
flow is touched; (2) the first time a real Gavere section pinches west
or is drawn R→L (dogfeed will surface it fast); (3) the next
seed/auto-populate refactor — fix all the ORM-leaking results together.

## 63. Desktop tsc gate absent — ~20 standing pre-existing errors, no pre-commit check (Tier E — code quality / safety net)

**What.** `npx tsc --noEmit -p tsconfig.web.json` currently emits ~20 errors
(Electron namespace, `PickAndOpenResult` return type, `SetStateAction` mismatch,
scattered test-fixture type gaps). None are in hot-path renderer code today,
but the project has no `tsc` step in `.githooks/pre-commit` — so new type
errors introduced by refactors are invisible until a developer runs tsc manually
or a runtime crash surfaces them. The memory file `feedback_desktop_tsc_gap.md`
documents this gap; it was first noted during the #12 App.tsx split.

**Why deferred.** Clearing the backlog requires touching several files that are
on the boundary of ongoing litho-slice work (#55) and the pinch-out ghost-UX
(#62). Fixing them now would create noise-commits mid-feature and add a hook
step that fails until every pre-existing error is gone. The risk is low: the
affected lines are type-widening mismatches in test fixtures, not production
logic. The TDZ and missing-namespace errors are in App.tsx, which already has
its own smoke test.

**When to revisit.** Before the first external (coworker/paid) distribution
(ties to debt #3 / backwards-compat re-arm trigger). At that moment:
(1) drive `tsc --noEmit` to zero errors — start with the 5 App.tsx errors
(Electron namespace + return-type widening), then the test-fixture synthetic_x
gaps, then the CptChart comparison dead-code; (2) add `npx tsc --noEmit -p
tsconfig.web.json` to `.githooks/pre-commit` alongside the existing vitest
step; (3) document the node version requirement in the hook comment (Node 22
LTS; Node 24 segfaults vitest — see memory `project_node_22_pin.md`).

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

## 65. Litho borehole scope toggles absent — no litho crossings validator (Tier E)

**What.** The Lithology stage inspector has no "excluded boreholes"
UI (the litho model's `excluded_borehole_ids` is set only via
the backend, never surfaced). There is also no litho-specific
crossings validator (the geology crossings banner lives in
`useCrossingsValidation`, keyed on the geological model — it is
not wired for the litho model). As a result, litho surface
crossings are silently undetected.

**Why deferred.** The litho inspector is deliberately read-only
at v1.0 (formations are project-scoped shared vocabulary;
CRUD stays in GeologyInspector). The crossings validator can be
extended later with a `modelId` parameter and the same hook
reused — but there is no UI surface to trigger it on today's
Lithology stage inspector.

**When to revisit.** When the litho inspector gains an
exclusion-toggle or when the first dogfeed session surfaces
a silent litho surface crossing as a confusing artefact.

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
