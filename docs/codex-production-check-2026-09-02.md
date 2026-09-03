# Production-readiness check — synthesized final (2026-09-03)

This file started as Codex's independent first pass (ten source-verified rows, 2026-09-02 evening) and is now the single synthesized outcome of both audits after the overnight hardening fleet. The first-pass rows survive as the parenthesised numbers in the table.

One deduplicated table for the two independent audits of 2026-09-02 (`docs/production-readiness-audit-2026-09-02.md`, ids C1–L12; `docs/codex-production-check-2026-09-02.md`, rows 1–10), with what was fixed overnight, what is accepted for the closed beta, and what stays a paid-launch gate. Every "fixed" row names the landed commit range on develop and the test that went red first; nothing here is inferred from a report alone — the session main re-ran each slice's gate on the rebased tree before the fast-forward.

Legend: lane = **beta** (had to be fixed before a closed beta) · **accept** (a risk the owner consciously carries into the beta) · **launch** (paid-launch gate) · **design** (N/A by design for a single-seat desktop app).

## Findings, deduplicated

| Id (Codex row) | Sev | Lane | Finding | Status | Evidence |
|---|---|---|---|---|---|
| C1 | Critical | beta | The installer never expired: `dist` rebuilt the main bundle without the stamp env. | **FIXED** | `desktop/scripts/require-beta-stamp.mjs` pre+post in `package`; stamped installer 20:03 verified (`2026-10-15`). |
| C2 (9) | Critical | beta | Launch token skipped for any present Origin; localhost CORS in production; CSRF multipart into `/cpt/import`. | **FIXED** | apisec slice: token required whenever an Origin header is present, localhost regex development-only; red-first `test_local_client_token.py` (remote-origin multipart → 403, nothing written). |
| C2b | High | beta | Unscoped CPT duplicate lookup let a confirmed refresh overwrite a CPT in another project. | **FIXED** | `cpt_repository.py` always scopes (project or `IS NULL`); red-first `test_cpt_repository_scope.py`; integration pins in `test_cpt_import_refresh.py`. |
| C3 | Critical | beta | Packaged licence gate decorative: mock issuer with demo keys, `STRIX_E2E` bypass, renderer-only block, no device binding. | **FIXED (a–d)** | activation slice: `UnreachableActivationRepository` when packaged without an issuer; e2e flag gated on `!isPackaged`; `device_mismatch` state with MachineGuid in the device id; main-side `activationBlocksLaunch` wired before `startApi()` (backend deferred until activation, window still shown). Rule: a beta build runs on its stamp; a non-beta packaged build with no issuer cannot activate. |
| C3+ | High | beta | Activation status read failure opened the workspace (Codex "not promoted"); plain-http issuer URL accepted. | **FIXED** | fail-closed in `activationGate.ts` for packaged non-beta builds; `sanitizeIssuerUrl` refuses non-https except dev loopback. |
| C4 (1) | Critical | beta | `release` published whatever was on disk; no provenance; reused Python tree never re-verified; 593 unpushed commits. | **FIXED (code)** / **owner (push)** | release slice: `release` chains `dist`; `require-clean-release.mjs` refuses dirty/unpushed/stale-version; git SHA + build time inlined and shown in About and the boot log; `MANIFEST.sha256` verified on reuse; `--frozen` export; weekly CI schedule. Pushing develop remains the owner's call. |
| H1 | High | beta | Quit stopped the backend before the save prompt. | **FIXED** | `backendLifecycle.ts`: stop on `will-quit` / `window-all-closed` only; source pin against `before-quit`. |
| H2 (8) | High | beta | No backups; one-way migrations at launch; older build over newer DB bricked boot. | **FIXED** | dbrecov slice: three `.strix` generations (`writeFileAtomicKeepingGenerations`), `pg_dump -Fc` checkpoint before any pending migration (retention 5, `DATA_REWRITE` declared on the five rewriting migrations), `NewerDatabaseError` (exit 6) with named copy, `PG_VERSION` major check, migration timeout scaled by data size. |
| H3 | High | beta | Backend/main/renderer death had no recovery path; orphaned uvicorn adopted with a stale token. | **FIXED** | lifecycle slice: respawn once (`backendRespawnPolicy`), packaged probe with `Origin: null` + token refuses a foreign backend, children stopped before `process.exit(1)`, renderer reloaded once (`rendererGonePolicy`), restart banner in the renderer. |
| H4 | High | beta | `project:add-recent` authorised any path; save dialogs pre-filled unsanitised names. | **FIXED** | recents refuses unauthorised paths; `sanitizeSaveDialogDefault` on both dialogs. |
| H5 | High | launch→done early | No launch-time activation refresh. | **FIXED (dormant)** | `refreshOnLaunch()` wired after launch; inert without an issuer URL. |
| H6 | High | beta | Unsigned auto-update installed silently on quit. | **FIXED** | `autoInstallOnQuit(APP_IS_SIGNED=false)`; explicit Install-now path retained. |
| M1 | Medium | beta | Live Postgres cluster in the Roaming profile. | **FIXED** | `pgdata` and logs under `%LOCALAPPDATA%\StrixGeo`; one-time verified move of an existing Roaming cluster; `numba-cache` (rebuildable) also moved via `configureNumbaCacheRoot` (parity slice). |
| M2 (4) | Medium | beta | Corrupt DOV cache hit permanent, no fsync; no 429 back-off; unbounded bbox. | **FIXED** | bounds slice: bbox order/size/area 422 (25 km side, 625 km², 2000 features), discovery ceiling before download, duplicate-job 409, cache invalidate+refetch once, fsync before rename, `Retry-After` back-off with parallelism halving (CPT path). |
| M3 | Medium | beta | No timeouts anywhere. | **FIXED** | `lock_timeout` 30 s / `statement_timeout` 5 min / idle-in-transaction 5 min on the engine; 55P03 → 409 `lock_timeout`, `BodyPartitionContentionError` → 409 naming the holder; renderer 60 s timeout on quick mutations with a `SLOW_MUTATION_HINTS` carve-out for builds, imports, exports and restore. |
| M4 (6) | Medium | beta | Write payloads accepted unknown fields; lazy-load-by-default. | **FIXED / tripwire** | `StrictRequestModel` (`extra=forbid`, `allow_inf_nan=False`) on 66 request models; six shared request+response schemas and the bundle intake stay lenient by documented policy; `lazy=RELATIONSHIP_LAZY` on all 35 relationships, `raise` opt-in via `STRIX_ORM_RELATIONSHIP_LAZY` for an integration tripwire run. |
| M5 | Medium | beta | One root ErrorBoundary. | **FIXED** | `StageErrorBoundary` around the stage slot with reset and diagnostic capture. |
| M6 | Medium | beta | Hidden sheet-PDF window less hardened. | **FIXED** | `sandbox: true`, packaged devtools off, shared `windowGuards`. |
| M7 | Medium | accept→partly fixed | 5000-CPT rendering; continuous Cesium render; voxel build without progress/cancel; plot-batch cap unchunked. | **FIXED except voxel** | canvas markers + shared tooltip, windowed lists (~19 DOM rows for 5000), Cesium request-render mode, plot-batch chunked by 500. Voxel progress/cancel needs a job channel → debt #282 (accepted for beta). |
| M8 | Medium | beta | Newer-DB / slow migration had no cause on screen. | **FIXED** | named copy in `bootFailureMessage.ts` + backend exit codes 5/6. |
| (2) | High | beta | Project-owned markers converted with Lambert 72 regardless of project CRS. | **FIXED** | `mapMarkers.ts` + `viewportFilter` use `projectedToWgs84(epsg)`; DOV pins stay explicit 31370; red-first 28992 test (a 1.3° error before). |
| (3) | High | beta | Project-switch races and caches keyed by investigation only. | **FIXED** | generation guard + clear-on-switch in `useInvestigationData`; proj4 caches cleared on project change. |
| (5) | High | beta | Unbounded job queues, no no-consumer expiry. | **FIXED** | bounded queues (256, terminal event kept), finished-job TTL 300 s, 64-job cap, duplicate-key guard. |
| (7)+L7 | Medium | beta | Non-finite numbers accepted (boundary coordinates, GEF values). | **FIXED** | `allow_inf_nan=False` on strict schemas; GEF parser nulls non-finite values, ERROR issue on a non-finite depth. |
| (10)+L1 | Low | beta | Main log rotated only at launch. | **FIXED** | rotating appender re-checks size mid-session. |
| L2 | Low | beta | 4xx refusals invisible in packaged logs. | **FIXED** | `api-refusal` diagnostics with `detail.code`. |
| L3 | Low | beta | Redaction missed quoted names; bundle ids collided. | **FIXED** | `redactMessage`; random UUID bundle ids. |
| L4 | Low | beta | Newer inner `format_version` read as corrupt. | **FIXED** | typed "saved by a newer build" reason (EN/NL). |
| L5 | Low | beta | `sample.geotech_body_id` bare UUID. | **FIXED** | migration `c6d7e8f9a0b1`: FK ON DELETE SET NULL after nulling danglers. |
| L6 | Low | beta | Restore caps dropped rows silently. | **FIXED (counts)** | `ProjectRestoreResponse.dropped_series/dropped_child_rows`; toast wiring left (counts are logged). |
| L8, L9 | Low | beta | Memo caches never cleared; 2D map silent offline. | **FIXED** | `clearProjectScopedCaches`; `MapOfflineBanner`. |
| L10 | Low | beta | Gate skips compounded on one laptop. | **FIXED** | weekly CI schedule; scheduled runs pin `ref: develop` on checkout (parity slice) so the quiet-week run verifies develop, not the stale default. |
| L11 | Low | launch | Routers reach the ORM directly (#106). | **open** | unchanged; tracked. |
| L12 | Low | beta | 500 handler promised "not applied". | **FIXED** | truthful wording. |
| #47 | Tier B | beta | Bundle column auto-enumeration. | **RESOLVED** | column set pinned per array; `generation_id` promoted to `_SKIP_COLUMNS`. |
| #104 | Tier D | beta | Three-level export gap. | **VERIFIED RESOLVED** | truth table: all six exporters × three levels carry geometry and identifiers; Plaxis 3D guard pins added. |
| #107 | Tier D | accept | Schema remainder. | **re-verified** | co-nullation CHECK obsolete under A2; `app_project_id` NOT NULL blocked by three optional-project import routes (owner call at re-arm); no missing FK/index on newer tables. |
| #278/#279 | — | beta | Litho/geotech advisory-lock deadlock (found by the sweep). | **FIXED** | sibling geotech locks before any litho write, `no_autoflush` in the lock helper, clear-litho and delete-body covered; BP-3 race 7/40 → 0/40; BP-1 re-armed. |

## Accepted for the closed beta (owner carries these consciously)

- Unsigned installer (SmartScreen prompt) until the KBO registration enables organisation validation (debt #6).
- Activation is prototype-grade: no issuer URL, unsigned licence file, device binding is a deterrent not a proof; a beta build runs on its stamp (expires 2026-10-15).
- Voxel build has no progress or cancel (debt #282).
- `lazy="raise"` ships off; the tripwire run is owed.
- Six shared request+response schemas stay lenient by design.
- `SheetMap.tsx` still converts with Lambert 72 (PDF sheet map; needs the project EPSG in the payload).
- The four new backend error codes show the server's English message in an NL app.
- Push of develop and a CI run have not happened (owner's call).

## Closed after this audit — parity slice (2026-09-03)

Three items above were closed by a follow-up parity slice (all TDD, red-first):

- **Borehole DOV parity.** The borehole import now threads ONE shared `DovRateLimitState` through every sub-client (boring + interpretation + sample + grain-size + scalar), so a 429 seen by any of them halves the download parallelism once for the rest of the import — matching the CPT path. The borehole duplicate lookup (`borehole_repository.py`, both `find_by_project_test` and `find_existing_test_ids`) now always scopes `app_project_id` (project, or `IS NULL` when none), so it never crosses projects, exactly like the CPT fix.
- **`numba-cache` under `%LOCALAPPDATA%`.** `buildBackendEnv` now roots the compile cache under an optional configured machine-local root (`configureNumbaCacheRoot`, default = `userDataPath`), wired next to `configurePgdataRoot` on a packaged launch — so the rebuildable cache leaves the synced Roaming profile with the cluster.
- **Scheduled CI on develop.** The `ci.yml` checkout step pins `ref: develop` for scheduled runs only (`github.event_name == 'schedule'`); push/PR runs pass an empty ref and are unchanged — so the weekly run verifies develop instead of the stale default branch.

## Paid-launch gates (not beta blockers)

1. Real issuer on strixgeo.com + Ed25519-signed licence + device binding as proof (debt #3/#5).
2. Code signing certificate and signed auto-update (debt #6).
3. Fail-closed activation with server-side seat authority; self-service transfer already exists.
4. Backups: user-visible restore of a `.strix` generation and of a pre-migration dump.
5. #106 application layer welded to the ORM; the `lazy="raise"` default once the tripwire run is clean.

## Evidence

Final gates (2026-09-03 morning): backend unit 3113 passed; desktop tsc clean, full Vitest 626 files / 5435 tests; full integration suite under `STRIX_ORM_RELATIONSHIP_LAZY=raise` 951 passed / 13 skipped / 0 failed (raise is now the default); full e2e sweep 119 passed / 6 skipped with every red passing solo (22 tests, zero backend errors) — the two fixture reds were the new import limit (fixture shrunk), one was the batch-accept ‖ recompute row-lock race (closed by the litho-writers slice), the rest the known load flakes. The final develop head is recorded in CLAUDE.local.md and the morning dogfeed guide.

Landed on develop overnight: activation, frontend, scaling, #47, #104, bounds, dbrecov, lifecycle, release, apisec, plus the earlier deadlock fix, sheet/tutorial fixes, sample mechanism, deactivate dialog, compile Q1, #156, exporter dedup, SectionPanel Phase B, diagnostics transmit. Each slice's own gate (unit suite / full Vitest / tsc) was re-run on the rebased tree before its fast-forward; integration files named by the builders ran through the wrapper where the DB was free. Final gates and the e2e sweep are recorded at the end of this document.

## Go / no-go for the closed beta

GO, with the accepted list above stated to the testers in the onboarding note (unsigned installer, beta expiry date, no licence needed). The stamped installer must be rebuilt from the final develop head so it carries every fix in this table.
