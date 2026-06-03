# Per-instance body identity — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make distinct, uncorrelated same-lithology litho units become distinct, separately-numbered instances (QHSa1 / QHSa2) — fixing the missing second label, the body "jump" on pinch-out accept, and the over-suppressed suggestions.

**Architecture:** The `body` table *is* the instance (decision B-i). The instance resolver drops from formation-row granularity to **layer** granularity: it builds connected components over the correlation-edge graph (whose endpoints already FK `litho_layer.id`), numbers components shallowest-first per `(parent_formation_id, litho_main_soil_code)` group, then **reconciles one `body` per component** and stamps a new `litho_layer.body_id` on every member layer. All other body sites (claim, detect, suggest, render) resolve the body via the framed layer's `body_id` instead of recomputing `(formation, instance_ordinal)`.

**Tech Stack:** Python 3.11 / FastAPI / async SQLAlchemy / Alembic / PostgreSQL+PostGIS / Polars (backend); Electron + React + TypeScript / Vitest / Playwright (desktop). UV for Python, npm for desktop.

**Spec:** `docs/superpowers/specs/2026-06-03-per-instance-body-identity-design.md`

**Pre-flight (read once, do not skip):**
- `CLAUDE.md` — layer model, logging-via-inheritance, one-class-per-file, constants-file, DoD (logging + numpy docstrings + tests), pre-commit (ruff format + ruff check --fix per file), conventional commits, one file per commit, develop branch, **never push**.
- Integration tests run via `.\scripts\run-integration-tests.ps1` (sibling `groundmodel_integration` DB) — NEVER bare `uv run pytest tests/integration` (it wipes the dev DB). After adding the migration, the wrapper runs `alembic upgrade head` on the integration DB; also run `uv run alembic upgrade head` (no override) once to migrate the dev DB so the dogfed app doesn't 500.
- Desktop: Node must be 22.x (`node --version`). Filtered type-check: `npx tsc --noEmit -p tsconfig.web.json` from `desktop/`.
- e2e: `.\scripts\run-e2e.ps1` — close the dev desktop app first (`:8765` conflict; the runner ABORTS, it won't kill).

---

## File Structure

**Backend — create:**
- `src/groundmodel/infrastructure/db/migrations/versions/<rev>_add_litho_layer_body_id.py` — additive column + index.

**Backend — modify:**
- `src/groundmodel/infrastructure/db/models/litho_layer_orm.py` — add `body_id` column + index.
- `src/groundmodel/domain/services/resolve_litho_instances.py` — rewrite to layer granularity; new DTOs; drop lock machinery.
- `src/groundmodel/application/resolve_litho_instances_use_case.py` — `_run_resolver` rewrite: load layers+edges, call domain, reconcile bodies, stamp `litho_layer.body_id`; drop the `FormationContactOrm` lookup and the formation-ordinal write-back.
- `src/groundmodel/application/claim_body_extent.py` — resolve the body via the framed layer's `body_id` instead of `formation.instance_ordinal`.
- `src/groundmodel/application/suggest_body_pinch_outs.py` — populate each candidate's `body_id` from the framed layer's `body_id`; per-instance suppression.
- `src/groundmodel/application/detect_bodies.py` — key the upsert on the component (framed-layer `body_id`) not `formation_ordinals`.
- `src/groundmodel/infrastructure/db/repositories/project_bundle.py` — export + restore `litho_layer.body_id`.

**Desktop — modify:**
- `desktop/src/renderer/src/api/client.ts` — add `body_id` to the `LithoLayer` type.
- `desktop/src/renderer/src/components/sections/BodyExtentOverlay.tsx` — frame each body from its member layers (`body_id`), not "shallowest formation contact".
- `desktop/src/renderer/src/shell/stages/lithology/LithologyInspector.tsx` + `ordinalStaleness.ts` — re-point instance labels off `formation.instance_ordinal`; drop the now-meaningless ordinal-lock toggle.

**Desktop — create:**
- `desktop/tests/e2e/specs/flow_per_instance_body.spec.ts` — Playwright coverage.

**Decision recorded in the plan (no separate task):** `geological_formation.instance_ordinal` / `instance_ordinal_locked` columns stay in the schema (harmless; geological-model only). The litho path stops reading/writing them. The domain resolver's `LockConflict` machinery is deleted as part of the rewrite (Task 3).

---

## Task 1: Migration — add `litho_layer.body_id`

**Files:**
- Create: `src/groundmodel/infrastructure/db/migrations/versions/<rev>_add_litho_layer_body_id.py`

- [ ] **Step 1: Generate a revision stub**

Run: `uv run alembic revision -m "add litho_layer.body_id"`
This prints the new file path with a generated `<rev>` id. Open that file.

- [ ] **Step 2: Fill in upgrade/downgrade**

Replace the generated `upgrade`/`downgrade` bodies with:

```python
def upgrade() -> None:
    """Add the nullable body_id FK + its index to litho_layer."""
    op.add_column(
        "litho_layer",
        sa.Column("body_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_litho_layer_body_id",
        "litho_layer",
        "body",
        ["body_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("idx_litho_layer_body", "litho_layer", ["body_id"])


def downgrade() -> None:
    """Drop the body_id index, FK, and column."""
    op.drop_index("idx_litho_layer_body", table_name="litho_layer")
    op.drop_constraint("fk_litho_layer_body_id", "litho_layer", type_="foreignkey")
    op.drop_column("litho_layer", "body_id")
```

Ensure the imports at the top include `import sqlalchemy as sa` and `from sqlalchemy.dialects import postgresql` (copy the pattern from any recent migration in that folder). Keep the generated `down_revision` pointing at the current head.

- [ ] **Step 3: Apply to the integration DB and verify it round-trips**

Run: `.\scripts\run-integration-tests.ps1 --collect-only`
Expected: migrations run clean (alembic upgrade head succeeds, collection completes with no error).

- [ ] **Step 4: Apply to the dev DB** (so the dogfed app doesn't 500)

Run: `uv run alembic upgrade head`
Expected: `Running upgrade ... -> <rev>, add litho_layer.body_id`.

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/infrastructure/db/migrations/versions/<rev>_add_litho_layer_body_id.py
git commit -m "feat(db): add litho_layer.body_id FK for per-instance bodies"
```

---

## Task 2: ORM — add `body_id` to `LithoLayerOrm`

**Files:**
- Modify: `src/groundmodel/infrastructure/db/models/litho_layer_orm.py`

- [ ] **Step 1: Add the index to `__table_args__`**

After the existing `idx_litho_layer_parent_geo` index entry, add:

```python
        # Body (instance) backlink — the resolver stamps this; the renderer
        # groups layers by body to frame each instance from its member layers.
        Index("idx_litho_layer_body", "body_id"),
```

- [ ] **Step 2: Add the column** (place it just after `parent_geo_contact_id`)

```python
    # The body (instance) this layer belongs to. NULL until the instance
    # resolver runs. SET NULL on body delete so the layer survives a body
    # reconciliation that drops its instance. See spec
    # docs/superpowers/specs/2026-06-03-per-instance-body-identity-design.md.
    body_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("body.id", ondelete="SET NULL"),
        nullable=True,
    )
```

- [ ] **Step 3: Type-check + commit**

Run: `uv run mypy src/groundmodel/infrastructure/db/models/litho_layer_orm.py`
Expected: no new errors.

```bash
git add src/groundmodel/infrastructure/db/models/litho_layer_orm.py
git commit -m "feat(db): map litho_layer.body_id on the ORM model"
```

---

## Task 3: Domain resolver — rewrite to layer granularity

**Files:**
- Modify: `src/groundmodel/domain/services/resolve_litho_instances.py`
- Test: `tests/unit/domain/services/test_resolve_litho_instances.py` (existing — rewrite to the new contract)

This is the heart. The new resolver is pure (no I/O). It takes layer nodes + layer-id edges and returns one **instance** per connected component, numbered per `(parent, soil)` group, shallowest-first.

- [ ] **Step 1: Write the failing tests** (rewrite the existing test file to the new contract)

```python
"""Unit tests for the layer-level litho instance resolver."""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.resolve_litho_instances import (
    LayerEdge,
    LayerNode,
    resolve_litho_instances,
)

P = UUID("00000000-0000-0000-0000-0000000000aa")  # parent formation
F_SAND = UUID("00000000-0000-0000-0000-0000000000f1")  # clean-sand formation row
INV_A = UUID("00000000-0000-0000-0000-0000000000a1")
INV_B = UUID("00000000-0000-0000-0000-0000000000b1")


def _layer(layer_id: str, depth: float, inv: UUID, formation: UUID = F_SAND) -> LayerNode:
    return LayerNode(
        layer_id=UUID(layer_id),
        formation_id=formation,
        parent_formation_id=P,
        litho_main_soil_code="ZAND",
        depth_top_m=depth,
        source_investigation_id=inv,
    )


def test_two_uncorrelated_same_formation_layers_get_distinct_ordinals() -> None:
    # Two SAND layers, same formation row, NO edge between them → two
    # instances numbered 0 and 1 (shallowest first).
    shallow = _layer("00000000-0000-0000-0000-000000000001", 2.0, INV_A)
    deep = _layer("00000000-0000-0000-0000-000000000002", 8.0, INV_A)
    result = resolve_litho_instances(layers=[shallow, deep], edges=[])
    assert result.layer_to_ordinal[shallow.layer_id] == 0
    assert result.layer_to_ordinal[deep.layer_id] == 1
    assert len(result.instances) == 2


def test_correlated_layers_share_one_instance() -> None:
    # Two SAND layers on different columns, correlated → one instance,
    # one ordinal, both members.
    a = _layer("00000000-0000-0000-0000-000000000001", 3.0, INV_A)
    b = _layer("00000000-0000-0000-0000-000000000002", 3.2, INV_B)
    edges = [LayerEdge(layer_a_id=a.layer_id, layer_b_id=b.layer_id)]
    result = resolve_litho_instances(layers=[a, b], edges=edges)
    assert result.layer_to_ordinal[a.layer_id] == result.layer_to_ordinal[b.layer_id]
    assert len(result.instances) == 1
    assert set(result.instances[0].member_layer_ids) == {a.layer_id, b.layer_id}


def test_uncorrelating_splits_back_into_two() -> None:
    # Same two layers, no edge → two instances again (proves the resolver is
    # a pure function of the current edge set).
    a = _layer("00000000-0000-0000-0000-000000000001", 3.0, INV_A)
    b = _layer("00000000-0000-0000-0000-000000000002", 3.2, INV_B)
    result = resolve_litho_instances(layers=[a, b], edges=[])
    assert len(result.instances) == 2


def test_distinct_soil_codes_number_independently() -> None:
    # SAND and SILT under the same parent are independent groups: each
    # starts at ordinal 0.
    sand = _layer("00000000-0000-0000-0000-000000000001", 2.0, INV_A, F_SAND)
    silt = LayerNode(
        layer_id=UUID("00000000-0000-0000-0000-000000000003"),
        formation_id=UUID("00000000-0000-0000-0000-0000000000f2"),
        parent_formation_id=P,
        litho_main_soil_code="SILT",
        depth_top_m=5.0,
        source_investigation_id=INV_A,
    )
    result = resolve_litho_instances(layers=[sand, silt], edges=[])
    assert result.layer_to_ordinal[sand.layer_id] == 0
    assert result.layer_to_ordinal[silt.layer_id] == 0


def test_instance_representative_is_shallowest_layer() -> None:
    # A multi-layer instance reports the shallowest layer's formation +
    # investigation as its representative identity.
    deep = _layer("00000000-0000-0000-0000-000000000002", 8.0, INV_B)
    shallow = _layer("00000000-0000-0000-0000-000000000001", 2.0, INV_A)
    edges = [LayerEdge(layer_a_id=deep.layer_id, layer_b_id=shallow.layer_id)]
    result = resolve_litho_instances(layers=[deep, shallow], edges=edges)
    inst = result.instances[0]
    assert inst.source_investigation_id == INV_A
    assert inst.earliest_depth_m == 2.0
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/unit/domain/services/test_resolve_litho_instances.py -q`
Expected: FAIL — `ImportError` (`LayerNode` / `LayerEdge` not defined).

- [ ] **Step 3: Rewrite the resolver**

Replace the whole body of `resolve_litho_instances.py` with the layer-level implementation below. Delete the old `FormationNode`, `CorrelationEdge`, `LockConflict`, `ResolveResult`, `_group_key`, `_depth_sort_key`, and `resolve_litho_instances`. **Keep** the existing `connected_formation_ids` BFS helper (other callers import it — verify with `grep -rn "connected_formation_ids" src tests`; if there are no callers besides its own test, delete it too).

```python
"""Pure domain service — assign instance ordinals over a litho model.

An *instance* is one connected component of correlated litho layers. Two
layers belong to the same instance iff a path of user-approved correlation
edges connects them. Uncorrelated layers — including two same-formation
layers stacked at one column, or two laterally-separate columns never linked
— are distinct instances and receive distinct ordinals.

Ordinals are assigned per ``(parent_formation_id, litho_main_soil_code)``
naming group, shallowest component first, starting at 0. The component with
the shallowest member is ordinal 0, the next is 1, and so on. This matches
the depth-rank the section renderer already computes for body labels
(QHSa1 = shallowest sand instance under that parent).

No I/O, no database access, no logging. The caller
(``ResolveLithoInstances`` use case) loads the data, calls this function, and
writes the results back (creating/reconciling body rows + stamping
``litho_layer.body_id``).
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class LayerNode:
    """Lightweight snapshot of one accepted litho_layer row.

    Attributes
    ----------
    layer_id : UUID
        Primary key of the litho_layer row. Also the id the correlation
        edge endpoints reference (edges FK litho_layer.id post-A4).
    formation_id : UUID
        The layer's naming-type formation row.
    parent_formation_id : UUID | None
        Parent geological formation. Together with ``litho_main_soil_code``
        this forms the naming group. Litho layers always have a parent.
    litho_main_soil_code : str | None
        Base lithology token (ZAND/KLEI/SILT/GRIND/VEEN).
    depth_top_m : float
        Top depth of the layer interval; the ordinal sort key.
    source_investigation_id : UUID
        The layer's anchor investigation (borehole_id or cpt_id).
    """

    layer_id: UUID
    formation_id: UUID
    parent_formation_id: UUID | None
    litho_main_soil_code: str | None
    depth_top_m: float
    source_investigation_id: UUID


@dataclass(frozen=True)
class LayerEdge:
    """One user-approved correlation edge between two layers.

    Attributes
    ----------
    layer_a_id : UUID
        One endpoint (litho_layer id).
    layer_b_id : UUID
        The other endpoint (litho_layer id).
    """

    layer_a_id: UUID
    layer_b_id: UUID


@dataclass(frozen=True)
class InstanceAssignment:
    """One resolved instance (connected component of layers).

    Attributes
    ----------
    formation_id : UUID
        Representative formation row = the shallowest member layer's
        formation. The reconciled body uses this as its formation_id.
    ordinal : int
        0-based ordinal within the ``(parent, soil)`` naming group
        (0 = shallowest instance in the group).
    member_layer_ids : list[UUID]
        Every layer in this component (each gets ``body_id`` stamped).
    source_investigation_id : UUID
        The shallowest member layer's investigation — the body's source.
    earliest_depth_m : float
        The shallowest member layer's ``depth_top_m``.
    """

    formation_id: UUID
    ordinal: int
    member_layer_ids: list[UUID]
    source_investigation_id: UUID
    earliest_depth_m: float


@dataclass
class ResolveResult:
    """Output of ``resolve_litho_instances``.

    Attributes
    ----------
    instances : list[InstanceAssignment]
        One entry per connected component.
    layer_to_ordinal : dict[UUID, int]
        layer_id → its instance ordinal (convenience for callers/tests).
    layer_to_formation : dict[UUID, UUID]
        layer_id → its instance's representative formation_id (the body's
        formation; may differ from the layer's own formation_id when a
        component spans admixtures).
    """

    instances: list[InstanceAssignment]
    layer_to_ordinal: dict[UUID, int]
    layer_to_formation: dict[UUID, UUID]


def _components(node_ids: set[UUID], adjacency: dict[UUID, set[UUID]]) -> list[list[UUID]]:
    """Return connected components (BFS). Singletons are single-element lists."""
    visited: set[UUID] = set()
    out: list[list[UUID]] = []
    for start in node_ids:
        if start in visited:
            continue
        comp: list[UUID] = []
        queue: deque[UUID] = deque([start])
        visited.add(start)
        while queue:
            cur = queue.popleft()
            comp.append(cur)
            for nb in adjacency.get(cur, ()):
                if nb not in visited:
                    visited.add(nb)
                    queue.append(nb)
        out.append(comp)
    return out


def resolve_litho_instances(
    layers: list[LayerNode],
    edges: list[LayerEdge],
) -> ResolveResult:
    """Resolve instances (connected components) and assign group ordinals.

    Parameters
    ----------
    layers : list[LayerNode]
        Every accepted layer in the model (singletons included).
    edges : list[LayerEdge]
        User-approved correlation edges (layer-id endpoints). Endpoints not
        present in ``layers`` are ignored (dangling-edge guard).

    Returns
    -------
    ResolveResult
        Instances + the layer→ordinal / layer→formation lookups.

    Notes
    -----
    Pure function — no I/O. Safe to call from any layer.
    """
    node_map: dict[UUID, LayerNode] = {ln.layer_id: ln for ln in layers}
    node_ids: set[UUID] = set(node_map)

    adjacency: dict[UUID, set[UUID]] = defaultdict(set)
    for e in edges:
        if e.layer_a_id in node_ids and e.layer_b_id in node_ids:
            adjacency[e.layer_a_id].add(e.layer_b_id)
            adjacency[e.layer_b_id].add(e.layer_a_id)

    components = _components(node_ids, adjacency)

    # Build one InstanceAssignment per component, keyed by its shallowest
    # member (representative). Sort key for the shallowest member: by depth,
    # then layer UUID for determinism.
    def _key(ln: LayerNode) -> tuple[float, str]:
        return (ln.depth_top_m, str(ln.layer_id))

    GroupKey = tuple[UUID | None, str | None]
    group_to_comps: dict[GroupKey, list[tuple[tuple[float, str], list[UUID], LayerNode]]] = (
        defaultdict(list)
    )
    for comp in components:
        members = [node_map[fid] for fid in comp]
        rep = min(members, key=_key)  # shallowest member = representative
        gk: GroupKey = (rep.parent_formation_id, rep.litho_main_soil_code)
        group_to_comps[gk].append((_key(rep), comp, rep))

    instances: list[InstanceAssignment] = []
    layer_to_ordinal: dict[UUID, int] = {}
    layer_to_formation: dict[UUID, UUID] = {}

    for _gk, comps in group_to_comps.items():
        comps.sort(key=lambda triple: triple[0])  # shallowest component first
        for ordinal, (_rep_key, comp, rep) in enumerate(comps):
            instances.append(
                InstanceAssignment(
                    formation_id=rep.formation_id,
                    ordinal=ordinal,
                    member_layer_ids=list(comp),
                    source_investigation_id=rep.source_investigation_id,
                    earliest_depth_m=rep.depth_top_m,
                )
            )
            for lid in comp:
                layer_to_ordinal[lid] = ordinal
                layer_to_formation[lid] = rep.formation_id

    return ResolveResult(
        instances=instances,
        layer_to_ordinal=layer_to_ordinal,
        layer_to_formation=layer_to_formation,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/unit/domain/services/test_resolve_litho_instances.py -q`
Expected: PASS (5 tests).

- [ ] **Step 5: Format, lint, commit**

```bash
uv run ruff format src/groundmodel/domain/services/resolve_litho_instances.py tests/unit/domain/services/test_resolve_litho_instances.py
uv run ruff check --fix src/groundmodel/domain/services/resolve_litho_instances.py tests/unit/domain/services/test_resolve_litho_instances.py
git add src/groundmodel/domain/services/resolve_litho_instances.py
git commit -m "refactor(litho): resolve instances over layers, drop lock machinery"
git add tests/unit/domain/services/test_resolve_litho_instances.py
git commit -m "test(litho): layer-level instance resolver cases"
```

---

## Task 4: Use case — reconcile bodies + stamp `litho_layer.body_id`

**Files:**
- Modify: `src/groundmodel/application/resolve_litho_instances_use_case.py`
- Test: `tests/integration/application/test_resolve_litho_instances.py` (add cases; create if absent)

The `_run_resolver` helper is rewritten end-to-end. It must: (1) load accepted layers + their formation `(parent, soil)` via a join, (2) load user-approved edges (endpoints are layer ids — no `FormationContactOrm` lookup), (3) call the domain resolver, (4) reconcile `body` rows to the instance set, (5) stamp `litho_layer.body_id`, (6) mark surfaces stale when an ordinal changed. It no longer writes `geological_formation.instance_ordinal`.

- [ ] **Step 1: Write the failing integration test**

Add to `tests/integration/application/test_resolve_litho_instances.py` (use the existing litho-model fixtures in that folder as a template for seeding a model + accepted layers; if the file does not exist, copy the seeding helpers from `tests/integration/application/test_suggest_body_pinch_outs.py`):

```python
async def test_two_uncorrelated_same_formation_layers_yield_two_bodies(
    db_session, litho_model_with_two_uncorrelated_sand_layers
):
    """Distinct uncorrelated SAND layers → two body rows, ordinals 0 and 1."""
    ctx = litho_model_with_two_uncorrelated_sand_layers
    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)

    bodies = (
        await db_session.execute(
            select(BodyOrm).where(BodyOrm.model_id == ctx.model_id).order_by(BodyOrm.body_ordinal)
        )
    ).scalars().all()
    assert [b.body_ordinal for b in bodies] == [0, 1]

    layers = (
        await db_session.execute(
            select(LithoLayerOrm)
            .where(LithoLayerOrm.model_id == ctx.model_id)
            .order_by(LithoLayerOrm.depth_top_m)
        )
    ).scalars().all()
    # Each accepted layer is stamped with a distinct body.
    body_ids = {ly.body_id for ly in layers}
    assert None not in body_ids
    assert len(body_ids) == 2
```

(The fixture seeds one litho model with two accepted SAND layers, same formation row, no correlation edge. Build it from the existing helpers — a borehole/CPT, a parent formation, a litho formation row with `litho_main_soil_code='ZAND'`, two `litho_layer` rows at different depths, `status='accepted'`.)

- [ ] **Step 2: Run to verify failure**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/application/test_resolve_litho_instances.py -q`
Expected: FAIL (old resolver writes formation ordinals; no bodies created, `body_id` stays NULL).

- [ ] **Step 3: Rewrite `_run_resolver`**

Replace the `_run_resolver` function body. Update the imports at the top of the file:
- Remove: `from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm`.
- Add:
  ```python
  from uuid6 import uuid7
  from groundmodel.domain.services.resolve_litho_instances import (
      LayerEdge,
      LayerNode,
      resolve_litho_instances,
  )
  from groundmodel.infrastructure.db.models.body_orm import BodyOrm
  from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
  ```
- Keep: `GeologicalFormationOrm`, `GeologicalModelOrm`, `LithoContactCorrelationEdgeOrm`, `GeologyRepository`.

New `_run_resolver` body:

```python
async def _run_resolver(session: AsyncSession, model_id: UUID) -> list[dict]:
    """Resolve instances over layers, reconcile bodies, stamp body_id.

    Loads accepted litho layers + user-approved correlation edges (layer-id
    endpoints), runs the pure ``resolve_litho_instances`` domain service,
    reconciles one ``body`` row per connected component, stamps
    ``litho_layer.body_id`` on every member layer, and marks surfaces stale
    when an instance ordinal changed. No inner commit — the caller owns the
    transaction boundary.

    Returns
    -------
    list[dict]
        One ``{"formation_id": str, "new_ordinal": int}`` per body whose
        ordinal changed (drives the section's stale-surface cue).
    """
    repo = GeologyRepository(session)
    logger = _RunResolverLogger()
    logger.debug(f"_run_resolver: model {model_id}")

    model = await session.get(GeologicalModelOrm, model_id)
    if model is None:
        logger.warning(f"_run_resolver: model {model_id} gone — skipping")
        return []

    # 1. Accepted layers joined to their formation for (parent, soil).
    layer_rows = (
        await session.execute(
            select(
                LithoLayerOrm.id,
                LithoLayerOrm.formation_id,
                LithoLayerOrm.depth_top_m,
                LithoLayerOrm.borehole_id,
                LithoLayerOrm.cpt_id,
                LithoLayerOrm.body_id,
                GeologicalFormationOrm.parent_formation_id,
                GeologicalFormationOrm.litho_main_soil_code,
            )
            .join(GeologicalFormationOrm, GeologicalFormationOrm.id == LithoLayerOrm.formation_id)
            .where(
                LithoLayerOrm.model_id == model_id,
                LithoLayerOrm.status == "accepted",
            )
        )
    ).all()

    nodes: list[LayerNode] = [
        LayerNode(
            layer_id=r.id,
            formation_id=r.formation_id,
            parent_formation_id=r.parent_formation_id,
            litho_main_soil_code=r.litho_main_soil_code,
            depth_top_m=r.depth_top_m,
            source_investigation_id=(r.borehole_id if r.borehole_id is not None else r.cpt_id),
        )
        for r in layer_rows
    ]
    existing_body_id_by_layer: dict[UUID, UUID | None] = {r.id: r.body_id for r in layer_rows}

    # 2. User-approved edges — endpoints already FK litho_layer.id.
    edge_rows = (
        await session.execute(
            select(
                LithoContactCorrelationEdgeOrm.contact_a_id,
                LithoContactCorrelationEdgeOrm.contact_b_id,
            ).where(
                LithoContactCorrelationEdgeOrm.model_id == model_id,
                LithoContactCorrelationEdgeOrm.user_approved.is_(True),
            )
        )
    ).all()
    edges = [LayerEdge(layer_a_id=a, layer_b_id=b) for a, b in edge_rows]

    logger.debug(f"_run_resolver: {len(nodes)} layer(s), {len(edges)} edge(s)")

    result = resolve_litho_instances(layers=nodes, edges=edges)

    # 3. Reconcile bodies. Existing bodies keyed (formation_id, ordinal).
    existing_bodies = (
        await session.execute(select(BodyOrm).where(BodyOrm.model_id == model_id))
    ).scalars().all()
    body_by_key: dict[tuple[UUID, int], BodyOrm] = {
        (b.formation_id, b.body_ordinal): b for b in existing_bodies
    }
    wanted_keys: set[tuple[UUID, int]] = set()
    layer_to_body_id: dict[UUID, UUID] = {}
    changed: list[dict] = []

    for inst in result.instances:
        key = (inst.formation_id, inst.ordinal)
        wanted_keys.add(key)
        body = body_by_key.get(key)
        if body is None:
            body = BodyOrm(
                id=uuid7(),
                app_project_id=model.app_project_id,
                model_id=model_id,
                formation_id=inst.formation_id,
                body_ordinal=inst.ordinal,
                source_investigation_id=inst.source_investigation_id,
            )
            session.add(body)
            body_by_key[key] = body
            changed.append({"formation_id": str(inst.formation_id), "new_ordinal": inst.ordinal})
            logger.debug(f"_run_resolver: created body f={inst.formation_id} ord={inst.ordinal}")
        for lid in inst.member_layer_ids:
            layer_to_body_id[lid] = body.id

    # 4. Delete orphan bodies (no longer a wanted instance) UNLESS named.
    for (f_id, ordn), body in body_by_key.items():
        if (f_id, ordn) in wanted_keys:
            continue
        if body.name:
            logger.debug(f"_run_resolver: preserving named orphan body {body.id} ({body.name!r})")
            continue
        await session.delete(body)
        changed.append({"formation_id": str(f_id), "new_ordinal": ordn})
        logger.debug(f"_run_resolver: deleted orphan body f={f_id} ord={ordn}")

    await session.flush()  # bodies get their ids before stamping layers

    # 5. Stamp litho_layer.body_id where it changed.
    n_stamped = 0
    for lid, bid in layer_to_body_id.items():
        if existing_body_id_by_layer.get(lid) != bid:
            await session.execute(
                update(LithoLayerOrm).where(LithoLayerOrm.id == lid).values(body_id=bid)
            )
            n_stamped += 1

    if changed or n_stamped:
        await session.flush()
        pairs = [(model_id, UUID(c["formation_id"])) for c in changed]
        if pairs:
            await repo.mark_surfaces_stale(pairs)
        logger.info(
            f"_run_resolver: {len(changed)} body change(s), {n_stamped} layer stamp(s) "
            f"for model {model_id}"
        )
    else:
        logger.debug(f"_run_resolver: no changes for model {model_id}")

    return changed
```

Add `update` to the SQLAlchemy import line: `from sqlalchemy import func, select, update` (drop `func` if it ends up unused after the rewrite — run ruff to confirm).

- [ ] **Step 4: Run the integration test**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/application/test_resolve_litho_instances.py -q`
Expected: PASS.

- [ ] **Step 5: Run the broader litho integration suite to catch fallout**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/application -q`
Expected: PASS (some pre-existing tests asserting `formation.instance_ordinal` may now fail — if so, those assertions are testing the dropped behaviour; update them to assert body ordinals instead, in the same commit, and note it).

- [ ] **Step 6: Format, lint, type-check, commit**

```bash
uv run ruff format src/groundmodel/application/resolve_litho_instances_use_case.py
uv run ruff check --fix src/groundmodel/application/resolve_litho_instances_use_case.py
uv run mypy src/groundmodel/application/resolve_litho_instances_use_case.py
git add src/groundmodel/application/resolve_litho_instances_use_case.py
git commit -m "feat(litho): reconcile bodies + stamp layer.body_id in resolver"
git add tests/integration/application/test_resolve_litho_instances.py
git commit -m "test(litho): resolver creates per-instance bodies + stamps body_id"
```

---

## Task 5: `ClaimBodyExtent` — resolve body via the framed layer

**Files:**
- Modify: `src/groundmodel/application/claim_body_extent.py`
- Test: `tests/integration/application/test_claim_body_extent.py` (add a case)

The claim currently resolves `body_ordinal = formation.instance_ordinal or 0` (lines ~231-250) and find-or-creates by `(formation, body_ordinal)`. Replace with: resolve the body from the framed layer's `body_id`. The router passes the contact/layer being framed — confirm the claim signature receives a layer id (e.g. `above_contact_id` or a dedicated `layer_id`); if it only receives `formation_id` + `source_investigation_id`, resolve the layer = the accepted `litho_layer` at `source_investigation_id` whose `formation_id` matches and whose interval contains the claim, then read its `body_id`.

- [ ] **Step 1: Write the failing test** — two uncorrelated SAND units on the same column; claim a left extent on the deeper one; assert it lands on the deeper unit's body (ordinal 1), not the shallower (ordinal 0), and does not 409.

```python
async def test_claim_targets_the_framed_instance_not_the_shallowest(
    db_session, litho_model_with_two_uncorrelated_sand_layers
):
    ctx = litho_model_with_two_uncorrelated_sand_layers
    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)

    body = await ClaimBodyExtent(db_session).execute(
        project_id=ctx.project_id,
        model_id=ctx.model_id,
        layer_id=ctx.deep_layer_id,          # the deeper SAND unit
        side="left",
        kind="open",
        source_investigation_id=ctx.inv_id,
        neighbour_inv_id=None,
        primary_section_id=ctx.section_id,
    )
    assert body.body_ordinal == 1            # deeper instance, not 0
    assert body.extent_left_kind == "open"
```

- [ ] **Step 2: Run to verify failure**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/application/test_claim_body_extent.py -q`
Expected: FAIL (signature mismatch or wrong ordinal).

- [ ] **Step 3: Implement** — replace the `body_ordinal = formation_row.instance_ordinal or 0` block + the find-or-create with a lookup keyed on the framed layer's `body_id`:

```python
        # Resolve the target body from the framed layer's instance, not from
        # the formation's (collapsed) instance_ordinal. The resolver has
        # already stamped litho_layer.body_id; the body always exists for an
        # accepted unit.
        layer = await self._session.get(LithoLayerOrm, layer_id)
        if layer is None or layer.model_id != model_id:
            raise ValueError(f"layer {layer_id} not found in model {model_id}")
        if layer.body_id is None:
            # Resolver hasn't run for this layer yet — run it so the body
            # exists, then re-read. (Defensive; the normal accept/correlate
            # path stamps body_id before any claim gesture is possible.)
            await ResolveLithoInstances(self._session).execute(model_id=model_id, commit=False)
            await self._session.refresh(layer)
        if layer.body_id is None:
            raise ValueError(f"layer {layer_id} has no resolved body — cannot claim extent")
        body = await self._session.get(BodyOrm, layer.body_id)
        assert body is not None
```

Then the existing provenance/update branch runs against `body` (the create branch is removed — the body always exists post-resolver). Keep the `ProvenanceViolationError` guard intact. Update the router + use-case signature to accept `layer_id` (thread it from the candidate the user is acting on); update the API schema if the request body changes — additive field, default behaviour preserved. Add `from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm` and the `ResolveLithoInstances` import.

- [ ] **Step 4: Run test to verify pass**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/application/test_claim_body_extent.py -q`
Expected: PASS.

- [ ] **Step 5: Format, lint, type-check, commit (two commits — src then test)**

```bash
uv run ruff format src/groundmodel/application/claim_body_extent.py
uv run ruff check --fix src/groundmodel/application/claim_body_extent.py
uv run mypy src/groundmodel/application/claim_body_extent.py
git add src/groundmodel/application/claim_body_extent.py
git commit -m "fix(litho): claim resolves body via framed layer's instance"
git add tests/integration/application/test_claim_body_extent.py
git commit -m "test(litho): claim targets the framed instance, no cross-instance 409"
```

---

## Task 6: `SuggestBodyPinchOuts` — per-instance candidate body_id + suppression

**Files:**
- Modify: `src/groundmodel/application/suggest_body_pinch_outs.py`
- Test: `tests/integration/application/test_suggest_body_pinch_outs.py` (adjust + add)

The suggester currently resolves a candidate's `body_id` via the `(formation, instance_ordinal)` map (the interim `f73039eb` fix). Re-point it: each candidate frames a specific accepted layer; set `candidate.body_id = layer.body_id`. Suppression (sides already correlated / already claimed) is then evaluated per body, so two distinct named instances no longer suppress each other's candidates (Q1).

- [ ] **Step 1: Write/adjust the failing test** — two uncorrelated SAND instances; name one (set `body.name`); assert the other still yields a candidate. Also keep/repurpose `test_to_target_body_suppresses_other_source_candidate` to operate per-instance.

```python
async def test_named_instance_does_not_suppress_the_other(
    db_session, litho_model_with_two_uncorrelated_sand_layers
):
    ctx = litho_model_with_two_uncorrelated_sand_layers
    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)
    # Name the shallow instance's body.
    shallow_body = (await db_session.execute(
        select(BodyOrm).where(BodyOrm.model_id == ctx.model_id, BodyOrm.body_ordinal == 0)
    )).scalar_one()
    shallow_body.name = "Top sand"
    await db_session.commit()

    candidates = await SuggestBodyPinchOuts(db_session).execute(
        project_id=ctx.project_id, model_id=ctx.model_id, section_id=ctx.section_id
    )
    # The deeper, un-named instance still gets at least one candidate.
    deep_body = (await db_session.execute(
        select(BodyOrm).where(BodyOrm.model_id == ctx.model_id, BodyOrm.body_ordinal == 1)
    )).scalar_one()
    assert any(c.body_id == deep_body.id for c in candidates)
```

- [ ] **Step 2: Run to verify failure**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/application/test_suggest_body_pinch_outs.py -q`
Expected: FAIL (current suppression keys on formation, over-suppresses).

- [ ] **Step 3: Implement** — replace the `bodies_by_formation_ordinal` / `formation_ordinal` lookup (added in `f73039eb`) with a `body_by_layer_id` resolution: load accepted layers' `body_id`, and for each candidate set `body_id = layer.body_id`. Evaluate "already claimed" by reading the body's `extent_<side>_kind`; "already correlated/paired" stays as-is but is now naturally per-instance because each layer maps to its own body. Remove the now-dead `GeologicalFormationOrm.instance_ordinal` query.

- [ ] **Step 4: Run test to verify pass**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/application/test_suggest_body_pinch_outs.py -q`
Expected: PASS (all cases, including the adjusted `to_target` suppression).

- [ ] **Step 5: Format, lint, type-check, commit (src then test)**

```bash
uv run ruff format src/groundmodel/application/suggest_body_pinch_outs.py
uv run ruff check --fix src/groundmodel/application/suggest_body_pinch_outs.py
uv run mypy src/groundmodel/application/suggest_body_pinch_outs.py
git add src/groundmodel/application/suggest_body_pinch_outs.py
git commit -m "fix(litho): suggest resolves candidate body per instance"
git add tests/integration/application/test_suggest_body_pinch_outs.py
git commit -m "test(litho): named instance no longer suppresses its sibling"
```

---

## Task 7: `DetectBodies` — key the upsert on the component, not `formation_ordinals`

**Files:**
- Modify: `src/groundmodel/application/detect_bodies.py`
- Test: `tests/integration/application/test_detect_bodies.py` (adjust)

`DetectBodies` builds `formation_ordinals = {formation.id: formation.instance_ordinal}` (line ~300) and upserts bodies keyed `(formation_id, ordinal)`. Since the resolver now owns body existence + ordinals, detect should: resolve each detected candidate to its instance via the framed layer's `body_id`, look that body up (it exists), and write the `to_target` extents onto it. Remove the `formation_ordinals` map and the `bodies_skipped_unresolved_ordinal` path's dependence on `formation.instance_ordinal` (replace with "framed layer has no body_id" guard, still counted).

- [ ] **Step 1: Adjust the failing test** — detect over a model with two uncorrelated instances writes `to_target` extents onto the correct per-instance bodies (ordinals 0 and 1), not a single collapsed body.

- [ ] **Step 2: Run to verify failure**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/application/test_detect_bodies.py -q`
Expected: FAIL.

- [ ] **Step 3: Implement** — replace the `formation_ordinals` resolution + the `existing_bodies_map[(formation_id, ordinal)]` upsert with a `body_by_layer_id` lookup (each detected candidate carries/derives its framed layer; read `layer.body_id`; fetch the body). Keep the bilateral `primary_section_id` resolution and the reconciliation/preserve-named logic in step 8 of that file, but key it on the resolver-owned body set rather than recreating bodies.

- [ ] **Step 4: Run test to verify pass**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/application/test_detect_bodies.py -q`
Expected: PASS.

- [ ] **Step 5: Format, lint, type-check, commit (src then test)**

```bash
uv run ruff format src/groundmodel/application/detect_bodies.py
uv run ruff check --fix src/groundmodel/application/detect_bodies.py
uv run mypy src/groundmodel/application/detect_bodies.py
git add src/groundmodel/application/detect_bodies.py
git commit -m "fix(litho): detect writes extents onto resolver-owned instance bodies"
git add tests/integration/application/test_detect_bodies.py
git commit -m "test(litho): detect targets per-instance bodies"
```

---

## Task 8: Bundle — round-trip `litho_layer.body_id`

**Files:**
- Modify: `src/groundmodel/infrastructure/db/repositories/project_bundle.py`
- Test: `tests/integration/...` bundle round-trip test (locate the existing litho bundle round-trip test via `grep -rn "litho_layers" tests/integration | grep -i bundle`)

- [ ] **Step 1: Write the failing assertion** — extend the existing litho-bundle round-trip test: after export→restore, a layer's `body_id` is preserved (or, if bodies are re-resolved on restore, the layer ends up stamped with a valid body in the restored model). Assert `restored_layer.body_id is not None` and points to a body in the restored model.

- [ ] **Step 2: Run to verify failure**

Run: `.\scripts\run-integration-tests.ps1 <that test> -q`
Expected: FAIL (`body_id` not serialised / not restored).

- [ ] **Step 3: Implement** — in the litho-layer serialisation block, add `"body_id": str(layer.body_id) if layer.body_id else None`. On restore, after layers + bodies are inserted, the restore endpoint already runs `ResolveLithoInstances` per litho model (per CLAUDE.md "Recently resolved" — the restore reconcile) — confirm that hook runs the new resolver so `body_id` is re-stamped consistently. If the restore writes `body_id` directly from the bundle, ensure the referenced body id exists in the same bundle (bodies array) or null it and let the resolver re-stamp. Prefer **null-then-resolver-restamp** to avoid dangling FK on partial bundles.

- [ ] **Step 4: Run test to verify pass**

Run: `.\scripts\run-integration-tests.ps1 <that test> -q`
Expected: PASS.

- [ ] **Step 5: Format, lint, commit (src then test)**

```bash
uv run ruff format src/groundmodel/infrastructure/db/repositories/project_bundle.py
uv run ruff check --fix src/groundmodel/infrastructure/db/repositories/project_bundle.py
git add src/groundmodel/infrastructure/db/repositories/project_bundle.py
git commit -m "feat(bundle): round-trip litho_layer.body_id"
git add <bundle round-trip test path>
git commit -m "test(bundle): litho_layer.body_id survives export/restore"
```

---

## Task 9: Frontend client — add `body_id` to the `LithoLayer` type

**Files:**
- Modify: `desktop/src/renderer/src/api/client.ts`

- [ ] **Step 1: Locate the `LithoLayer` interface**

Run: `grep -n "interface LithoLayer\b\|type LithoLayer\b" desktop/src/renderer/src/api/client.ts`

- [ ] **Step 2: Add the optional field** (additive — keep backwards-tolerant)

```typescript
  /** The body (instance) this layer belongs to; null until the resolver runs. */
  body_id: string | null
```

- [ ] **Step 3: Type-check + commit**

Run (from `desktop/`): `npx tsc --noEmit -p tsconfig.web.json`
Expected: no new errors.

```bash
git add desktop/src/renderer/src/api/client.ts
git commit -m "feat(desktop): add body_id to the LithoLayer client type"
```

---

## Task 10: `BodyExtentOverlay` — frame each body from its member layers

**Files:**
- Modify: `desktop/src/renderer/src/components/sections/BodyExtentOverlay.tsx`
- Test: `desktop/src/renderer/src/components/sections/BodyExtentOverlay.test.tsx`

Today the overlay derives a committed body's geometry from "the shallowest formation contact", so when two instances share a formation the band snaps to the wrong one (the jump). With `litho_layer.body_id` available, group the section's litho layers by `body_id` and derive each body's source-column band from the member layer at the body's `source_investigation_id` (its real `depth_top_m`/`depth_base_m`); the wings still come from the per-side extents.

- [ ] **Step 1: Write the failing test (BE-FRAME)** — render two bodies sharing one formation, with member layers at different depths supplied via `body_id`; assert each body's band top matches its own member layer's depth (not both at the shallowest). Spy on the rendered band `y`/transform. Use the existing test harness in this file (it already renders ghosts + committed bodies).

- [ ] **Step 2: Run to verify failure**

Run (from `desktop/`): `npx vitest run src/renderer/src/components/sections/BodyExtentOverlay.test.tsx`
Expected: FAIL (both bands frame from the shallowest contact).

- [ ] **Step 3: Implement** — accept the section's litho layers (already in scope or pass as a prop), build `Map<body_id, Layer[]>`, and for each committed body compute its source-column interval from the member layer whose anchor == `source_investigation_id`. Replace the shallowest-contact derivation. Keep the depth-rank label path (`computeDepthStacking`) — it now sees distinct bodies and emits QHSa1/QHSa2 automatically.

- [ ] **Step 4: Run test to verify pass + the full overlay suite**

Run (from `desktop/`): `npx vitest run src/renderer/src/components/sections/BodyExtentOverlay.test.tsx`
Expected: PASS (all, including the existing BE-GHOST-KEYS + label tests).

- [ ] **Step 5: tsc + commit (src then test)**

```bash
# from desktop/
npx tsc --noEmit -p tsconfig.web.json
git add desktop/src/renderer/src/components/sections/BodyExtentOverlay.tsx
git commit -m "fix(sections): frame each body from its member layers (no jump)"
git add desktop/src/renderer/src/components/sections/BodyExtentOverlay.test.tsx
git commit -m "test(sections): body frames from its own instance, not shallowest"
```

---

## Task 11: Inspector + `ordinalStaleness` — re-point off `formation.instance_ordinal`

**Files:**
- Modify: `desktop/src/renderer/src/shell/stages/lithology/LithologyInspector.tsx`
- Modify: `desktop/src/renderer/src/shell/stages/lithology/ordinalStaleness.ts` (+ its test)

The inspector shows an instance-ordinal badge sourced from `formation.instance_ordinal` and an ordinal-lock toggle. Both are now meaningless (instances are per-component, auto-ranked). Re-point the badge to the per-instance body labels (QHSa1/QHSa2) and remove the lock toggle.

- [ ] **Step 1: Map the current usages**

Run: `grep -rn "instance_ordinal\|instanceOrdinal\|ordinal_locked\|ordinalLocked" desktop/src/renderer/src/shell/stages/lithology`

- [ ] **Step 2: Adjust `ordinalStaleness.ts`** — if it computes "this formation's ordinal looks stale", either delete it (if the badge it fed is removed) or re-base it on body ordinals. Update `ordinalStaleness.test.ts` to match. Run the test red→green.

Run (from `desktop/`): `npx vitest run src/renderer/src/shell/stages/lithology/ordinalStaleness.test.ts`

- [ ] **Step 3: Update `LithologyInspector.tsx`** — render instances grouped by formation using the body labels; remove the ordinal-lock toggle and its handler. Keep the formation roster (vocabulary) intact.

- [ ] **Step 4: tsc + inspector test**

Run (from `desktop/`):
`npx tsc --noEmit -p tsconfig.web.json`
`npx vitest run src/renderer/src/shell/stages/lithology/LithologyInspector.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit (one file per commit)**

```bash
git add desktop/src/renderer/src/shell/stages/lithology/ordinalStaleness.ts
git commit -m "refactor(litho): re-base ordinal staleness on instance bodies"
git add desktop/src/renderer/src/shell/stages/lithology/ordinalStaleness.test.ts
git commit -m "test(litho): ordinal staleness on instance bodies"
git add desktop/src/renderer/src/shell/stages/lithology/LithologyInspector.tsx
git commit -m "refactor(litho): inspector lists instances, drops ordinal lock"
```

---

## Task 12: e2e — `flow_per_instance_body` Playwright spec

**Files:**
- Create: `desktop/tests/e2e/specs/flow_per_instance_body.spec.ts`

Follow the structure of an existing litho section spec (e.g. `grep -rln "Suggest litho\|correlate\|seedFromStrat" desktop/tests/e2e/specs` to find a template). Runs offline against the synthetic fixture via `scripts/run-e2e.ps1` (which seeds the fixture + starts uvicorn on :8765).

- [ ] **Step 1: Write the spec**

Three assertions, matching the spec's e2e section:
1. Accept two uncorrelated same-lithology units on one section → exactly two distinct numbered labels render (`QHSa1` + `QHSa2`), not one.
2. Correlate the two → labels collapse to a single instance label.
3. Accept a pinch-out on one → the body band's top stays at its source layer depth (no jump) and the label persists.

Use the page-object / selector helpers the existing specs use (data-testids on the section canvas + toolbar). Assert label text via the rendered SVG `<text>` nodes.

- [ ] **Step 2: Run the spec**

Run: `.\scripts\run-e2e.ps1 flow_per_instance_body`
Expected: PASS (offline, deterministic). **Close the dev desktop app first.**

- [ ] **Step 3: Commit**

```bash
git add desktop/tests/e2e/specs/flow_per_instance_body.spec.ts
git commit -m "test(e2e): per-instance body labels, merge-on-correlate, no jump"
```

---

## Task 13: Full-suite regression sweep

**Files:** none (verification only)

- [ ] **Step 1: Backend unit + integration**

Run:
`uv run pytest tests/unit -q`
`.\scripts\run-integration-tests.ps1 -q`
Expected: all PASS. Fix any test that asserted the dropped `formation.instance_ordinal` litho behaviour by re-pointing it to body ordinals (commit each fix separately with a `test(...)` message).

- [ ] **Step 2: Desktop unit + type-check**

Run (from `desktop/`):
`npm test`
`npx tsc --noEmit -p tsconfig.web.json`
Expected: all PASS, no type errors.

- [ ] **Step 3: e2e full suite**

Run: `.\scripts\run-e2e.ps1`
Expected: green (close the dev app first).

- [ ] **Step 4: mypy on the touched backend tree**

Run: `uv run mypy src`
Expected: no new errors.

---

## Self-review (run before handing off)

- **Spec coverage:** every spec section maps to a task — entity/resolver (3,4), framing (10), suggester/claim/labels/inspector (5,6,11), migration/self-heal (1,2,8), testing incl. e2e (3–12).
- **Type consistency:** `LayerNode`/`LayerEdge`/`InstanceAssignment`/`ResolveResult` defined in Task 3 are consumed unchanged in Task 4. `body_id` named identically across ORM (Task 2), client type (Task 9), overlay (Task 10), bundle (Task 8).
- **No placeholders:** the two spots needing live-schema confirmation (claim's exact `layer_id` plumbing in Task 5; the bundle round-trip test path in Task 8) are explicit "locate via grep" steps, not hand-waves — resolve them by reading the file before editing.
- **Ordering:** migration → ORM → domain → use case → consumers → frontend → e2e → sweep. Each task is independently testable and committable.
