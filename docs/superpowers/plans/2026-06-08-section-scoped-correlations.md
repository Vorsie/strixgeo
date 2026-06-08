# Section-scoped Correlation Edges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A correlation edge belongs to the cross-section it was authored on and renders only there; the 3D body stays the model-level union of all sections' correlations.

**Architecture:** Add a NOT-NULL `section_id` FK to `litho_contact_correlation_edge` (`ON DELETE CASCADE`), widen its UNIQUE to `(model_id, section_id, contact_a_id, contact_b_id)`, and clean-slate the 307 existing edges (re-correlate per section). Authoring stamps the section; the list/clear/accept endpoints scope by the `section_id` column; the bundle round-trips it. `ResolveLithoInstances` (`body_id`/3D) is untouched — it still unions all approved edges.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + pytest (`scripts/run-integration-tests.ps1`); React + TypeScript + Vitest (Node 22).

**Spec:** `docs/superpowers/specs/2026-06-08-section-scoped-correlations-design.md`

**Pre-commit reality:** the git hook runs `pytest tests/unit` (no DB) + desktop Vitest on staged files. Integration tests are NOT in the hook — run them with `.\scripts\run-integration-tests.ps1`. That wrapper TRUNCATEs the `_integration` DB (wiping the Playwright e2e fixture); re-seed before any e2e run.

---

### Task 1: ORM — add `section_id` + widen the UNIQUE

**Files:**
- Modify: `src/groundmodel/infrastructure/db/models/litho_contact_correlation_edge_orm.py`

- [ ] **Step 1: Add the `section_id` import + column + widen the unique constraint**

In the `__table_args__` tuple, replace the existing `UniqueConstraint(... "uq_litho_contact_corr_triple")` block:

```python
        UniqueConstraint(
            "model_id",
            "contact_a_id",
            "contact_b_id",
            name="uq_litho_contact_corr_triple",
        ),
```

with the section-scoped form:

```python
        # Section-scoped (owner directive 2026-06-08): one edge per
        # (model, section, contact-pair). The SAME pair may be correlated on
        # two sections (e.g. parallel cuts through the same tests) — each gets
        # its own row + ribbon. Canonical ordering still covers the symmetric
        # duplicate within a section.
        UniqueConstraint(
            "model_id",
            "section_id",
            "contact_a_id",
            "contact_b_id",
            name="uq_litho_contact_corr_triple",
        ),
```

Then add the column itself, immediately after the `model_id` column block (before `contact_a_id`):

```python
    # FK to cross_section — the section this correlation was AUTHORED on.
    # Section-scoped rendering (owner directive 2026-06-08): a correlation is
    # displayed only on its section, and the section Accept/Auto-correlate verbs
    # scope by it. The model-level resolver still unions ALL sections' approved
    # edges into one body (3D = transitive closure across cuts), so this column
    # does NOT change body resolution. ON DELETE CASCADE: deleting a section
    # drops the correlations authored on it.
    section_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("cross_section.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
```

- [ ] **Step 2: Verify unit suite still green (ORM change doesn't persist in unit tests)**

Run: `uv run pytest tests/unit -q`
Expected: PASS (unit tests don't hit the DB; the NOT-NULL only bites at flush in integration).

- [ ] **Step 3: Commit**

```bash
git add src/groundmodel/infrastructure/db/models/litho_contact_correlation_edge_orm.py
git commit -m "feat(geology): add section_id to litho_contact_correlation_edge ORM"
```

---

### Task 2: Alembic migration — clean slate + `section_id`

**Files:**
- Create: a new migration under `src/groundmodel/infrastructure/db/migrations/versions/` (generated)

- [ ] **Step 1: Generate the migration skeleton**

Run: `uv run alembic revision -m "section-scope litho contact correlations"`
This creates a file with `down_revision = "e1c2d3a4b5f6"` (current head) already set. Note the generated path.

- [ ] **Step 2: Fill in upgrade/downgrade**

Replace the generated `upgrade()` / `downgrade()` with (keep the generated `revision`/`down_revision`/imports; add `from alembic import op`, `import sqlalchemy as sa`, `from sqlalchemy.dialects import postgresql` if not present):

```python
def upgrade() -> None:
    """Section-scope correlation edges: clean slate + section_id NOT NULL.

    Owner directive 2026-06-08: existing edges have no section linkage to
    backfill, and re-correlating per section is one click (Auto-correlate →
    Accept). Delete all edges first so the NOT-NULL add is safe on an empty
    table; the user rebuilds ribbons + bodies by re-correlating each section.
    """
    op.execute("DELETE FROM litho_contact_correlation_edge")
    op.drop_constraint(
        "uq_litho_contact_corr_triple",
        "litho_contact_correlation_edge",
        type_="unique",
    )
    op.add_column(
        "litho_contact_correlation_edge",
        sa.Column("section_id", postgresql.UUID(as_uuid=True), nullable=False),
    )
    op.create_foreign_key(
        "fk_litho_contact_corr_section",
        "litho_contact_correlation_edge",
        "cross_section",
        ["section_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "idx_litho_contact_corr_section_id",
        "litho_contact_correlation_edge",
        ["section_id"],
    )
    op.create_unique_constraint(
        "uq_litho_contact_corr_triple",
        "litho_contact_correlation_edge",
        ["model_id", "section_id", "contact_a_id", "contact_b_id"],
    )


def downgrade() -> None:
    """Revert to the model-level unique (data loss on section_id is accepted —
    pre-ship, backwards-compat suspended)."""
    op.drop_constraint(
        "uq_litho_contact_corr_triple",
        "litho_contact_correlation_edge",
        type_="unique",
    )
    op.drop_index(
        "idx_litho_contact_corr_section_id",
        table_name="litho_contact_correlation_edge",
    )
    op.drop_constraint(
        "fk_litho_contact_corr_section",
        "litho_contact_correlation_edge",
        type_="foreignkey",
    )
    op.drop_column("litho_contact_correlation_edge", "section_id")
    op.create_unique_constraint(
        "uq_litho_contact_corr_triple",
        "litho_contact_correlation_edge",
        ["model_id", "contact_a_id", "contact_b_id"],
    )
```

- [ ] **Step 3: Apply to the integration DB + the dev DB**

Run: `.\scripts\run-integration-tests.ps1 --collect-only` (migrates the `_integration` DB).
Then migrate the **dev** DB so the dogfed app doesn't 500 (per `feedback_migrate_dev_db_after_migration_fix`):
Run: `uv run alembic upgrade head`
Expected: both succeed; `litho_contact_correlation_edge.section_id` exists.

- [ ] **Step 4: Verify the column + constraint landed**

Run: `docker exec strix-db-1 psql -U groundmodel -d groundmodel -c "\d litho_contact_correlation_edge"`
Expected: `section_id uuid not null`, FK `fk_litho_contact_corr_section`, index `idx_litho_contact_corr_section_id`, unique `uq_litho_contact_corr_triple` over `(model_id, section_id, contact_a_id, contact_b_id)`.

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/infrastructure/db/migrations/versions/
git commit -m "feat(db): section-scope litho contact correlation edges (clean slate)"
```

---

### Task 3: Authoring — stamp `section_id` on create + auto-correlate

**Files:**
- Modify: `src/groundmodel/application/correlate_litho_contacts.py` (~175-202)
- Modify: `src/groundmodel/application/auto_correlate_contact_edges.py` (~320-335)
- Test: `tests/integration/application/test_auto_correlate_contact_edges.py`

- [ ] **Step 1: Write the failing test (same pair on two sections → two edges)**

Add to `tests/integration/application/test_auto_correlate_contact_edges.py` (mirror the existing fixture there for project/model/section/layers; create a SECOND section through the same two tests). Use the real fixtures in that module for the model + two litho layers `la`, `lb` and two sections `sec1`, `sec2`:

```python
@pytest.mark.asyncio
async def test_same_pair_correlates_once_per_section(
    db_session: AsyncSession, two_section_pair
) -> None:
    """Section-scoped: correlating the same contact pair on two sections yields
    two edges (one per section), each stamped with its section_id."""
    ctx = two_section_pair  # model_id, section1_id, section2_id, layer_a_id, layer_b_id, project_id
    uc = CorrelateLithoContacts(db_session)
    r1 = await uc.execute(
        project_id=ctx.project_id, model_id=ctx.model_id,
        contact_a_id=ctx.layer_a_id, contact_b_id=ctx.layer_b_id,
        source="manual", request_section_id=ctx.section1_id,
    )
    r2 = await uc.execute(
        project_id=ctx.project_id, model_id=ctx.model_id,
        contact_a_id=ctx.layer_a_id, contact_b_id=ctx.layer_b_id,
        source="manual", request_section_id=ctx.section2_id,
    )
    assert r1.was_created and r2.was_created
    assert r1.edge.id != r2.edge.id
    assert r1.edge.section_id == ctx.section1_id
    assert r2.edge.section_id == ctx.section2_id
```

(Build `two_section_pair` from the module's existing project/model/litho-layer fixtures plus two `CrossSectionOrm` rows whose corridor contains both tests. If the module lacks a reusable builder, add a `pytest_asyncio.fixture` that commits them and returns a `SimpleNamespace` of the ids.)

- [ ] **Step 2: Run to verify it fails**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/application/test_auto_correlate_contact_edges.py::test_same_pair_correlates_once_per_section`
Expected: FAIL — either the create errors (NOT-NULL `section_id`) or the second create returns the first (old model-level unique).

- [ ] **Step 3: Stamp `section_id` in the manual create path**

In `correlate_litho_contacts.py`, just before the edge insert (~line 188), add the guard, then add `section_id` to the existing-edge query and the insert. The existing-edge query (`existing_stmt`, ~175-181) currently filters `model_id, contact_a_id == a_id, contact_b_id == b_id` — add the section filter:

```python
        if request_section_id is None:
            raise ValueError(
                "CorrelateLithoContacts requires request_section_id — a "
                "correlation is always authored on a section (section-scoped, "
                "owner directive 2026-06-08)."
            )
```

In `existing_stmt`'s `.where(...)`, add:

```python
            LithoContactCorrelationEdgeOrm.section_id == request_section_id,
```

In the `LithoContactCorrelationEdgeOrm(...)` constructor (~195), add:

```python
            section_id=request_section_id,
```

- [ ] **Step 4: Stamp `section_id` in the auto-correlate path**

In `auto_correlate_contact_edges.py`, the `values` list comprehension (~320) builds one dict per candidate. Add `section_id` (the `execute` already receives `section_id`; auto-correlate is always section-scoped — add a guard at the top of `execute` if `section_id is None` mirroring the manual path, since the column is NOT NULL):

```python
        if section_id is None:
            raise ValueError(
                "AutoCorrelateContactEdges requires section_id (section-scoped "
                "correlations, owner directive 2026-06-08)."
            )
```

Add to each `values` dict:

```python
                "section_id": section_id,
```

(The `.on_conflict_do_nothing(constraint="uq_litho_contact_corr_triple")` is unchanged — it now targets the section-scoped unique.)

- [ ] **Step 5: Run to verify the test passes**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/application/test_auto_correlate_contact_edges.py`
Expected: PASS (the new test + existing auto-correlate tests — see Task 4 if existing ones fail on the NOT-NULL column).

- [ ] **Step 6: Commit (two files, separately)**

```bash
git add src/groundmodel/application/correlate_litho_contacts.py
git commit -m "feat(geology): manual correlate stamps section_id (section-scoped)"
git add src/groundmodel/application/auto_correlate_contact_edges.py tests/integration/application/test_auto_correlate_contact_edges.py
git commit -m "feat(geology): auto-correlate stamps section_id + same-pair-per-section test"
```

---

### Task 4: Test factories + synthetic e2e fixture stamp `section_id`

The NOT-NULL column breaks any test/factory/fixture that persists an edge without it. Fix them all so the integration + e2e suites are green.

**Files:**
- Modify: every test that constructs `LithoContactCorrelationEdgeOrm(...)` without `section_id`
- Modify: `desktop/tests/e2e/fixtures/build_synthetic_fixture.py` (or wherever the fixture seeds edges)

- [ ] **Step 1: Find every edge-construction site**

Run: `rg -n "LithoContactCorrelationEdgeOrm\(" tests/ desktop/ scripts/`
Run: `rg -n "litho_contact_correlation_edge|contact-correlations" desktop/tests/e2e/fixtures/`

- [ ] **Step 2: Add `section_id` to each construction site**

For each match, pass a valid `section_id` (a section in the same project whose corridor contains both endpoint tests). In test modules that already build a section, reuse its id. In the synthetic fixture, stamp the section the correlated tests sit on. Where a test only needs *a* section, add a minimal `CrossSectionOrm` to its fixture and use its id.

- [ ] **Step 3: Run the full integration suite**

Run: `.\scripts\run-integration-tests.ps1 -q`
Expected: PASS. Any remaining `NotNullViolation` / `IntegrityError` on `section_id` points to a missed construction site — fix it.

- [ ] **Step 4: Re-seed the e2e fixture + run the DOV/litho e2e specs that touch correlations**

The integration run truncated the `_integration` DB. Re-seed, then:
Run: `.\scripts\run-e2e.ps1 flow_auto_correlate` (and any correlation-touching spec)
Expected: PASS. Fix the fixture builder if an edge insert fails.

- [ ] **Step 5: Commit (per file or logically grouped by test module)**

```bash
git add <changed test files> desktop/tests/e2e/fixtures/<changed fixture>
git commit -m "test(geology): stamp section_id on correlation-edge fixtures"
```

---

### Task 5: Render + clear-suggestions scope by `section_id` column

**Files:**
- Modify: `src/groundmodel/api/routers/geology/contact_correlations.py` (~94-148 helper, ~330-339 list, ~472-486 clear)
- Test: `tests/integration/api/test_auto_correlate_contact_edges.py` or a router test for the GET (mirror an existing one)

- [ ] **Step 1: Write the failing test (cross-section edge does not leak)**

Add a router/integration test: author an edge on section S1 (both endpoints in S1's and S2's corridors), then GET `…/contact-correlations?section_id=<S2>` and assert the edge is absent; GET with `section_id=<S1>` returns it.

```python
@pytest.mark.asyncio
async def test_list_correlations_section_scoped(
    async_client: AsyncClient, two_section_pair_with_edge
) -> None:
    ctx = two_section_pair_with_edge  # edge authored on section1; both tests in both corridors
    base = f"/projects/{ctx.project_id}/geology/models/{ctx.model_id}/contact-correlations"
    s1 = (await async_client.get(base, params={"section_id": str(ctx.section1_id)})).json()
    s2 = (await async_client.get(base, params={"section_id": str(ctx.section2_id)})).json()
    assert any(e["id"] == str(ctx.edge_id) for e in s1)
    assert all(e["id"] != str(ctx.edge_id) for e in s2)
```

- [ ] **Step 2: Run to verify it fails**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/api/<file>::test_list_correlations_section_scoped`
Expected: FAIL — the old `_contact_ids_on_section` filter returns the edge for both sections (both project the endpoints).

- [ ] **Step 3: Repoint the list filter at the `section_id` column**

In `list_contact_correlations` (~330-339), replace:

```python
    if section_id is not None:
        contact_ids = await _contact_ids_on_section(
            session, project_id=project_id, model_id=model_id, section_id=section_id
        )
        if not contact_ids:
            return []
        stmt = stmt.where(
            LithoContactCorrelationEdgeOrm.contact_a_id.in_(contact_ids),
            LithoContactCorrelationEdgeOrm.contact_b_id.in_(contact_ids),
        )
```

with:

```python
    if section_id is not None:
        # Section-scoped render (owner directive 2026-06-08): an edge belongs to
        # the section it was AUTHORED on, not "any section that projects both
        # endpoints". Filter the section_id column directly.
        stmt = stmt.where(LithoContactCorrelationEdgeOrm.section_id == section_id)
```

- [ ] **Step 4: Repoint the clear-suggestions filter the same way**

In `delete_auto_contact_correlations` (~476-486), replace the `_contact_ids_on_section` block with:

```python
    if section_id is not None:
        stmt = stmt.where(LithoContactCorrelationEdgeOrm.section_id == section_id)
```

- [ ] **Step 5: Remove the now-unused helper**

Run: `rg -n "_contact_ids_on_section" src/`
If the only definition remains (no callers), delete the `_contact_ids_on_section` function (~94-148). Then run `rg -n "project_investigations_onto_section" src/groundmodel/api/routers/geology/contact_correlations.py` — if that import is now unused, remove it.

- [ ] **Step 6: Run to verify the test passes + nothing else broke**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/api/test_auto_correlate_contact_edges.py tests/integration/api/<list-test-file>`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/groundmodel/api/routers/geology/contact_correlations.py tests/integration/api/<file>
git commit -m "feat(api): correlation list/clear scope by section_id column"
```

**Note — no toolbar change needed:** `SectionsToolbar`'s Auto-correlate "re-correlate?" pre-check (~192) already passes `selectedSectionId` to `listContactCorrelations`. Once this task repoints the GET's `section_id` filter at the `section_id` column, the pre-check counts only this section's unapproved auto edges automatically.

---

### Task 6: Accept-correlations scope by `section_id`

**Files:**
- Modify: `src/groundmodel/application/accept_contact_correlations.py` (~171-185)
- Test: `tests/integration/application/test_accept_contact_correlations.py`

- [ ] **Step 1: Write the failing test (accept on S1 leaves S2's edge unapproved)**

Add: two unapproved auto edges, one stamped section S1, one section S2; call section-scoped accept for S1; assert S1's edge is approved and S2's is still `user_approved=False`.

```python
@pytest.mark.asyncio
async def test_accept_scoped_to_section(db_session, two_section_unapproved_edges) -> None:
    ctx = two_section_unapproved_edges  # edge1 on S1, edge2 on S2, both user_approved=False
    await AcceptContactCorrelations(db_session).execute(
        project_id=ctx.project_id, model_id=ctx.model_id, section_id=ctx.section1_id
    )
    e1 = await db_session.get(LithoContactCorrelationEdgeOrm, ctx.edge1_id)
    e2 = await db_session.get(LithoContactCorrelationEdgeOrm, ctx.edge2_id)
    assert e1.user_approved is True
    assert e2.user_approved is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/application/test_accept_contact_correlations.py::test_accept_scoped_to_section`
Expected: FAIL — the old seeded-set scope approves by contact membership, not section_id (with empty seeded sets it may approve neither, or with shared contacts approve both).

- [ ] **Step 3: Replace the seeded-set scope with the section_id column**

In `accept_contact_correlations.py`, the `elif section_id is not None:` branch (~171-185) — keep the `load_scoped_or_raise` project guard, replace the seeded-set `in_scope_stmt`:

```python
        elif section_id is not None:
            # Validate the section belongs to the project (404/403 guard).
            await load_scoped_or_raise(
                self._session, CrossSectionOrm, section_id, project_id, label="Cross-section"
            )
            # Section-scoped accept (owner directive 2026-06-08): approve only the
            # unapproved edges AUTHORED on this section. Replaces the old
            # seeded-set intersection, which broke once classification stopped
            # populating the seeded set per section (the two scopes now agree).
            in_scope_stmt = select(LithoContactCorrelationEdgeOrm.id).where(
                LithoContactCorrelationEdgeOrm.model_id == model_id,
                LithoContactCorrelationEdgeOrm.user_approved.is_(False),
                LithoContactCorrelationEdgeOrm.section_id == section_id,
            )
```

(Drop the now-unused `section_contact_ids` debug line. If `sec.seeded_formation_contact_ids` is no longer read anywhere in this file, the `sec` local from `load_scoped_or_raise` is only used for the guard — that's fine.)

- [ ] **Step 4: Run to verify the test passes**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/application/test_accept_contact_correlations.py`
Expected: PASS (new test + existing — update any existing test that asserted the seeded-set scope to stamp `section_id` and expect section-scoped behaviour).

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/application/accept_contact_correlations.py tests/integration/application/test_accept_contact_correlations.py
git commit -m "feat(geology): section-scoped accept reads section_id (closes seeded-scope gap)"
```

---

### Task 7: Bundle — serialize + restore `section_id`

**Files:**
- Modify: `src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_build.py` (~325)
- Modify: `src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py` (~695-735)
- Test: `tests/integration/db/test_project_bundle.py`

- [ ] **Step 1: Write the failing test (edge round-trips with section_id; legacy dropped)**

Add to `tests/integration/db/test_project_bundle.py`: build a project with a model, a section, two litho layers, and one approved edge stamped with the section; save the bundle, restore into a clean project, assert the restored edge carries the same `section_id`. Second case: a hand-built bundle payload whose edge dict lacks `section_id` is dropped (not restored, no crash).

```python
@pytest.mark.asyncio
async def test_bundle_roundtrips_edge_section_id(db_session, bundle_with_section_edge) -> None:
    ctx = bundle_with_section_edge
    restored = await _save_and_restore(db_session, ctx)  # helper in this module
    edge = (await db_session.execute(
        select(LithoContactCorrelationEdgeOrm).where(
            LithoContactCorrelationEdgeOrm.id == ctx.edge_id
        )
    )).scalar_one()
    assert edge.section_id == ctx.section_id


@pytest.mark.asyncio
async def test_restore_drops_edge_without_section_id(db_session, restore_payload_factory) -> None:
    payload = restore_payload_factory(edge_without_section=True)
    result = await restore_project_bundle(db_session, payload)  # match the module's call shape
    # The legacy edge (no section_id) is dropped; restore does not raise.
    assert (await db_session.execute(
        select(func.count()).select_from(LithoContactCorrelationEdgeOrm)
    )).scalar_one() == 0
```

(Adapt to the module's actual save/restore helpers + payload shape.)

- [ ] **Step 2: Run to verify it fails**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/db/test_project_bundle.py -k "section_id or section"`
Expected: FAIL — build doesn't serialize `section_id`; restore either errors on the NOT-NULL column or doesn't drop the legacy edge.

- [ ] **Step 3: Serialize `section_id` in the bundle build**

In `bundle_build.py`, the `"litho_contact_correlation_edges": [ {...} ]` dict (~325) currently emits `id, model_id, contact_a_id, contact_b_id, source, user_approved` (+ timestamps). Add `section_id`:

```python
                "section_id": str(e.section_id),
```

(Match the existing key style — if other ids are emitted as `str(...)`, use `str(...)`; if raw UUID, match that.)

- [ ] **Step 4: Drop legacy edges + restore valid section_id in the restore path**

In `bundle_restore_litho.py`, inside the per-edge loop (~717, after the contact-endpoint validity check, before `_apply_json_to_kwargs`), add a section guard. The restore already builds validity sets for models/contacts; add `valid_section_ids` (the sections restored for this project — load them the same way the function loads `valid_model_ids`/`valid_contact_ids`):

```python
        ce_section_id = _uuid(ce_payload.get("section_id"))
        if ce_section_id is None or ce_section_id not in valid_section_ids:
            logger.warning(
                f"[{i}/{total}] litho contact edge {ce_id}: missing or unknown "
                f"section_id {ce_section_id} — dropped (section-scoped, clean slate)"
            )
            dropped += 1
            continue
```

If `valid_section_ids` is not already computed in this function, add it near the other validity sets, e.g.:

```python
    valid_section_ids = {
        r for (r,) in (
            await session.execute(
                select(CrossSectionOrm.id).where(CrossSectionOrm.app_project_id == project_id)
            )
        ).all()
    }
```

(Import `CrossSectionOrm` if not already imported in this module.)

- [ ] **Step 5: Run to verify the tests pass**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/db/test_project_bundle.py`
Expected: PASS (new tests + existing bundle round-trip tests — existing fixtures that include edges must already stamp `section_id` from Task 4).

- [ ] **Step 6: Commit (two files, separately)**

```bash
git add src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_build.py
git commit -m "feat(bundle): serialize correlation-edge section_id"
git add src/groundmodel/infrastructure/db/repositories/project_bundle/bundle_restore_litho.py tests/integration/db/test_project_bundle.py
git commit -m "feat(bundle): restore section_id; drop section-less legacy edges"
```

---

### Task 8: Frontend — pass the section to the edge fetch + type

**Files:**
- Modify: `desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx` (~389-408 `refetchContactEdges`)
- Modify: `desktop/src/renderer/src/api/clients/geology.ts` (~720 `LithoContactCorrelationEdge` interface)

- [ ] **Step 1: Add `section_id` to the edge type**

In `geology.ts`, the `LithoContactCorrelationEdge` interface (~720), add after `model_id`:

```typescript
  section_id: string
```

- [ ] **Step 2: Pass the selected section to the fetch**

In `SectionsCanvas.tsx`, `refetchContactEdges` (~399) currently calls:

```typescript
      const edges = await api.geology.listContactCorrelations(project.id, lithoModelId)
```

Change to pass the selected section so only this section's edges return:

```typescript
      const edges = await api.geology.listContactCorrelations(
        project.id,
        lithoModelId,
        selectedSectionId,
      )
```

The effect that calls `refetchContactEdges` already lists `selectedSectionId` in its dep array (line ~422), so it re-fetches on section change. `refetchContactEdges`'s `useCallback` deps are `[lithoModelId, project.id]` — add `selectedSectionId`:

```typescript
  }, [lithoModelId, project.id, selectedSectionId])
```

(The manual correlate gesture already threads `requestSectionId` through `createContactCorrelation` — no change needed there.)

- [ ] **Step 3: tsc (filtered) + the sections Vitest suite**

Run: `cd desktop ; npx tsc --noEmit -p tsconfig.web.json 2>&1 | rg -i "SectionsCanvas|geology"` → expect no output.
Run: `cd desktop ; npx vitest run src/renderer/src/shell/stages/sections/` → expect PASS. If a test mocked `listContactCorrelations` and asserted a 2-arg call, update it to expect the section arg.

- [ ] **Step 4: Commit (two files, separately)**

```bash
git add desktop/src/renderer/src/api/clients/geology.ts
git commit -m "feat(desktop): section_id on LithoContactCorrelationEdge type"
git add desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx
git commit -m "fix(desktop): fetch only the selected section's correlation edges"
```

---

### Task 9: Full-suite verification + dogfeed handoff

- [ ] **Step 1: Backend — full unit + full integration**

Run: `uv run pytest tests/unit -q` → PASS
Run: `.\scripts\run-integration-tests.ps1 -q` → PASS

- [ ] **Step 2: Frontend — full Vitest + full web tsc**

Run: `cd desktop ; npx vitest run` → PASS
Run: `cd desktop ; npx tsc --noEmit -p tsconfig.web.json` → exit 0

- [ ] **Step 3: Re-seed the e2e fixture + run the e2e suite (integration run wiped it)**

Re-seed per the e2e runner, then: `.\scripts\run-e2e.ps1` → PASS (close the dev app first; the runner aborts if :8765 is busy).

- [ ] **Step 4: Dogfeed handoff (owner)**

Confirm in the live app (restart it — backend + migration changed):
1. The existing project's ribbons are gone (clean slate) and litho bands render per-column until re-correlation.
2. Auto-correlate → Accept on a section rebuilds that section's ribbons + bodies.
3. Draw a **perpendicular** section through the same tests → it shows **no** carried-over ribbons; correlate on it → its own ribbons appear; the original section is unchanged.
4. The 3D body reflects the **union** of both sections' correlations.

---

## Notes for the implementer

- Node must be 22.x for Vitest (`node --version`).
- `.\scripts\run-integration-tests.ps1` truncates the `_integration` DB (wipes the Playwright fixture) — re-seed before any e2e run.
- After the migration, migrate the **dev** DB too (`uv run alembic upgrade head`, no env override) or the dogfed app 500s.
- Out of scope (do NOT touch): `ResolveLithoInstances` / `body_id` / partition fill / 3D (model-level union stays), the classification in-corridor gate (Task 1 of the prior plan), correlation-mode toolbar gate.
- Each Python commit triggers the pre-commit hook's `pytest tests/unit` (no DB) — keep unit green throughout (the NOT-NULL only bites integration, which the hook does not run).
