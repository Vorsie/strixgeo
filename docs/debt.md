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
* **C. Current work — dogfeed correctness / velocity / friction (pre-external-users, 2026-05-16 re-tier):** #41 (Geology3DViewer untested + pure-helper extract — now stands alone; #12 closed so it's no longer folded) *(#12, #36, #37, #38, #40, #43, #51 resolved 2026-05-16/17 — #12 resolved on substantive completion + revised DoD: App.tsx 3,200→833, the dangerous shellContextValue memo isolated + netted, Sidebar gone; strict `<400` de-scoped as low-value coordinator-pattern churn — see #53 for the residual dep-array tracking)* *(launch-demo blockers #29–#35 all cleared 2026-05-16; bundling/commercial Tier B deferred — owner directive: app not feature-ready for packaging. This tier front-loads a data-loss landmine + the velocity-multiplier test/refactor work that gates the UI-rework / geotech-model / parametrisation roadmap, then the cheap dogfeed-friction fixes.)*
* **D. Post-launch / Phase 5:** #11, #13, #28, #39, #44, #52
* **E. Lower technical debt:** #15, #16, #17, #18, #19, #20, #21, #22, #23, #26, #27, #42, #45, #46, #48, #49, #50, #53

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
fixed; DataInspector adoption is the residual — #45 stays open).
**#48 progress-logging shipped 2026-05-17** (restore loops now have
[i/total] DEBUG + phase summaries; only the cosmetic procedural-logger
style remains — #48 stays open, rescoped). 29 open items**) compact
them. Commit messages and code comments written
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

## 17. Backfill `dov_permkey` for legacy rows (low)

**What.** Refresh-on-duplicate (resolved in an earlier PR) keys
per-row dedup on `dov_permkey`. Children stored before that PR landed have
`dov_permkey = NULL` and don't participate in dedup, so the first
re-import of a previously-imported bbox creates duplicate observation
/ sample / lab-test rows for those legacy boreholes.

**Why deferred.** Solo-dev wiped the DB on 2026-05-10, so all
locally-stored data is post-PR and has permkeys. The trade-off only
bites when a non-solo user receives the migration on top of an
existing dataset.

**When.** Before any non-solo user inherits an existing DB. The fix
shape is well-defined: a one-off backfill that walks
`observation` / `sample` / 6 lab-test families, derives the
`dov_permkey` from a re-fetch of the parent's source XML or WFS row,
and stamps the column. ~Half a day of work plus a careful run.

## 18. Crossings validator — suppress / qualify when surfaces are stale (low — UX consistency)

**What.** The crossings validator runs against the cached TIN.
Post on-click build pivot, the cache can be stale during iterative
editing (per-contact mutations only flip ``is_stale=True``;
Delaunay only re-runs on Build). The banner ("N surface crossings
detected") was a confident statement; commit 43f3864 added an
"as of last build — click Build to refresh" suffix when stale,
which is the short-term honesty fix.

The longer-term option is to suppress the validator fetch entirely
when ``staleSurfaceCount > 0`` and instead show "Build the model
to validate crossings." That is cleaner UX (no qualified amber
warnings about possibly-out-of-date geometry) but requires:

* Threading ``staleSurfaceCount`` into the crossings useEffect so
  the fetch is gated on freshness.
* A second banner state ("validation pending build") with its own
  copy + visual.
* Re-running the fetch automatically on the rebuild-success
  callback.

**Why deferred.** The suffix is sufficient for v1 — engineers
know "as of last build" means "click Build to refresh." Cost of
the cleaner UX is non-trivial (state management + new banner
state) for a marginal clarity win.

**When to revisit.** First time a real user reports being misled
by the qualified banner ("I rebuilt and the crossing went away
— was the warning real?"), or when the crossings validator gets
extended with more issue kinds where staleness matters more.

## 19. Bundle vertices / triangles size cap (low — coworker-distribution trigger)

**What.** ``restore_project_bundle`` deserialises FormationSurface
JSONB ``vertices`` and ``triangles`` blobs straight from the .strix
file with no upper bound. SQLAlchemy passes them to PostgreSQL's
JSONB serialiser which accepts arbitrarily large arrays. At v1
cardinality (typical TIN: a few KB) this is a non-issue, but a
malicious or accidentally-oversized bundle could OOM the asyncio
process or balloon the DB row size.

**Why deferred.** Today's distribution path is single-user local
(the user crafted the bundle on their own machine). The fallout
of a malformed bundle is "I can't open my own file", not RCE or
data theft. Acceptable for v1.

**When to revisit.** When the coworker-distribution path lands
(see ``project_coworker_distribution.md`` memory). At that point
the bundle source is no longer fully trusted. Add upper-bound
checks at the restore boundary:

* ``source_contact_count`` > 50_000 → reject the surface (force
  is_stale=True, skip vertices/triangles restore).
* ``len(vertices)`` and ``len(triangles)`` capped at e.g. 200_000
  each (covers any realistic Phase 5 kriging surface comfortably).
* Total bundle size pre-parse cap (electron preload's
  read-file path can enforce this once before the API ever sees
  the payload).

Folds into debt #5 (tamper hardening) — same trigger, same
review pass.

## 20. Translate ``ScalarLabTest.parameter`` storage (low)

**What.** 671 rows already store the verbatim DOV string
``"Korrelvolumemassa (korrelvolumemassa)"`` etc. If DOV changes their
inconsistent doubled-tail convention again, we'd need to migrate all
rows. A separate ``parameter_slug`` column with a canonical short
name (derived at ingest from a curated map) would help reporting and
make the storage column independent of upstream tweaks.

**When.** When a query against ``scalar_lab_test`` is added that
filters by parameter — at that point the slug becomes load-bearing.

## 21. Elevation provenance — rollback column (low, residual)

**What landed.** ``elevation_source`` enum
``{dov, gef, manual, none}`` now lives on ``cpt`` and ``borehole``.
``set_elevation`` stamps ``MANUAL``; ``ImportCpt`` /
``ImportCptDov`` / ``ImportBoreholeDov`` stamp ``GEF`` / ``DOV``
/ ``NONE`` on initial insert. The column round-trips through the
.strix bundle. The desktop ``ElevationEditor`` renders a tiny
"(DOV)" / "(GEF)" / "(manual)" tag next to the Z value.

**What's open.** The optional ``elevation_m_source`` second column
that holds the ORIGINAL upstream value so "Clear" can restore it
instead of nulling the row. Today's Clear flow returns the row to
the "no Z known" state, which is fine for a first paid release but
doesn't undo a typo gracefully.

**Why low priority.** The trigger condition for the rollback
column hasn't fired yet — DOV is mono-source today, and the
refresh-on-duplicate path still doesn't update parent columns
(it only refreshes children). When the refresh-parent rule lands
(needed when DOV publishes a corrected Z and we want to surface
it without clobbering manual edits), that's the moment to add
the rollback column at the same time.

**When to revisit.** Pair with the refresh-on-duplicate-of-parent
work; that's when consulting ``elevation_source`` actually starts
to skip overwrites, and the rollback column closes the user-side
asymmetry.

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

## 42. Multi-class files violate the one-class-per-file convention (Tier E)

**What.** CLAUDE.md "Code Conventions" requires one class per file
(only `shared/exceptions.py` exempt). Offenders:
`api/schemas/project/formation_contact.py` (17 schema classes in one
~355-line file — every geology endpoint grows it, every import pulls
the whole module), `domain/services/tin_surface.py` (4 value
objects + 3 functions + a logger, with a hard numpy/scipy import at
module load), `domain/services/geology_validator.py` (3 classes).
The `tin_surface` value objects (`ContactPoint3D`, `TinSurface`,
`SectionLine2D`, `SlicePoint`) are domain types imported by the
application layer and belong under `domain/value_objects/`.

**Why deferred.** Pre-existing groupings from when each subsystem was
first sketched and the class counts were small.

**When to revisit.** Before the first non-solo contributor
(readability gates onboarding), or when the Phase-5 kriging/RBF
interpolator gives `tin_surface.py` a second compute path. Split
`formation_contact.py` first (it grows fastest); then the
`tin_surface` value objects into `domain/value_objects/`.

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

## 45. Shell empty / loading states — DataInspector adoption residual (Tier E — partial; primitive shipped 2026-05-17)

**What.** **Done (f7e79e5):** the shared `shell/EmptyState.tsx`
primitive was extracted from the GeologyCanvas template — `EmptyState`
(40 px muted icon + title + optional hint + CTA slot) and
`LoadingState` (spinner + label + `role=status`). The two clearest
offenders the debt called out are fixed: `GeotechnicalCanvas` (was a
bare "coming soon" line — on camera for the launch demo) is now a
guided placeholder, and `DataCanvas`'s two bare "Loading …" strings
now spin. `ExportCanvas` was already fixed when #30 shipped.

**Residual.** `DataInspector`'s text-only empty states still don't use
the primitive — a mechanical adoption (swap the inline centred-text
divs for `<EmptyState>`), deferred only because DataInspector is the
daily-driver panel and a focused diff there wants its own pass rather
than riding an extraction commit.

**Why deferred.** Purely cosmetic and the hard part (the shared
primitive + the on-camera placeholder) is done; the remaining site is
low-risk but touches the most-used panel.

**When to revisit.** Next time DataInspector is opened for any other
change, or before the launch-demo recording. Fix: replace its
text-only empties with `<EmptyState icon title hint>` (icon TBD per
tab — e.g. `MousePointerClick` for "select an investigation").

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

---

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
