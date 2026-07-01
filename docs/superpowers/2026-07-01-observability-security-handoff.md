# Handoff — Observability/Testing Audit + Restore-Path Security — 2026-07-01

**For a fresh session.** Picks up the whole-codebase observability + testing audit
(and a security detour that came out of it). Read this top-to-bottom before touching
anything.

---

## 1. Branch state

- **Branch:** `feat-geotech-body-samples-3d` — **122 commits ahead of `develop`, UNPUSHED.**
- **Working tree:** clean (all tracked changes committed).
- **Push policy:** DO NOT `git push`. The owner pushes. Commit per-file only.
- Untracked scratch you can ignore: `*.html` mockups at repo root, `scripts/throwaway_*`,
  and `desktop/src/renderer/src/utils/partitionFill.cs1render.test.ts` (pre-existing
  untracked arbiter gate — not created this session; leave it unless asked).

This branch carries THREE layered bodies of work, oldest→newest:
1. **Geotech body model** (Phase A — packing subdivision → watertight 3D + lab-sample
   assignment; LCS-match auto-correlate). Done + real-data validated on CS1 earlier.
2. **Whole-codebase observability + testing audit** (`docs/superpowers/2026-06-30-observability-testing-audit.md`) — the live backlog. Partially applied.
3. **Restore-path IDOR security closure** (this session's main output).

---

## 2. What this session completed (all verified, all committed)

### 2a. Cross-project IDOR class — CLOSED across the `.strix` restore path ✅
A `testing-reviewer` found geotech-unit restore lacked a `geological_formation_id`
scope guard (a malicious/shared `.strix` restored into project A could insert rows
FK'd to project B's data — the DB accepts the FK because the referenced row exists
under another project). Fixed, then a `security-reviewer` pass proved the *class*
wasn't closed and found four more siblings. All now guarded:

| Fix | Entity | Guard | Sev |
|---|---|---|---|
| geotech unit | `GeotechnicalUnitOrm.geological_formation_id` | `valid_formation_ids` scope + integrity-key `"formation_id"`→`"geological_formation_id"` | (original) |
| #1 | `FormationContactOrm.borehole_id`/`cpt_id` | anchor vs `valid_inv_ids`; synthetic contacts (both null) pass | **HIGH** |
| #2 | `FormationAbsenceOrm.investigation_id` | scope-check polymorphic UUID (no DB FK exists) | MED |
| #3 | `LithoBodySolidOrm.vertices`/`triangles` | `_MAX_TIN_ARRAY_LEN` cap + blank + `is_stale` (OOM vector) | MED |
| #4 | review `target_kind` | allow-list before id-dispatch (garbage kind → clean drop, not a 500) | LOW |

- New shared helper `_build_valid_inv_ids` (DB rows ∪ payload ids) in
  `bundle_restore_core.py`, threaded into `_restore_geological_models`,
  `_restore_bodies` (replaced its duplicate local build + dead `CptOrm`/`BoreholeOrm`
  imports), and `_restore_formation_absences` in `bundle_restore_litho.py`.
- **Deferred (documented, not built):** two LOW self-FK items —
  `FormationContactOrm.parent_geo_contact_id` — bounded by `SET NULL`. Also the
  security-reviewer's structural-validation-on-solids parity (`_validate_tin_payload`
  on litho solids) was NOT added — only the size cap (matches the committed test; a
  malformed-but-not-oversized solid is uncovered). Pick these up if hardening further.
- **Commits:** `76bd219c`, `f3a37552`, `6bc1fd52`, `1f596755`, `9f90dadf` (earlier
  geotech-unit batch) → `7c293da9`, `2b3e5d97`, `101676ca`, `5d01cde8`, `34441d86`
  (this session's HIGH/MED/LOW closure + fixture fix + lessons).
- **Verification (real gate, READ not trusted):** `test_restore_project_idor.py`
  **13 passed**; **1572 unit tests pass**.
- **⚠ A subagent flaked mid-fix** (committed 669 lines of tests for 4 fixes but applied
  ~none; truncated off-topic final message). Recovered directly. See lesson 8/9 below.

### 2b. Observability/testing audit — items already applied on this branch
From `docs/superpowers/2026-06-30-observability-testing-audit.md`:
- **A1 geotech logging** (L1–L6): CPT→skeleton reason, empty-stack edges, missing-XY,
  zero-CPT, Phase-8 provenance + materialise summary.
- **A3 builder self-timing:** `shared/timing.py::phase_timer` (WARNING+FAILED on
  exception — `2888ee0a`/`42e8a63c`); wired into `build_voxel_litho_model` +
  `recompute_litho_solids` (`eda81faf`/`46201085`).
- **L-A backend logging:** `restore_project` + `import_cpt_job` entry/exit/reject/error
  (`b6e5db85`).
- **C frontend logging:** `ContactsLayer` drag-branch INFO promotions (kept per-drag at
  DEBUG after a logging-reviewer pass), `shared.ts` server-`detail` on errors,
  `PartitionFillOverlay` caller log (partitionFill.ts kept pure).
- **B/D testing:** voxel `is_flagged` structurally-zero unit test + strat-path
  fire test (`1dcf2834`); always-on frozen CS1 partition gate + anonymised fixture
  (`7adc650a`/`b87fca3c`/`8145c1c9`); warp-transform render tests for
  `PartitionFillOverlay` (`75620adb`, + the untracked `cs1render` file).
- **Process fix:** `.githooks/pre-push` runs the integration suite when
  `src/groundmodel/**` or `tests/integration/**` change.
- **The 3 audit agents CREATED + registered:** `.claude/agents/{logging-reviewer,
  testing-reviewer,debugging-scientist}.md`; `docs/subagents.md` now lists 9.
- **`docs/lessons-learned.md`:** 9 lessons (referenced from CLAUDE.md).

---

## 3. What's PENDING — the backlog tail (open)

Work `docs/superpowers/2026-06-30-observability-testing-audit.md` down with the
**dedicated reviewer agents** (see §5). Roughly in the audit's suggested order.

> **Session 2 progress (2026-07-01 cont.) — DONE this session (commits `89cc6f9b`→`b82db732`):**
> - **A2 ingest logging: COMPLETE (all 8 gaps).** WFS response status/size/latency/count
>   (`1c58a907`), per-item download size+latency TRACE (`6ca3bb97`), `_parse_cone_metadata`
>   `(None,None)` + empty-conustype routing traces (`bda6164b`), scalar/Atterberg
>   dropped-value reasons + empty-curve grain-size (`10313625`), WFS recursion-saturation
>   bbox corners (`c1a56bd9`), GEF latin-1 fallback INFO (`91e47f09`), process-pool-vs-
>   network failure classifier + test (`88754336`/`eda6ae38`).
> - **A3 exports: DXF/Plaxis DONE.** DXF dropped-contact tally + split WARNING (`93e4c223`),
>   Plaxis empty-snapshot identity + dropped-borehole log (`531b7700`), + tally-arithmetic
>   tests (`059a1869`/`e586ef7b`). STILL OPEN: `get_project_bundle` (~10 MB) + `duplicate_project`
>   deep-clone unlogged.
> - **Frontend hooks: 3 of 5 DONE** (50 tests). `useLithoSuggestions` (`89cc6f9b`, 23),
>   `useContactCrud` create/delete (`d6778ad8`, 10), `useInvestigationData` (`b0682a77`, 17).
>   **The last found a REAL shipped bug** — `unhide` built `touched` inside a deferred React
>   setState updater so the `is_hidden=false` upsert never fired → a 409-re-imported CPT
>   came back hidden on next project load. Fixed (`8f5723dc`) + lesson #10 (`2550a0aa`).
>   `debugging-scientist` PROVED it real (not a harness artifact) across 3 call contexts.
> - **B testing:** the A2 "0 failed" lie + count-conservation was already done/verified
>   (`test_import_partial_failure_counted.py` PF-1/PF-2 green); qt/q_total DB round-trip
>   pinned (`b82db732` — note: qt is NOT a stored column, it's derived-on-read; the real
>   gap was a populated-q_total round-trip); Plaxis-3D no-surface skip count + test done
>   in the A3 batch.

**STILL OPEN — Backend:**
- A3: `get_project_bundle` (~10 MB export) + `duplicate_project` deep-clone unlogged.
- B: double-`execute()` refresh-on-duplicate round-trip; three-level export gap (#104)
  across all 4 exporters; PDF geometry (not just `%PDF`+size); Numba object-mode-fallback
  detection; raster the hull for watertight/overlap (current ~6-point sample misses
  between-sample overlaps).

**STILL OPEN — Frontend testing (D):**
- **Two untested DOM-event hooks:** `useBoundaryDrag` (652 — document mousemove/mouseup
  synthesis; zero-thickness auto-reject; shared-boundary partner propagation),
  `useSectionCanvasGestures` (430 — Shift-marquee priority). These need jsdom DOM-event
  synthesis (see `memory/feedback_playwright_section_drag_synthesis` for the failure layers).
- Stage-badge count-filter tests (`ExportStage` still open); `useDovImportStream` SSE
  error/abort; `SectionsCanvas` (2761 LOC) populated-state TDZ smoke.
- DEFERRED render-warp tests still owed for `ContactsLayer` + `CorrelationEdgesOverlay`.

**The #1 multiplier (owner decision needed):** integration tests run NOWHERE in CI.
This session added `.githooks/pre-push` as the stopgap; the durable fix is a
path-gated PR-only CI `integration` job (digest-pinned postgis service). Owner picks
CI job vs pre-push hook vs documented merge gate.

---

## 4. Hard constraints — VERBATIM, do not deviate

- **DO NOT `git push`.** Owner pushes. Commit per-file, Conventional Commits, end every
  commit body with exactly:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Commit with `git commit --no-verify`** — the pre-commit hook hangs on the full unit
  suite. (You still run tests yourself; you just bypass the hook.)
- **Integration tests ONLY via** `.\scripts\run-integration-tests.ps1 <path>`
  (PowerShell; points `DATABASE_URL` at the sibling `groundmodel_integration` DB).
  **NEVER** bare `pytest tests/integration` — it wipes/truncates the dev DB + e2e
  fixture. **The wrapper exits 0 even on failure → ALWAYS READ its stdout** for the
  `N passed / M failed` line; never trust its exit code.
- **The wrapper TRUNCATEs `groundmodel_integration`, which the Playwright e2e fixture
  shares** → after any integration run the e2e fixture is GONE. Re-seed with
  `build_synthetic_fixture.py` (backend up on :8765) before running e2e. **It is
  currently wiped** (this session ran the IDOR suite).
- Unit tests: `uv run pytest tests/unit -q` (fast, no DB). Desktop:
  `npx vitest run` + `npx tsc --noEmit -p tsconfig.web.json` (no tsc pre-commit gate;
  run it on changed renderer files yourself).
- **Node must be 22 LTS** (`node --version`) — vitest segfaults on Node 24. HVCI/Memory
  Integrity can also crash `node -e` on this machine (skip vitest, ask owner).
- `uv run python` / `py`, never bare `python` (not on PATH here). Never log
  secrets/DSN/PII. Defensive-security context only.

---

## 5. HOW to continue — the Combined Workflow (owner's standing instruction)

> "start applying from the top of that backlog, but have the testing and logging
> subagent have another pass and don't use the general subagent" + "keep going down
> the backlog."

Per applied batch: **implement → `logging-reviewer` pass → `testing-reviewer` pass →
revise.** Use the DEDICATED agents (`logging-reviewer`, `testing-reviewer`,
`debugging-scientist`), NOT `general-purpose`. For any non-obvious bug, use
`debugging-scientist` (instrument, don't guess). For security-touching diffs, add a
`security-reviewer` pass — it earned its keep this session (found the HIGH IDOR).

**Verify every subagent's "done" yourself** (lessons 8/9): `git log --stat`,
`git diff --stat <base> -- <expected-file>`, run the real gate, read the diff. A
truncated/off-topic final message = assume nothing shipped. When a multi-file security
fix flakes, finishing it directly (you have the reviewer's exact fixes) beats
re-dispatching into another flake.

---

## 6. Recommended immediate next step

The security closure is a clean, complete, verified milestone — a natural checkpoint.
**Two honest options** (owner's call — surface it):
1. **Dogfeed + merge this branch first** (122 commits, a lot of unpushed value:
   geotech bodies, the audit hardening, the security closure). Re-seed the e2e fixture,
   dogfeed the geotech + restore paths, then merge to develop before grinding the tail.
2. **Keep going down the backlog tail** (§3) — start with the highest-value cheap wins:
   the A2 "0 failed" import lie (log + count + conservation test), then the five
   untested frontend hooks (start `useLithoSuggestions` — #149 root cause lives there).

Either way: pick ONE batch, run it through the Combined Workflow, verify the gate
yourself, commit per-file, do not push.

---

## 7. Key references

- Backlog: `docs/superpowers/2026-06-30-observability-testing-audit.md`
- Lessons (9): `docs/lessons-learned.md` (esp. 8 = subagent "done" is a claim; 9 =
  fix one vuln instance → sweep the whole class)
- Agents: `docs/subagents.md` (9 agents) + `.claude/agents/*.md`
- IDOR tests: `tests/integration/api/test_restore_project_idor.py` (13 tests)
- Restore path: `src/groundmodel/infrastructure/db/repositories/project_bundle/`
  (`bundle_restore_core.py`, `bundle_restore_litho.py`)
- Geotech body model memory: `memory/project_geotech_stage_body_centric.md`
- Dev DB: `groundmodel` on docker `strix-db-1` port **5433**.
