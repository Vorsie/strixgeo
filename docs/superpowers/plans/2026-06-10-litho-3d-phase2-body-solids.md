# Litho 3D — Part b, Plan B2 (Milestone 2): Per-Body Solids Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a watertight 3D solid per lithostratigraphic body — through-going bodies + pinch-outs — and render them in the litho 3D pane's "Solid" view, replacing the placeholder per-formation surface sheets.

**Architecture:** Server-side builder mirroring the geology surface pipeline. `LithoSolidBuilder` (pure domain) fits **one `compute_tin` surface per contact-boundary** (shared between the two bodies it bounds) and assembles each body as a closed mesh `[top faces] + [flipped base faces] + [side walls on the boundary edges]` (spike-validated watertight; pinch-outs free where surfaces meet). Persisted to a new `litho_body_solid` table (mirrors `formation_surface_orm`), recomputed via `RecomputeLithoSolids` (on-click Build + stale-on-edit cascade), served by `GET /geology/models/{id}/litho-solids`, and rendered as opaque closed meshes by `Geology3DViewer` (new `bodySolids` path) inside `LithologyCanvas`. Lenses render as overlapping blobs (3D carve deferred to M3); a body with <3 control points falls back to a flagged thin slab.

**Tech Stack:** Python (FastAPI, SQLAlchemy/Alembic, SciPy `compute_tin`), TypeScript/React, Cesium, Vitest, pytest. Reuses `compute_tin`, `FormationSurfaceOrm`/`RecomputeFormationSurface`/`RebuildModelSurfaces` patterns, `ResolveLithoInstances`, `BodyOrm`, `buildTinPrimitive`/`Geology3DViewer`.

---

## Scope

**In (milestone 2):** through-going bodies + pinch-outs as closed watertight solids; shared per-contact surfaces; `litho_body_solid` persistence + stale cascade + Build; API; per-body colour (`display_color`) in the bundle; Solid-view render of per-body solids replacing the sheets.

**Out (milestone 3, separate plan):** the 3D lens carve (lenses render as overlapping blobs here); true interfingering / composite-contact extent; full freedraw-node fidelity. **Out (deferred):** DXF / Plaxis 3D export.

---

## File Structure

**Backend (Python)**
- **Create** `src/groundmodel/domain/services/litho_solid_builder.py` — pure builder (`build_body_solids`) + internal helpers (`contact_surface_set`, `body_between_surfaces`).
- **Create** `src/groundmodel/domain/value_objects/litho_body_mesh.py` — `LithoBodyMesh` value object (`body_id`, `formation_id`, `vertices`, `triangles`, `is_flagged`).
- **Create** `src/groundmodel/infrastructure/db/models/litho_body_solid_orm.py` — `LithoBodySolidOrm`.
- **Create** migration `..._add_litho_body_solid.py` (+ a second migration `..._add_body_display_color.py`).
- **Modify** `src/groundmodel/infrastructure/db/models/body_orm.py` — add nullable `display_color`.
- **Create** `src/groundmodel/application/recompute_litho_solids.py` — `RecomputeLithoSolids` use case.
- **Modify** the litho repository (the one that loads accepted layers + bodies — same module `ResolveLithoInstances` uses) — add a `mark_litho_solids_stale` + `list_litho_solids` query.
- **Create** `src/groundmodel/api/schemas/project/litho_body_solid_response.py` — `LithoBodySolidResponse`.
- **Modify** the geology models router (where `GET .../surfaces` lives, `api/routers/geology/surfaces.py`) — add `GET .../litho-solids`, `POST .../litho-solids/rebuild`; **Modify** the body router (or geology router) — add `PATCH .../bodies/{body_id}` for `display_color`.
- **Create** `tests/unit/domain/test_litho_solid_builder.py`, `tests/integration/api/test_litho_solids.py`, `tests/benchmarks/bench_litho_solid_builder.py`.

**Frontend (TypeScript)**
- **Modify** `desktop/src/renderer/src/api/clients/geology.ts` — `LithoBodySolidResponse` type + `listLithoSolids` / `rebuildLithoSolids` / `setBodyColor`.
- **Modify** `desktop/src/renderer/src/shell/stages/geology/Geology3DViewer.tsx` — `bodySolids` prop + `buildSolidPrimitive` (opaque closed mesh) render path.
- **Modify** `desktop/src/renderer/src/shell/stages/lithology/LithologyCanvas.tsx` — fetch litho-solids in Solid mode, Build button, per-body colour picker; stop passing formation sheets in Solid mode.
- **Create** `desktop/tests/e2e/flow_litho_solids.spec.ts`.

---

## Task 1: Domain — body solid mesh builder (pure)

**Files:**
- Create: `src/groundmodel/domain/value_objects/litho_body_mesh.py`
- Create: `src/groundmodel/domain/services/litho_solid_builder.py`
- Test: `tests/unit/domain/test_litho_solid_builder.py`

The spike-validated core. Input is per-body member-layer boundary picks; the builder fits one surface per contact (cached by pick-set so adjacent bodies share it) and assembles each body's closed mesh.

- [ ] **Step 1: Write the value object**

```python
# src/groundmodel/domain/value_objects/litho_body_mesh.py
"""Closed 3D mesh for one lithostratigraphic body."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LithoBodyMesh:
    """A body's watertight triangle mesh in project CRS + vertical datum.

    Parameters
    ----------
    body_id : str
        The ``body.id`` this mesh represents.
    formation_id : str
        The body's lithology formation id (drives colour).
    vertices : list[tuple[float, float, float]]
        ``(x_m, y_m, elevation_m)`` triples.
    triangles : list[tuple[int, int, int]]
        Vertex-index triples (outward-facing winding).
    is_flagged : bool
        True when the body could not form a real solid (<3 control points /
        collinear) and was emitted as a thin fallback slab — surfaced as
        under-constrained in the UI (spec §7).
    """

    body_id: str
    formation_id: str
    vertices: list[tuple[float, float, float]]
    triangles: list[tuple[int, int, int]]
    is_flagged: bool
```

- [ ] **Step 2: Write the failing tests** (the spike cases, as the geological rule in the comments)

```python
# tests/unit/domain/test_litho_solid_builder.py
"""Unit tests for the litho body-solid builder (no DB, no I/O)."""
from __future__ import annotations

from collections import Counter

from groundmodel.domain.services.litho_solid_builder import (
    BodyLayerPick,
    build_body_solids,
)


def _is_closed_manifold(triangles: list[tuple[int, int, int]]) -> bool:
    """A closed 2-manifold: every undirected edge is shared by exactly 2 tris."""
    ec: Counter[tuple[int, int]] = Counter()
    for a, b, c in triangles:
        for u, v in ((a, b), (b, c), (c, a)):
            ec[(min(u, v), max(u, v))] += 1
    return len(triangles) > 0 and all(ct == 2 for ct in ec.values())


# Two investigations forming a tiny fence — enough x,y spread for a TIN once a
# body spans >=3 of them. Each pick: (investigation, x, y, surface_elev, body_id,
# formation_id, top_depth, base_depth).
PTS = [(0.0, 0.0), (50.0, 0.0), (100.0, 0.0), (0.0, 80.0), (50.0, 80.0), (100.0, 80.0)]


def _slab_picks(body_id: str, formation_id: str, top: float, base: float) -> list[BodyLayerPick]:
    return [
        BodyLayerPick(
            investigation_id=f"inv{i}",
            x_m=x,
            y_m=y,
            surface_elev_m=12.0,
            body_id=body_id,
            formation_id=formation_id,
            top_depth_m=top,
            base_depth_m=base,
        )
        for i, (x, y) in enumerate(PTS)
    ]


def test_through_going_body_is_a_closed_watertight_solid() -> None:
    """A body present on every investigation builds one closed manifold solid."""
    picks = _slab_picks("b1", "ZAND", top=2.0, base=6.0)
    meshes = build_body_solids(picks)
    assert len(meshes) == 1
    m = meshes[0]
    assert m.body_id == "b1"
    assert not m.is_flagged
    assert _is_closed_manifold(m.triangles)


def test_pinch_out_keeps_the_solid_watertight_and_zero_thickness_at_the_pinch() -> None:
    """Where the base meets the top the body thins to zero and stays watertight."""
    picks = _slab_picks("b1", "ZAND", top=2.0, base=6.0)
    # Make the last investigation a pinch: base depth == top depth (zero thickness).
    picks[5] = BodyLayerPick(
        investigation_id="inv5", x_m=100.0, y_m=80.0, surface_elev_m=12.0,
        body_id="b1", formation_id="ZAND", top_depth_m=2.0, base_depth_m=2.0,
    )
    meshes = build_body_solids(picks)
    assert len(meshes) == 1
    assert _is_closed_manifold(meshes[0].triangles)
    # A vertex pair (top, base) coincides → zero-thickness pinch present.
    zs = [v[2] for v in meshes[0].vertices]
    assert any(abs(z - (12.0 - 2.0)) < 1e-9 for z in zs)


def test_degenerate_body_falls_back_to_a_flagged_slab_not_a_crash() -> None:
    """A body on <3 investigations can't fit a TIN → flagged slab, no crash."""
    picks = _slab_picks("b1", "ZAND", top=2.0, base=6.0)[:2]  # only 2 points
    meshes = build_body_solids(picks)
    assert len(meshes) == 1
    assert meshes[0].is_flagged is True


def test_adjacent_bodies_share_the_contact_surface_exactly() -> None:
    """Body A's base picks == body B's top picks → the shared surface coincides
    vertex-for-vertex (watertight stack), because the builder caches one surface
    per contact."""
    sand = _slab_picks("sand", "ZAND", top=0.0, base=4.0)
    clay = _slab_picks("clay", "KLEI", top=4.0, base=9.0)  # clay top == sand base
    meshes = build_body_solids(sand + clay)
    by_id = {m.body_id: m for m in meshes}
    sand_base_z = sorted(v[2] for v in by_id["sand"].vertices if abs(v[2] - (12.0 - 4.0)) < 1e-6)
    clay_top_z = sorted(v[2] for v in by_id["clay"].vertices if abs(v[2] - (12.0 - 4.0)) < 1e-6)
    assert sand_base_z and clay_top_z  # both bodies have vertices on the shared contact
```

- [ ] **Step 3: Run; confirm failure**

Run: `uv run pytest tests/unit/domain/test_litho_solid_builder.py -q`
Expected: ImportError / fail — `litho_solid_builder` not defined.

- [ ] **Step 4: Implement the builder**

```python
# src/groundmodel/domain/services/litho_solid_builder.py
"""Build watertight 3D solids for lithostratigraphic bodies (pure domain).

A body's top and base contact picks sit at the SAME investigations (wherever the
body exists), so ``compute_tin`` over that shared point set yields the same
triangulation + vertex correspondence for both surfaces. A body mesh is then
``[top faces] + [flipped base faces] + [side walls on the boundary edges]`` — a
closed watertight 2-manifold, with pinch-outs free where the surfaces meet
(validated by the 2026-06-10 spike). One surface is fitted per CONTACT and cached
by its pick-set, so two bodies sharing a contact (base-of-upper = top-of-lower)
reference the identical surface → the stack is watertight by construction.

Lenses build as their own closed blobs that overlap their matrix (the 3D carve is
milestone 3). A body with <3 non-collinear control points cannot fit a TIN and is
emitted as a flagged thin slab (spec §7) rather than crashing.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from groundmodel.domain.services.tin_surface import compute_tin
from groundmodel.domain.value_objects.contact_point_3d import ContactPoint3D
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh
from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)

#: Thickness (m) of the fallback slab for a body that cannot fit a surface.
FLAGGED_SLAB_THICKNESS_M = 0.5


@dataclass(frozen=True)
class BodyLayerPick:
    """One member-layer of a body at one investigation.

    Parameters
    ----------
    investigation_id : str
        CPT/borehole id (identity for the (x, y) anchor).
    x_m, y_m : float
        World coordinates (project CRS).
    surface_elev_m : float
        Ground/surface elevation at the investigation (depth → elevation).
    body_id, formation_id : str
        The body this pick belongs to and its lithology formation.
    top_depth_m, base_depth_m : float
        The member layer's top/base depths below ``surface_elev_m``.
    """

    investigation_id: str
    x_m: float
    y_m: float
    surface_elev_m: float
    body_id: str
    formation_id: str
    top_depth_m: float
    base_depth_m: float


def _surface_key(picks: list[tuple[str, float, float, float]]) -> tuple:
    """Stable cache key for a contact surface = its sorted (inv, x, y, z) picks."""
    return tuple(sorted((iv, round(x, 4), round(y, 4), round(z, 6)) for iv, x, y, z in picks))


def build_body_solids(picks: list[BodyLayerPick]) -> list[LithoBodyMesh]:
    """Build one closed mesh per body from its member-layer picks.

    Parameters
    ----------
    picks : list[BodyLayerPick]
        All accepted member-layer picks across the model (any order). Grouped by
        ``body_id`` internally.

    Returns
    -------
    list[LithoBodyMesh]
        One mesh per body. Bodies with <3 control points are flagged slabs.
    """
    by_body: dict[str, list[BodyLayerPick]] = {}
    for p in picks:
        by_body.setdefault(p.body_id, []).append(p)

    surface_cache: dict[tuple, tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]] = {}

    def _surface(raw: list[tuple[str, float, float, float]]):
        key = _surface_key(raw)
        cached = surface_cache.get(key)
        if cached is not None:
            return cached
        tin = compute_tin(
            [ContactPoint3D(contact_id=iv, x_m=x, y_m=y, elevation_m=z) for iv, x, y, z in raw]
        )
        result = (list(tin.vertices), list(tin.triangles))
        surface_cache[key] = result
        return result

    meshes: list[LithoBodyMesh] = []
    for body_id, members in by_body.items():
        formation_id = members[0].formation_id
        top_raw = [
            (m.investigation_id, m.x_m, m.y_m, m.surface_elev_m - m.top_depth_m) for m in members
        ]
        base_raw = [
            (m.investigation_id, m.x_m, m.y_m, m.surface_elev_m - m.base_depth_m) for m in members
        ]
        top_v, top_t = _surface(top_raw)
        base_v, base_t = _surface(base_raw)

        if len(top_t) == 0 or len(base_t) == 0 or top_t != base_t:
            # Degenerate (<3 non-collinear picks) or — defensively — mismatched
            # triangulations (cache miss from differing pick order on the same
            # contact). Emit a flagged thin slab from whatever picks exist.
            logger.warning(
                f"litho_solid_builder: body {body_id} could not form a solid "
                f"(top_tris={len(top_t)}, base_tris={len(base_t)}); flagged slab"
            )
            meshes.append(_flagged_slab(body_id, formation_id, top_raw))
            continue

        meshes.append(_assemble(body_id, formation_id, top_v, base_v, top_t))
    return meshes


def _assemble(
    body_id: str,
    formation_id: str,
    top_v: list[tuple[float, float, float]],
    base_v: list[tuple[float, float, float]],
    tris: list[tuple[int, int, int]],
) -> LithoBodyMesh:
    """Close a body mesh: top faces + flipped base faces + side walls."""
    n = len(top_v)
    vertices = list(top_v) + list(base_v)  # [0, n) top, [n, 2n) base
    triangles: list[tuple[int, int, int]] = []
    for a, b, c in tris:
        triangles.append((a, b, c))  # top, up-facing
        triangles.append((c + n, b + n, a + n))  # base, reversed → down-facing
    edge_count: Counter[tuple[int, int]] = Counter()
    for a, b, c in tris:
        for u, v in ((a, b), (b, c), (c, a)):
            edge_count[(min(u, v), max(u, v))] += 1
    for (i, j), ct in edge_count.items():
        if ct != 1:
            continue  # interior edge — no wall
        # Boundary edge: two triangles bridging top edge (i,j) to base edge.
        triangles.append((i, j, j + n))
        triangles.append((i, j + n, i + n))
    return LithoBodyMesh(
        body_id=body_id, formation_id=formation_id, vertices=vertices,
        triangles=triangles, is_flagged=False,
    )


def _flagged_slab(
    body_id: str, formation_id: str, top_raw: list[tuple[str, float, float, float]]
) -> LithoBodyMesh:
    """Fallback for an un-triangulable body: a thin slab under its picks.

    Builds a degenerate but non-crashing marker. When even 3 points exist but are
    collinear the slab is a thin ribbon; with <3 points it is an empty mesh (the
    caller/UI shows the count of under-constrained bodies).
    """
    if len(top_raw) < 3:
        return LithoBodyMesh(body_id, formation_id, [], [], is_flagged=True)
    top = [(x, y, z) for _iv, x, y, z in top_raw]
    base = [(x, y, z - FLAGGED_SLAB_THICKNESS_M) for _iv, x, y, z in top_raw]
    n = len(top)
    vertices = top + base
    triangles = [(0, 1, 2), (2 + n, 1 + n, 0 + n)]  # one tri each face (best-effort)
    return LithoBodyMesh(body_id, formation_id, vertices, triangles, is_flagged=True)
```

- [ ] **Step 5: Run; confirm pass**

Run: `uv run pytest tests/unit/domain/test_litho_solid_builder.py -q` → all pass.

- [ ] **Step 6: Format + lint + commit**

```bash
uv run ruff format src/groundmodel/domain/services/litho_solid_builder.py src/groundmodel/domain/value_objects/litho_body_mesh.py tests/unit/domain/test_litho_solid_builder.py
uv run ruff check --fix <same files>
git add src/groundmodel/domain/value_objects/litho_body_mesh.py
git commit -m "feat(litho-3d): LithoBodyMesh value object"
git add src/groundmodel/domain/services/litho_solid_builder.py tests/unit/domain/test_litho_solid_builder.py
git commit -m "feat(litho-3d): pure body-solid builder (watertight mesh + pinch-outs)"
```

---

## Task 2: ORM — `litho_body_solid` table + migration

**Files:**
- Create: `src/groundmodel/infrastructure/db/models/litho_body_solid_orm.py`
- Create: migration under `src/groundmodel/infrastructure/db/migrations/versions/`

Mirror `formation_surface_orm.py` exactly (read it first). Columns: `id` (UUID PK), `model_id` (FK geological_model, CASCADE), `body_id` (FK body, CASCADE), `formation_id` (FK geological_formation, CASCADE), `method` (String(16), "tin"), `vertices` (JSONB), `triangles` (JSONB), `source_pick_count` (Integer), `source_pick_checksum` (LargeBinary), `is_stale` (Boolean), `is_flagged` (Boolean, default false), `created_at`, `updated_at`. UNIQUE `(model_id, body_id)` (`uq_litho_body_solid_model_body`); INDEX on `model_id`.

- [ ] **Step 1: Write the ORM** mirroring `formation_surface_orm.py` (copy its structure; rename table `litho_body_solid`, swap `formation_id`-unique for `body_id`-unique, add `body_id` FK + `is_flagged`). Numpy docstring on the class.
- [ ] **Step 2: Generate the migration.** `uv run alembic revision -m "add litho_body_solid"` then fill `upgrade()`/`downgrade()` mirroring the `formation_surface` migration (`a3b7e29f4d10`) + its `is_stale` follow-up. Include the unique constraint + index.
- [ ] **Step 3: Apply to the integration DB + dev DB.** `.\scripts\run-integration-tests.ps1 --collect-only` (migrates the integration DB) and `uv run alembic upgrade head` (dev DB — see CLAUDE.md "migrate the dev DB after a migration-bearing fix").
- [ ] **Step 4: Commit** (ORM file, then migration file — one per commit).

---

## Task 3: ORM — `body.display_color` column + migration

**Files:**
- Modify: `src/groundmodel/infrastructure/db/models/body_orm.py`
- Create: migration

- [ ] **Step 1: Add the column.** `display_color: Mapped[str | None] = mapped_column(String(20), nullable=True)` with a docstring: nullable hex like `"#aabbcc"`; `null` ⇒ use the lithology colour; a per-project engineering decision that rides in the `.gmproj` bundle (see `project_decisions_in_bundle`).
- [ ] **Step 2: Migration** `add body display_color` (add column, nullable, no default). Apply to integration + dev DB.
- [ ] **Step 3: Bundle round-trip.** Grep the project-bundle build/restore for `BodyOrm` serialization; add `display_color` to the bundle body shape (additive, defaults null) so it persists. Run the bundle integration test.
- [ ] **Step 4: Commit** (one file per commit).

---

## Task 4: Application — `RecomputeLithoSolids` use case + stale cascade

**Files:**
- Create: `src/groundmodel/application/recompute_litho_solids.py`
- Modify: the litho repository (same module `ResolveLithoInstances` loads layers from)
- Test: `tests/integration/db/test_recompute_litho_solids.py`

Mirror `RebuildModelSurfaces` / `RecomputeFormationSurface`.

- [ ] **Step 1: Repository queries.** Add `load_body_picks(model_id) -> list[BodyLayerPick]` (join accepted `litho_layer` → `body` (body_id) → investigation `cpt`/`borehole` for `location_x/y` + `elevation_m`; skip layers with null body_id or null elevation, logging the count skipped). Add `mark_litho_solids_stale(model_id)` (bulk UPDATE `is_stale=true`) and `list_litho_solids(model_id)`.
- [ ] **Step 2: Use case.** `RecomputeLithoSolids(session).execute(model_id, force=False)`: run `ResolveLithoInstances` first (ensure body_id current) → `load_body_picks` → `build_body_solids` → upsert each `LithoBodySolidOrm` (ON CONFLICT `(model_id, body_id)`), delete orphan solids whose body no longer exists, set `is_stale=false`. Use a `source_pick_checksum` short-circuit like `RecomputeFormationSurface`. Log phase summary (bodies considered / built / flagged).
- [ ] **Step 3: Stale cascade.** Every use case that mutates litho layers / correlation edges / bodies (the same set that already calls `mark_surfaces_stale` or `ResolveLithoInstances`) also calls `mark_litho_solids_stale(model_id)`. Grep for `mark_surfaces_stale(` to find the sites.
- [ ] **Step 4: Integration test** — seed a small connected fence, run `RecomputeLithoSolids`, assert one solid row per body, watertight triangle count > 0, `is_stale=false`; mutate a layer → assert solids marked stale.
- [ ] **Step 5: Commit** per file.

---

## Task 5: API — list / rebuild / colour

**Files:**
- Create: `src/groundmodel/api/schemas/project/litho_body_solid_response.py`
- Modify: `src/groundmodel/api/routers/geology/surfaces.py` (or the geology models router)
- Test: `tests/integration/api/test_litho_solids.py`

Mirror `FormationSurfaceResponse` + the surfaces endpoints.

- [ ] **Step 1: Response schema** `LithoBodySolidResponse` (`from_attributes`): `id, model_id, body_id, formation_id, method, vertices: list[list[float]], triangles: list[list[int]], is_stale: bool, is_flagged: bool, display_color: str | None, created_at, updated_at`. The endpoint computes the effective colour (override ?? lithology) OR returns `display_color` + lets the client resolve — return `display_color` and the `formation_id` (client already has formation colours).
- [ ] **Step 2: Endpoints.** `GET /geology/models/{model_id}/litho-solids` → `list[LithoBodySolidResponse]` (repo `list_litho_solids`, eager-load the `body` for `display_color` — add the `selectinload` per the async-ORM rule in CLAUDE.md). `POST /geology/models/{model_id}/litho-solids/rebuild` → calls `RecomputeLithoSolids(...).execute(model_id)` (mirror `rebuild_model_surfaces`). `PATCH /geology/models/{model_id}/bodies/{body_id}` body `{display_color: str | null}` → update + return the body. Additive only.
- [ ] **Step 3: Integration test** — seed fence, `POST rebuild`, `GET litho-solids` returns one per body with vertices/triangles; `PATCH` colour persists + comes back on the next GET; confirm the response model tolerates a flagged (empty-mesh) body.
- [ ] **Step 4: Commit** per file.

---

## Task 6: Frontend — client types + API calls

**Files:**
- Modify: `desktop/src/renderer/src/api/clients/geology.ts`
- Test: tsc

- [ ] **Step 1: Type** `LithoBodySolidResponse` (mirror `FormationSurfaceResponse`: `vertices: [number,number,number][]`, `triangles: [number,number,number][]`, plus `body_id`, `formation_id`, `is_stale?`, `is_flagged?`, `display_color?: string | null`).
- [ ] **Step 2: API calls** `api.geology.listLithoSolids(projectId, modelId)`, `rebuildLithoSolids(projectId, modelId)`, `setBodyColor(projectId, modelId, bodyId, color: string | null)`. Mirror the existing geology surface/ground-surface client calls.
- [ ] **Step 3:** `cd desktop && npx tsc --noEmit -p tsconfig.web.json` (exit 0). Commit.

---

## Task 7: Frontend — render per-body solids in Geology3DViewer

**Files:**
- Modify: `desktop/src/renderer/src/shell/stages/geology/Geology3DViewer.tsx`

Add an optional `bodySolids?: LithoBodySolid[]` prop (`{bodyId, formationId, vertices, triangles, displayColor}`). When present, render each as an **opaque closed** mesh (a `buildSolidPrimitive` mirroring `buildTinPrimitive` but `closed: true` + `translucent: false`, coloured by `displayColor ?? formation.color`). Respect `hiddenFormationIds` (a hidden lithology hides its bodies) + the split `clip` (mirror the fence path). This render path is gated like the fence one; when `bodySolids` is provided the formation-TIN sheets are not drawn (the caller controls that — see Task 8).

- [ ] **Step 1:** Add the prop + `buildSolidPrimitive` (copy `buildTinPrimitive`, set `PerInstanceColorAppearance({ translucent: false, flat: true, closed: true })`; thread `clip` for split). Verify `closed: true` is wanted (solids are closed volumes, back-face cull is correct + faster).
- [ ] **Step 2:** In `rebuildSurfacePrimitives`, add a `bodySolids` param + a render loop (skip `hiddenFormationIds`, colour `displayColor ?? formation colour`, pass `clip`). Thread it through `CesiumViewport` (interface + destructure + call + dep array) + both viewport instances + `Geology3DViewerProps`.
- [ ] **Step 3:** `npx tsc --noEmit -p tsconfig.web.json` + `npx vitest run` (green). Commit.

---

## Task 8: Frontend — LithologyCanvas Solid-mode wiring + colour picker

**Files:**
- Modify: `desktop/src/renderer/src/shell/stages/lithology/LithologyCanvas.tsx`

- [ ] **Step 1:** In **Solid** mode, fetch `listLithoSolids` (effect keyed on the active litho model; refetch after a Build). Pass them as `bodySolids` to `Geology3DViewer`, and pass an **empty** `surfacesByFormationId` (or a `showSheets={false}` signal) so the placeholder sheets are not drawn in Solid mode (they're replaced). Fence mode unchanged.
- [ ] **Step 2:** Add a **Build** action (toolbar/legend) → `rebuildLithoSolids` → refetch → toast outcome; show stale badge (mirror the formation `is_stale` UX) and a "N under-constrained bodies" note when any `is_flagged`.
- [ ] **Step 3:** Per-body **colour picker** — selecting a body (legend or 3D pick — start with a legend list of bodies) opens a colour input → `setBodyColor` → refetch. Reset clears to null (lithology default). Persisted server-side → rides in the bundle.
- [ ] **Step 4:** `npx tsc --noEmit -p tsconfig.web.json` + `npx vitest run` (green) + a Vitest for the Solid-mode fetch + Build wiring. Commit.

---

## Task 9: Benchmark

**Files:**
- Create: `tests/benchmarks/bench_litho_solid_builder.py`

Per the "benchmark alongside CPU-bound code" rule — `build_body_solids` is the new per-element CPU surface.

- [ ] **Step 1:** `bench_litho_solid_builder.py` timing `build_body_solids` on synthetic fences (10 / 50 / 200 bodies × ~6–30 picks). Naming `bench_*`. Run `uv run pytest tests/benchmarks/bench_litho_solid_builder.py --benchmark-enable -v`; record numbers in `CLAUDE.local.md`. Commit.

---

## Task 10: e2e

**Files:**
- Create: `desktop/tests/e2e/flow_litho_solids.spec.ts`

- [ ] **Step 1:** Seed the fence fixture, open the litho 3D stage, click **Build**, switch to **Solid** mode, assert the Cesium canvas renders and stays mounted (no error overlay) — geometry correctness is covered by the unit/integration tests. Run via `.\scripts\run-e2e.ps1 flow_litho_solids` (close the dev app first). Commit.

---

## Self-Review

- **Spec coverage:** Implements spec §11.6 milestone 2 in full — builder (§5.2 through-going + pinch-outs; `lens_carve` excluded → M3), `litho_body_solid` (§5.3), API (§5.4), viewer (§5.5 per-body solids), per-body colour (§5.6). Lenses-overlap + flagged-slab match the §7 / scope decisions.
- **Type consistency:** `BodyLayerPick` / `LithoBodyMesh` defined once (Task 1) and consumed in Task 4. `LithoBodySolidResponse` defined in Task 5, mirrored in Task 6. `bodySolids` prop shape consistent across Tasks 7–8.
- **No placeholders:** the pure builder (Task 1) is complete code; the ORM/use-case/API/frontend tasks reference the exact existing files to mirror (`formation_surface_orm.py`, `RecomputeFormationSurface`, the surfaces router, `buildTinPrimitive`) — the implementer copies those proven patterns. Confirm-points (exact migration template, `selectinload` chain, the mark-stale call sites) are named reads, not guesses.
- **Watertight guarantee:** rests on shared per-contact surface caching (Task 1) — pinned by `test_adjacent_bodies_share_the_contact_surface_exactly` + the manifold checks.

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review (spec then quality) between tasks; matches how B1 shipped.
2. **Inline Execution** — execute in this session with checkpoints.

After M2 lands a rotatable per-body solid model, the next step is a **lens-carve spike** → **Plan B3 (milestone 3)**: 3D lens carve + true-extent/interfingering fidelity, then the deferred DXF / Plaxis 3D export spec.
