# Bottom-tie Correlation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the geologist correlate the *bottom* (deepest base) of a test to another test's bottom, so the deepest litho unit gains a correlated base contact and **bands** (it can only onlap/pinch today, because the deepest layer has no addressable base contact).

**Architecture:** Add a `contact_side` (`'top'`/`'base'`) discriminator to each correlation-edge endpoint. A bottom-tie is an edge with `side='base'` on both ends. The partition's `classifyTermination` learns to read a `side='base'` edge on a unit's *own* layer as its base correlation; the deepest unit, once tied, reaches 2 correlated contacts and bands. Bottom-tie contacts are interpretive, so they're excluded from the confidence calc. The frontend reuses the existing correlate gesture (the deepest base becomes a grabbable handle) and renders the tie dashed/interpretive. The voxel build inherits the banding via the unchanged `computeSectionFill` payload.

**Tech Stack:** PostgreSQL + SQLAlchemy/Alembic (edge schema), FastAPI (correlate endpoint), React/TypeScript (partition `partitionFill.ts`, section-editor gesture, `CorrelationEdgesOverlay`), Vitest + pytest.

**Spec:** `docs/superpowers/specs/2026-06-17-bottom-tie-correlation-design.md` — read it first.

**Standing rules:** commit per file/task (Conventional Commits); do NOT `git push`; run desktop checks from `desktop/` (`npx tsc --noEmit -p tsconfig.web.json`, `npx vitest run`); run backend unit tests with `uv run pytest tests/unit -q` and integration via `.\scripts\run-integration-tests.ps1`; every `react-hooks/exhaustive-deps` disable needs a `// reason:` comment; numpy docstrings on public Python, JSDoc on public TS; English-only. Backwards-compat is suspended pre-ship, so the additive migration is clean.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `src/groundmodel/infrastructure/db/models/litho_contact_correlation_edge_orm.py` | edge ORM — add `contact_a_side`/`contact_b_side`; update CHECK + unique index | Modify |
| `src/groundmodel/infrastructure/db/migrations/versions/<new>_bottom_tie_contact_side.py` | additive migration (columns default `'top'`, new unique index, drop+recreate old one) | Create |
| `src/groundmodel/domain/models/litho_contact_correlation_edge.py` (or the edge value object) | carry `contact_a_side`/`contact_b_side`; normalization keeps side paired with its contact | Modify |
| the correlate use case + its request schema (e.g. `application/correlate_litho_contacts*.py`, `api/schemas/.../correlate_*`) | accept + persist the per-endpoint side; default `'top'` | Modify |
| `api/.../correlation edge response schema` + `desktop/src/renderer/src/api/clients/*` types | surface `contact_*_side` to the client | Modify |
| `desktop/src/renderer/src/utils/partitionFill.ts` | `classifyTermination` base lookup honors `side='base'` on the unit's own layer | Modify |
| `desktop/src/renderer/src/utils/partitionFill.test.ts` | bottom-tie → band; no-tie → unchanged; default-top byte-identical | Modify |
| `desktop/src/renderer/src/utils/distanceConfidence.ts` / `tinConfidence.ts` (+ the confidence input builder) | exclude `side='base'` contacts from the distance/confidence inputs | Modify |
| `desktop/src/renderer/src/components/sections/` (ContactsLayer / correlate-mode handler) | expose the deepest-layer base as a grabbable contact handle; create a `side='base'` edge | Modify |
| `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx` | render a bottom-tie dashed/interpretive | Modify |
| backend `section_partition` Python port (if `classifyTermination` change touches golden paths) | mirror the base-side lookup to keep golden parity | Modify (conditional) |

---

## PHASE 1 — Schema

### Task 1: Add `contact_side` to the edge ORM + constraints

**Files:**
- Modify: `src/groundmodel/infrastructure/db/models/litho_contact_correlation_edge_orm.py`

- [ ] **Step 1: Add the two columns + a CHECK enum guard.** After the `contact_b_id` mapped_column, add:

```python
    # Which contact of each layer the edge joins: 'top' (the existing layer-top
    # contact, the default for every legacy edge) or 'base' (the layer's BASE).
    # A "bottom-tie" is an edge with side='base' on BOTH ends — it lets the
    # DEEPEST layer (which has no layer below, so no top-keyed base contact) be
    # correlated at its base so it can band. (#221-adjacent / bottom-tie spec.)
    contact_a_side: Mapped[str] = mapped_column(
        String(4), nullable=False, server_default=text("'top'")
    )
    contact_b_side: Mapped[str] = mapped_column(
        String(4), nullable=False, server_default=text("'top'")
    )
```

Add to `__table_args__` a CHECK constraint:

```python
        CheckConstraint(
            "contact_a_side IN ('top','base') AND contact_b_side IN ('top','base')",
            name="ck_litho_contact_corr_edge_side_enum",
        ),
```

- [ ] **Step 2: Widen the unique index to include the sides** so a top↔top correlation AND a base↔base bottom-tie between the *same* two layers can coexist. Replace the existing `(model_id, LEAST(contact_a_id,contact_b_id), GREATEST(...))` unique index expression with one that also keys both sides (sides travel with the normalized a/b order — see Task 3). Update the `Index(...)` definition's columns/expression to append `contact_a_side, contact_b_side`. (The exact `text()` expression mirrors the existing LEAST/GREATEST one with the two side columns appended.)

- [ ] **Step 3: Verify it imports.** Run: `uv run python -c "from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import LithoContactCorrelationEdgeOrm; print('ok')"` → prints `ok`.

- [ ] **Step 4: Commit** — `git add` the ORM file; `git commit -m "feat(litho): add contact_side to correlation edge for bottom-ties"`.

### Task 2: Alembic migration

**Files:**
- Create: `src/groundmodel/infrastructure/db/migrations/versions/<rev>_bottom_tie_contact_side.py`

- [ ] **Step 1: Autogenerate then hand-finish.** Run `uv run alembic revision -m "bottom tie contact_side"` to get a stamped file with the correct `down_revision`. Fill `upgrade()`:

```python
def upgrade() -> None:
    op.add_column("litho_contact_correlation_edge",
        sa.Column("contact_a_side", sa.String(length=4), nullable=False, server_default="top"))
    op.add_column("litho_contact_correlation_edge",
        sa.Column("contact_b_side", sa.String(length=4), nullable=False, server_default="top"))
    op.create_check_constraint(
        "ck_litho_contact_corr_edge_side_enum", "litho_contact_correlation_edge",
        "contact_a_side IN ('top','base') AND contact_b_side IN ('top','base')")
    # Recreate the unordered-pair unique index to include the sides so a top-tie
    # and a base-tie between the same two layers can coexist.
    op.drop_index("<existing_unique_index_name>", table_name="litho_contact_correlation_edge")
    op.execute(
        "CREATE UNIQUE INDEX <existing_unique_index_name> ON litho_contact_correlation_edge "
        "(model_id, LEAST(contact_a_id, contact_b_id), GREATEST(contact_a_id, contact_b_id), "
        "contact_a_side, contact_b_side)")
```

(Read the existing index name + exact expression from the ORM `__table_args__` and reuse it verbatim plus the two side columns.) `downgrade()` reverses: drop the widened index, recreate the original, drop the check, drop the two columns.

- [ ] **Step 2: Migrate the integration DB + verify.** Run `.\scripts\run-integration-tests.ps1 --collect-only` (runs `alembic upgrade head` against the integration DB). Then verify: `docker exec strix-db-1 psql -U groundmodel -d groundmodel_integration -c "\d litho_contact_correlation_edge"` shows the two `contact_*_side` columns defaulting to `'top'`.
- [ ] **Step 3: Migrate the dev DB** — `uv run alembic upgrade head` (no DATABASE_URL override) so the dogfeed DB stays current (per `feedback_migrate_dev_db_after_migration_fix`).
- [ ] **Step 4: Commit** — `git commit -m "chore(db): migration — contact_side columns + widened unique index"`.

---

## PHASE 2 — Domain / repository / API

### Task 3: Carry `contact_side` through the edge value object + normalization

**Files:**
- Modify: the edge domain value object + the repository that writes/reads `LithoContactCorrelationEdgeOrm`.

- [ ] **Step 1: Write the failing test** (in the repo/domain unit tests) — normalization keeps each side paired with its contact when a/b are swapped to satisfy `contact_a_id < contact_b_id`:

```python
def test_edge_normalization_keeps_side_with_its_contact():
    # b_id < a_id forces a swap; the sides must swap too.
    edge = make_edge(contact_a_id=BIG_UUID, a_side="base",
                     contact_b_id=SMALL_UUID, b_side="base")
    norm = normalize_edge(edge)
    assert norm.contact_a_id == SMALL_UUID and norm.contact_a_side == "base"
    assert norm.contact_b_id == BIG_UUID and norm.contact_b_side == "base"

def test_top_default_when_unspecified():
    edge = make_edge(contact_a_id=SMALL_UUID, contact_b_id=BIG_UUID)  # no sides
    assert normalize_edge(edge).contact_a_side == "top"
```

- [ ] **Step 2: Run → FAIL** (`uv run pytest <path>::test_edge_normalization_keeps_side_with_its_contact -v`).
- [ ] **Step 3: Implement** — add `contact_a_side`/`contact_b_side` (default `"top"`) to the value object; in the normalization that orders `(a,b)` so `a_id < b_id`, swap the sides alongside the ids in the same branch.
- [ ] **Step 4: Run → PASS.** **Step 5: Commit** — `git commit -m "feat(litho): edge value object carries contact_side; sides swap with normalization"`.

### Task 4: Correlate use case + API accept the per-endpoint side

**Files:**
- Modify: the correlate use case + its request schema; the edge response schema + the desktop client type.

- [ ] **Step 1: Write the failing test** (integration, against the correlate endpoint): posting a base↔base correlation persists a row with `('base','base')` and it's returned; a default post is `('top','top')`.

```python
async def test_correlate_base_tie_persists_and_returns_sides(client, scene):
    body = {"contact_a_id": str(deepA), "contact_a_side": "base",
            "contact_b_id": str(deepB), "contact_b_side": "base",
            "request_section_id": str(section)}
    r = await client.post(f"/projects/{pid}/geology/models/{mid}/contacts/correlate", json=body)
    assert r.status_code == 201
    edge = r.json()
    assert {edge["contact_a_side"], edge["contact_b_side"]} == {"base"}
```

- [ ] **Step 2: Run → FAIL** (`.\scripts\run-integration-tests.ps1 <test_file>::test_correlate_base_tie_persists_and_returns_sides`).
- [ ] **Step 3: Implement** — add optional `contact_a_side`/`contact_b_side` (default `'top'`) to the correlate request schema; thread into the use case → the ORM row; add both to the edge response schema + the desktop `client.ts` `LithoCorrelationEdge` type. Reuse the existing section-scope + same-column-rejection guards unchanged.
- [ ] **Step 4: Run → PASS.** **Step 5: Commit (one file per commit)** — request schema; use case; response schema; client type.

---

## PHASE 3 — Partition: the deepest unit bands when bottom-tied

### Task 5: `classifyTermination` reads a `side='base'` edge on the unit's own layer

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts` (`classifyTermination` + the per-unit base-correlation lookup)
- Test: `desktop/src/renderer/src/utils/partitionFill.test.ts`

- [ ] **Step 1: Write the failing tests** (behaviour-shaped, via the existing `coverAt` point-in-polygon helper). Three cases:

```ts
// CASE BT-1: deepest unit with a base-tie to a reaching neighbour → BANDS
it('bottom-tie makes the deepest unit band across the gap', () => {
  const cols = makeCols(/* deep L + deep R, each deepest = SAND; top of SAND correlated;
                            base-tie edge side='base' both ends between the two deepest layers */)
  const fill = computeSectionFill(cols, edgesWithBaseTie)
  expect(coverAt(fill, /*mid-gap, deep elevation*/)).toEqual(['SAND'])  // continuous, not pinched
})
// CASE BT-2: same geometry, NO base-tie → deepest unit still pinches/onlaps (unchanged)
it('without a base-tie the deepest unit still pinches', () => {
  const fill = computeSectionFill(cols, edgesTopOnly)
  expect(coverAt(fill, /*mid-gap deep*/)).not.toEqual(['SAND'])  // pinched as today
})
// CASE BT-3: a base-tie at different elevations → the deepest base SLOPES (dip)
it('a base-tie between different bottom elevations dips', () => {
  const fill = computeSectionFill(colsDipping, edgesWithBaseTie)
  // base elevation at the left edge > base elevation at the right edge
  expect(baseElevAt(fill, 0.05)).toBeGreaterThan(baseElevAt(fill, 0.95))
})
```

- [ ] **Step 2: Run → FAIL** (`cd desktop && npx vitest run src/renderer/src/utils/partitionFill.test.ts -t "bottom-tie"`). BT-1/BT-3 fail (deepest unit pinches; base flat).
- [ ] **Step 3: Implement.** In the base-correlation lookup inside `classifyTermination`/`reduceColumn` (today a unit's base is correlated only via an edge on the **layer-below's** top contact — the `below !== undefined` branch), add: a unit's base also counts as correlated if there is an approved edge with `side='base'` on **this unit's own layer id** toward the facing/reaching neighbour. For the deepest layer (`below === undefined`) this `side='base'` edge is the *only* base-correlation source. With top + base correlated → `count === 2` → band. The reach/defer-past-too-shallow logic from `a2cbeb5a` is unchanged.
- [ ] **Step 4: Run → PASS** (all three) + the full file green: `npx vitest run src/renderer/src/utils/partitionFill.test.ts`.
- [ ] **Step 5: Default-top regression** — `npx vitest run src/renderer/src/utils/partitionFill.test.ts` (whole suite): existing partitions with only `side='top'` edges stay byte-identical.
- [ ] **Step 6: tsc + commit** — `npx tsc --noEmit -p tsconfig.web.json`; `git commit -m "feat(section-fill): honor base-tie correlations so the deepest unit can band"`.

### Task 6: Mirror the base lookup in the backend Python port (only if it touches golden paths)

**Files:**
- Modify: the backend `section_partition` Python port (the `classifyTermination` equivalent) — ONLY if Task 5 alters golden output.

- [ ] **Step 1: Check parity.** Run `uv run pytest tests/unit -q -k section_partition_golden` (or the golden parity test). If still **green + goldens byte-identical**, SKIP this task — the goldens don't exercise base-ties; record "no port change needed" and move on. If RED, continue.
- [ ] **Step 2 (if needed): mirror the lookup** in the Python port identically (a `side='base'` edge on the unit's own layer supplies its base correlation), regenerate/compare goldens deliberately (document the intended golden change), keep TS↔Python parity.
- [ ] **Step 3: Commit** (if changed) — `git commit -m "feat(section-partition): mirror base-tie lookup in the Python port"`.

---

## PHASE 4 — Confidence excludes base-ties

### Task 7: `side='base'` contacts don't reduce the confidence fade

**Files:**
- Modify: the confidence-input builder feeding `distanceConfidence.ts` / `tinConfidence.ts` (where the set of "investigations/contacts" used for the distance calc is assembled)
- Test: the confidence util test (or a new one)

- [ ] **Step 1: Write the failing test** — adding a base-tie contact does not change the confidence/distance result:

```ts
it('base-tie (side=base) contacts are excluded from the confidence distance calc', () => {
  const withoutTie = distanceConfidenceInputs(contactsObservedOnly)
  const withTie = distanceConfidenceInputs([...contactsObservedOnly, baseTieContact])
  expect(withTie).toEqual(withoutTie)  // the interpretive base-tie adds no confidence
})
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run <confidence test>`).
- [ ] **Step 3: Implement** — where the confidence inputs are assembled, filter out contacts/edges with `side='base'` (interpretive, no observed data at the base) before the distance calc. Leave the observed (`side='top'`) contacts untouched.
- [ ] **Step 4: Run → PASS.** **Step 5: tsc + commit** — `git commit -m "fix(confidence): exclude interpretive base-tie contacts from the fade calc"`.

---

## PHASE 5 — Frontend gesture + rendering

### Task 8: Expose the deepest-layer base as a grabbable contact handle

**Files:**
- Modify: the section-editor contact-handle source + the correlate-mode handler under `desktop/src/renderer/src/components/sections/` (ContactsLayer / the correlate gesture).
- Test: a Vitest for the handle set / correlate payload.

- [ ] **Step 1: Write the failing test** — the deepest layer of a column yields a base handle, and correlating from a base handle to another column's base handle produces a `side='base'` edge payload:

```tsx
it('correlating two base handles posts a side=base edge', async () => {
  // render the section in correlate mode, grab the deepest base handle on col A,
  // drop on col B's deepest base handle
  // assert the correlate call was made with contact_a_side==='base' && contact_b_side==='base'
})
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — for each column, surface the deepest layer's base as an additional grabbable contact handle (marked as a base/floor handle). The existing correlate gesture, when both endpoints are base handles, sends `contact_a_side='base'`/`contact_b_side='base'`. Other (top) correlations are unchanged. (If a top↔base mixed grab is possible, normalize/validate per the spec — common case is base↔base.)
- [ ] **Step 4: Run → PASS.** **Step 5: tsc + commit** — `git commit -m "feat(sections): deepest-base grab handle + base-tie correlate gesture"`.

### Task 9: Render the bottom-tie dashed / interpretive

**Files:**
- Modify: `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx`
- Test: the overlay test

- [ ] **Step 1: Write the failing test** — an edge with `side='base'` (both ends) renders with the interpretive (dashed) treatment, distinct from a solid observed-contact correlation:

```tsx
it('a base-tie edge renders dashed/interpretive', () => {
  const { container } = renderOverlay({ edges: [baseTieEdge, topEdge] })
  expect(pathFor(container, baseTieEdge)).toHaveAttribute('stroke-dasharray')  // interpretive
  expect(pathFor(container, topEdge)).not.toHaveAttribute('stroke-dasharray')  // observed solid
})
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — in the edge render, branch on `side==='base'` (both ends) → dashed + the interpretive colour from the design (cyan `#4fc3f7`); base-handle marker distinct from top handles. Keep spacing-aware X (`warpedXToScreen`) untouched (run `strix-section-geometry-check` if any along-section coordinate is touched).
- [ ] **Step 4: Run → PASS.** **Step 5: tsc + commit** — `git commit -m "feat(sections): render bottom-ties dashed/interpretive"`.

---

## PHASE 6 — Integration + real-data validation

### Task 10: End-to-end + dogfeed validation

- [ ] **Step 1: Full gates** — from `desktop/`: `npx tsc --noEmit -p tsconfig.web.json` (clean) + `npx vitest run` (full suite green). Backend: `uv run pytest tests/unit -q` + `.\scripts\run-integration-tests.ps1` (the new correlate-side test green).
- [ ] **Step 2: Real-data check (dev DB)** — reconstruct CS1 (`019e934c…`, dev DB :5433), add a base↔base tie on the deep substrate the dogfeed flagged (S7 / the deep package), run `computeSectionFill` before/after: confirm the tied deepest unit **bands** (was pinched), un-tied deep units + CS2/CS3 unchanged, golden/Python-port parity preserved.
- [ ] **Step 3: e2e (optional, dev app closed)** — `./scripts/run-e2e.ps1 flow_correlate` (and the section flows) green; the existing correlate flows unaffected by the additive side column.
- [ ] **Step 4: Dogfeed handoff** — note for the owner: draw a bottom-tie on the deep substrate in CS1, then **re-Build** the model so the voxel 3D + model-fill view inherit the banding (the 2D Fill bands reflect it immediately).

---

## Out of scope (do NOT implement here)

- The pinch-apex-cap geometry change for un-tied deep units (owner decision 2026-06-17 — un-tied deep units pinch as today).
- The automatic deepest-first lithology-only fill mode (Phase-5 debt **#221**).

---

## Self-review notes (author check — completed)

- **Spec coverage:** §5 schema → Tasks 1-2; §6 gesture/render → Tasks 8-9; §7 partition → Tasks 5-6; §8 confidence → Task 7; §9 voxel → inherits (no task, validated in Task 10); §2 decisions (option i, reuse gesture, dashed, confidence-exclusion, no apex-cap, B→Phase-5) all reflected. §10 correctness rules → BT-1/BT-2/BT-3 + default-top regression + confidence test + Task-10 voxel parity.
- **Placeholder scan:** the only deferred specifics are the exact existing unique-index name/expression (Task 1/2 say "read from the ORM and reuse verbatim") and the exact frontend handle/overlay code (Tasks 8-9 give the test + the precise behaviour); these are grounded by reading the named files at execution, not vague TODOs.
- **Type consistency:** `contact_a_side`/`contact_b_side` (`'top'|'base'`) used identically across ORM, value object, API, client type, partition lookup, confidence filter, and render. `side='base'` is the bottom-tie marker throughout.
- **Known nuance flagged for the implementer:** the unique index must include both sides so a top-tie and a base-tie between the same two layers coexist (Task 1/2); sides swap with a/b normalization (Task 3); top↔base mixed edges are an edge case to normalize/validate (Task 8).
