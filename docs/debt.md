# Known Architectural Debt

Items that need a focused session — bigger than a quick fix, smaller
than a phase. Tracked here so each one is visible in PR / commit
context without rediscovering it from grep. Order is loose priority.

When an item is resolved, **delete it from this list** — its
implementation history lives in the relevant commit on ``develop``,
not here. Numbers stay stable through a debt-fixing campaign (do
not renumber after each fix); explicit cleanup passes (last done
2026-05-13, 24 DONE items removed, open items compacted to 1–34)
compact them.

## 1. WFS client base class — remaining wrapper duplication (low)

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


## 3. Translate ``ScalarLabTest.parameter`` storage (low)

**What.** 671 rows already store the verbatim DOV string
``"Korrelvolumemassa (korrelvolumemassa)"`` etc. If DOV changes their
inconsistent doubled-tail convention again, we'd need to migrate all
rows. A separate ``parameter_slug`` column with a canonical short
name (derived at ingest from a curated map) would help reporting and
make the storage column independent of upstream tweaks.

**When.** When a query against ``scalar_lab_test`` is added that
filters by parameter — at that point the slug becomes load-bearing.

## 5. Telemetry / crash reporting (low)

**What.** No Sentry-equivalent. Frontend ``log.*`` calls go to the
devtools console; user-side crashes are invisible to us.

**When.** Before any non-solo user.

## 7. Backfill `dov_permkey` for legacy rows (low)

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

## 8. Elevation provenance — rollback column (low, residual)

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

## 10. License key + activation system (medium → blocking before paid release)

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

## 11. Installer + code signing + auto-update (medium → blocking before paid release)

**What.** electron-builder produces .exe / .dmg / .deb / .AppImage,
electron-updater handles deltas. Windows requires EV code signing
(~€200–400/year for a hardware-token cert) to avoid SmartScreen
"untrusted publisher" warnings that scare off enterprise IT.
macOS notarization is similar (~€100/year Apple Developer
membership + signing + Apple notary upload). Linux can ship
unsigned today.

**Why deferred.** Same as #10 — pre-revenue, premature.

**When.** In parallel with #10, before the first paid release.
Auto-update is especially important because future .gmproj format
upgrades depend on every user reaching the build that introduced
the upgrade path.

## 12. Tamper / reverse-engineering hardening (low — pragmatic posture, residual)

**What's still open.** The malformed-input audit pass landed: every
DOV XML parser uses ``defusedxml`` (billion-laughs + external DTD
guards); ``project:read-file`` and ``fs:read-file`` apply size caps
before allocating Buffers; the API has its own body-size + GEF-upload
caps. What's left is the licensing-side hardening tied to debt #10:

* Defeat casual bypass (renamed exe, deleted license file).
* Token store + verification on each launch (already in #10's scope).
* No anti-debug, no obfuscation, no DRM theatre.

**Why low priority.** Geotech engineers don't pirate software at
scale. The .strix format is also not inherently sensitive — losing
the geometry of someone's site investigation isn't catastrophic the
way leaking a movie pre-release is.

**When.** Folds into debt #10's license-key work before paid release.

## 13. Marketing site + market-facing name (medium → blocking before paid release)

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

## 25. Geotechnical units invisible to the section editor (medium — Phase 5 trigger)

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

## 33. Bundled Postgres distribution path not prototyped (medium → blocking before beta)

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

## 34. Plaxis target version unconfirmed (medium → blocking before exporter implementation)

**What.** The Plaxis exporter (MVP gate item) needs a target file
format. Plaxis 2D 2016+ uses ``.plxs``; older versions (still
common in BE consultancies) use the legacy ``.geo`` / PLAXIS Input
ASCII. Building for ``.plxs`` and shipping to a 2014-vintage
paying customer is a support conversation before revenue.

**Why deferred.** Cannot decide without market signal.

**When to revisit.** Ask the first 5 validation contacts which
Plaxis version they run. Decide format target from the modal
response. Implement exporter only after the version is named —
format delta is non-trivial.

## Items #40, #42 — 2026-05-13 security-reviewer audit pass (#35–#39, #41, #43 resolved)

The remaining audit findings — #35 CORS, #36 CSP+window-open+
unpkg, #37 IPC paths, #38 bundle bounds, #39 GEF cap, #41
recent-projects, #43 error messages — landed in the same session.
Open items kept: #40 (auth threading, blocked by #10) + #42
(ESLint reason-rule enforcement, project bigger than 30 min).

## 40. Project-by-id endpoints rely on "only caller is local user" (medium → day-1 of #10)

**What.** ``POST /projects/{id}/duplicate`` (project.py:281-300)
and ``PATCH /projects/{id}/view-state`` (router-resolved via the
project id) operate on the resolved row without an identity
check. Today that's correct (single user, no auth). When debt
#10 lands, these endpoints will need a ``user_owns(project_id)``
predicate threaded through. The geology + cross-section + review
routers already use a two-stage ``get_in_project_or_404`` pattern
— mirror that.

**Why deferred.** No auth shipped.

**When to revisit.** Day-1 of debt #10 license-token work — auth
scaffolding must thread ``current_user`` through these routes
before any token-gated call ships.

## 44. Contact selection toolbox — RESOLVED 2026-05-13, REFINED 2026-05-13

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

**Open follow-ups under this debt** (low priority, captured here so
they don't get re-filed as new items):

* COPY uses N parallel POSTs (Promise.all). Partial-failure leaves
  some contacts created and others missing; the toast warns. Promote
  to a real ``POST /contacts/batch-create`` endpoint with single-
  transaction commit when failure rates start to bite.

The entry stays in the debt list as historical record + design-
rationale anchor for anyone reading the section editor code.
Strike-through is intentional — do not renumber after a fix.

## 45. Undo/redo (Ctrl+Z) for geological model edits (medium — dogfooding ask 2026-05-13)

**What.** No undo system today. Every contact create / delete /
update / batch-create / batch-update / auto-populate is permanent
the moment it commits. User asked for Ctrl+Z during a real
dogfooding session — they want to revert a misclick or a wrong
auto-populate without re-importing the project.

**Scope shape.** Command pattern. Each mutation handler builds a
``Command`` object with ``apply()`` + ``revert()``. App-level
``useUndo()`` hook owns ``historyStack: Command[]`` +
``redoStack: Command[]``. Ctrl+Z pops history → revert → push
redo. Ctrl+Y / Shift+Ctrl+Z pops redo → apply → push history.
Every existing mutation handler in ``App.tsx`` adds a command
push after success.

Commands needed (rough sketch):

* ``CreateContactCommand`` — revert: DELETE the created id.
* ``DeleteContactCommand`` — revert: POST a new contact with the
  pre-delete payload (gets a new server id; updates remembered
  refs in the redo stack).
* ``UpdateContactDepthCommand`` — revert: PATCH back to the old
  depth.
* ``BatchUpdateContactsCommand`` — revert: PUT batch with the
  pre-update snapshot.
* ``BatchCreateContactsCommand`` — revert: DELETE every created id.
* ``AutoPopulateCommand`` — revert: DELETE every created contact
  + every created formation.

**Why deferred.** Touches every mutation handler — ~1-2 days of
careful work + tests. Better to ship as one coherent feature in
its own session than to bolt onto the next bugfix sprint.

**When to revisit.** Next session focused on contact-editor work,
or sooner if dogfooding hits a real "I just lost an hour of
picks" moment. The friction-list trigger is the same shape as
the data-loss save bug from earlier (#44 sibling) — a real loss
event makes this MUCH higher priority.

## 46. Sidebar UI overhaul (medium — dogfooding ask 2026-05-14)

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

## 47. App.tsx smoke / mount test (medium — TDZ regression caught only in dogfooding 2026-05-14)

**What.** App.tsx is ~2,900 lines of state + effects + callbacks.
TypeScript + the existing per-component vitest suite caught zero
of the TDZ runtime crashes that have hit the user mid-dogfooding
(2026-05-13 contact-selection toolbox; 2026-05-14 saveProject
auto-build). CLAUDE.md already flags the rule:

> Add a top-level smoke test (`render(<App />)`) when the
> component crosses the threshold where mental tracking gets
> unreliable.

We're past that threshold. Need a single ``App.smoke.test.tsx``
that mounts ``<App />`` end-to-end with stubs for window.electron,
the api wrappers, leaflet's window.L globals, and the persistence
layer. The test asserts only that mount completes without throwing
— catching TDZ + unmocked-global crashes is the whole point.

**Why deferred.** Mock surface is non-trivial: ~10
window.electron methods, ~30 api.* methods, leaflet bootstrap,
useProject's file-system bridge. Probably half a day of careful
mock setup. Not a 30-minute job; better to ship as one focused
session than bolt onto a bugfix sprint.

**When to revisit.** Before the first paid release — every TDZ
shipped to a paying customer is a "the app crashed on launch"
support call we don't want. Also: any time a third TDZ class of
crash slips past tsc + per-component tests, file the smoke test
as the next session's first priority.

**Escalation when the smoke test alone isn't enough.** If a fourth
TDZ-class crash slips past the smoke test (or a new dev / future
session can no longer trace ``saveProject``-shaped flows in one
read), promote this item to "split App.tsx into custom hooks":

* Extract ``useGeologicalModel`` — owns ``surfacesByFormationId``,
  ``formationsRefreshCounter``, ``crossingsRefreshCounter``,
  ``activeGeologicalModel``, ``staleSurfaceCount``, and the
  ``saveProject`` auto-build sequence (the tightest cohesive
  cluster the latest TDZ exposed).
* Extract ``useProjectLifecycle`` — owns ``saveProject``,
  ``openProject``, ``closeProject``, ``recentProjects``.
* Leave App.tsx as the coordinator that renders, not the place
  that computes.

Don't do the split pre-trigger — restructuring 2,900 lines is
a multi-day refactor with its own bug surface.

## 48. Bundle vertices / triangles size cap (low — coworker-distribution trigger)

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

Folds into debt #12 (tamper hardening) — same trigger, same
review pass.

## 49. Crossings validator — suppress / qualify when surfaces are stale (low — UX consistency)

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

## 50. Canonical regional stratigraphy catalog (NCS / BRO) for ordering + colors + names (high — architectural answer for stratigraphy)

**What.** Today's depth-derived `display_order` in auto-populate
(see ``auto_populate_contacts_from_stratigraphy.py`` post-walk
sort) is a heuristic — it works because depth aligns with age in
normal Belgian stratigraphy (Steno's superposition). It breaks for
faulted zones, overturned beds, repeated glaciotectonic sequences,
and anywhere the user has informal layer names.

The authoritative source is the Belgian National Commission for
Stratigraphy chart (https://ncs.naturalsciences.be/infosearch/).
Each formation has a canonical age, prescribed color, multilingual
names (NL/FR/EN), and a description. NL has the equivalent BRO /
TNO Dutch stratigraphic chart.

Wire as a 3-tier ordering source:

| Priority | Source | Coverage | Confidence |
|---|---|---|---|
| 1 | NCS / BRO age | BE+NL named formations | Authoritative |
| 2 | G3Dv3 stacking | Flanders mapped formations | Authoritative-regional |
| 3 | Depth-derived mean | Anything (informal, foreign) | Heuristic (today) |

**Wins beyond ordering** when this lands:

* Standard formation **colours** — engineer picks "Ieper" → it
  gets the prescribed yellow from the NCS chart automatically.
* **Multilingual labels** — "Boom Klei" / "Argile de Boom" /
  "Boom Clay" depending on user locale (Strix targets BE bilingual
  + NL + future international).
* Formation **descriptions** auto-fill the ``description`` column
  on first creation.
* **Stronger crossings validation**: the validator can flag "user
  placed Antropogeen below Ieper — NCS says that's geologically
  impossible" with authoritative language, not depth-derived
  heuristic.
* **Formation autocomplete** in the manual create dialog (typing
  "Boom" → suggests "Boom Klei" with the formal regional_ref +
  color pre-filled).

**Four implementation options** (pick when revisiting):

* **A. Hardcoded curated catalog.** Python dict in
  ``infrastructure/codelists/ncs_belgian_stratigraphy.py`` with
  the ~50-100 most common Belgian formations. Update manually
  when NCS publishes changes. Cheapest start; manual maintenance.
* **B. Scraped catalog cached in repo.** One-time scrape of the
  NCS site → JSON file shipped with the app. Refresh script in
  ``scripts/``. CI re-scrapes periodically. Best balance of
  freshness + simplicity.
* **C. Live API query.** If NCS exposes an API, hit it on import.
  Cache responses locally. Slower, network-dependent, fragile.
  Worst fit for the local-first commercial model.
* **D. G3Dv3 import covers it.** When the user imports G3Dv3
  (post-v1.0 Flanders feature), formations land with the right
  order baked in. NCS becomes a fallback for non-G3Dv3 projects.
  Folds the work into the G3Dv3 import.

**Why deferred.** The depth-derived heuristic shipped today
covers the dogfooding bug (Antropogeen-as-oldest) and works for
~95% of normal Belgian sites. NCS integration is multi-week
effort: catalog scraping (or curation), schema for ages + colors
+ multilingual names, code-paths in auto-populate / manual
create / validator, locale machinery for the labels.

**When to revisit.** Two natural triggers:

1. **G3Dv3 import session** (CLAUDE.md Phase 4 launch-adjacent):
   the regional_ref → age mapping is half the work for NCS, so
   land them together.
2. **First user complaint that depth-derived ordering got it
   wrong on a real project** (faulted site, overturned bed,
   repeated sequence). Single complaint = file as P1 because it
   means the heuristic's accuracy assumption broke.

Architectural note: NCS is BE-only. NL has its own catalog
(TNO / BRO). The interface this debt produces should be a
pluggable "regional stratigraphic catalog" abstraction with
two implementations on day one (NCS + BRO), not a hardcoded NCS
lookup. Keeps the door open for international expansion without
a rewrite.

**Principle (user-confirmed 2026-05-14): stratigraphic ordering
must be CORRECT AT CREATE TIME, not via a repair button.** A
"Reorder by depth" or "Snap to NCS chart" button was discussed
during dogfooding and rejected — it would be a permanent
monument to a create-path bug. Today's depth-derived auto-populate
shipped under this principle (fix the inversion, not bolt on
a repair). NCS integration must follow the same rule: when the
user runs auto-populate on a Belgian project, the resulting order
should match the NCS chart with no extra clicks. The user can
still manually drag-reorder for special cases (overturned beds,
bespoke local naming) — that override is theirs, not the
system's repair.
