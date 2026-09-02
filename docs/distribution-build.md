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
could just duplicate"*. So the two areas the owner named (rulings 5-6) do **not**
ship as source: the **engine** (voxel-litho builder, NAD classifier,
representative statistic) and the **parsers** (all GEF + DOV parsing). Right
after the backend is copied, `scripts/compile-backend-natives.ps1` translates
each module listed in `scripts/native_compile_manifest.py` to C with Nuitka,
drops a `<name>.cp311-win_amd64.pyd` beside its package `__init__.py`, and
deletes the `.py` **in the staged tree only** (the repo `src/` is never touched;
dev keeps running all-source). 66 modules today, ~23 MB of `.pyd`. The API,
repositories and application layer stay source, so alembic + the codelist data
files keep resolving `__file__`-relative exactly as under pytest.

Two carve-outs stay source, recorded in the manifest's `SOURCE_CARVEOUTS`:

| Carve-out | Why it cannot compile |
|---|---|
| `voxel_litho/greedy_mesh.py` | its greedy-mesh kernel is a Numba `@njit(cache=True)` function — Numba needs the `__code__` object + an on-disk `.py` to cache beside; a `.pyd` has neither. Pinned by `test_greedy_mesh.py:58-77` (drops to object-mode otherwise). |
| every `__init__.py` | compiling a package marker breaks the package's importability and hides no logic. |

`domain/services/geotech_band_reclassification.py` is engine code but is left
**source pending owner decision C3** (band-reclassification behaviour is still
under active dogfeed rulings); add it to the manifest when C3 lands.

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
7. `run-migrations` — `python -m groundmodel.infrastructure.db.migrate`, which
   waits for the server, creates the database, `CREATE EXTENSION postgis`, then
   `alembic upgrade head`.

Measured on the development machine: **first boot 13.4 s** (of which `initdb`
is 9.8 s), **subsequent boots 2.1 s**.

```
[boot] resolve-paths        ok       0ms — ...\embedded\pgsql
[boot] load-secrets         ok       1ms
[boot] acquire-port         ok       6ms — port 55385
[boot] init-cluster         ok       9777ms — created
[boot] start-postgres       ok       11ms
[boot] await-postgres-ready ok       589ms
[boot] run-migrations       ok       2971ms
[boot] total 13355ms
```

The log is written with `appendFileSync`, not a buffered stream. The first
time a packaged build failed to start, the log the dialog told the user to
send back was **zero bytes** — every line was still in the stream's buffer
when the process died. A startup log that survives only a graceful exit is
worthless exactly when it is needed.

Then the existing `startApi()` spawns the backend against the resolved
`DATABASE_URL` and the renderer's `api:ready` poll takes over unchanged.

A failure at any stage shows a native dialog naming **what the app was doing**
in plain language, plus the underlying error and the log path — then quits.
There is no window yet and no backend, so there is nothing else to show.

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
(`pgdata/`, `pgcredentials.json`, `numba-cache/`, `logs/`). A unit test asserts
no writable path in the layout resolves under the install directory — the bug
it prevents is invisible on a developer's machine, where the app runs from a
writable build tree.

`NUMBA_CACHE_DIR` is set for the same reason: `@njit(cache=True)` writes beside
its source, and the 38.6× that justified taking numba as a dependency is a
*cached*-compile win.

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
