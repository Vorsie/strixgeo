# Known Architectural Debt

Items that need a focused session — bigger than a quick fix, smaller
than a phase. Tracked here so each one is visible in PR / commit
context without rediscovering it from grep. **Order is strict
priority — top is highest, bottom is lowest. Tiers are grouped, but
within each tier the order also matters.**

Five tiers:

* **A. Phase 4 engineering blockers** *(none open — #1 resolved 2026-05-14)*
* **B. Commercial launch gates — pre-paid-revenue** (#2–#7)
* **C. Dogfooding asks — current Phase 4 friction** (#9–#10; #8 resolved 2026-05-14)
* **D. Post-launch / Phase 5** (#11–#14)
* **E. Lower technical debt** (#15–#21)

When an item is resolved, **delete it from this list** — its
implementation history lives in the relevant commit on ``develop``,
not here. Numbers stay stable through a debt-fixing campaign (do
not renumber after each fix); explicit cleanup passes (last done
**2026-05-14, renumbered + priority-sorted, 21 open items**)
compact them. Commit messages and code comments written before a
cleanup pass continue to reference the OLD numbers — that's an
unavoidable cost of the renumber.

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
Docker Compose.

**When to revisit.** Before approaching the first 5 validation
engineers. Build a one-off prototype on a clean Windows machine
without Docker. If the bundled path is fragile, the SQLite +
SpatiaLite fallback (already called out in CLAUDE.md) becomes the
real plan and is a non-trivial refactor. The decision belongs
ahead of the first beta install.

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

## 9. Crossings banner — surface offending contacts + jump-to-section (medium — dogfooding ask 2026-05-14)

**What.** Today's crossings banner reports
"Younger 'Antropogeen' sits below older 'Boom Klei' by 3.2 m"
in plain text. The user has to mentally translate that to
"which boreholes? which depths? which contacts to fix?" and
hunt them down in the section view themselves. Each issue should
expose:

* The list of OFFENDING contact rows (the specific picks where
  the crossing was detected — vertices of one TIN that sat below
  the other's interpolated elevation).
* A click target that opens the relevant cross-section, scrolls
  to the borehole/CPT column carrying the contact, and highlights
  it visually (selection ring + amber pulse).

**Why deferred.** Today's `validate_no_crossings` records
``formation_ids`` (the offending pair) but NOT contact_ids of the
specific picks that triggered the violation. Adding that requires:

* Track the contact_id of each TIN vertex (currently the cache
  carries (x, y, elevation) but no provenance pointer to the
  contact that produced it). Either thread contact_id through
  ContactPoint3D → TinSurface vertices, or post-detect via a
  reverse-lookup (find contacts at this (x, y) on this formation).
* Extend GapIssue with ``contact_ids: tuple[UUID, ...]`` for the
  crossing kind (already supported per the value-object shape).
* Frontend: clickable banner items that drive a "focus contact"
  intent into App.tsx, which in turn picks the section that
  contains the contact's anchor (or creates one if none exists)
  and dispatches a scroll/highlight action to ContactsLayer.

**Wins beyond UX clarity:** dovetails with debt #8 (undo/redo)
and the resolved selection-toolbox anchor at the bottom of this
file — same "highlight a contact in the section view" primitive
could be the underlying intent for both.

**When to revisit.** Pair with the "selection toolbox" follow-on
work (the resolved anchor at the bottom of this file lists open
follow-ups) — they share the section-jump-and-highlight
infrastructure. Or after the first real user reports being unable
to find the offending contact without trial-and-error in the
section view.

## 10. Virtuele Boring API as formation prior for CPT-only projects (medium — dogfooding ask 2026-05-14)

**What.** DOV exposes a REST API at
``services.dov.vlaanderen.be/virtueleboringserver/base/lagenmodel/g3dv3_F/profielbevraging/lagen``
that returns the expected G3Dv3 formation stack at any (x, y) in
Flanders, derived from the same 3D model whose unit table we
ship as a static codelist. Wire it as a Phase 4+ fallback that
seeds candidate formation contacts when a project has CPTs only
and no boreholes with formal stratigraphic interpretations —
giving the engineer "DOV says you should expect Antropogeen
0–2m, Boom Klei 2–18m, ..." as a starting point to nudge from
in the section editor.

**Why deferred.** The G3Dv3 static catalog (this commit) covers
the "what formations exist + age order + colors" half. The
Virtuele Boring API covers the "where in the column at THIS
location" half — useful but not production-blocking. The API
also needs reverse-engineering: the public spec at
``confluence.omgeving.vlaanderen.be/.../Virtueel+Profiel+API`` is
behind a Confluence redirect we couldn't follow, the bare
endpoint returned ``null`` to the probe coords (request shape
not fully understood yet), and we need to verify it returns NCS
slugs / G3Dv3 codes (not just locally-rendered text labels)
before integrating.

**Wins when this lands:**
* CPT-only projects get a default formation stack out-of-the-box
  (massive demo win — drop a project, hit "Seed from G3Dv3", get
  a starting model in seconds).
* Reduces "blank page" friction when no borehole interpretations
  exist nearby.
* Sanity-check on user-drawn formations ("DOV predicted Diest at
  this depth, you placed Boom — confirm?").

**When to revisit.** When dogfooding hits a CPT-only project
where the user has to type every formation from scratch, OR when
the Flanders launch demo needs "import → instant model" to land
without a borehole prerequisite.

**Implementation sketch.** New ``infrastructure/parsers/dov/
virtuele_boring_client.py`` (GroundModelLogger-inheriting),
returns a list of ``{formation_code, top_m, base_m,
confidence}``. UI surface: "Seed from G3Dv3" button in
InterpretationPane next to "Auto-populate from boreholes". The
seeded contacts carry a flag distinguishing them from
borehole-anchored picks so the validator can downweight them.

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

## 14. Sidebar UI overhaul (medium — dogfooding ask 2026-05-14)

**What.** The Sidebar's Tests / Visualisation / Interpretation
category-tab structure is getting busy. The InterpretationPane's
action area in particular hit a real overflow bug during
dogfooding: 4-5 buttons (Build / From boreholes / Dedupe / Add /
future imports) didn't fit horizontally on a narrow sidebar so
the user had to pan-right to see them. Patched immediately by
moving Build to its own primary row (commit 97f5434), but the
deeper IA needs a proper rethink before the v1.0 launch.

**Four real options to evaluate** when the time comes:

* **A. Top-of-screen action bar** (AutoCAD / Plaxis pattern). Per-
  tab horizontal toolbar at the top of the main content area;
  Sidebar becomes pure navigation + lists. More horizontal space
  for action labels; another piece of chrome.
* **B. Right Inspector panel** (Photoshop / Figma). Section view +
  map fullscreen, Sidebar narrows to nav-icons-only, right edge
  hosts a collapsible Properties panel that shows section
  properties / active model / formations + actions. Bigger
  refactor; matches engineering-software conventions.
* **C. Top tabs + persistent right-rail** (gINT / D-Series). Flat
  tab bar across the top; main content fills the screen; slim
  right rail for context-sensitive properties. Loses count badges
  unless tabs are decorated.
* **D. First-run gold-path overlay** (onboarding tutorial). Keep
  current layout; first project triggers an overlay walking
  Import → Define formations → Place contacts → Build model →
  Export. Behind a "?" after dismissal. Cheap; doesn't restructure
  anything; helps demo flow.

**Why deferred.** Pre-validation. The dogfooding friction
(missing Build button) was solvable with a small layout patch
(commit 97f5434); the broader overhaul should follow user input,
not solo-dev intuition. gINT and D-Series both ship busy UIs
that engineers tolerate because they're discoverable —
discoverability beats minimalism for this audience.

**When to revisit.** After the first 5 BE/NL geotech engineers
have walked through the app on real projects + given friction-list
feedback. Pre-validation overhauls cost a week and rebuild the
wrong thing.

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
