# StrixGeo production-readiness check — 2026-09-02

## Decision

**Closed beta: no-go until findings 1–7 are closed and 8–10 have an explicit
owner acceptance.** This is a desktop product with a loopback API and one
backend per user; it does *not* need a cloud fleet, CDN, multi-tenant RLS, or
paid activation to run a time-bounded closed beta. It *does* need a release
that is freshly built, correct for both supported CRSs, resistant to a rapid
project switch, and unable to turn an unbounded DOV request into an unusable
single-user backend.

**Paid launch: no-go independently of the beta decision.** Activation is
deliberately still a mock-backed prototype, as the activation decision records;
signing is also an explicit prerequisite. Those are not relabelled as beta
regressions below, but they remain release gates before the first checkout.

This is a source audit, not a test pass. It was read against `CLAUDE.md`,
`docs/debt.md`, `docs/design/beta-expiry.md`,
`docs/design/activation-decision-memo.md`, `docs/design/activation-api-contract.md`,
`docs/design/diagnostics-capture.md`, `docs/data-integrity.md`,
`docs/gmproj-format.md`, `docs/backwards-compat.md`, and
`docs/autosave-recovery.md`. Existing debt is cited as context, not counted as
a new finding unless the source exposes a narrower, actionable release failure.

## Ranked, source-verified findings

| # | Severity / release lane | Layer | Source | Failure boundary | Smallest responsible fix | Effort | Debt status |
|---:|---|---|---|---|---|---|---|
| 1 | **High — beta blocker** | CI/CD & release | `desktop/package.json:14-18` | `npm run release` invokes only `electron-builder --publish=always`; unlike `dist`, it does not build the renderer, Cesium, embedded Python, or PostgreSQL. Running it from a checkout with old `out/` or `embedded/` can publish those old inputs. | Delete/replace `release` with a command that publishes a clean `npm run dist` output, or only publishes a CI-produced, checksummed artifact. Exercise that exact command once in a disposable release. | M | #6, sharpened |
| 2 | **High — beta blocker** | Frontend / spatial correctness | `desktop/src/renderer/src/components/MapView.tsx:23,295,528-536`; `desktop/src/renderer/src/utils/verticalDatum.ts:35-41`; `desktop/src/renderer/src/components/SectionOverlays.tsx:264-268` | `MapView` converts every stored CPT and borehole with `lambertToWgs84` (EPSG:31370). The project UI supports EPSG:28992, while the section overlay already uses the generic `projectedToWgs84`. An NL project therefore gets misplaced markers and map-driven selection. DOV pending pins are a separate 31370 source and should stay explicit. | Give `MapView` the effective project EPSG and use `projectedToWgs84` for project-owned rows; add a 28992 marker/selection regression test and retain an explicit 31370 conversion for DOV pins. | M | New |
| 3 | **High — beta blocker** | Frontend / project isolation | `desktop/src/renderer/src/hooks/useInvestigationData.ts:479-518,520-575` | CPT/borehole list requests have no abort or generation guard. Switch A → B while A is slow: A may resolve last and overwrite B's lists. The detail/plot `Map`s are also retained across project changes and cache only by investigation id. The nearby review fetch correctly uses a `cancelled` guard (`:415-474`), showing the missing boundary. | Abort or generation-check every project-scoped request; clear or key all detail/plot caches by project id; test an A-slow/B-fast switch. | S | New |
| 4 | **High — beta blocker** | Rate limiting / availability | `src/groundmodel/api/schemas/cpt/import_dov_request.py:11-14`; `src/groundmodel/api/schemas/borehole/import_borehole_dov_request.py:15-18`; `src/groundmodel/infrastructure/dov/dov_client.py:126-162` | A DOV bbox accepts only four floats. It has no ordering, area, feature-count, or duplicate-request limit before remote enumeration/downloads, cache writes, and database work. One user can make their only backend unusable with a continental or repeated selection. | Shared ordered-bbox + maximum-area validation, a discovered-feature ceiling before download, and a deliberate product limit/error message. | M | #79 related, scope sharpened |
| 5 | **High — beta blocker** | Jobs / memory | `src/groundmodel/application/job_registry.py:51,97-100,124-161`; `src/groundmodel/api/routers/cpt.py:422-460`; `src/groundmodel/api/routers/borehole.py:220-244` | Each import job owns an unbounded event queue. Completed entries are removed on SSE consumption/disconnect; a stream that never attaches retains its task, queue, and terminal pin payload. Repeated starts can grow the backend for the whole session. | Bound queue length, give completed/no-consumer jobs a TTL, and retain only a bounded terminal summary for a late client. Add a no-consumer expiry test. | M | New |
| 6 | **Medium — beta blocker** | API contract / data integrity | `src/groundmodel/api/schemas/project/project_update_request.py:13-36`; `src/groundmodel/api/routers/project.py:220-243`; contrast `src/groundmodel/api/schemas/project/cross_section.py:12-21` | `ProjectUpdateRequest` inherits bare Pydantic `BaseModel`, so an unknown PATCH key is ignored. `model_dump(exclude_unset=True)` then produces no update and the endpoint returns 200 with the old project. Example: `default_horizonal_epsg` silently does nothing. | Use a shared external-write base with `extra='forbid'` for this request and audit other write schemas deliberately; add a typo → 422 contract test. Do not apply blindly to legacy bundle intake, where some ignored fields are compatibility policy. | S | New |
| 7 | **Medium — beta blocker** | Input validation / model integrity | `src/groundmodel/api/schemas/project/body/body_boundary.py:20-63`; `src/groundmodel/api/routers/geology/bodies.py:549-610` | Boundary node coordinates are unrestricted `float`s. Pydantic accepts non-finite float values by default; the full-replace route persists converted nodes. `NaN`/infinity can poison sort/order/render geometry rather than receive a 422. | Make both node coordinates finite (`allow_inf_nan=False` or an equivalent finite validator) and pin NaN, ±∞, and normal-value cases. | S | New |
| 8 | **Medium — upgrade blocker** | Database & storage | `desktop/src/main/embedded/embeddedStack.ts:245-293`; `src/groundmodel/infrastructure/db/migrations/versions/a4b5c6d7e8f9_merge_geo_label_twin_formations.py:60-63` | Packaged startup runs migrations automatically. The cited migration labels itself destructive and non-reversible; the launcher has no pre-migration snapshot/restore checkpoint. The immediate file may already be applied in dev, but the framework currently provides no guard against the next repair migration on a beta user's store. | Add a tested pre-migration backup/checkpoint protocol for data-rewriting migrations and require the migration to declare it. This is a policy/framework fix, not a retrofit of one historical migration. | M | #278 pattern, sharpened |
| 9 | **Medium — acceptance required** | Local API security | `src/groundmodel/api/main.py:261-278,346-370`; `src/groundmodel/api/local_client_token_middleware.py:39-54,97-121` | Production allows `http://localhost:<any port>` by CORS. The launch token protects `Origin: null` only. A remote website cannot claim that origin, but a malicious/local process serving a page on localhost can read or mutate the loopback API while Strix runs. This is a local-adversary boundary, not an internet-exposure claim: binding and trusted-host restrictions are present. | In packaged mode allow only the `file:`/`null` renderer path with the launch token; retain localhost only in development. Verify the app still boots with the exact production CORS policy. | S | New |
| 10 | **Medium — acceptance required** | Observability / availability | `desktop/src/main/index.ts:217-245` | The advertised 5 MiB × 3 rotation is performed when the main log opens, not before every synchronous append. A long verbose session can grow the active log past the cap until restart, consuming the user profile volume and adding UI-thread I/O. | Rotate/check on append or use a bounded rotating writer; add a focused writer test. | S | New |

## Findings deliberately *not* promoted to beta blockers

| Topic | Evidence | Decision |
|---|---|---|
| Paid licence / seats / device binding | `desktop/src/main/activationConfig.ts:32-39,81-104` intentionally selects the in-memory mock while no issuer exists; `docs/design/activation-decision-memo.md:3-12,130-145` schedules issuer, Ed25519 licence and signing before the first paid checkout. | **Not a closed-beta defect. Hard paid-launch gate.** A beta must use the shipped expiry primitive; it must not be represented as paid entitlement protection. |
| Activation status reads fail open | `desktop/src/renderer/src/App.tsx:276-310` opens the workspace when packaged status IPC rejects. | **Hard paid-launch gate** once an entitlement is authoritative. It is not meaningful protection while the current issuer is mock-backed. Change to a recoverable blocked/unknown state in the paid-launch work. |
| Device fingerprint and HTTP issuer URL | `desktop/src/main/deviceIdentity.ts:132-149`; `desktop/src/main/activationConfig.ts:49-83`. | **Paid-launch design work, not a current data path.** No real packaged issuer URL exists yet; enforce HTTPS and choose the approved OS identity source with the actual issuer implementation. |
| RLS / tenant isolation | `src/groundmodel/api/routers/_helpers.py:199-242` provides project ownership checks; the product is currently one local DB/backend per user. | **N/A by design for multi-tenant RLS.** The relevant current boundary is loopback-origin protection (finding 9), not SaaS row-level tenancy. |
| `.strix` save/restore corruption claims | `desktop/src/main/strixCodec.ts`; `desktop/src/main/atomicWrite.ts`; `src/groundmodel/api/routers/project.py:365-535`. | **No finding from static review.** There are output-size limits, temp+fsync+rename writing, and restore integrity/error handling. Runtime recovery remains unexecuted because DB-opening tests were prohibited. |

## Layer verdicts

| Layer | Verdict | Concrete rationale |
|---|---|---|
| 1. Frontend | **GAP** | Findings 2–3 can show the wrong location or stale project data. |
| 2. APIs & backend logic | **GAP** | Silent PATCH success and unrestricted DOV request shape remain. |
| 3. Database & storage | **GAP** | Automatic destructive-migration policy has no user-data checkpoint. |
| 4. Auth & permissions | **GAP** | The per-launch token is sound for `null` origin, but localhost is still a separate un-tokened origin class. |
| 5. Hosting & deployment | **GAP** | The publish command can publish stale release inputs. |
| 6. Cloud & compute | **N/A-BY-DESIGN** | Closed beta is a local desktop backend, not a hosted compute service. DOV work-volume control is assessed in findings 4–5. |
| 7. CI/CD & version control | **GAP** | GitHub CI type-checks and unit-tests, but it does not create/prove the artifact that `release` publishes. |
| 8. Security & RLS | **GAP** | Multi-tenant RLS is N/A; local-origin reachability and hostile numeric input need closing. |
| 9. Rate limiting | **GAP** | DOV has no request-work budget or concurrency policy. |
| 10. Caching & CDN | **GAP** | The in-memory job event queue has no no-consumer bound/expiry. A CDN is N/A for this desktop distribution. |
| 11. Load balancing & scaling | **N/A-BY-DESIGN** | There is deliberately one backend per desktop user; capacity limits must instead protect that one process. |
| 12. Error tracking & logs | **GAP** | Crash/error paths exist, but the stated active-log cap is not enforced during a session. |
| 13. Availability & recovery | **GAP** | Atomic save/recovery code is encouraging, but upgrade rollback needs a checkpoint and the already-recorded last-good-save guard (#225) is still open. |

## Closed-beta top 10, in order

1. Make release publication consume a fresh, verified `dist` artifact (finding 1).
2. Correct map conversion for every supported project CRS and test EPSG:28992 (finding 2).
3. Make project switches cancel/generation-guard all project-scoped loading (finding 3).
4. Put a product-level area/result limit on DOV imports (finding 4).
5. Bound and expire import job queues (finding 5).
6. Reject typoed project PATCH fields instead of returning a false success (finding 6).
7. Reject non-finite boundary coordinates (finding 7).
8. Choose and implement the upgrade snapshot policy before distributing an update over user data (finding 8).
9. Decide whether a hostile local process is in beta threat model; if yes, remove production localhost CORS (finding 9).
10. Either enforce live log rotation or explicitly accept the disk-growth behaviour for the beta (finding 10).

## Paid-launch exit gates (not beta blockers)

1. Replace the mock issuer with the chosen server + signed offline authority, and make a failed entitlement-status read recoverable but closed.
2. Ship a code-signed installer before activation is treated as tamper resistance (`docs/design/activation-decision-memo.md:144-145`; debt #6).
3. Validate real issuer/diagnostics URLs as HTTPS and complete the device-binding decision with the real server contract.
4. Produce a reproducible signed installer from CI, then run clean-machine install, upgrade, rollback/recovery, and licence-expiry exercises.

## Coverage and limits

* I sampled project-scoped routes and verified the shared `get_in_project_or_404` ownership pattern; I did **not** claim an exhaustive route-by-route authorization proof.
* I did not run integration/e2e, Alembic, embedded PostgreSQL, a package build, installer, or migration: the audit brief forbids commands that open the database or package the product.
* The permitted unit/lint/TypeScript/Vitest commands were attempted earlier but could not run because `uv` and `npx` are unavailable on this host's `PATH`; no passing-test count is implied.
* Static migration inspection is not an Alembic-head check. Clean-profile install, upgrade-with-real-data, EN/NL visual parity, and a 28992 end-to-end map exercise remain unexecuted release gates.

## Gate results

| Command | Result |
|---|---|
| `uv run pytest tests/unit -q` | Not run — `uv` unavailable on PATH. |
| `uv run ruff check src tests` | Not run — `uv` unavailable on PATH. |
| `cd desktop && npx vitest run` | Not run — `npx` unavailable on PATH. |
| `cd desktop && npx tsc --noEmit -p tsconfig.web.json` | Not run — `npx` unavailable on PATH. |
| `cd desktop && npx tsc --noEmit -p tsconfig.node.json` | Not run — `npx` unavailable on PATH. |
