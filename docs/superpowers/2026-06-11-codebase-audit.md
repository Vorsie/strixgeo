# Strix Repository — Executive Audit

> **Remediation status (2026-06-12, branch `feat-litho-3d-m3-watertight`, unpushed).**
> Audit-remediation run executed Phases 0–4 of
> `docs/superpowers/plans/2026-06-11-next-session-handoff.md`. **Done:** #1, #2
> (+ two single-layer IDOR paths the security-reviewer surfaced: PATCH `/layers/{id}`
> and `unlink-geo`), #3 (+ the live `lenses_created/removed`→`bodies_*` client mismatch),
> #5, #6, #8, #10, #12, #13, #15 (+ dotdot-traversal hardening), #16 (+ packaged-build
> `ENVIRONMENT=production` injection + empty-key rejection), #19, the missing partial
> index, and the `partitionFill.ts` hot-loop allocations. **Skipped (logged):** #4
> (god-component memo split — owner-present), #7 (Electron EOL bump — major-version bump
> not safe to verify unattended via headless e2e with the fixture wiped), #11/#14/#18 and
> the §4/§5 larger refactors (gated on the geotech stage). All Phase-0 fixes passed a
> `security-reviewer` subagent pass. Suites green at completion.
>
> **Re-landed 2026-06-11 after the floor-clip revert.** This audit ran during the
> (now reverted) floor-clip / geo-coupled-fill thread. Findings **#9** (`_build_fill_meta`
> / `load_floor_inputs.py`), **#17** (PartitionFillOverlay floor-clip divergence), **#20**
> (`refetchLithoContacts` floor-layer race), and the **`#134-C-bulk` PartitionFillOverlay
> multi-record floor clip** candidate reference code that was reverted (`git reset --hard
> f66ac920`) — they are **moot**. Every other finding stands against the current tree.

## 1. Executive summary

The repository is in solid health for a pre-distribution Phase-4 MVP. The layered architecture holds (domain is clean, dependencies flow one way), backend logging discipline is strong, and the Electron security baseline (contextIsolation, sandbox, defusedxml, scope guards) is genuinely good. The dominant risk themes are **(a) a small cluster of real security bugs** — a SQL-injection-shaped f-string in a migration, an IDOR gap in the litho-layer batch endpoints, and a `file://` navigation wildcard; **(b) documentation and code that lie about a retired subsystem** — the 2026-06-06 body-extent retirement left orphaned components, dead domain services, stale docstrings, and three reference docs (domain-model.md, api.md, desktop.md/architecture.md) describing deleted symbols as current; and **(c) a confirmed frontend performance regression** where `computeSectionFill` (LCS + polygon geometry) reruns on every pan/zoom.

The four things that matter most: fix the two High security findings (migration injection + batch IDOR), correct the field-name mismatch that makes lens-naming silently return `undefined`, split the `screenRegions` memo so geometry stops recomputing on scroll, and run the documentation/dead-code cleanup so the next session is not misled by the retired body-extent system. None of the heavy known debt (#106 ORM leak, #201 god-components) needs to move before the geotech gate.

## 2. Top 20 issues (ranked, deduplicated)

| # | Title | Severity | Location | Lenses | Why it matters |
|---|-------|----------|----------|--------|----------------|
| 1 | SQL injection via f-string `sa.text(f"...extent_{side}...")` in migration | High | `migrations/versions/ecc4014879af_*.py:102-108` | Security | Column-name interpolation of DB-derived value; teaches an exploitable idiom |
| 2 | Litho-layer batch endpoints lack per-row model-scope check (IDOR) | High | `batch_update_litho_layer_status.py:72`, `batch_update_litho_layers.py:69`, `move_litho_layer_boundary.py:96` | Security | A known layer UUID from project B is mutable via project A's batch call |
| 3 | `NameBodyResponse.lens_id` vs backend `body_id` — silent `undefined` at runtime | Critical→High | `clients/geology.ts:853-856`, `InspectLensBodyPanel.tsx:353` | Naming, Dead-code | Lens-naming callback receives `undefined`; corrupts downstream state |
| 4 | `screenRegions` memo reruns `computeSectionFill` on every pan/zoom | High | `PartitionFillOverlay.tsx:609-930`, `SectionPanel.tsx:932` | Performance | LCS DP + polygon geometry rebuilt every scroll frame on every section |
| 5 | `except (ValueError, Exception)` swallows all errors, commits partial batch | High | `recompute_all_absences_for_model.py:270` | Simplicity, Logging | Real bugs silently skip a formation; no rollback; partial result committed |
| 6 | SQLAlchemy `echo=settings.debug` leaks DB DSN (password) to backend.log | High | `infrastructure/db/session.py:9` | Logging, Security | DEBUG run prints plaintext DSN; ships in pre-distribution binary |
| 7 | Electron pinned to EOL `42.0.1` (~17 months of Chromium CVEs behind) | High | `desktop/package.json:44` | Dependencies | Lockfile freezes first patch of an EOL line; coworker builds inherit it |
| 8 | `MoveLithoLayerBoundary` has zero unit tests for 4 validation branches | High | `move_litho_layer_boundary.py:57-161` | Testing | Sole boundary-drag write path; pre-commit suite can't catch a tolerance flip |
| 9 | `_build_fill_meta` (floor-clip fill lithology) untested | High | `load_floor_inputs.py:130-185` | Testing | Wrong fill formation looks right in 2D but mis-assigns 3D solid body_id |
| 10 | N+1 `UPDATE litho_layer SET body_id` loop in resolver | High | `resolve_litho_instances_use_case.py:250-257` | Performance | One round-trip per layer on every accept/auto-correlate/startup sweep |
| 11 | #106 — application layer directly queries ORM (scope has grown) | High | `application/` — 34 files, 152 import lines | Architecture, DRY | Each new use case re-rolls raw `select()`; thins unit-testability |
| 12 | Reference docs describe retired body-extent system as current | High | `domain-model.md:66-116`, `api.md:682-740` | Docs | Fresh session implements/calls deleted symbols (DetectBodies, extent kinds) |
| 13 | Orphaned components/services from body-extent retirement | Medium | `BodyBandOverlay.tsx`+`bodyBands.ts`, `classify_enclosed_lenses.py`, `lens_identity.py`, `lens_boundary_geometry.py` | Dead-code | Zero production callers; inflate search space, mislead architecture reads |
| 14 | `contact_a_id`/`contact_b_id` columns FK `litho_layer.id`, not `formation_contact` | High | `litho_contact_correlation_edge_orm.py:127-138` | Naming | Column names actively lie about their referent; pre-ship is the time to rename |
| 15 | `isInAppNavigation` allows all `file://` URLs in production | Medium | `desktop/src/main/security.ts:168-170` | Security | will-navigate bypass to arbitrary local files if renderer is ever compromised |
| 16 | `SECRET_KEY` default is a warning, not a hard error | Medium | `shared/config.py:57-64` | Security | `change-me` ships to coworkers; forges any future signed token |
| 17 | PartitionFillOverlay ignores floor clips → 2D/per-column disagree | Medium | `PartitionFillOverlay.tsx:533-571` | Correctness | Deepest unit drawn past clip depth between columns; tells two stories |
| 18 | Corridor-investigation query duplicated 3×, one uses wrong bbox geometry | Medium | `recompute_formation_absences_for_body.py:73-136` + 2 more | DRY, Architecture | Auto-correlate/snapshot/absence corridors can silently diverge |
| 19 | Dead user setting: `openExtentLengthM` wired 4 layers, never reaches overlay | Medium | `PartitionFillOverlay.tsx:134`, `SectionPanel.tsx:2960` | Maintainability | Engineer changes the setting on dogfeed, nothing happens |
| 20 | `refetchLithoContacts` floor-layer fetch has no cancellation guard | Medium | `useGeologicalModel.ts:1313-1318` | Correctness | Model-switch mid-fetch writes stale floor clips into the new model's view |

## 3. Quick wins (<1 day)

- **Migration SQL injection** — `migrations/.../ecc4014879af_*.py:102-108`: replace `sa.text(f"...extent_{side}...")` with an explicit `if side=='left' / else` branch + `assert side in ('left','right')`.
- **Batch IDOR** — `litho_layer_repository.list_layers_by_ids`: add optional `model_id` filter; thread it from the 3 use cases (`batch_update_litho_layer_status.py`, `batch_update_litho_layers.py`, `move_litho_layer_boundary.py`).
- **lens_id → body_id** — `clients/geology.ts:853-856` + `:917`; fix consumer `InspectLensBodyPanel.tsx:353-356`.
- **Swallow-all except** — `recompute_all_absences_for_model.py:270`: narrow to `(ValueError, LookupError)`, add `rollback()` + re-raise on others.
- **DB DSN echo** — `infrastructure/db/session.py:9`: `echo=False` (gate on a separate `SQLALCHEMY_ECHO` env var if needed).
- **Electron bump** — `npm install electron@42` (latest patch in line), re-run e2e.
- **`file://` wildcard** — `security.ts:168-170`: restrict to the loaded renderer directory, not the scheme.
- **`SECRET_KEY` hard error** — `shared/config.py:57-64`: raise in non-dev runs; drop default from `.env.example`.
- **`openExtentLengthM` dead setting** — `SectionPanel.tsx:2960`: forward the already-in-scope prop into `PartitionFillOverlay`.
- **refetch race** — `useGeologicalModel.ts:1313`: add a local cancel flag (or extract `refetchFloorLayers` with an AbortController).
- **N+1 resolver UPDATE** — `resolve_litho_instances_use_case.py:250`: group by `body_id`, one `update().where(id.in_(ids))` per body.
- **Delete orphans** — `BodyBandOverlay.tsx`/`bodyBands.ts`(+test), `classify_enclosed_lenses.py`, `lens_identity.py`, `lens_boundary_geometry.py` (+ their tests).
- **Stale type exports** — drop `AutoCorrelateResult` (`geology.ts:816`), `LithoCorrelationEdge` (`:790`), `acceptContactCorrelations` `lenses_created/removed` → `bodies_*`.
- **Add missing index** — partial index `litho_contact_correlation_edge(model_id) WHERE user_approved=TRUE`.
- **Hot-loop allocations** — `partitionFill.ts:445` hoist `otherFormations` Set out of the `while`; precompute correlated-partner map for `classifyTermination:571`.
- **Quick perf tests** — add unit tests for `_checksum_picks`, `UpsertFormationAbsence`, `RecomputeAllAbsencesForModel` guards (all mock-only, run in pre-commit).
- **Constant/naming hygiene** — replace 5 raw `"lithostratigraphic"` literals with `MODEL_KIND_LITHOSTRATIGRAPHIC`; move `_LITHO_INT` to `litho_segmentation_constants.py`; rename `materialize_wedge_tips_*` → `materialise_*`.
- **Stale comments/docstrings** — `_sweep_stale_bodies`/`project.py` DetectBodies blocks; 9 `BodyExtentOverlay` comment sites; `litho_lens/__init__.py:3-6` `DetectBodiesResponse`.
- **Toast wording** — replace "see console" with `err.message` in the 9 error-toast sites.

## 4. Medium improvements (1-5 days)

- **Split `screenRegions` memo** (`PartitionFillOverlay.tsx:609`): one data-only memo producing regions in (fraction, elevation) space; a second cheap memo mapping to screen px on pan/zoom.
- **Extract corridor query** (`CrossSectionRepository.get_corridor_investigations`): unify the 3 copies; replace the bbox variant in `recompute_formation_absences_for_body.py` with `project_investigations_onto_section` (fixes geometric mismatch + DRY in one move).
- **Suggest/Validate use-case tests**: `SuggestLithoContacts` priority-fallback, `ValidateModelCrossings` (unit + one integration), `SuggestLithoContacts` wrong-kind paths.
- **`contact_a_id`/`contact_b_id` → `layer_a_id`/`layer_b_id`** rename (ORM + migration + schemas + client) while backwards-compat is suspended.
- **`request_section_id` → `section_id`**, **`parent_geological_model_id` → `parent_model_id`** renames (pre-ship clean).
- **Extract `StartupReconciliation` service** out of `main.py` lifespan; add a `SectionPanel.render.test.tsx` smoke test (TDZ guard).

## 5. Major refactors (>1 week)

- **#106 — repository boundary for the application layer** (34 files): do not big-bang. Enforce "any new use case with >1 raw `select()` extracts a repo method"; route new geotech-stage use cases through repositories. Worth it because every DB-shape change currently fans out through the application layer and starves unit tests of a seam.
- **#201 — `ContactsLayer.tsx` (3,920) / `SectionPanel.tsx` (3,291) split**: trigger on the next axis-type/edit-mode addition in the geotech stage; first extraction is the pure `useContactDrag` state machine. Worth it for bug-context isolation, not before the gate.
- **`auto_populate_contacts_from_stratigraphy.py` (1,573 lines)**: extract the 7-level per-layer block into `_process_layer(...)`; pair with the eventual `StratigraphyCatalogPort` (debt #11) so DOV/BRO catalogs swap without touching the use case.
- **`geology/contacts.py` router (1,476 lines)**: split litho-accept / litho-populate off geological CRUD along the same boundary debt #40 used, before geotech adds handlers.

## 6. Remediation roadmap

**Phase 0 — Security & correctness hotfixes (½ day, do first).** Items #1, #2, #5, #6, #15, #16. All quick, all high risk-reduction. Independent of each other.

**Phase 1 — Silent-failure frontend bugs (½ day).** #3 (lens_id), #19 (openExtentLengthM). Each is a one-file fix; #3 unblocks correct lens-naming.

**Phase 2 — Retired-system cleanup (1 day).** Delete orphans (#13), stale type exports, stale comments/docstrings, then fix the 3 reference docs (#12). Do code deletion before doc edits so doc claims match the tree. Dependency: none, but easiest as one campaign.

**Phase 3 — Performance (1-2 days).** #4 (split memo — highest impact), #10 (N+1 resolver), the index, the `partitionFill.ts` hot-loop allocations. #4 and #10 are independent.

**Phase 4 — Test backfill (1-2 days).** #8, plus `_checksum_picks`, `UpsertFormationAbsence`, `RecomputeAllAbsencesForModel`, `SuggestLithoContacts`, `ValidateModelCrossings`. Land before any geotech-stage edits touch these paths.

**Phase 5 — DRY + naming, pre-ship renames (2-3 days).** #14, #18, `request_section_id`/`parent_model_id`, corridor extraction, electron bump (#7) into the release checklist. Do renames now while backwards-compat is suspended.

**Deferred (gated on geotech stage):** #106, #201, the large file splits.

## 7. Components removable with minimal impact

| File / symbol | Evidence it's safe |
|---|---|
| `components/sections/BodyBandOverlay.tsx` + `utils/bodyBands.ts` + `bodyBands.test.ts` | Zero `import.*BodyBandOverlay` outside the file; `computeBodyBands` only imported by the dead component + its test |
| `domain/services/classify_enclosed_lenses.py` + test | Host-half suppression rule removed with R1/body-extent retirement; no app/api/router importer |
| `domain/services/lens_identity.py` + test | `content_key` column dropped; `body_boundary.py:6` confirms the lookup is gone; no importer |
| `domain/services/lens_boundary_geometry.py` + test | Geometry owned by TS `partitionFill.ts`; no Python importer |
| `AutoCorrelateResult` (`geology.ts:816`), `LithoCorrelationEdge` (`:790`) | Stale fields not in backend schema; zero consumers outside the client barrel |
| `extremeMemberLayerId` export (`bodyAnchor.ts:39`) | Only consumer was retired `BodyExtentOverlay`; only test imports it — unexport or delete |
| `total_wedge_tips_created/deleted` (`recompute_all_absences_for_model.py:58`) | Plumbed through 4 layers; no frontend reader; info already in log line |
| `httpx[http2]` extra + `http2=True` (3 sites) | DOV proven HTTP/1.1-only (live probe 2026-05-17); drops h2/hpack/hyperframe |

(Renames/dead-comment items are cleanup, not removals; listed in Quick wins.)

## 8. Debt-list candidates

**#106 extension — corridor-query unification + repository discipline**
*What:* Extract `get_corridor_investigations` into `CrossSectionRepository` (3 copies, one using a wrong axis-aligned bbox); route the 3 "list all project sections" copies through `CrossSectionRepository.list_all`; enforce repo-method extraction for any new use case with >1 raw `select()`.
*Why deferred:* #106 is intentional Tier-D debt; the geotech stage is the right boundary to start paying it down.
*When to revisit:* First day of the geotech-subdivision stage (not the end of litho).

**API-router-bypasses-use-case-layer**
*What:* Read-only list endpoints (`geology/contacts.py:287`, `cross_section.py:36`, `bodies.py:120`) call repositories directly; extract thin `List*` query use cases.
*Why deferred:* No business logic on these paths today; "never design a layer you haven't needed yet."
*When to revisit:* When a router needs to add a filter, permission, or cache to one of these paths.

**`geology/contacts.py` router split (1,476 lines)**
*What:* Split litho-accept and litho-populate/seed/dedup handlers off geological CRUD onto the same prefix (per debt #40's boundary).
*Why deferred:* Mechanical, no behaviour change; not worth the churn mid-litho-dogfeed.
*When to revisit:* Before geotech subdivision adds new handlers to this file.

**`scipy.spatial.Delaunay` import in domain layer**
*What:* `domain/services/tin_surface.py:51` imports scipy; define a `TinSurfaceComputer` port in domain, move scipy impl to infrastructure.
*Why deferred:* One-directional dependency, not a violation today; same category as #106.
*When to revisit:* When the Phase-5 GemPy/kriging engine lands (the substitution point).

**Result-type co-location carve-out (docs)**
*What:* 32 application files group a use-case class with its result dataclass; either document the exception in CLAUDE.md "Code Conventions" or split.
*Why deferred:* Consistent, intentional, harmless; only the undocumented status is the issue.
*When to revisit:* Next CLAUDE.md conventions pass — add one sentence.

**TS/Python mirrored-pair drift guard**
*What:* `dipExtrapolation`, `sliceTin`/`slice_tin`, `projectPointOntoLine`/`project_point_onto_line` are intentional parallel impls with no machine-enforced link.
*Why deferred:* Correct design for sub-ms render work; risk is only future divergence.
*When to revisit:* Before any Slice-8 true-dip-extrapolation refinement; add cross-reference comments + a debt-file list now.
