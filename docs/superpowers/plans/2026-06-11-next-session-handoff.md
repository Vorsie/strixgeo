# Overnight Autonomous Plan — Audit Remediation (+ Litho 3D handoff)

> **For the fresh session: this runs AUTONOMOUSLY overnight. Do NOT ask the owner
> any questions — everything you need is here or in the referenced docs.** Use
> `superpowers:subagent-driven-development` and execute continuously. The owner is
> asleep; if an item is genuinely blocked, SKIP it, log why, and move to the next —
> never stop to wait.
>
> Written 2026-06-11 with full context of the day. The overnight work is **§3 (audit
> remediation)**. **§4 (litho 3D dogfeed/merge + the geological-bounding feature) is
> OWNER-PRESENT work — do NOT touch it overnight.**

---

## 0. TL;DR

1. Branch `feat-litho-3d-m3-watertight` was reset to `f66ac920` today (a 70-commit
   floor-clip thread built in the wrong pane was reverted). The good M3 + facies work
   is intact at the tip. **You do not need to understand the litho 3D work to do the
   overnight job.**
2. **Overnight job = execute the audit remediation in §3** (security → silent-failure →
   dead-code/docs → perf → test backfill). Each item is specified file+line in
   `docs/superpowers/2026-06-11-codebase-audit.md`. Subagent-driven, commit per fix,
   **do not push**.
3. **Do NOT** touch the litho 3D builder, do NOT build the geological-bounding feature,
   do NOT merge the branch — those are §4, handled in a **separate** session (the
   geological-bounding feature design is now DECIDED — see §4 — but it is its own
   session, not part of this unattended audit run).
4. When §3 is done (or the night runs out), run the full suite (§5) and write a
   completion summary listing what shipped, what was skipped + why, and any red tests.

---

## 1. Branch state

- **Branch:** `feat-litho-3d-m3-watertight` — **UNPUSHED, do NOT push**
  ([[feedback_git_workflow]]).
- **HEAD:** `f66ac920` (facies-partition tip). Good work intact: M3 watertight bodies +
  facies partition (`litho_*` domain services, `build_body_solids`, `flow_litho_facies`).
- **Reverted today (gone):** the floor-clip / geo-coupled / geo-banded thread. Old tip
  preserved as tag `floor-thread-archive-20260611` (`4124f3ef`) — do NOT delete it.
- **Audit re-landed** at `docs/superpowers/2026-06-11-codebase-audit.md` (commit
  `97ac81aa`) — this is your spec for §3.
- **Baseline suite at this tip is green** (1211 backend unit + integration + e2e). If
  something is red before you start, it is pre-existing (check `test_import_progress`
  flake) — note it, don't chase it.

## 2. The one lesson (so you don't repeat today)

Today's waste: a feature was built in the **2D section render** when it belonged in the
**3D litho builder**. The fix-rule, now in `CLAUDE.local.md`: *establish WHERE a
feature renders / which layer owns it BEFORE building.* This matters for §4 — it does
NOT affect §3 (the audit items are exact-location bug fixes, no ambiguity).

---

## 3. ⭐ THE OVERNIGHT WORK — audit remediation (autonomous, no questions)

**Process:** `superpowers:subagent-driven-development`. One task = one fix (or a small
tight group). Per task: write a failing test where the item is testable → implement the
audit's fix → green → spec-review + code-quality-review subagents → commit **one file
per commit** ([[feedback_git_workflow]], Conventional Commits) → next. **Run the
project `security-reviewer` subagent on every Phase-0 item.** Commit straight to this
branch ([[feedback_pr_review_rhythm]] — delegated debt goes to the branch directly).

The audit (`docs/superpowers/2026-06-11-codebase-audit.md`) is the detailed spec — it
gives exact file:line + the fix for every item. Work the phases in order; phases are
independent of each other so skipping a blocked item never blocks a later phase.

### Phase 0 — Security & correctness hotfixes (do FIRST, run security-reviewer)

- **#1 — migration SQL-injection f-string.** `migrations/versions/ecc4014879af_*.py:102-108`:
  replace `sa.text(f"...extent_{side}...")` with an explicit `if side == 'left' / else`
  branch and `assert side in ('left', 'right')`. Test: a unit test asserting the helper
  rejects any `side` not in the allow-list. (This migration is on a retired body-extent
  column; the fix is about killing the exploitable *idiom*, not the column.)
- **#2 — litho-layer batch IDOR.** Add an optional `model_id` filter to
  `litho_layer_repository.list_layers_by_ids`; thread it from `batch_update_litho_layer_status.py:72`,
  `batch_update_litho_layers.py:69`, `move_litho_layer_boundary.py:96` so a batch can
  only mutate layers in the caller's model. Test: an integration test that a layer id
  from model B is rejected (404/empty) by a batch call scoped to model A.
- **#6 — DB-DSN echo leak.** `infrastructure/db/session.py:9`: `echo=False` (optionally
  gate on a new `SQLALCHEMY_ECHO` env var, default off). No test needed (config change);
  grep-verify no other `echo=settings.debug` site.
- **#15 — `file://` nav wildcard.** `desktop/src/main/security.ts:168-170`: restrict
  `isInAppNavigation` to the loaded renderer directory, not the whole `file://` scheme.
  Test: a vitest asserting an out-of-app `file://` path is rejected, the renderer index
  is allowed.
- **#16 — `SECRET_KEY` soft default.** `shared/config.py:57-64`: raise (hard error) in
  non-dev runs when `SECRET_KEY` is the `change-me` default; drop the default from
  `.env.example`. Test: a unit test that a non-dev env with the default raises.

### Phase 1 — Silent-failure bugs (each one file)

- **#3 — `lens_id` → `body_id`.** `desktop/.../clients/geology.ts:853-856` (+ `:917`):
  the `NameBodyResponse` field is `body_id` on the backend; the client reads `lens_id`
  → `undefined` at runtime. Fix the field + the consumer `InspectLensBodyPanel.tsx:353-356`.
  Test: a vitest that the name-body callback receives the real id, not `undefined`.
- **#5 — swallow-all `except`.** `recompute_all_absences_for_model.py:270`: narrow
  `except (ValueError, Exception)` to `(ValueError, LookupError)`; add `rollback()` +
  re-raise on anything else (no partial commit on an unexpected error). Test: a unit
  test that an unexpected error propagates and does not commit a partial batch.
- **#19 — dead `openExtentLengthM` setting.** `SectionPanel.tsx:2960`: forward the
  already-in-scope prop into `PartitionFillOverlay` (`:134`). (Low risk; if the prop
  path is unclear after reading both sites, SKIP and log — it's a minor UX setting.)

### Phase 2 — Retired-system cleanup (delete code first, THEN fix docs)

- **#13 — delete orphans** (the audit §7 verified zero production importers):
  `components/sections/BodyBandOverlay.tsx` + `utils/bodyBands.ts` (+ test),
  `domain/services/classify_enclosed_lenses.py` (+ test), `lens_identity.py` (+ test),
  `lens_boundary_geometry.py` (+ test). Before deleting each: grep the repo for any
  importer; if one exists that the audit missed, SKIP that file and log it. Run the
  suite after the deletions.
- **Stale type exports** (audit §3): drop `AutoCorrelateResult` (`geology.ts:816`),
  `LithoCorrelationEdge` (`:790`); rename `acceptContactCorrelations`
  `lenses_created/removed` → `bodies_*`. tsc must stay clean.
- **#12 — fix the 3 reference docs** to stop describing the retired body-extent system
  as current: `docs/domain-model.md:66-116`, `docs/api.md:682-740`, and the
  body-extent mentions in `docs/desktop.md` / `docs/architecture.md`. Match the docs to
  the actual tree (DetectBodies / extent kinds / SuggestBodyPinchOuts are GONE — see the
  body-extent-retirement note in CLAUDE.md "Known Architectural Debt").

### Phase 3 — Performance (only if Phases 0–2 are done; each is contained)

- **#10 — N+1 resolver UPDATE.** `resolve_litho_instances_use_case.py:250-257`: group
  layer ids by `body_id`, issue one `update().where(id.in_(ids))` per body instead of
  per-layer. Test: an integration test asserting the update count drops (or a query-count
  assertion via the SQLAlchemy listener recipe in [[feedback_profile_before_optimizing]]).
- **Missing index** (audit §3): add a partial index
  `litho_contact_correlation_edge(model_id) WHERE user_approved = TRUE` via an Alembic
  migration. Migrate the integration DB via the wrapper, not the dev DB
  ([[feedback_dev_db_no_truncate]]).
- **`partitionFill.ts` hot-loop allocations** (`:445`, `:571`): hoist the
  `otherFormations` Set out of the `while`; precompute the correlated-partner map once
  for `classifyTermination`. Behaviour must not change — the existing partitionFill
  vitest suite is the guard. **Do NOT** attempt audit #4 (the `screenRegions` memo
  split on `PartitionFillOverlay.tsx`) overnight — it's a god-component perf refactor
  that wants owner eyes; leave it.

### Phase 4 — Test backfill (if time remains)

- **#8 — `MoveLithoLayerBoundary`** validation branches (`move_litho_layer_boundary.py:57-161`):
  unit tests for the 4 validation branches (zero/negative thickness, out-of-order,
  tolerance, scope).
- Mock-only guard tests for `_checksum_picks`, `UpsertFormationAbsence`,
  `RecomputeAllAbsencesForModel` (run in pre-commit).

### Phase 5 — Electron EOL bump (#7) — LAST, optional

- `cd desktop && npm install electron@42` (latest patch in the 42 line) — then re-run
  the e2e suite (§5). If e2e goes red on the bump and you can't resolve it cleanly,
  REVERT the bump and log it for the owner — do not leave the suite red.

**Skipping rule:** any item that turns out to need a judgement call you can't make from
the audit + code → SKIP it, log a one-line reason in your completion summary, continue.
Never block the night on one item.

---

## 4. SEPARATE SESSIONS — not part of THIS unattended audit run

These are NOT for the overnight audit run — they get their own sessions. Listed here so
you know to leave them alone tonight.

- **Litho 3D dogfeed + merge.** The M3 + facies builder has never been owner-dogfed on
  `test.strix`. The owner will Build the 3D solids, confirm no hairlines/overlaps, then
  merge to develop via `finishing-a-development-branch`. Needs a human looking at the 3D
  render — not an overnight task.
- **3D geological-unit bounding feature** (what the reverted thread was trying to do,
  aimed correctly at `build_body_solids`; the 2D section is the INPUT, not the target).
  The owner is starting a **separate fresh session** for this. **The product design is
  DECIDED (owner directive 2026-06-11): geology prevails — interfingering can NEVER
  cross a geological boundary; litho interfingers ONLY within each geological unit.**
  Geological surfaces are the HARD outer bounds; the existing litho partition
  (correlations / bodies / facies / `computeSectionFill` / the 3D fence) fills WITHIN
  each geological band; the deepest band is bounded below by the observed-base surface.
  Full model in `CLAUDE.local.md` → "The geo-coupled MODEL". That session's path:
  `superpowers:brainstorming` (implementation only — the product question is answered)
  → `writing-plans` → build in `build_body_solids`. **Still do NOT start it in the
  overnight audit run — it is a different session.**

---

## 5. Verification (run at the end, before the completion summary)

```
uv run pytest tests/unit -q                          # backend unit
.\scripts\run-integration-tests.ps1 -q               # integration (sibling DB via wrapper, NEVER the dev DB)
cd desktop; npm test; npx tsc --noEmit -p tsconfig.web.json   # vitest + types (Node 22.x — [[project_node_22_pin]])
.\scripts\run-e2e.ps1                                 # e2e (only if you touched desktop or did Phase 5; CLOSE the dev app first — :8765)
```

All must be green. If a fix you made is red and you can't resolve it, REVERT that fix
(`git revert` the single commit) and log it — leave the suite green, not broken.

## 6. Hard DO-NOTs

- Do NOT push the branch.
- Do NOT touch the litho 3D builder or build the geological-bounding feature (§4).
- Do NOT merge the branch.
- Do NOT attempt audit #4 (PartitionFillOverlay memo split) or the big pre-ship renames
  (#14 `contact_a_id`→`layer_a_id`) overnight — owner-present.
- Do NOT run bare `uv run pytest tests/integration` against the dev DB — wrapper only
  ([[feedback_dev_db_no_truncate]]); both integration and e2e share the integration DB,
  re-seed the fixture before e2e ([[feedback_integration_tests_wipe_e2e_fixture]]).
- Do NOT delete the `floor-thread-archive-20260611` tag.

## 7. Pointers

- Audit (your §3 spec) → `docs/superpowers/2026-06-11-codebase-audit.md`.
- Lessons + the validated geo-coupling model (for §4) → `CLAUDE.local.md` "Lessons
  learned (2026-06-11)".
- 3D builder + facies design (for §4 context) → memory `project-litho-3d-model`.
