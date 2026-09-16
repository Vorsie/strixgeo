# Building the Windows installer

How a `.exe` a coworker can double-click is produced from this repo. Implements
**Fork A** of [distribution-db-decision.md](distribution-db-decision.md)
(debt #2) plus the installer half of debt #6.

**Nothing here affects a dev session.** Docker Compose on `localhost:5433`
remains the only database a dev session sees; every mechanism below is gated on
`app.isPackaged` or lives in a script you run deliberately.

---

## The one command

```
cd desktop
npm run dist
```

which is `embedded:postgres` → `embedded:python` → `package`. The first two are
idempotent and skip themselves when their output already exists; pass `-Force`
to the underlying script to rebuild one.

Output: `desktop/dist/StrixGeo-Setup-<version>.exe`.

## Release integrity and provenance

`dist` and `release` are gated so a publish can only ever carry a tree that was
committed, pushed, version-bumped, and freshly built — the production-readiness
audit (2026-09-02, C4) found `npm run release` published whatever happened to be
on disk, with no build and no provenance.

**The guard — `desktop/scripts/require-clean-release.mjs`.** Runs at the START of
both `dist` and `release`:

* refuses a **dirty tree** (`git status --porcelain` shows tracked changes) — a
  publish must be reproducible from a commit;
* refuses **unpushed commits** (HEAD ahead of its upstream, or no upstream at
  all) — CI has never verified them;
* on `release` only, refuses a **stale version** — `package.json` `version` must
  be strictly newer (SemVer) than the latest **published** version. "Published"
  is read only from sources an installed client can actually be offered: the
  GitHub releases feed of `Vorsie/strixgeo-releases` (read-only, via `gh`) when
  reachable, else the `v<semver>` git tags on the source repo. A local
  `desktop/dist/latest.yml` is never a source (see below). electron-updater
  offers an update only for a *greater* version, so re-publishing an equal or
  older one is invisible to every installed client. When the feed and the tags
  are both empty, any version is allowed (first release).

The clean/pushed checks are skippable with `STRIX_ALLOW_DIRTY_DIST=1` for a
LOCAL test build (`dist`, never `release`); the version check has no opt-out.

**`release` chains the full `dist`.** `release` = guard → `dist` (embedded
postgres → embedded python → `package`) → `electron-builder --publish=always`,
so it can only publish an `out/` / `embedded/` it just built — never a stale one.

**Reused-Python integrity.** `build-embedded-python.ps1` skips the ~640 MB
interpreter + dependency stage when `embedded/python/python.exe` already exists.
It now writes a SHA-256 manifest (`embedded/python/MANIFEST.sha256`) of that tree
when it stages it, and verifies every listed file on reuse *before* trusting the
skip; a mismatch fails the build naming the file (re-stage with `-Force`). This
closes the audit's "a bit flip in one of ~145 site-packages ships with a valid
sha512" — the staged import check only loads ~10 of them. The `uv export` also
runs `--frozen`, so a shipped build can never resolve a dependency set that
differs from the committed, hash-pinned `uv.lock`. (The build-only codelist
prune runs on the unconditionally re-staged backend on every build, reuse
included, and now asserts the dropped files are gone rather than trusting the
removal.)

**Build provenance.** Every build stamps its git SHA + build time into the main
bundle through the same electron-vite `MAIN_VITE_*` channel as the beta expiry:
`electron.vite.config.ts` sets them from `scripts/buildProvenance.mjs`, and
`buildStamp.ts` reads them back via `compiledBuildProvenance()`. `require-beta-stamp.mjs
post` greps `out/main/index.js` for the SHA, so a silent injection failure fails
the package instead of shipping a build with no provenance. `compiledBuildProvenance()`
feeds the About dialog and a one-line boot log (the `index.ts` wiring is a
companion change).

## What gets staged, and why

`desktop/embedded/` (gitignored — ~950 MB, rebuildable from pinned upstream
URLs plus `uv.lock`) is assembled by two scripts and copied into the installer
by electron-builder `extraResources`, landing at `<install>/resources/`.

| Staged tree | Built by | Size | Ships as |
|---|---|---|---|
| `pgsql/` | `scripts/build-embedded-postgres.ps1` | 309 MB | `resources/pgsql` |
| `python/` | `scripts/build-embedded-python.ps1` | 639 MB | `resources/python` |
| `backend/` | `scripts/build-embedded-python.ps1` | ~28 MB | `resources/backend` — mostly source; the engine + parsers are native `.pyd` (see below) |

One more `extraResources` entry, unrelated to the embedded stack: `resources/sample`
→ `resources/sample`. It carries the worked-example onboarding project as
`worked-example.strix` (debt #93, ruling A8). It lands OUTSIDE the asar so the
main process can `copyFile` it — "Load sample project" copies it to a user-owned
location rather than opening the pristine resource in place (a Save would
overwrite it). Until the owner authors the `.strix`, the directory holds only a
`README.md`, `sample:available` returns false, and onboarding starts empty.

### PostgreSQL + PostGIS

Two official artefacts, both pinned by version **and SHA256** in the script —
verified on every run including cache hits, so a truncated download or an
upstream that re-cuts a release in place fails the build instead of silently
changing what ships: the EnterpriseDB Windows **binary zip** (not the
installer) and the OSGeo **PostGIS Windows bundle**, whose documented install
procedure is to copy its `bin/ lib/ share/` over the PostgreSQL tree. That procedure is followed verbatim rather than
merged no-clobber — the bundle's GEOS/PROJ/OpenSSL set is the set its
`postgis-3.dll` was linked against.

Pruned: `pgAdmin 4` (711 MB of the 869 MB raw tree — a GUI we never launch),
`StackBuilder`, `doc/`, `include/`, the PostGIS shapefile GUI, and the
non-PostGIS extensions the bundle also carries (pgRouting, MobilityDB, h3,
pointcloud, pg_sphere, ogr_fdw). **Kept in full:** the PROJ grid-shift files
under `share/contrib/` — without them `ST_Transform` silently degrades to a
lower-accuracy datum shift, and the app must work with no network on site.

> Extraction uses `System32\tar.exe` (bsdtar), not `Expand-Archive`. Measured
> on these archives: minutes versus over half an hour.

### The Python backend

**A relocated interpreter, not PyInstaller.** python-build-standalone (what uv
already downloads for this project) is built to be relocatable, so the script
copies it and installs the `uv export --no-dev` locked set into its own
`site-packages`. The backend itself ships **mostly as source** with `PYTHONPATH`
pointed at it — the exception is the engine + parsers, which ship as native
`.pyd` (see "The compiled subset" below).

Freezing was rejected on four concrete counts, each of which is a failure that
appears in a tester's hands rather than at build time:

* numba/llvmlite, polars, scipy, shapely, pyproj, asyncpg — a large
  hidden-import and datas surface.
* Alembic needs its migration scripts as **real files**, and `versions/` is not
  even an importable package (no `__init__.py`) — a wheel build drops all 96.
* The DOV/G3Dv3 codelists are read `__file__`-relative and are not declared as
  package data — a wheel build drops all 11.
* `@njit(cache=True)` writes next to the source it compiles.

The trade is size for correctness: the source that ships is byte-identical to
what the test suite runs against.

### The compiled subset

Readable source is a leak — owner ruling 2026-08-31: *"the underlying codebase
should also be protected and not leak at all times ... otherwise someone else
could just duplicate"*. So the areas the owner named do **not** ship as source:
the **engine** (rulings 5-6 — the voxel-litho builder plus the whole
`domain/services` modelling core: NAD classifier, CPT segmenter / Robertson
chain, the full geotech subdivision family, TIN/DEM/lens/correlation geometry),
the **parsers** (all GEF + DOV parsing), and — owner ruling "Q1", 2026-09-01 —
the **engine-class modules that live in `application/`** (see below). Right
after the backend is copied, `scripts/compile-backend-natives.ps1` translates
each module listed in `scripts/native_compile_manifest.py` to C with Nuitka,
drops a `<name>.cp311-win_amd64.pyd` beside its package `__init__.py`, and
deletes the `.py` **in the staged tree only** (the repo `src/` is never touched;
dev keeps running all-source). 132 modules today. The rest of the API,
repositories and application layer stay source, so alembic + the codelist data
files keep resolving `__file__`-relative exactly as under pytest.

Two carve-outs stay source, recorded in the manifest's `SOURCE_CARVEOUTS`:

| Carve-out | Why it cannot compile |
|---|---|
| `voxel_litho/greedy_mesh.py` | its greedy-mesh kernel is a Numba `@njit(cache=True)` function — Numba needs the `__code__` object + an on-disk `.py` to cache beside; a `.pyd` has neither. Pinned by `test_greedy_mesh.py:58-77` (drops to object-mode otherwise). |
| every `__init__.py` | compiling a package marker breaks the package's importability and hides no logic. |

The **application engine** compiled under ruling Q1 is ALGORITHM code only — the
geotech subdivision / borehole-division / packing-edge engine
(`divide_boreholes`, `subdivide_all_bodies`, `geotech_edge_derivation`), the
in-module geotech band-edit planning and tie/pair reanchor matching
(`geotech_band_edit_helpers`, `geotech_tie_reanchor`, `pair_ruling_reanchor`),
the voxel build (`build_voxel_litho_model`), and the section / wedge / companion /
stratigraphy / export geometry that has no compiled-domain home
(`build_section_polygons`, `create_perpendicular_companion`,
`materialize_wedge_tips_for_formation`, `stratigraphy_bridge`,
`thin_export_units`) — 12 modules. The rest of `application/` stays source: the
band-reclassification hand-edit verbs (merge / split / move / preview) and the
body resolution / recompute use cases **delegate** their algorithm to a compiled
`domain/services` service (`geotech_band_reclassification.plan_*`,
`resolve_litho_instances`, `body_fact_translation`) — so that IP already ships as
a `.pyd` — and the CRUD / import / snapshot / DTO / queue families carry none.
That delegation boundary is the ALGORITHM-vs-orchestration line. The application
set needed **no Nuitka carve-out**: all 12 compile and import clean (verified
2026-09-02). (`geotech_band_reclassification` itself landed as C3 and ships
compiled with the rest of the geotech family — no longer a deferred source
module.)

**Nuitka rewrites `__file__` and `__spec__.origin` back to the original `.py`
path** so tracebacks point at source — so a "`__file__` ends with `.pyd`" check
is a FALSE witness. The gates verify compilation via the `__compiled__` marker +
the `nuitka_module_loader` loader name + `__compiled__.extension_filename`
instead.

**Two gates, both EXECUTE the artifacts — hashes prove nothing on this box.**
It has shipped two `.pyd` files with a poisoned image section while their bytes
still hashed correct (CLAUDE.local.md "Machine health"). So:

1. a **smoke gate** in `build-embedded-python.ps1` imports every manifest module
   in the staged interpreter and asserts each is `__compiled__` with no surviving
   `.py`, and that `greedy_mesh` imports as source;
2. a **behavioural gate** (`scripts/verify-staged-natives.ps1`) runs the real
   unit suites — the voxel byte-identity SHA-256 pin, the `@njit` tripwire, the
   NAD classifier, and the GEF/DOV parsers (incl. the process-pool parse worker)
   — against the compiled `.pyd` under the staged interpreter, with a pre-suite
   marker test re-asserting the `__compiled__` markers inside the pytest process.

Either gate failing kills the dist build. The toolchain lives in the `compile`
dependency group (`uv sync --group compile`); because it is a non-default group,
`uv export --no-dev` excludes it and Nuitka never lands in the installer.

Broader tamper hardening (anti-debug, the `--remote-debugging-port` flag surface)
stays debt #5 and is deliberately not attempted here — a decompiled `.pyd` is
harder than a decompiled wheel, but this is obfuscation-grade protection, not
DRM.

---

## What happens on the tester's machine

`desktop/src/main/embedded/` — the pure pieces (paths, port, secrets, DSN, the
stage machine) are unit-tested; `postgresCluster.ts` and `embeddedStack.ts` are
the I/O and are covered by actually installing and booting.

The launcher's boot is split into a fast preparation phase and the cluster
phase so the engine's cold import can OVERLAP the database coming up (owner
report, installer #13 — a cold first launch ran ~60 s of DB boot, then a whole
second ~17 s Python interpreter just to answer "already at head", then the
engine's own ~48 s cold import, all in series). Preparation (`prepareEmbeddedStack`)
resolves paths, reads secrets and picks a port, then the launcher spawns the
engine against that DSN as soon as the licence gate passes, and the cluster
phase (`startEmbeddedCluster`) brings PostgreSQL up CONCURRENTLY with the
engine's import. The schema migration is **no longer run by the launcher** —
the engine brings the database to head in its own process (see the maintenance
note below).

Stages, in order, recorded by `BootSequence` and written to the backend log:

1. `resolve-paths` — locate the bundled trees; fail by name if one is missing.
2. `load-secrets` — read or generate this install's password + `SECRET_KEY`.
3. `acquire-port` — bind `:0` and take what the OS gives. **Never a fixed
   port**: a coworker running their own Postgres on 5433 is the target user,
   and the failure mode of a collision is connecting to *their* database.
4. `init-cluster` — first launch only. `initdb -E UTF8 --locale=C
   --auth-host=scram-sha-256`, password via `--pwfile`. A directory that
   exists but has no `PG_VERSION` is a first launch that died part-way; it is
   moved aside and re-created rather than left to fail forever.
5. `start-postgres` — `listen_addresses=127.0.0.1` only.
6. `await-postgres-ready` — poll the bundled `pg_isready`, aborting early if
   the server process reported a spawn failure or already exited.

Stages 1–3 are awaited (they produce the port the engine is spawned against);
stages 4–6 run in the background while the engine imports. A failure in stages
4–6 stops the engine and shows the native "could not start" dialog.

```
[boot] resolve-paths        ok       0ms — ...\embedded\pgsql
[boot] load-secrets         ok       1ms
[boot] acquire-port         ok       6ms — port 55385
[boot] init-cluster         ok       9777ms — created
[boot] start-postgres       ok       11ms
[boot] await-postgres-ready ok       589ms
[boot] total 10384ms
```

The engine then logs its own phases to the same backend log — including
`[engine-boot 2/6] engine-side DB migration …` with its elapsed ms — so a
launch reads as one timeline across the two processes.

The log is written with `appendFileSync`, not a buffered stream. The first
time a packaged build failed to start, the log the dialog told the user to
send back was **zero bytes** — every line was still in the stream's buffer
when the process died. A startup log that survives only a graceful exit is
worthless exactly when it is needed.

`startApi()` spawns the backend against the resolved `DATABASE_URL` as soon as
the licence gate passes — concurrently with stages 4–6 — and the renderer's
`api:ready` poll (three-minute packaged deadline) takes over unchanged.

A failure in the awaited preparation stages shows a native dialog naming **what
the app was doing** in plain language, plus the underlying error and the log
path — then quits, before any window exists. A failure in the concurrent cluster
stages (4–6) does the same once a window is up (the dialog layers over the
splash). A failure inside the engine — the wait for Postgres, the in-process
migration, or the engine import — is logged by the engine and surfaces as the
renderer's "could not start the data service" message pointing at the same log.

> **Maintenance note — the packaged boot runs migrations IN THE ENGINE.** There
> is no `migrate.py` child in the packaged boot path any more. At the start of
> the FastAPI lifespan the engine runs `groundmodel.api.boot_migration.run_boot_migration`,
> which delegates to the same `DatabaseMigrator` (bounded wait for the server,
> create-database, `CREATE EXTENSION postgis`, the `HEAD_REVISION` fast path, the
> pre-migration `pg_dump` checkpoint, the newer-database guard). It is gated on
> the `STRIX_ENGINE_MIGRATE` env the launcher sets in `buildBackendEnv`, so dev /
> CI / e2e keep running migrations externally (`alembic upgrade head` / the
> wrapper script). The `migrate.py` CLI is kept for dev/CI and the embedded
> integration test. If you change the migrator's env contract, change both the
> launcher's `buildBackendEnv` and `boot_migration.run_boot_migration`.

> **Maintenance note - the parse-pool workers self-exit if the engine dies.**
> The engine's DOV parse pool (`api/main.py`, a `ProcessPoolExecutor` of `spawn`
> workers) is created with `initializer=start_parent_watchdog,
> initargs=(os.getpid(),)`. Every worker, the moment it spawns, starts a
> one-second daemon watchdog (`groundmodel.shared.parent_watchdog`) on the
> engine's pid and calls `os._exit(0)` the instant that pid is gone. This is the
> in-engine second layer behind the desktop's process-tree kill
> (`desktop/src/main/shutdownSequencer.ts`): an engine crash, or a tree-kill that
> misses a worker, can no longer leave a stranded `python.exe` holding files in
> the install folder, the state that made a reinstall report "StrixGeo is nog
> actief" (owner diagnosis 2026-09-06). On a clean lifespan exit the pool is shut
> down with `wait=False, cancel_futures=True`, so the stop never blocks on an
> in-flight parse and the idle workers take their shutdown sentinel. If you add
> another `spawn` child anywhere in the engine, wire the same initializer so it
> inherits the watchdog.

### Per-install generated secrets

`<userData>/pgcredentials.json`, written on first launch:

* the **database password** — the dev stack's `groundmodel:groundmodel` is fine
  for a loopback container on one developer's box and is not fine on a shared
  office machine;
* the backend **`SECRET_KEY`** — a packaged build runs `ENVIRONMENT=production`,
  under which the backend refuses to start on the shipped `change-me` default
  (audit #16). Without this the packaged app cannot boot at all.

If that file becomes unreadable the app **fails loudly** rather than generating
a replacement: the cluster was initialised with that password, and a silent
regeneration would lock the user out of an intact data directory.

### Read-only install, writable user profile

Everything shipped is read-only; everything written lives under `userData`
(`pgdata/`, `pgcredentials.json`, `numba-cache/`, `logs/`, `backups/`). A unit
test asserts no writable path in the layout resolves under the install
directory — the bug it prevents is invisible on a developer's machine, where the
app runs from a writable build tree.

`NUMBA_CACHE_DIR` is set for the same reason: `@njit(cache=True)` writes beside
its source, and the 38.6× that justified taking numba as a dependency is a
*cached*-compile win.

`backups/` holds the **pre-migration `pg_dump` checkpoints** (production-readiness
audit H2b). When a launch has pending migrations, `DatabaseMigrator` writes
`backups/pre-<from_rev>-<to_rev>-<timestamp>.dump` (custom `-Fc` format,
`pg_restore`-able) *before* `alembic upgrade head`, keeping the five newest. The
launcher hands the migrator the bundled `pg_dump.exe` path and this directory
through the env vars `STRIX_PG_DUMP_PATH` and `STRIX_BACKUP_DIR` (set in
`buildBackendEnv`, the same mechanism as the DSN and `STRIX_ENGINE_MIGRATE`). In
dev neither is set and the dump is skipped (a dev DB is not the user's only
copy). Because the migration now runs inside the engine, a dump failure or an
unknown stamped revision — the store was written by a newer StrixGeo — fails the
engine's lifespan startup with the migrator's own message logged
(`DatabaseMigrator` raises `DatabaseMigratorError` / `NewerDatabaseError` with
"install the current version; your data is intact"); the launcher's own
`bootFailureMessage.ts` newer-database dialog now covers only the dev/CI
`migrate.py` path. See [design/autosave-recovery.md](design/autosave-recovery.md) §7.

---

## Verifying a change without launching the app

```
cd desktop
STRIX_EMBEDDED_INTEGRATION=1 npx vitest run src/main/embedded/embeddedStack.integration
```

Runs the **real** `startEmbeddedStack` against the **real** staged binaries —
`initdb`, server start, `CREATE EXTENSION postgis`, an actual Lambert72
`ST_Transform`, all 96 migrations, the reuse-on-second-launch path, and the
recover-from-a-half-initialised-directory path. It uses a throwaway
`mkdtemp` profile and an OS-assigned port, needs no Electron and opens no
window, and skips itself when `desktop/embedded/` has not been staged.

**Prefer it to launching the packaged app.** Two rules, both learned the hard
way:

* **Never point a test run at the default user-data directory.** A packaged
  launch claims `%APPDATA%\StrixGeo\` (see the profile section below) — no
  longer the dev profile, but still a REAL profile a future install owns, and
  a test that half-initialises its `pgdata` poisons that first install. Pass
  `--user-data-dir=<throwaway>` if you must launch it at all. (Before the
  profile split this bit harder: a test launch wrote straight into the
  developer's live `ground-model-desktop` profile.)
* **Never let a test instance take :8765.** That is the dev backend's port
  (`memory/feedback_e2e_port_8765_conflicts_dev_app`). The integration test
  above never binds it; a launched app will.

A hand-written PowerShell smoke script is *not* a substitute: the first
version of one re-implemented the boot steps instead of calling them, and so
happily passed while the real code had a 100 %-reproducible first-boot bug
(the `initdb` password file was being written inside the data directory,
which makes `initdb` refuse a non-empty target).

---

## Installer shape (NSIS, unsigned)

| Setting | Value | Why |
|---|---|---|
| `oneClick` | `false` | Assisted installer; the tester still just clicks Next. |
| `perMachine` | `false` | Per-user install under `%LOCALAPPDATA%\Programs` — **no UAC prompt**, so a coworker whose IT withholds admin can still install. |
| `deleteAppDataOnUninstall` | `false` | **Data safety.** The database is the live store and the `.strix` is the save artefact; deleting `pgdata` on uninstall would destroy any project not saved to a file. |

Uninstall therefore removes the program and leaves `%APPDATA%\StrixGeo\`. To
reclaim the space, or to force a clean first-run, delete that folder by hand.

**Reinstalling over a running app.** A stranded parse-pool worker can no longer block a reinstall as "StrixGeo is nog actief": a normal close kills the engine tree (`shutdownSequencer.ts`) and, as a backstop, each worker self-exits once the engine is gone (`groundmodel.shared.parent_watchdog`, wired as the pool initializer in `api/main.py`).

**`toolsets: { winCodeSign: "1.1.0" }` is load-bearing, not cosmetic.** The
legacy default fetches ONE archive holding every platform's signing tools,
including macOS `.dylib` **symlinks** that Windows refuses to create without
Developer Mode or an elevated shell. The build then dies while merely
unpacking `rcedit` — which is the only thing an unsigned Windows build takes
from that archive — with `cannot execute cause=exit status 2` and no mention
of symlinks in the summary. Pinning `1.1.0` downloads `rcedit` as its own
small zip. Remove that key and the build breaks on any machine without
Developer Mode.

**Unsigned.** SmartScreen shows "Windows protected your PC" → *More info* →
*Run anyway*. Acceptable for trusted internal testers per
`memory/project_coworker_distribution`; the EV certificate is the rest of debt
#6.

---

## The packaged profile — `%APPDATA%\StrixGeo`, never the dev folder

**RULED 2026-08-27 (owner: "yes clean profile, do it").** `build.productName`
renames the executable, the Start-menu shortcut and the install directory, but
it does **not** move `app.getPath('userData')` — that resolves from
`package.json`'s top-level `name` (`ground-model-desktop`), the same folder
the dev app uses. A packaged build therefore claims its own profile:
`applyPackagedProfile(app)` in `desktop/src/main/packagedProfile.ts`, the
first userData-affecting statement in `index.ts`, moves `userData` **and**
`sessionData` to `%APPDATA%\StrixGeo\` when `app.isPackaged`. Dev is a no-op.

Why clean over sharing: the single-instance lock lives in the profile, so
sharing would stop dev and an installed build from ever running at the same
time; an install would put a Postgres cluster next to the developer's live
`recovery/` and `recent-projects.json`; and the profile name is the one thing
that becomes unrenameable after the first real install (it holds the
customer's `pgdata`), so the brand name has to be right from install #1.

Order is the feature: the lock, the recovery store, the beta anchor, the
diagnostics store and the embedded stack all resolve paths off userData —
`packagedProfile.test.ts` PP3 pins that the call precedes every one of them.

## Still open (debt #6 remainder)

* **Code signing** — EV cert, ~€200–400/yr for a hardware token.
* **Auto-update** — `electron-updater` + a release feed. Matters more than
  signing long-term: `.gmproj` format upgrades depend on every user reaching
  the build that introduced the upgrade path.
* **Postgres major upgrades.** A future PG 17 bundle cannot read a PG 16
  `pgdata`. The decision doc's accepted shortcut stands — the `.gmproj` bundle
  is the data anchor, so the recovery is dump/restore or wipe-and-reopen — but
  nothing detects the mismatch yet beyond the server refusing to start.

## Releasing: the version must be greater than the last published one

`npm run release` runs `scripts/require-clean-release.mjs release` first. The
guard refuses a package version that is not GREATER than the latest published
one, because electron-updater offers an update only for a greater semver.

It reads the "published" version only from what an installed client can actually
be offered, never from a local build output. In order:

1. **The releases feed** of `Vorsie/strixgeo-releases`, read-only via `gh`
   (`gh api repos/Vorsie/strixgeo-releases/releases`), using the same
   `GH_TOKEN`/`gh` auth the publish uses. Drafts are excluded; prereleases
   count. This is the primary source: it is exactly what the updater sees.
2. **The `v<semver>` git tags** on the source repo, as a fallback when the feed
   cannot be read (no token, offline, `gh` not installed). The guard prints that
   the feed was unreachable and which source it used.

A local `desktop/dist/latest.yml` is **never** consulted: every `npm run dist`
rewrites it with the current package version, so treating it as "published"
once refused the first beta release while the releases repo was still empty
(the guard now says `published version: none published` in that state, and any
version is allowed). This is the resolution in
`desktop/scripts/publishedVersion.mjs`; its tests pin it.

Before every release:

1. Bump `"version"` in `desktop/package.json` above the last published release
   (check `gh release list --repo Vorsie/strixgeo-releases`), land the bump on a
   branch and push develop; the guard also demands a clean tree level with
   `origin/develop`. The version bump is required for every release because the
   updater only offers a strictly greater semver.
2. Run the release; it creates a DRAFT release named after the package version
   (`v0.1.0`) on the releases repo. Publish it by hand after a download check;
   the git tag on the private repo (`v0.1.0-beta.1`) is a separate name.
