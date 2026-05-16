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
* **C. Current Phase 4 friction / launch-demo blockers:** *(none open — #29/#30/#31/#32/#33/#34/#35 all resolved 2026-05-16)*
* **D. Post-launch / Phase 5:** #11, #12, #13, #36, #37, #38, #39, #44, #43, #52
* **E. Lower technical debt:** #15, #16, #17, #18, #19, #20, #21, #22, #23, #26, #27, #28, #40, #41, #42, #45, #46, #48, #49, #50, #51

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
transaction), #35 resolved (pinned_order survives Build). **Tier C
fully cleared.** 38 open items**) compact
them. Commit messages and code comments written before a cleanup
pass continue to reference the OLD numbers — that's an unavoidable
cost of the renumber. Sections #2–#28 below remain in their prior
numeric order; #29+ are appended in numeric order — read the
five-tier list above for true priority.

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

## 12. App.tsx → custom hooks split (medium — smoke-test landed 2026-05-14, split deferred)

**What landed.** ``App.smoke.test.tsx`` mounts ``<App />`` with stubs
for window.electron + the full api.* surface + a console.error spy.
Catches TDZ ReferenceErrors, missing-global crashes, and hook-
ordering regressions on mount. Verified to fail on a deliberate TDZ
probe in App.tsx at line 210 before the test shipped.

**What's still open.** App.tsx is ~3,200 lines and still grows on
every Phase 4 step. The smoke test catches CRASH-shaped regressions
but cannot stop the file from becoming unreadable. The escalation
plan is to split into custom hooks once the trigger condition fires:

* Extract ``useGeologicalModel`` — owns ``surfacesByFormationId``,
  ``formationsRefreshCounter``, ``crossingsRefreshCounter``,
  ``activeGeologicalModel``, ``staleSurfaceCount``, and the
  ``saveProject`` auto-build sequence (the tightest cohesive
  cluster the latest TDZ exposed).
* Extract ``useProjectLifecycle`` — owns ``saveProject``,
  ``openProject``, ``closeProject``, ``recentProjects``.
* Leave App.tsx as the coordinator that renders, not the place
  that computes.

**Why deferred.** Restructuring 3,200 lines is a multi-day refactor
with its own bug surface, and the smoke test now blocks the failure
mode (TDZ crashes) that motivated urgency. Pre-trigger refactoring
on solo-dev intuition is exactly the speculative work the project
rules call out.

**When to revisit.** Any of these triggers fire:

* A fourth TDZ-class crash slips past the smoke test (smoke test
  alone insufficient → the file's complexity is now eating tests too).
* A new contributor (or a future Claude session) can no longer
  trace a ``saveProject``-shaped flow in one read.
* Before the first paid release — readability gates support burden.

**Progress (2026-05-15) — S2 landed, not yet resolved.** The trigger
fired (the UI-shell rework needs a shell on top of App.tsx — see
``docs/ui-shell-architecture.md``). Phase **S2** extracted 8 custom
hooks (``useToasts``, ``useAppBoot``, ``useMapOverlays``,
``useGeologicalModel``, ``useSections``, ``useInvestigationData``,
``useProjectLifecycle``, ``useMapState``); App.tsx went ~2,200 → 979
lines. The 979 (vs the architecture doc's ~200–300 estimate) is
~390 lines of JSX render tree — render extraction is **S3** (stage
components), not S2. A senior-code-reviewer pass caught + fixed two
behaviour regressions the green suite missed (dropped
``onMenuImportCpt`` subscription; lost session-import trim on
formation delete). **Resolve this item only when S7 completes**
(App.tsx reduced to the shell coordinator); until then it stays open
with S3–S7 outstanding.

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

## 36. `excluded_borehole_ids` is ignored by TIN recompute (Tier D — view/surface divergence)

**What.** `GeologicalModel.excluded_borehole_ids` is applied at
section projection time (`BuildSectionSnapshot` filters
investigations) but NOT at TIN recompute time —
`RecomputeFormationSurface` loads all contacts for `(model_id,
formation_id)` without filtering excluded anchors. An excluded
borehole that still carries contacts contributes its (x, y, z) point
to the surface, so the TIN disagrees with what the section view
shows.

**Why deferred.** The exclusion list is Phase-4 scaffolding the UI
doesn't strongly expose yet; in practice a user wouldn't place
contacts on a borehole they then exclude, so the inconsistency is
latent, not observed.

**When to revisit.** When the section editor's per-investigation
show/hide is wired to `excluded_borehole_ids` and the user can flip
exclusion after contacts exist. Fix: add the exclusion filter to the
`RecomputeFormationSurface` contact query (one WHERE clause; decide
skip-vs-delete for existing excluded-anchor contacts).

## 37. `delete_model` cascade destroys all project formations; single-model invariant unenforced (Tier D — pre-Phase-5 landmine)

**What.** `GeologicalFormation` rows are project-scoped with no model
FK (correct for shared Phase-5 vocabulary). `delete_model` deletes
all formations for the project before deleting the model, justified
by an "exactly one model per project" assumption that lives only as a
code comment — nothing in the API or DB enforces it, and nothing
prevents creating a second model. If a second model ever exists,
deleting one silently wipes every formation in the project.

**Why deferred.** Multi-model is a Phase-5 concept; v1 UI creates
exactly one and exposes no Delete-model button, so the risk is
contained today.

**When to revisit.** Before any surface that allows a second model
(UI or scripted API), and before Phase-5 multi-model work *starts*
(not during). Fix shape (already in the repo comment): make the
cascade model-aware — delete only formations exclusively owned by the
target model — or add a junction table for model membership.

## 38. Geology contact-mutation use cases have no unit-test coverage (Tier D — pre-commit blind to the hottest write path)

**What.** `CreateFormationContact`, `UpdateFormationContact`,
`DeleteFormationContact`, `DeduplicateFormationContacts`,
`RebuildModelSurfaces`, `ValidateModelCrossings`,
`BuildSectionSnapshot`, `BuildGroundModelSnapshot` have no unit
tests — only integration tests that need a live Postgres and so do
NOT run in the pre-commit hook (`pytest tests/unit -q`). This is the
highest-frequency write path in the Phase-4 MVP with the most domain
logic (XOR anchor check, `DuplicateContactError`, stale-flag
propagation, checksum short-circuit, `projected_by_id` filter). A
regression here passes the unit suite silently. Flagged by two audit
agents independently; DoD §4 requires this coverage.

**Why deferred.** All depend on a real `AsyncSession`; the repository
isn't behind a Protocol/ABC, making mock-based unit tests awkward —
not worth the refactor mid-build.

**When to revisit.** Before any non-solo user can mutate contacts.
Fix: introduce a `GeologyRepositoryProtocol` (structural `Protocol`)
so tests pass an `AsyncMock`; cover `DuplicateContactError`, the
stale-pair set, dedup determinism, and the snapshot contact filter.

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

## 40. `api/routers/geology.py` is a ~1,100-line orchestration monolith (Tier E)

**What.** One router file covers formations, geotechnical units,
models, contacts (CRUD + batch), surface rebuild, gap/crossing
validation, ground-surface build, and Plaxis-3D export — the
API-layer analogue of pre-S2 App.tsx. Any new geology operation
(Plaxis 2D #29, G3Dv3 seed, per-unit contacts) has the whole file as
blast radius. `build_ground_surface` alone is ~122 lines of
error-mapping + provider-factory wiring that belongs in an
application use case, not a route handler.

**Why deferred.** Splitting it (sub-routers for formations / models /
contacts / surfaces / exports) carries real merge-conflict risk
during active Phase-4 feature work.

**When to revisit.** When a Phase-5 op would push it past ~1,400
lines, or on the first merge conflict from two sessions touching
different parts. Split into `api/routers/geology/{formations,models,
contacts,surfaces,exports}.py` mounted on a shared `APIRouter`.

## 41. `Geology3DViewer.tsx` (~1,740 lines) is untested; pure geometry helpers not extracted (Tier E)

**What.** The largest single component in the codebase, growing every
Phase-4 step, with zero test coverage (Cesium needs WebGL so it can't
be unit-mocked). But `flyToBounds` / `flyToCutFace` /
`buildFormationPrimitive` / `buildBasemapLid` contain pure-ish
coordinate math (midpoint, normal, camera-direction vectors) that is
extractable into a `cesiumGeometry.ts` helper vitest *can* reach, and
the two-click split-line state machine is pure local state, also
testable. The recent `flyToCutFace` ReferenceError fix (585c714) is
exactly the class of bug a smoke test would have caught.

**Why deferred.** Rendering-level tests need a headless-WebGL harness
(separate tooling investment); accepted no coverage during the
Phase-4 sprint.

**When to revisit.** Before Phase 5 or first external release. Fix:
(a) extract the pure helpers into `cesiumGeometry.ts`; (b) add a
`Geology3DViewer.test.tsx` smoke test stubbing the widget to null
(the viewer already guards every effect on `widgetRef.current ==
null`).

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

## 43. Esc no longer closes the inspector / canvas detail views (Tier D — shell-rework keyboard regression)

**What.** docs/ux.md makes Esc the global "close detail panel" key
and requires detail-panel close on "X OR Esc". After the S2–S7 shell
rework, the right Inspector toggles only via the StageToolbar button
(`onToggleInspector`) and `useShellState` registers no `keydown`
listener; selecting a CPT/borehole swaps the canvas to a chart/log
with no Esc-to-return. Modals and bbox/section draw still honour Esc;
the inspector and canvas detail views regressed. A gINT/Plaxis user
reflexively hits Esc to back out and nothing happens.

**Why deferred.** Not a data/destructive defect — every view is still
mouse-dismissible. A correct global Esc that peels one layer at a
time across five stages without colliding with the section editor's
existing per-layer Esc peel is a focused interaction-design pass, not
a one-liner.

**When to revisit.** When the shared `hooks/useGlobalShortcut.ts`
extraction (already flagged ripe in docs/ux.md via the
`isTypingTarget` fourth-copy trigger) lands — fold the shell-level
Esc peel order into that one ordered handler.

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

## 45. Shell empty / loading states are below the documented bar (Tier E)

**What.** docs/ux.md: "Empty states — text + icon (Lucide), never
just blank"; async needs an in-element spinner. Violations:
`DataInspector` empty states are text-only; `DataCanvas` loading
fallbacks are bare "Loading chart…" strings with no spinner;
`GeotechnicalCanvas` is a single muted "coming soon" line with no
icon or guidance (`ExportCanvas` was fixed when #30 shipped — it now
follows the icon + actionable-card pattern). GeologyCanvas's empty state
(Mountain icon + actionable guidance) is the one that does it right
and should be the template — the inconsistency reads as unfinished
against the LeapFrog/Plaxis polish the product sells on.

**Why deferred.** Purely cosmetic — every state is functionally
correct, just under-guided. Fixing it well means a shared
`<EmptyState icon title hint>` primitive across ~6 sites (the
rule-of-three is already met), its own focused pass.

**When to revisit.** When the shared `EmptyState` primitive is
extracted (DataInspector ↔ canvas-fallback duplication already meets
rule-of-three), or before the launch-demo recording — bare "coming
soon" canvases on camera undercut the polish narrative.

## 46. Long-running stage verbs lack an in-button spinner (Tier E)

**What.** "Fill from boreholes" / "Seed" / "Dedupe" / Plaxis-3D
export are multi-second server round-trips whose only feedback is a
label swap + `disabled`. Only "Build model" shows a spinner
(`RefreshCw animate-spin`); the rest freeze their label with no
motion, so on a slow network the engineer can't tell working from
hung. docs/ux.md requires disable + in-button spinner for async
triggers; only Build honours the spinner half.

**Why deferred.** Disable + relabel does prevent double-submit and
does say "working" — a sub-spec affordance, not a missing one.

**When to revisit.** Fold into the `shell/ToolbarPrimitives.tsx`
extraction GeologyToolbar's header comment already schedules for the
Export-stage toolbar (copy 3) — add a spinner slot to the shared
primitive so every long verb gets it for free.

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

## 48. `project_bundle.py` procedural logger + no restore-progress logging (Tier E)

**What.** The ~860-line bundle module uses a module-level
`LoggerFactory.get_logger(__name__)` (legitimate — it's procedural,
not a class) but the call style diverges from the `self.info()`
`GroundModelLogger` convention used everywhere else, and
`restore_project_bundle` has no `[i/total]` progress logging in the
CPT/borehole restore loops. A 500-CPT restore today produces no
per-row log, so a stuck restore is indistinguishable from a running
one — exactly the DoD bulk-loop logging rule.

**Why deferred.** The logger works; it's a consistency + observability
gap, not a correctness one.

**When to revisit.** Next time `restore_project_bundle` is touched
for any functional reason — wrap it in a
`ProjectBundleService(GroundModelLogger)` and add `[i/total]`
progress to the CPT/borehole loops in the same change.

## 49. Crossings validator issues N queries per formation (Tier E)

**What.** `ValidateModelCrossings.execute` loops over `formation_ids`
calling `repo.list_contacts(model_id, formation_id=fid)` once per
formation (the code comment claims "all formations at once" — it
isn't). N formations → N+2 round-trips. Invisible at v1 (~10
formations, <5 ms) but the validator polls after every contact edit,
so a Phase-5 model with 20+ formations stalls the crossings banner
during active editing.

**Why deferred.** Read-only, non-blocking, sub-5 ms at current
cardinality; the misleading comment is the only immediate harm (fixed
as a quick-fix, see below).

**When to revisit.** When the crossings banner is reported slow on a
15+-formation model during active editing. Fix is also a
simplification: one `list_contacts(model_id)` (no formation filter)
+ Python grouping — one round-trip, less code.

## 50. Virtuele Boring model code reaches an outbound URL without a codelist gate (Tier E — security, low; pairs with #4)

**What.** `GET /projects/{pid}/virtuele-boring/predictions?models=…`
splits the comma-separated `models` param and embeds each raw element
into the outbound DOV URL path (`virtuele_boring_client.py`:
`f"{BASE}{PATH}/{model}"`) with no regex/codelist gate. The API caps
the count (12) but not each code's length or charset. httpx
URL-normalises traversal so this is not RCE; the real issue is an
arbitrary user string in a backend-issued HTTP request — server
probing / behaviour-sensitivity if a proxy is ever interposed. Real
attacker surface is small (localhost-only API, CORS+TrustedHost block
external callers, target is an HTTPS government WCS) but it
contradicts the project's own injection-defence posture.

**Why deferred.** CORS + TrustedHost limit callers to the renderer
and a local dev; exploitation needs a compromised renderer or a
deliberate local curl. No regression in the 2026-05-13 audited
surfaces.

**When to revisit.** With the #4 auth-threading work, or when the
catalogue endpoint is cached server-side. Fix is a two-liner:
`VALID_MODEL_CODE_RE = re.compile(r'^[A-Za-z0-9_.\-]{1,50}$')` and a
400 on any non-matching code before fan-out.

## 51. Inspector chrome still on raw Tailwind palette, not semantic tokens (Tier E)

**What.** After the #24 Modal migration, ~49 raw-palette occurrences
remain across 9 shell-stage files — concentrated in GeologyInspector
(~21: formation rows, "Boreholes in model", crossings banner use
`text-gray-*` / `bg-gray-50` / `border-amber-300`) and DataInspector
(~11: bulk-remove bar uses `bg-red-600` / `bg-blue-50`). On the dark
inspector surface these are low-contrast — the same class as the
already-fixed Sidebar gray-800 bug — while their migrated siblings
render correctly, so the inspectors look half-themed. Found during
the 2026-05-16 audit; de-scoped from that pass's quick-fix batch
because a 49-spot migration is a focused refactor, not a slip-in.

**Why deferred.** Functionally readable in both themes; it is a
contrast/consistency polish gap, not a correctness or
destructive-action defect. Doing it right is one disciplined pass
mapping every raw class to its `surface-*` / `text-*` / `status-*`
token and verifying each inspector in both themes — its own change +
ux-review, exactly like #24 was.

**When to revisit.** Next dark-mode polish pass, or first time the
half-themed inspector is reported jarring during dogfeeding. Fix
shape: `text-gray-*` → `text-text-{primary,secondary,muted}`,
`bg-gray-50` → `bg-surface-subtle`, `bg-red-600`/`text-red-*` →
`status-danger`, `border-amber-300` → the amber-unsaved token; then
verify GeologyInspector + DataInspector + the 7 other flagged files
in light and dark. Pairs naturally with the deferred leaf dark-mode
token migration.

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
