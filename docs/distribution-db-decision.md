# Distribution DB fork — decision doc (debt #2)

**Status: DECIDED AND BUILT — Fork A, 2026-08-27.** This document is
kept as the recorded reasoning and as the SQLite escape hatch's
trigger condition; the shipped procedure lives in
[distribution-build.md](distribution-build.md), and debt #2 carries the
status. The Fork B analysis below is unchanged and still the fallback
if embedded Postgres ever fails a clean-box pass in a way that cannot
be mitigated in under a day. It has not.

Original framing (written 2026-05-15 for the "evaluate before
building" step) follows.

**Question.** CLAUDE.md "Distribution model" plans an installer that
bundles Postgres + PostGIS (the Plaxis pattern). The stated fallback
is "SQLite + SpatiaLite if the bundled-Postgres path proves too
fragile — a non-trivial refactor". This doc quantifies *non-trivial*
on both forks against the **actual** codebase surface so the fork is
picked on numbers, not vibes.

Context that bounds the decision (memory `project_coworker_distribution`):
the immediate distribution target is a **trusted internal coworker
binary**, not a paid public release. Coworkers click through
SmartScreen, no NDA, no code-signing required yet. The `.gmproj`
bundle is the data-portability anchor — the DB is a cache.

---

## Fork A — bundle embedded Postgres + PostGIS

### What it takes

* Ship the **PostGIS Windows binary zip** (no system installer).
  Current as of writing: PostGIS Windows Bundle 3.6.2 for PG 14–18,
  released 2026-03-16 — actively maintained, matches our dev Postgres
  major.
* electron-builder `extraResources` carries the `pgsql/` tree
  (~150–250 MB unpacked: `bin/`, `lib/`, `share/`, PostGIS extension
  files + the bundled PROJ grid `share/contrib/postgis/proj` so
  `ST_Transform` works offline).
* Electron main process, first launch:
  1. `initdb -D <userData>/pgdata` (one-time, ~3–5 s).
  2. spawn `postgres -D <userData>/pgdata -p <free port>` as a child;
     kill it on app quit + on `before-quit`.
  3. `CREATE EXTENSION postgis;` + `alembic upgrade head` against the
     fresh cluster.
  4. write the resolved port into the env the FastAPI sidecar reads
     (`DATABASE_URL` — `config.py:24` already env-driven, zero code
     change in Python).
* Subsequent launches: detect existing `pgdata`, just spawn + wait
  for ready.

### Concrete failure modes (clean Windows box, no Docker)

| Mode | Severity | Mitigation |
|---|---|---|
| Port `5433` already taken | medium | **Don't hardcode.** Pick a free ephemeral port at launch, pass via `DATABASE_URL`. Removes the single most likely first-run failure. |
| Defender / AV quarantines `postgres.exe` | medium | Unsigned binary → SmartScreen warns. Coworker context tolerates it (memory). Real fix (EV cert) is debt #6, deferred. Document "allow once" in the coworker README. |
| `initdb` fails on non-ASCII / spaced Windows username in `userData` path | medium | Known Postgres-on-Windows footgun. Use the short (8.3) path or `--locale=C` + explicit `-E UTF8`; test on a `C:\Users\José Núñez\` profile. |
| Orphan `postgres.exe` after Electron hard-crash | low | `pgdata/postmaster.pid` stale-lock detection on next launch; `pg_ctl` handles this. Also kill by recorded PID on startup. |
| Postgres **major** upgrade across an app update | low–med | `pg_upgrade` is heavy for a solo dev. Acceptable shortcut: on major mismatch, `pg_dump` → fresh `initdb` → restore, OR just rely on the `.gmproj` re-open path (the data anchor) and wipe `pgdata`. The bundle format already makes a DB wipe non-destructive. |
| Antivirus real-time scan locks the data dir → slow first write | low | Inherent; coworker-acceptable. Document `pgdata` exclusion as an optional speed tip. |

### Python-side blast radius

**Zero.** `config.py:24` resolves `database_url` from env first.
`session.py` builds the engine from `settings.database_url`. Alembic
`env.py` already honours `DATABASE_URL`. Embedded Postgres is purely
an Electron-main + packaging change — no domain/infra/SQL code moves.

### Effort

**~1–2 days.** Mostly Electron-main process lifecycle + electron-builder
`extraResources` wiring + one clean-box validation pass (port conflict,
spaced-username profile, quit/relaunch, AV warning walkthrough).

---

## Fork B — SQLite + SpatiaLite refactor

### The actual Postgres-specific surface (measured, not estimated)

Grepped `src/`: **202 PG-specific occurrences across 49 files.** The
load-bearing ones:

1. **`ARRAY(DOUBLE_PRECISION)` depth-series columns** —
   `cpt_series_orm.py`: `depths_m, qc_mpa, fs_mpa, u2_mpa, rf_pct,
   q_total_mpa`. **SQLite has no array type.** This is *the* hardest
   schema decision in the project (CLAUDE.md "Depth Series Storage"
   Option C — raw arrays for Polars-friendliness + a summary table).
   SQLite forces either JSON-encoded TEXT (kills the Polars zero-copy
   read, changes the repository contract) or a per-sample child table
   (row-count explosion: a 10 k-row CPT becomes 10 k rows ×
   ~60 k CPTs). Either way the core storage model and every
   `cpt_series` read/write path changes.
2. **PostGIS geometry + spatial functions** — centralised, which
   helps: `spatial_query.py` is the *only* sanctioned spatial path
   (`ST_Within / ST_DWithin / ST_Transform / ST_MakeEnvelope /
   ST_MakePoint / Geography` cast). Writes go through `WKTElement` in
   exactly 2 places (`import_cpt.py:229`, `project_bundle.py:365`).
   SpatiaLite has analogues but: needs `mod_spatialite` shipped +
   loaded per-connection, needs its own PROJ data for `ST_Transform`,
   and the `Geography`-cast metre-distance trick
   (`transformed_distance_filter`) has no clean SpatiaLite equivalent —
   that helper would be rewritten.
3. **`JSONB`** — `formation_surface` vertices/triangles, `view_state`,
   review payloads. Maps to SQLite `JSON1`/TEXT; mechanical but touches
   the bundle restore path (the backwards-compat-critical surface).
4. **`PG_UUID(as_uuid=True)`** — pervasive PK type. SQLAlchemy generic
   `Uuid` exists but flipping it is a whole-schema change + an Alembic
   rewrite.
5. **~20 Alembic migrations** authored with `postgresql.ARRAY`,
   `postgresql.JSONB`, `geoalchemy2.Geometry`. SQLite can't replay
   them as-is. Path: squash to a single SQLite-targeted baseline (and
   maintain two migration lineages forever, since dev/CI may stay on
   Postgres) OR fully port each. Either breaks the "`alembic upgrade
   head` is the contract" simplicity.
6. **Driver swap** `asyncpg` → `aiosqlite`, plus SQLite single-writer
   concurrency (the FastAPI sidecar is async + the import pipeline
   does large single-commit batches — needs WAL mode + serialised
   writer validation).

### Failure modes of *doing* the refactor

* Performance re-baseline mandatory — CLAUDE.local.md's entire bench
  baseline assumes Polars over PG arrays. JSON-TEXT round-trip for
  100 k-row series is the regression risk.
* Two DB backends = two test surfaces (integration suite is
  Postgres-only today, with a hard guard in `conftest.py`).
* Backwards-compat: the `.gmproj` restore path rebuilds PostGIS
  geometry from x/y/epsg — that's contract-bound (format v3). The
  refactor must preserve byte-identical bundle round-trip.

### Effort

**~1–2 weeks** of focused work + a full re-validation + a perf
re-baseline. Matches CLAUDE.md's "non-trivial refactor" wording —
this doc just puts a number on it.

---

## Recommendation — **Fork A (embedded Postgres), SQLite stays a documented escape hatch**

Reasoning, in priority order:

1. **Asymmetric cost: ~1–2 days vs ~1–2 weeks**, and Fork A has
   *zero* Python blast radius vs Fork B touching the project's
   single hardest schema decision (array-backed depth series).
2. **The fallback only triggers on evidence.** CLAUDE.md already
   frames SQLite as conditional ("*if* the bundled path proves too
   fragile"). We haven't run the clean-box prototype yet — choosing
   the 2-week refactor before the 2-day spike has even failed is
   exactly the speculative work the project rules forbid.
3. **The expensive Fork-B work isn't even on the v1.0 critical
   path.** ARRAY depth-series + PostGIS spatial query are core to the
   product; ripping them out for a distribution convenience is a bad
   trade while the MVP gate (geological editor → exports) is the
   actual priority.
4. **Coworker context lowers Fork A's worst failure modes.** The
   scary ones (code-sign/SmartScreen, AV trust) are explicitly
   tolerated for trusted internal testers (memory
   `project_coworker_distribution`); they become real only at debt
   #6, post-validation.

**Proposed build step if Fork A is approved:** prototype the embedded
launcher (binary-zip in `extraResources` + first-run `initdb` +
dynamic-port child-process lifecycle in Electron main + one
clean-box validation pass: port conflict, spaced/non-ASCII username
profile, quit→relaunch persistence, AV-warning walkthrough). Keep
the SQLite analysis in this doc as the recorded escape hatch with
its trigger: *"embedded Postgres fails the clean-box pass in a way
that can't be mitigated in <1 day."*

---

## Sources

* [PostGIS — Installing on Windows](https://postgis.net/documentation/getting_started/install_windows/)
* [PostGIS — Latest released versions (Windows bundle)](https://postgis.net/documentation/getting_started/install_windows/released_versions/)
* [PostgreSQL — Windows binary zip (no installer)](https://www.postgresql.org/download/windows/)
* [PostGIS Installation chapter (custom NSIS / extension files)](https://postgis.net/docs/postgis_installation.html)
