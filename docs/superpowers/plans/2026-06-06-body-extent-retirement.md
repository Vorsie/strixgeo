# Body-Extent System Retirement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the superseded DB-entity body-extent system so the 2026-06-05 partition fill (`computePartitionFill` + `PartitionFillOverlay` + freedraw `body_boundary_nodes`) is the *one* model for body shapes, and the 5 obsolete integration tests are gone.

**Architecture:** This is a *removal* sweep, sequenced render-layer → wiring → backend → schema/bundle → tests → docs. Each task deletes a self-contained slice and is gated by the relevant build check before commit. Consumer unwinding in the React god-components is **compiler-driven**: delete the source, run `tsc`, fix exactly the references it reports (the consumer files are enumerated per task). Keep: the resolver (`ResolveLithoInstances`, `body_id`), correlation edges, `litho_layer`, `body` rows, `body_boundary_nodes` + its save path, the partition fill, `detect_crossing_pinch_outs` (used by Auto-correlate), `BodyContextMenu` (used by the partition; only its claim items are stripped).

**Tech Stack:** Python 3.11 / FastAPI / SQLAlchemy + Alembic (backend); React + TypeScript + Vitest (desktop); pytest (unit + integration via `scripts/run-integration-tests.ps1`); Playwright (`scripts/run-e2e.ps1`).

**Spec:** `docs/superpowers/specs/2026-06-06-body-extent-retirement-design.md`

**Conventions:** Conventional Commits; one logical change per commit. Run `uv run ruff format <file>` + `uv run ruff check --fix <file>` on every changed Python file before staging (a PostToolUse hook also does 1–2). Do NOT push. Node must be 22 (`node --version`).

---

## Inventory (from the 2026-06-06 survey)

**RETIRE — backend:**
- `src/groundmodel/application/detect_bodies.py` (`DetectBodies`)
- `src/groundmodel/application/suggest_body_pinch_outs.py` (`SuggestBodyPinchOuts`)
- `src/groundmodel/application/claim_body_extent.py` (`ClaimBodyExtent`)
- `src/groundmodel/application/clear_body_extent.py` (`ClearBodyExtent` — vestigial per CLAUDE.md)
- `src/groundmodel/domain/services/detect_body_extents.py`
- `src/groundmodel/domain/services/body_extent.py` (`BodyExtent`, `DetectedBody`)
- `src/groundmodel/shared/constants/extent_kind.py` (verify no kept consumer — Task 1)
- `src/groundmodel/api/schemas/project/body/detect_bodies_response.py`
- `src/groundmodel/api/schemas/project/body/suggest_pinch_outs_response.py`
- `src/groundmodel/api/schemas/project/body/claim_body_extent_request.py`
- `body.extent_*` columns in `src/groundmodel/infrastructure/db/models/body_orm.py`

**RETIRE — frontend:**
- `desktop/src/renderer/src/components/sections/BodyExtentOverlay.tsx` (+ `.test.tsx`)
- `desktop/src/renderer/src/utils/bodyExtent.ts`
- `desktop/src/renderer/src/components/sections/GhostContextMenu.tsx`
- `desktop/src/renderer/src/components/sections/ProvenanceConflictDialog.tsx` (+ `.test.tsx`)
- `desktop/src/renderer/src/api/claimBodyExtent.test.ts`
- Hidden dropdown items + handlers in `shell/stages/sections/SectionsToolbar.tsx`
- Client methods in `desktop/src/renderer/src/api/clients/geology.ts`
- "Lens max thickness" row in Settings + `utils/lithoSegmenterPrefs.ts` (`maxLensThicknessM` / `max_lens_thickness_m`)

**RETIRE — tests:**
- `tests/integration/application/test_detect_bodies.py`
- `tests/integration/application/test_suggest_body_pinch_outs.py`
- `tests/integration/application/test_claim_body_extent.py`
- `tests/integration/application/test_clear_body_extent.py`
- `tests/unit/domain/services/test_detect_body_extents.py`
- `tests/unit/domain/services/test_body_extent.py`
- `tests/unit/shared/constants/test_extent_kind.py`
- the body-extent cases in `tests/integration/api/test_bodies_api.py`

**KEEP (do not delete):** `detect_crossing_pinch_outs.py` (Auto-correlate consumer), `utils/partitionFill.ts`, `components/sections/PartitionFillOverlay.tsx`, `utils/bodyBands.ts` + `BodyBandOverlay.tsx`, `BodyContextMenu.tsx` (strip claim items only), `ResolveLithoInstances`, `auto_correlate_contact_edges.py`.

**FLAG for owner (NOT in this plan — separate decision, Task 1 records them):** "Materialise lens companions" verb + `materialiseLensCompanions`; "Delete all detected lenses" verb + `delete_detected_bodies.py` (`DeleteDetectedBodies`). Both are visible verbs whose semantics under the partition need an owner call; leave wired for now.

---

### Task 1: Survey + lock the kill-list

**Files:** none (read-only).

- [ ] **Step 1: Confirm `extent_kind.py` has no kept consumer**

Run:
```
cd C:/Users/robin/Documents/Strix
grep -rn "extent_kind\|EXTENT_KIND\|EXTENT_PROVENANCE\|EXTENT_SIDES\|is_user_claimed_extent_kind" src tests --include=*.py | grep -v "shared/constants/extent_kind.py"
```
Expected: every hit is in a RETIRE file (detect_bodies, suggest_body_pinch_outs, claim_body_extent, clear_body_extent, body_extent, body_orm, the body schemas, the retired tests). If a hit lands in a KEEP file, stop and record it — that reference must be removed in the owning task before `extent_kind.py` can go (Task 6).

- [ ] **Step 2: Confirm the freedraw save-boundary path is independent of `ClaimBodyExtent`**

Run:
```
grep -rn "onSaveBoundary\|save.*boundary\|body_boundary_nodes\|SaveBodyBoundary\|saveBodyBoundary\|body-boundary" desktop/src src --include=*.ts --include=*.tsx --include=*.py | grep -iv "claim"
```
Expected: the boundary-save path (PartitionFillOverlay `onSaveBoundary` → a `body_boundary_nodes` endpoint/use case) exists and does NOT route through `ClaimBodyExtent`. Record the exact save endpoint + use-case name (it is KEPT). If it routes through `ClaimBodyExtent`, stop — the freedraw path must be re-pointed before Task 5.

- [ ] **Step 3: Map the hidden dropdown verbs to their endpoints/use cases**

Run:
```
grep -n "detectLithoLenses\|suggestBodyPinchOuts\|claimBodyExtent\|acceptAllPinchOuts" desktop/src/renderer/src/api/clients/geology.ts
grep -rn "def .*detect\|def .*suggest\|def .*claim\|router\|@router" src/groundmodel/api/routers/geology/bodies.py | head -60
```
Record: which client method → which endpoint path → which use case. (Used by Tasks 3 + 5.)

- [ ] **Step 4: Confirm the bundle extent fields**

Run:
```
grep -n "extent" src/groundmodel/api/schemas/project/project_bundle.py src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py
```
Record the exact extent field names on the body serialize/restore (used by Task 7). NOTE: `bundle_restore_litho.py` also carries the recently-merged TIN-validation work — change only the extent lines.

- [ ] **Step 5: Record the FLAG decisions**

Write a one-line note in the PR/commit body (or `docs/debt.md`) that `materialiseLensCompanions` + `delete_detected_bodies` are intentionally left wired pending an owner call. No code change this task.

- [ ] **Step 6: Commit (docs only, if Step 5 touched debt.md; else skip)**

```
git add docs/debt.md
git commit -m "docs(debt): note body-companion + delete-detected verbs pending owner decision"
```

---

### Task 2: Remove the dead render layer (frontend, no behaviour change)

**Files:**
- Delete: `desktop/src/renderer/src/components/sections/BodyExtentOverlay.tsx`, `BodyExtentOverlay.test.tsx`, `desktop/src/renderer/src/utils/bodyExtent.ts`, `components/sections/GhostContextMenu.tsx`, `components/sections/ProvenanceConflictDialog.tsx`, `ProvenanceConflictDialog.test.tsx`
- Modify: `desktop/src/renderer/src/components/SectionPanel.tsx` (remove the `SHOW_LEGACY_BODY_EXTENT` constant + the `BodyExtentOverlay` import + its `{SHOW_LEGACY_BODY_EXTENT && …}` render block + the `GhostContextMenu`/`ProvenanceConflictDialog` imports/renders if present)

- [ ] **Step 1: Delete the files**

```
cd C:/Users/robin/Documents/Strix/desktop
git rm src/renderer/src/components/sections/BodyExtentOverlay.tsx src/renderer/src/components/sections/BodyExtentOverlay.test.tsx src/renderer/src/utils/bodyExtent.ts src/renderer/src/components/sections/GhostContextMenu.tsx src/renderer/src/components/sections/ProvenanceConflictDialog.tsx src/renderer/src/components/sections/ProvenanceConflictDialog.test.tsx
```

- [ ] **Step 2: Run tsc to enumerate the breakages**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: errors pointing at `SectionPanel.tsx` (and possibly `SectionsCanvas.tsx`) for the now-missing imports/usages.

- [ ] **Step 3: Remove each reported reference**

In `SectionPanel.tsx`: delete the `import BodyExtentOverlay …`, the `SHOW_LEGACY_BODY_EXTENT` const + its comment block, the `{SHOW_LEGACY_BODY_EXTENT && axisMode === 'lithostratigraphic' && lenses !== undefined && (<BodyExtentOverlay … />)}` block, and any `GhostContextMenu` / `ProvenanceConflictDialog` import + render + their state (`ghostCtxMenu`, provenance-dialog state). Leave `PartitionFillOverlay`, `BodyContextMenu` (body ctx menu), and `bodyCtxMenu` state intact.

- [ ] **Step 4: Re-run tsc until clean**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: exit 0.

- [ ] **Step 5: Run the hook-order check on SectionPanel (it lost a render branch)**

Run: `python C:/Users/robin/.claude/skills/react-hook-order-check/check_hook_order.py src/renderer/src/components/SectionPanel.tsx`
Expected: "OK — no hooks after an early return".

- [ ] **Step 6: Vitest**

Run: `npx vitest run`
Expected: all pass (fewer tests — the deleted specs are gone). If a surviving spec imported the deleted modules, remove that import/assertion.

- [ ] **Step 7: Commit**

```
git add -A
git commit -m "refactor(sections): remove dead BodyExtentOverlay + ghost/provenance dialogs"
```

---

### Task 3: Remove the hidden dropdown verbs + their wiring (frontend, compiler-driven)

**Files (consumers from the survey — fix every tsc error in these):**
- Modify: `shell/stages/sections/SectionsToolbar.tsx` (delete `handleDetectLenses`, `handleSuggestBodyPinchOuts`, `handleAcceptAllPinchOuts`, the three hidden `items[]` entries + their `.filter`, the busy-flag `useState`s, and `pinchOutCandidates`/`setPinchOutCandidates` reads)
- Modify: `hooks/useShellContextValue.ts`, `hooks/useSections.ts`, `shell/stages/sections/SectionsCanvas.tsx` (remove `pinchOutCandidates`/`setPinchOutCandidates` from the bus + any claim handler)
- Modify: `components/sections/BodyContextMenu.tsx` (remove the `ClaimableKind` import + the claim-extent menu items; KEEP Dissolve/Name) + `BodyContextMenu.test.tsx` (drop claim assertions)
- Modify: `api/clients/geology.ts` (delete `detectLithoLenses`, `suggestBodyPinchOuts`, `claimBodyExtent`, `acceptAllPinchOuts` methods + their request/response types)
- Delete: `desktop/src/renderer/src/api/claimBodyExtent.test.ts`
- Modify: `utils/bodyAnchor.ts` only if it references a deleted type (tsc will say)

- [ ] **Step 1: Delete the claim client test + remove the client methods**

```
cd C:/Users/robin/Documents/Strix/desktop
git rm src/renderer/src/api/claimBodyExtent.test.ts
```
In `api/clients/geology.ts`, delete the `detectLithoLenses`, `suggestBodyPinchOuts`, `claimBodyExtent`, and `acceptAllPinchOuts` methods and any `PinchOutCandidate`/`ClaimBodyExtentRequest`/`DetectBodiesResponse`/`SuggestPinchOutsResponse` type exports that become unused.

- [ ] **Step 2: Remove the toolbar verbs + state**

In `SectionsToolbar.tsx` delete: the three handlers (`handleDetectLenses`, `handleSuggestBodyPinchOuts`, `handleAcceptAllPinchOuts`), their `useState` busy flags (`detectingLenses`, `suggestingPinchOuts`, `acceptingPinchOuts`), the three `items[]` entries, the now-pointless `.filter(...)` that hid them (the array no longer contains those testids), and any `pinchOutCandidates`/`setPinchOutCandidates` bus reads. Keep the "Materialise companions", "Delete all detected", and "Fill bands" items (FLAG — owner decision).

- [ ] **Step 3: Strip claim items from BodyContextMenu**

In `BodyContextMenu.tsx`, remove the `ClaimableKind` type/import and the claim-extent menu entries; keep Dissolve + Name. Update `BodyContextMenu.test.tsx` to drop the claim-item assertions.

- [ ] **Step 4: Compiler-driven unwind**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Remove every reference it reports — the breakages live in the consumer files listed above (`useShellContextValue.ts`, `useSections.ts`, `SectionsCanvas.tsx`, `SectionPanel.tsx`, `useGeologicalModel.ts`). Delete the `pinchOutCandidates` field from the shell-context type + its provider value + every consumer read. Repeat until exit 0.

- [ ] **Step 5: Hook-order check on every modified `.tsx` with hooks**

Run: `python C:/Users/robin/.claude/skills/react-hook-order-check/check_hook_order.py src/renderer/src/shell/stages/sections/SectionsToolbar.tsx src/renderer/src/shell/stages/sections/SectionsCanvas.tsx src/renderer/src/hooks/useShellContextValue.ts src/renderer/src/hooks/useSections.ts`
Expected: OK for each.

- [ ] **Step 6: Vitest + fix the toolbar/canvas specs**

Run: `npx vitest run`
Expected: pass. Fix `SectionsToolbar.correlate.test.tsx`, `SectionsCanvas.provenance.test.tsx`, and any other spec that asserted on the removed verbs/state by deleting those assertions (or the spec if it tested only removed behaviour).

- [ ] **Step 7: Commit**

```
git add -A
git commit -m "refactor(sections): retire detect/suggest/claim body verbs + their wiring"
```

---

### Task 4: Remove the "Lens max thickness" Setting

**Files:**
- Modify: `utils/lithoSegmenterPrefs.ts` (remove `maxLensThicknessM` read/default), `utils/lithoSegmenterPrefs.test.ts` (drop its case), the Settings dialog row (grep `Lens max thickness` to find it), and any reader.

- [ ] **Step 1: Find every reference**

Run: `grep -rn "maxLensThicknessM\|max_lens_thickness_m\|Lens max thickness" desktop/src`

- [ ] **Step 2: Remove the pref + the Settings row + the test case**

Delete the `maxLensThicknessM` field from `readLithoSegmenterPrefs` + its default, the NumberRow in the Settings dialog, and the assertion in `lithoSegmenterPrefs.test.ts`.

- [ ] **Step 3: tsc + Vitest**

Run: `npx tsc --noEmit -p tsconfig.web.json && npx vitest run`
Expected: clean / pass.

- [ ] **Step 4: Commit**

```
git add -A
git commit -m "refactor(settings): remove vestigial 'Lens max thickness' knob"
```

---

### Task 5: Remove the backend use cases + endpoints + schemas + domain services

**Files:**
- Delete: `src/groundmodel/application/{detect_bodies,suggest_body_pinch_outs,claim_body_extent,clear_body_extent}.py`, `src/groundmodel/domain/services/{detect_body_extents,body_extent}.py`, `src/groundmodel/api/schemas/project/body/{detect_bodies_response,suggest_pinch_outs_response,claim_body_extent_request}.py`
- Modify: `src/groundmodel/api/routers/geology/bodies.py` (delete the detect/suggest/claim/clear endpoints), `src/groundmodel/api/schemas/project/body/__init__.py` (drop the re-exports), `api/main.py` + `api/routers/project.py` (remove the restore/startup `DetectBodies` sweep call — resolver-only there)

- [ ] **Step 1: Delete the files**

```
cd C:/Users/robin/Documents/Strix
git rm src/groundmodel/application/detect_bodies.py src/groundmodel/application/suggest_body_pinch_outs.py src/groundmodel/application/claim_body_extent.py src/groundmodel/application/clear_body_extent.py src/groundmodel/domain/services/detect_body_extents.py src/groundmodel/domain/services/body_extent.py src/groundmodel/api/schemas/project/body/detect_bodies_response.py src/groundmodel/api/schemas/project/body/suggest_pinch_outs_response.py src/groundmodel/api/schemas/project/body/claim_body_extent_request.py
```

- [ ] **Step 2: Remove the endpoints + re-exports + sweep**

In `api/routers/geology/bodies.py` delete the route handlers for detect / suggest-pinch-outs / claim-extent / clear-extent (the paths recorded in Task 1 Step 3). In `api/schemas/project/body/__init__.py` drop the deleted-schema re-exports. In `api/main.py` and `api/routers/project.py`, remove the `DetectBodies(...).execute(...)` calls in the startup sweep / bundle-restore reconcile so only `ResolveLithoInstances` runs there.

- [ ] **Step 3: Find + remove residual imports (compiler-driven via mypy)**

Run: `uv run mypy src 2>&1 | grep -i "extent\|detect_bod\|suggest_body\|claim_body\|clear_body" `
Remove every reported import/reference. Re-run until no extent/body-use-case errors remain (the 160 pre-existing baseline errors are unrelated — see CLAUDE.md).

- [ ] **Step 4: ruff + unit tests**

```
uv run ruff check --fix src
uv run pytest tests/unit -q
```
Expected: ruff clean on changed files; unit tests pass (some will be deleted in Task 8 — if an import error blocks collection, delete that obsolete test now and note it for Task 8).

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "refactor(bodies): delete detect/suggest/claim/clear extent use cases + endpoints"
```

---

### Task 6: Drop `extent_kind` + the `body.extent_*` columns

**Files:**
- Delete: `src/groundmodel/shared/constants/extent_kind.py` (after Task 1 Step 1 confirmed no kept consumer)
- Modify: `src/groundmodel/infrastructure/db/models/body_orm.py` (remove the four `extent_*` columns + their imports), `src/groundmodel/api/schemas/project/body/body_list_item.py` (remove extent fields)
- Create: `src/groundmodel/infrastructure/db/migrations/versions/<rev>_drop_body_extent_columns.py`

- [ ] **Step 1: Delete the constants module + the ORM columns**

```
git rm src/groundmodel/shared/constants/extent_kind.py
```
In `body_orm.py` remove `extent_left_kind`, `extent_right_kind`, `extent_left_provenance`, `extent_right_provenance`, `extent_left_target_contact_id`, `extent_right_target_contact_id`, `extent_left_neighbour_inv_id`, `extent_right_neighbour_inv_id` (confirm exact set by reading the model) + the `ExtentKind` import. In `body_list_item.py` remove the matching response fields.

- [ ] **Step 2: Author the Alembic migration**

Run `uv run alembic revision -m "drop body extent columns"` then fill the generated file:
```python
def upgrade() -> None:
    # Drop any CHECK constraints on the extent columns first (added by
    # a1c2d3e4f5a6 schema-invariant migration), then the columns.
    with op.batch_alter_table("body") as batch:
        # names confirmed via \d body in the integration DB / the
        # a1c2d3e4f5a6 + 4d0bd7dc0605 + e6f7a8b9c0d1 migrations
        batch.drop_column("extent_left_kind")
        batch.drop_column("extent_right_kind")
        batch.drop_column("extent_left_provenance")
        batch.drop_column("extent_right_provenance")
        batch.drop_column("extent_left_target_contact_id")
        batch.drop_column("extent_right_target_contact_id")
        batch.drop_column("extent_left_neighbour_inv_id")
        batch.drop_column("extent_right_neighbour_inv_id")

def downgrade() -> None:
    raise NotImplementedError("backwards-compat suspended pre-ship; no downgrade")
```
First inspect the three extent migrations (`4d0bd7dc0605`, `e6f7a8b9c0d1`, `a1c2d3e4f5a6`) to get the exact column + constraint names; drop constraints before columns.

- [ ] **Step 3: Migrate the dev DB AND the integration DB**

```
uv run alembic upgrade head                                   # dev DB
.\scripts\run-integration-tests.ps1 --collect-only            # migrates the integration DB
```
(Per CLAUDE.md: the wrapper migrates the sibling DB; `alembic upgrade head` with no override migrates dev.)

- [ ] **Step 4: mypy + ruff + unit**

```
uv run mypy src 2>&1 | grep -i extent ; uv run ruff check --fix src ; uv run pytest tests/unit -q
```
Expected: no extent references; ruff clean; unit pass.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat(db)!: drop body extent columns + extent_kind enum (partition fill owns shape)"
```

---

### Task 7: Strip extent fields from the .strix bundle

**Files:**
- Modify: `src/groundmodel/api/schemas/project/project_bundle.py` (remove extent fields from the body request/response model), `src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py` (remove extent writes on restore — touch ONLY extent lines; leave the merged TIN-validation code), and the body-serialize builder (grep `extent` in `project_bundle/`).

- [ ] **Step 1: Remove extent fields from serialize + restore**

Using the field names recorded in Task 1 Step 4, delete the extent keys from the bundle body schema, the serialize builder, and the restore loop. A legacy bundle that still carries them must restore without error (extra keys ignored by Pydantic if `extra='ignore'`; if `extra='forbid'`, add a discard step).

- [ ] **Step 2: Write a legacy-bundle-opens integration test**

In `tests/integration/db/test_project_bundle.py` add `test_restore_ignores_legacy_extent_fields`: build a bundle dict with stale `extent_left_kind` etc. on a body, POST it to the restore endpoint, assert 200 + the body + its `body_boundary_nodes` round-trip.

- [ ] **Step 3: Run it red→green**

```
.\scripts\run-integration-tests.ps1 tests/integration/db/test_project_bundle.py -q
```
Expected: the new test passes; the existing bundle tests pass.

- [ ] **Step 4: Commit**

```
git add -A
git commit -m "feat(bundle)!: drop body extent fields; ignore legacy extent on restore"
```

---

### Task 8: Delete the obsolete tests

**Files:**
```
git rm tests/integration/application/test_detect_bodies.py \
       tests/integration/application/test_suggest_body_pinch_outs.py \
       tests/integration/application/test_claim_body_extent.py \
       tests/integration/application/test_clear_body_extent.py \
       tests/unit/domain/services/test_detect_body_extents.py \
       tests/unit/domain/services/test_body_extent.py \
       tests/unit/shared/constants/test_extent_kind.py
```
- Modify: `tests/integration/api/test_bodies_api.py` (delete the detect/suggest/claim cases; keep any body-list/dissolve/name cases), `tests/integration/db/test_schema_invariants.py` (drop the extent-column constraint assertions), `tests/integration/db/test_bundle_v4_litho_layers.py` (drop extent assertions if any).

- [ ] **Step 1: Delete + edit per above.**
- [ ] **Step 2: Run the full backend suites**

```
uv run pytest tests/unit -q
.\scripts\run-integration-tests.ps1 -q
```
Expected: green, no collection errors, no reference to deleted modules.

- [ ] **Step 3: Commit**

```
git add -A
git commit -m "test(bodies): delete obsolete extent-system tests"
```

---

### Task 9: Partition-fill edge-case coverage (the §7 matrix)

**Files:**
- Modify: `desktop/src/renderer/src/utils/bodyBands.test.ts` and/or create `desktop/src/renderer/src/utils/partitionFill.test.ts`

- [ ] **Step 1: Read `utils/partitionFill.ts` to learn `computePartitionFill`'s signature + region kinds (`quad` / `pinch` / `lens`).**

- [ ] **Step 2: Add a failing test per missing §7 case**

For each of: one-sided pinch-out (quad + pinch), single-column lens, skip-column continuation (one body), section-edge open-stub, bottom substrate (no spurious pinch), and a `partition is hole-free + overlap-free` property test. Example skeleton (fill real columns):
```ts
it('one-sided pinch-out: matches left, pinches right', () => {
  const regions = computePartitionFill(leftCol, rightColMissingTheUnit)
  expect(regions.some(r => r.kind === 'quad')).toBe(true)
  expect(regions.some(r => r.kind === 'pinch')).toBe(true)
})
```

- [ ] **Step 3: Run; if a case already passes, keep it as a regression guard; if it fails, it found a real partition gap — STOP and report (do not "fix" the partition silently).**

Run: `npx vitest run src/renderer/src/utils/partitionFill.test.ts`

- [ ] **Step 4: Commit**

```
git add -A
git commit -m "test(partition): cover one-sided/lens/skip/open/substrate + hole-free invariant"
```

---

### Task 10: Docs

- [ ] **Step 1: `docs/debt.md` — add a Tier-D item**

Add: *"Port `computePartitionFill` to a Python domain service (or commit to client-side export) before the Phase-4 export step — the body-shape geometry is TS-only; exporters are Python. Trigger: first 2D/3D geometry export."* Commit:
```
git add docs/debt.md
git commit -m "docs(debt): track computePartitionFill TS->Python port for export"
```

- [ ] **Step 2: `CLAUDE.md` — update the body-with-extent section**

Replace the "body-with-extent refactor" narrative's extent-system references with: the partition fill (`computePartitionFill` + `PartitionFillOverlay` + `body_boundary_nodes` freedraw) is the sole body-shape model; the DB extent system (`DetectBodies`/`detect_body_extents`/`SuggestBodyPinchOuts`/`ClaimBodyExtent`/extent columns) was retired 2026-06-06. Commit:
```
git add CLAUDE.md
git commit -m "docs(claude): body shape is the partition fill; DB extent system retired"
```

---

### Task 11: Full verification + integration-handoff close-out

- [ ] **Step 1: Desktop gates** — `cd desktop; npx tsc --noEmit -p tsconfig.web.json; npx tsc --noEmit -p tsconfig.node.json; npx vitest run` → all green.
- [ ] **Step 2: Backend gates** — `uv run mypy src` (160 baseline, no extent refs); `uv run ruff check src tests` (touched files clean); `uv run pytest tests/unit -q`; `.\scripts\run-integration-tests.ps1` → green.
- [ ] **Step 3: e2e** — close the dev app; `.\scripts\run-e2e.ps1` → green (watch for the documented `flow_body_actions_ui` flake; the body-actions spec asserted on retired verbs — update/delete it as part of Task 3/9 if it references them).
- [ ] **Step 4: Original handoff close-out** — with `develop` green, run the still-pending integration-handoff steps: confirm Session-B's `test_restore_drops_structurally_malformed_surface_tin` (already merged) is green in the serial pass, then `git worktree remove ..\strix-A-scrubbar ..\strix-B-behardening ..\strix-C-cheatsheet` and `git branch -d A-scrubbar B-be-hardening C-cheatsheet`.

---

## Self-Review

**Spec coverage:** §3 retire-list → Tasks 2–8; §3 keep-list → untouched (verified Task 1) + `detect_crossing_pinch_outs` explicitly kept; §5 data/format → Tasks 6+7; §6 export note → Task 10 Step 1; §7 edge cases → Task 9; §8 test plan → Tasks 8+9; §9 build sequence → Tasks 1–11 in order; §10 open questions → Task 1 Step 5 (FLAG verbs) + Task 1 Step 1 (`extent_kind` consumers). Covered.

**Placeholder scan:** removal tasks use compiler/test-driven unwinding with the exact consumer files enumerated — concrete for a deletion. The migration column list + bundle field names are resolved in Task 1 before they're used (Steps 4 + the migration inspection). No "TBD"/"handle edge cases".

**Type consistency:** `extent_*` column names, `pinchOutCandidates`, the three client methods, and the verb handler names are used identically across Tasks 3/5/6/7. The migration drops exactly the columns Task 6 Step 1 removes from `body_orm.py`.

**Known risk flagged:** the React removals (Tasks 2–3) carry TDZ/hook-order risk in the god-components — each has an explicit hook-order-check step. The `Materialise companions` / `Delete-all-detected` verbs are deliberately out of scope (owner decision).
