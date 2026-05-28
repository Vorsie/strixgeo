# Litho ↔ Geological Contact Coupling (#162) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Couple coincident litho and geological contacts so they stay in sync (move-one-moves-the-other), the litho model splits to honour geo boundaries, and the geological model adopts the engineer's litho boundary positions.

**Architecture:** A nullable self-FK `parent_geo_contact_id` on `formation_contact` (litho → geo, `SET NULL` on delete = free unlink-on-geo-delete). On litho accept, each litho contact that sits on / within the snap tolerance of a geological contact is linked (snap geo→litho); geo moves trigger an auto-rebuild of affected surfaces. `UpdateFormationContact` propagates depth changes bidirectionally with a loop guard. No geological contacts are ever created — the existing straddle-split makes the litho contacts; coupling adds the link, the snap, and the rebuild.

**Tech Stack:** SQLAlchemy + Alembic, FastAPI, Pydantic; React + TS (Electron); pytest, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-28-litho-geo-contact-coupling-design.md`

**Scope:** Slice 1 only (the full coupling behaviour). Slice 2 (explicit manual "Link to geology…" action) is out of scope for this plan.

---

## File Structure

- `infrastructure/db/models/formation_contact_orm.py` — add the FK column.
- `infrastructure/db/migrations/versions/<rev>_*.py` — new migration.
- `application/accept_litho_suggestions.py` — carry geo contact ids; couple step; auto-rebuild hook.
- `application/batch_accept_litho_suggestions.py` — thread couple + once-per-batch rebuild.
- `application/update_formation_contact.py` — bidirectional propagation + loop guard.
- `application/unlink_litho_from_geo.py` — new use case (unlink).
- `api/routers/geology/contacts.py` — unlink endpoint.
- `api/schemas/project/geological_formation_contact.py` (or wherever the contact response schema lives) — expose `parent_geo_contact_id`.
- `infrastructure/db/repositories/project_bundle.py` — restore second-pass backfill.
- `desktop/.../api/client.ts` — `parent_geo_contact_id` on the contact type + `unlinkLithoFromGeo`.
- `desktop/.../hooks/useGeologicalModel.ts` — couple-tolerance threading + unlink handler.
- `desktop/.../components/sections/ContactsLayer.tsx` — unlink context-menu item + link glyph.
- `desktop/.../components/SettingsDialog.tsx` — relabel the snap-tolerance NumberRow.

---

## Task 1: Schema — `parent_geo_contact_id` FK + migration

**Files:**
- Modify: `src/groundmodel/infrastructure/db/models/formation_contact_orm.py`
- Create: `src/groundmodel/infrastructure/db/migrations/versions/<generated>_add_parent_geo_contact_id.py`
- Test: `tests/integration/db/test_contact_geo_link.py`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/db/test_contact_geo_link.py`. Mirror an existing integration test's fixtures (see `tests/integration/api/test_accept_litho_display_order.py` for how a project + geo model + litho model + contacts are set up). The test: create a geo contact G and a litho contact L with `parent_geo_contact_id=G.id`; assert it persists; delete G; assert L still exists with `parent_geo_contact_id IS NULL` (SET NULL).

```python
import pytest
from sqlalchemy import select
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm

@pytest.mark.asyncio
async def test_litho_contact_links_to_geo_and_unlinks_on_geo_delete(db_session, seeded_geo_and_litho):
    # seeded_geo_and_litho: a fixture giving (geo_contact, litho_contact, ...).
    geo, litho = seeded_geo_and_litho.geo_contact, seeded_geo_and_litho.litho_contact
    litho.parent_geo_contact_id = geo.id
    await db_session.flush()
    await db_session.refresh(litho)
    assert litho.parent_geo_contact_id == geo.id
    await db_session.delete(geo)
    await db_session.flush()
    await db_session.refresh(litho)
    assert litho.parent_geo_contact_id is None  # SET NULL
```

(If no `seeded_geo_and_litho` fixture exists, build the two contacts inline using the repository, mirroring `test_accept_litho_display_order.py`'s setup. Keep it minimal: one geological model + one litho model + one borehole + two contacts.)

- [ ] **Step 2: Run to verify it fails**

`.\scripts\run-integration-tests.ps1 tests/integration/db/test_contact_geo_link.py`
Expected: FAIL — `parent_geo_contact_id` attribute does not exist / column missing.

- [ ] **Step 3: Add the column to the ORM**

In `formation_contact_orm.py`, after the `observation_layer_id` column (~line 173) add:

```python
    # Litho↔geo coupling (#162). Set on a LITHOSTRATIGRAPHIC contact,
    # pointing at the GEOLOGICAL contact it is the same physical surface
    # as. SET NULL on delete → deleting the geo contact auto-unlinks its
    # litho children at the DB layer (the unlink lifecycle is free).
    # NULL = not coupled. Self-referential FK (both rows live in
    # formation_contact).
    parent_geo_contact_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("formation_contact.id", ondelete="SET NULL"),
        nullable=True,
    )
```

Add an index in `__table_args__` (so propagation can find a geo contact's children fast):

```python
        Index("idx_formation_contact_parent_geo", "parent_geo_contact_id"),
```

- [ ] **Step 4: Generate + write the migration**

Run: `uv run alembic revision -m "add parent_geo_contact_id to formation_contact"`
Edit the generated file's `upgrade()` / `downgrade()`:

```python
def upgrade() -> None:
    op.add_column(
        "formation_contact",
        sa.Column("parent_geo_contact_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_formation_contact_parent_geo",
        "formation_contact", "formation_contact",
        ["parent_geo_contact_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "idx_formation_contact_parent_geo", "formation_contact", ["parent_geo_contact_id"],
    )

def downgrade() -> None:
    op.drop_index("idx_formation_contact_parent_geo", table_name="formation_contact")
    op.drop_constraint("fk_formation_contact_parent_geo", "formation_contact", type_="foreignkey")
    op.drop_column("formation_contact", "parent_geo_contact_id")
```

Ensure `from alembic import op`, `import sqlalchemy as sa`, `from sqlalchemy.dialects import postgresql` are present.

- [ ] **Step 5: Apply to dev DB + run the test**

`uv run alembic upgrade head` (dev DB), then
`.\scripts\run-integration-tests.ps1 tests/integration/db/test_contact_geo_link.py` (the wrapper migrates the integration DB).
Expected: PASS.

- [ ] **Step 6: Expose the field on the contact response schema**

Find the `FormationContactResponse` Pydantic schema (grep `class FormationContactResponse` under `src/groundmodel/api/schemas/`). Add `parent_geo_contact_id: UUID | None = None`. Add the matching field to the TS `FormationContactResponse` in `desktop/src/renderer/src/api/client.ts` (`parent_geo_contact_id: string | null`). Run `uv run pytest tests/unit -q` and `cd desktop && npx tsc --noEmit -p tsconfig.web.json` — both clean.

- [ ] **Step 7: Commit**

```bash
git add src/groundmodel/infrastructure/db/models/formation_contact_orm.py src/groundmodel/infrastructure/db/migrations/versions/*parent_geo_contact_id*.py tests/integration/db/test_contact_geo_link.py
git add <the FormationContactResponse schema file> desktop/src/renderer/src/api/client.ts
git commit -m "feat(geology): add parent_geo_contact_id FK for litho-geo coupling (#162)"
```

---

## Task 2: Bundle restore backfill

**Files:**
- Modify: `src/groundmodel/infrastructure/db/repositories/project_bundle.py`
- Test: `tests/integration/api/test_project_bundle.py` (or wherever bundle round-trip is tested)

**Why:** `parent_geo_contact_id` rides the bundle automatically (column enumeration, #47), but on restore a litho contact's FK references another `formation_contact` row that may not be inserted yet → FK violation. Restore must insert all contacts with the link nulled, then backfill it in a second pass.

- [ ] **Step 1: Write the failing test**

In the bundle round-trip test file, add: build a bundle whose litho contact carries `parent_geo_contact_id` pointing at a geo contact; restore onto a wiped DB; assert the litho contact's `parent_geo_contact_id` equals the geo contact id post-restore. (Mirror the existing save→restore test setup in that file.)

- [ ] **Step 2: Run to verify it fails**

`.\scripts\run-integration-tests.ps1 tests/integration/api/test_project_bundle.py -k parent_geo`
Expected: FAIL — either FK violation on restore, or `parent_geo_contact_id` is NULL after restore.

- [ ] **Step 3: Implement null-then-backfill in restore**

In `project_bundle.py`'s contact-restore path: when constructing each `FormationContactOrm` from the bundle, set `parent_geo_contact_id=None` on first insert, but remember the intended value (`{contact_id: parent_geo_contact_id}` for non-null ones). After ALL contacts are added + flushed, run a second pass that sets `parent_geo_contact_id` on each remembered contact and flushes again. (Find the contact-construction loop — grep `FormationContactOrm(` in the file — and the function's flush point.)

```python
# during contact construction:
_geo_links: dict[UUID, UUID] = {}
# for each contact payload:
#   orm = FormationContactOrm(..., parent_geo_contact_id=None)
#   pgc = payload.get("parent_geo_contact_id")
#   if pgc is not None:
#       _geo_links[orm.id] = UUID(pgc)
# ... after all contacts added + flushed:
for contact_id, geo_id in _geo_links.items():
    c = await session.get(FormationContactOrm, contact_id)
    if c is not None:
        c.parent_geo_contact_id = geo_id
await session.flush()
```

- [ ] **Step 4: Run to verify it passes**

`.\scripts\run-integration-tests.ps1 tests/integration/api/test_project_bundle.py -k parent_geo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/infrastructure/db/repositories/project_bundle.py tests/integration/api/test_project_bundle.py
git commit -m "feat(bundle): restore parent_geo_contact_id via second-pass backfill (#162)"
```

---

## Task 3: Couple step on accept (link + snap geo→litho)

**Files:**
- Modify: `src/groundmodel/application/accept_litho_suggestions.py`
- Test: `tests/unit/application/test_accept_litho_suggestions.py`

**Context:** `_compute_straddle_splits` reads `geology_contacts_at_inv: list[tuple[float, UUID]]` (depth, formation_id). Extend the loader that builds that list (grep where `geology_contacts_at_inv` is populated in `execute`) to also carry the **geo contact id**: `list[tuple[float, UUID, UUID]]` = (depth, formation_id, geo_contact_id). Then add a pure helper that, given a litho contact's depth + the geo contacts at the investigation + the tolerance, returns the geo contact id to link to (the one at/within tolerance, nearest wins) or None.

- [ ] **Step 1: Write the failing unit tests for the link-resolsolver helper**

Add to `test_accept_litho_suggestions.py`:

```python
from groundmodel.application.accept_litho_suggestions import _geo_contact_to_link

def test_cl1_exact_geo_boundary_links():
    # A straddle-created litho contact at exactly a geo contact depth links to it.
    geo = [(0.0, UPPER_FORMATION_ID, CONTACT_A_ID), (3.0, LOWER_FORMATION_ID, CONTACT_B_ID)]
    assert _geo_contact_to_link(3.0, geo, tolerance_m=0.20) == CONTACT_B_ID

def test_cl2_within_tolerance_links_nearest():
    geo = [(0.0, UPPER_FORMATION_ID, CONTACT_A_ID), (3.0, LOWER_FORMATION_ID, CONTACT_B_ID)]
    # litho at 2.9 is within 0.20 of the 3.0 geo contact → links to it.
    assert _geo_contact_to_link(2.9, geo, tolerance_m=0.20) == CONTACT_B_ID

def test_cl3_mid_formation_no_link():
    geo = [(0.0, UPPER_FORMATION_ID, CONTACT_A_ID), (3.0, LOWER_FORMATION_ID, CONTACT_B_ID)]
    # litho at 1.5 is far from both → no link.
    assert _geo_contact_to_link(1.5, geo, tolerance_m=0.20) is None

def test_cl4_nearest_wins():
    geo = [(2.85, UPPER_FORMATION_ID, CONTACT_A_ID), (3.05, LOWER_FORMATION_ID, CONTACT_B_ID)]
    # litho at 3.0: 0.15 from A, 0.05 from B → B (nearest).
    assert _geo_contact_to_link(3.0, geo, tolerance_m=0.20) == CONTACT_B_ID
```

- [ ] **Step 2: Run to verify they fail**

`uv run pytest tests/unit/application/test_accept_litho_suggestions.py -k _geo_contact_to_link -q`
Expected: FAIL — `_geo_contact_to_link` not defined / ImportError.

- [ ] **Step 3: Implement the helper**

Add to `accept_litho_suggestions.py` (module-level, pure):

```python
def _geo_contact_to_link(
    litho_depth_m: float,
    geo_contacts_at_inv: list[tuple[float, UUID, UUID]],
    tolerance_m: float,
) -> UUID | None:
    """Return the geological contact id a litho contact at ``litho_depth_m``
    should couple to, or None.

    Picks the geo contact whose depth is closest to ``litho_depth_m`` and
    within ``tolerance_m``. ``geo_contacts_at_inv`` entries are
    ``(depth_m, formation_id, contact_id)``.
    """
    best: tuple[float, UUID] | None = None
    for depth, _fid, contact_id in geo_contacts_at_inv:
        d = abs(depth - litho_depth_m)
        if d <= tolerance_m and (best is None or d < best[0]):
            best = (d, contact_id)
    return best[1] if best is not None else None
```

- [ ] **Step 4: Run to verify they pass**

`uv run pytest tests/unit/application/test_accept_litho_suggestions.py -k _geo_contact_to_link -q`
Expected: PASS (CL1–CL4).

- [ ] **Step 5: Thread geo contact ids + wire the couple step into `execute`**

(5a) Extend the `geology_contacts_at_inv` loader in `execute` to carry contact ids — change the query/projection that builds it from `(depth, formation_id)` to `(depth, formation_id, contact.id)`. Update `_compute_straddle_splits`'s type hint accordingly (it only reads `[0]` and `[1]`, so it keeps working; widen the tuple type and any tuple-unpacking `for ... in contacts_sorted` to `for depth, fid, *_ in ...` or `for depth, fid, _cid in ...`).

(5b) Add `straddle_min_piece_thickness_m`'s sibling: pass a new `couple_tolerance_m: float = 0.20` param into `execute` (the snap tolerance from the frontend; default 0.20). After each litho contact is created/found in the main loop, call `_geo_contact_to_link(contact_depth, geo_contacts_at_inv, couple_tolerance_m)`; if it returns a geo contact id, set `contact.parent_geo_contact_id = geo_id`, and if the geo contact's depth differs from the litho depth, move the geo contact's `depth_top_m` to the litho depth (snap geo→litho) via the repo and mark that geo formation's surface stale (record the touched geo formation ids for Task 4's rebuild). Collect `touched_geo_formation_ids: set[UUID]` and return it on `AcceptLithoResult` (add the field).

- [ ] **Step 6: Add an integration test for end-to-end linking**

In `tests/integration/api/test_accept_litho_*.py` (new file `test_accept_litho_coupling.py`), accept a litho suggestion whose top coincides (within 0.20 m) with a seeded geo contact; assert the created litho contact has `parent_geo_contact_id` == that geo contact, and the geo contact's depth moved to the litho depth. Mirror the existing accept integration test setup.

- [ ] **Step 7: Run unit + integration**

`uv run pytest tests/unit/application/test_accept_litho_suggestions.py -q` (all green) and
`.\scripts\run-integration-tests.ps1 tests/integration/api/test_accept_litho_coupling.py`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/groundmodel/application/accept_litho_suggestions.py tests/unit/application/test_accept_litho_suggestions.py tests/integration/api/test_accept_litho_coupling.py
git commit -m "feat(litho): link accepted contacts to coincident geo contacts + snap geo->litho (#162)"
```

---

## Task 4: Auto-rebuild geo surfaces after a coupling move

**Files:**
- Modify: `src/groundmodel/api/routers/geology/contacts.py` (accept + batch-accept routers)
- Modify: `src/groundmodel/application/batch_accept_litho_suggestions.py`
- Test: `tests/integration/api/test_accept_litho_coupling.py`

**Context:** `RebuildModelSurfaces` exists (grep its class). The accept use case returns `touched_geo_formation_ids` (Task 3 Step 5). After accept, if that set is non-empty, the router rebuilds the parent geological model's surfaces scoped to those formations (once per accept; once per batch).

- [ ] **Step 1: Write the failing integration test**

Extend `test_accept_litho_coupling.py`: after the accept that snaps a geo contact, assert the affected geo formation's surface is NOT stale (i.e. it was rebuilt). Check the `formation_surface.is_stale` flag for the touched formation is False. (Mirror how other tests read surface staleness.)

- [ ] **Step 2: Run to verify it fails**

`.\scripts\run-integration-tests.ps1 tests/integration/api/test_accept_litho_coupling.py -k rebuild`
Expected: FAIL — surface is stale (no rebuild fired).

- [ ] **Step 3: Wire the rebuild into the accept router**

In the accept router handler (grep `accept-litho-suggestions` in `contacts.py`), after `AcceptLithoSuggestions.execute(...)`, if `result.touched_geo_formation_ids`, resolve the parent geological model id (the litho model's `parent_geological_model_id`) and call `RebuildModelSurfaces.execute(model_id=<parent geo model>, only_formation_ids=result.touched_geo_formation_ids)` (mirror how `RecomputeAllAbsencesForModel(only_formation_ids=...)` is wired — see the batch-accept router). Same for the batch-accept router: aggregate `touched_geo_formation_ids` across anchors and rebuild ONCE after the loop. Thread `couple_tolerance_m` through `BatchAcceptLithoSuggestions.execute` into each inner accept.

- [ ] **Step 4: Run to verify it passes**

`.\scripts\run-integration-tests.ps1 tests/integration/api/test_accept_litho_coupling.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/api/routers/geology/contacts.py src/groundmodel/application/batch_accept_litho_suggestions.py tests/integration/api/test_accept_litho_coupling.py
git commit -m "feat(litho): auto-rebuild geo surfaces touched by coupling snap (#162)"
```

---

## Task 5: Bidirectional propagation in UpdateFormationContact

**Files:**
- Modify: `src/groundmodel/application/update_formation_contact.py`
- Test: `tests/unit/application/test_update_formation_contact_*.py` (mirror an existing one) or a new `test_update_formation_contact_coupling.py`

**Context:** `UpdateFormationContact.execute` has a depth-only path. Add propagation AFTER the depth is applied: if the updated contact is a geo contact, find litho contacts with `parent_geo_contact_id == updated.id` and set their depth; if the updated contact is a litho contact with `parent_geo_contact_id`, set the linked geo contact's depth + mark its surface stale + rebuild. **Loop guard:** only propagate when the target depth differs from the new depth (equal → return). Propagation is a direct repo depth-set — it must NOT re-enter the full `UpdateFormationContact` (no cross-merge, no re-propagation).

- [ ] **Step 1: Write the failing unit tests**

```python
@pytest.mark.asyncio
async def test_prop1_geo_move_propagates_to_linked_litho(...):
    # geo contact G at 3.0, litho L linked to G at 3.0. Update G to 4.0.
    # Assert L.depth_top_m becomes 4.0.

@pytest.mark.asyncio
async def test_prop2_litho_move_propagates_to_linked_geo(...):
    # litho L linked to geo G, both at 3.0. Update L to 2.5.
    # Assert G.depth_top_m becomes 2.5.

@pytest.mark.asyncio
async def test_prop3_equal_depth_is_noop(...):
    # Update G to its current depth → no propagation call on L (loop guard).

@pytest.mark.asyncio
async def test_prop4_unlinked_contact_no_propagation(...):
    # Update a contact with parent_geo_contact_id=None and no children → no extra writes.
```

Mock the session/repo the way the existing `update_formation_contact` tests do (grep for them).

- [ ] **Step 2: Run to verify they fail**

`uv run pytest tests/unit/application/ -k "prop1 or prop2 or prop3 or prop4" -q`
Expected: FAIL — no propagation behaviour yet.

- [ ] **Step 3: Implement propagation + loop guard**

After the depth is committed in `execute`, add a `_propagate_coupled_depth(updated_contact, new_depth)` helper:
- If `updated_contact.parent_geo_contact_id` is set → load that geo contact; if its depth != new_depth, set it = new_depth, mark its formation surface stale, schedule a rebuild of that geo model formation.
- Else (could be a geo contact) → query litho contacts where `parent_geo_contact_id == updated_contact.id`; for each whose depth != new_depth, set = new_depth.
- Guard: skip any target whose depth already equals new_depth (terminates the geo↔litho↔geo cycle).
- Direct repo writes only (no recursive `UpdateFormationContact`).
Call it only on the depth-only change path.

- [ ] **Step 4: Run to verify they pass**

`uv run pytest tests/unit/application/ -k "prop1 or prop2 or prop3 or prop4" -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/application/update_formation_contact.py tests/unit/application/test_update_formation_contact_coupling.py
git commit -m "feat(geology): bidirectional depth propagation for coupled contacts (#162)"
```

---

## Task 6: Unlink use case + endpoint + frontend action + glyph

**Files:**
- Create: `src/groundmodel/application/unlink_litho_from_geo.py`
- Modify: `src/groundmodel/api/routers/geology/contacts.py`
- Test: `tests/unit/application/test_unlink_litho_from_geo.py` + `tests/integration/api/test_accept_litho_coupling.py`
- Modify: `desktop/.../api/client.ts`, `hooks/useGeologicalModel.ts`, `components/sections/ContactsLayer.tsx`

- [ ] **Step 1: Write the failing unit test (use case)**

```python
@pytest.mark.asyncio
async def test_unlink_clears_parent_geo_contact_id(...):
    # litho L linked to geo G. UnlinkLithoFromGeo(L.id) → L.parent_geo_contact_id is None.
    # Project-scope guard: L in another project → ValueError.
```

- [ ] **Step 2: Run → fail.** `uv run pytest tests/unit/application/test_unlink_litho_from_geo.py -q` → FAIL (module missing).

- [ ] **Step 3: Implement the use case** — `UnlinkLithoFromGeo(GroundModelLogger)` with `execute(*, project_id, contact_id)`: load the contact with a project-scope guard (mirror `AcceptLithoSuggestions`'s scope guard), set `parent_geo_contact_id = None`, commit. Logging per DoD.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Add the endpoint** — `POST /projects/{pid}/geology/models/{mid}/contacts/{cid}/unlink-geo` in `contacts.py`, mirroring an existing single-contact endpoint (e.g. the elevation/delete handlers). Returns the updated contact. Add an integration test asserting 200 + `parent_geo_contact_id` null after.

- [ ] **Step 6: Frontend wiring** — in `client.ts` add `unlinkLithoFromGeo(projectId, modelId, contactId)` (POST, mirror `acceptLithoSuggestions`). In `useGeologicalModel.ts` add `handleUnlinkLithoFromGeo` (call + refetch contacts). In `ContactsLayer.tsx`, in the litho-contact right-click menu (grep `setContactMenu`), add an **"Unlink from geology"** item shown only when `layer`'s contact has a non-null `parent_geo_contact_id`; render a small lock/link glyph on linked litho contacts (near the contact line). Add a Vitest pin: menu item present iff linked; glyph renders iff linked.

- [ ] **Step 7: Verify** — `uv run pytest tests/unit -q`, `.\scripts\run-integration-tests.ps1 tests/integration/api/test_accept_litho_coupling.py`, `cd desktop && npx vitest run` + `npx tsc --noEmit -p tsconfig.web.json`. All green.

- [ ] **Step 8: Commit** (per file, Conventional Commits, #162).

---

## Task 7: Couple-tolerance threading + Settings relabel

**Files:**
- Modify: `desktop/.../hooks/useGeologicalModel.ts` (pass `couple_tolerance_m` in accept bodies)
- Modify: `src/groundmodel/api/schemas/.../accept_litho_suggestions_request.py` + `batch_accept_litho_suggestions_request.py` (+ router) — add `couple_tolerance_m: float = Field(0.20, ge=0.01, le=5.0)`
- Modify: `desktop/.../components/SettingsDialog.tsx` (relabel)

- [ ] **Step 1:** Add `couple_tolerance_m` to both accept request schemas (default 0.20, ge=0.01, le=5.0) mirroring the `straddle_min_piece_thickness_m` field; thread it through the routers into `execute(couple_tolerance_m=...)` and the batch use case. Add a Pydantic schema test (default + bounds) mirroring `test_accept_litho_suggestions_schema.py`. Run → green.

- [ ] **Step 2:** In `client.ts`, add `couple_tolerance_m?: number` to both accept request TS types. In `useGeologicalModel.ts`, each of the four accept handlers includes `couple_tolerance_m: readLithoSegmenterPrefs(project.view_state).lithoSnapToleranceM` in the body (reuse the existing pref — no new field). `tsc` clean.

- [ ] **Step 3:** In `SettingsDialog.tsx`, relabel the existing `lithoSnapToleranceM` NumberRow: label "Litho↔geology snap (m)", hint "Litho and geological boundaries within this distance are treated as the same surface — linked and snapped together, so moving one moves the other (#162). Also drives the drag-snap prompt (#134). Range 0.01–5.0 m." Keep value/state wiring unchanged. Update the matching Vitest assertion if the label text is pinned.

- [ ] **Step 4:** Verify full `npx vitest run`, `npx tsc`, `uv run pytest tests/unit -q`. Commit.

---

## Task 8: Docs

- [ ] Mark #162 SHIPPED in `docs/debt.md` (+ note #157 is now subsumed by the coupling for the coincident case) and update the CLAUDE.md Tier line. Manual dogfeed: accept a litho suggestion that crosses a geo boundary → confirm the litho splits + links (glyph), moving the geo contact drags the litho and vice-versa, unlink works, and the Settings label reads clearly. Commit docs.

---

## Self-Review notes

- **Spec coverage:** schema+lifecycle (T1) ↔ Schema; restore backfill (T2) ↔ Bundle; couple step + snap geo→litho (T3) ↔ Auto-link; auto-rebuild (T4) ↔ Auto-rebuild; bidirectional+loop-guard (T5) ↔ Propagation; unlink+glyph (T6) ↔ Unlink/link UI; tolerance-knob reuse + relabel (T7) ↔ Tolerance section. No geo-contact creation anywhere (matches the corrected spec). Slice 2 (manual link) intentionally excluded.
- **Type consistency:** `parent_geo_contact_id` (snake) / `parent_geo_contact_id` (TS) used uniformly; `couple_tolerance_m` is the accept-request field, sourced from `lithoSnapToleranceM`; `touched_geo_formation_ids` is the AcceptLithoResult field consumed by the router rebuild; `_geo_contact_to_link` signature is stable across T3.
- **Note on file-exact code:** boilerplate layers (endpoints, router wiring, ContactsLayer menu, bundle loop) are specified as "mirror the existing pattern at <file/grep>" rather than verbatim code, because the exact local signatures must be read at implementation time; the core logic (schema, `_geo_contact_to_link`, propagation, restore backfill) is given concretely. Implementer subagents must read the referenced patterns before writing.
