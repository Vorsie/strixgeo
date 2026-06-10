# Litho-3D M3 — Watertight Bodies (Shared Contact Surfaces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make adjacent 3D litho bodies tile watertight by fitting each contact surface **once** and sharing it between the body above and below — killing the doubled-surface hairlines/holes — and render an enclosed lens as a matrix body with an interior void.

**Architecture:** Rewrite the *internals* of the pure domain builder `litho_solid_builder`. Reconstruct each investigation's litho column from the picks, enumerate contacts tagged by the ordered (upper-body, lower-body) pair, fit one TIN per contact "patch", and assemble each body from shared patch surfaces. A body whose top/base is a single patch (the common through-going/pinch case) shares its contacts exactly; a body wrapping a lens gets the lens surface appended reversed as a void (spike-proven, no CSG); a body with a lateral facies change (multiple bodies above it) falls back to today's per-body fit (no regression) until the final task upgrades it to a true conforming stitch. The output value object (`LithoBodyMesh` = vertices + triangles) is unchanged, so the ORM/API/Cesium renderer are untouched.

**Tech Stack:** Python 3.11, pure domain (no I/O), `compute_tin` (SciPy Delaunay) for fitting, pytest. Run all tests from the repo root with `uv run pytest`.

---

## Context the engineer needs

- **The bug:** `litho_solid_builder.build_body_solids` builds each body as `[top TIN]+[flipped base TIN]+[walls]`, caching surfaces keyed by the **full pick-set** (`_surface_key`). Two bodies share a surface only when their hole-sets are byte-identical, which almost never holds — so base-of-upper and top-of-lower get fitted as two different surfaces that drift apart (a spike measured **up to 75 cm** where hole-sets interleave; **0 cm** where the extra holes fall outside the shared hull). Read the module docstring of `src/groundmodel/domain/services/litho_solid_builder.py` and `_surface_key` (line 81) before starting.
- **Gap-free columns:** litho columns are contiguous — base of layer *i* == top of layer *i+1* (contiguity triggers). So at a hole the interface between the body directly above and directly below is one elevation. This is what lets us reconstruct contacts from picks.
- **`BodyLayerPick`** (in the builder) carries `investigation_id, x_m, y_m, surface_elev_m, body_id, formation_id, top_depth_m, base_depth_m`. Elevation = `surface_elev_m - depth_m`.
- **The output contract stays:** `build_body_solids(picks: list[BodyLayerPick]) -> list[LithoBodyMesh]`. We keep the signature; `picks` is now understood as **all of the model's picks** (it already groups by `body_id` internally).
- **Reuse, don't reinvent:** `compute_tin` returns an object with `.vertices` (`list[(x,y,z)]`) and `.triangles` (`list[(i,j,k)]`). The existing `_assemble` (line 217) already builds a watertight `top+base+walls` mesh with a correct directed-edge wall winding — reuse it for the single-patch case.
- **Spec:** `docs/superpowers/specs/2026-06-10-litho-3d-m3-watertight-bodies-design.md`.
- **Discipline:** TDD (red→green→commit per step), pure module (no I/O, no `Date`/random), numpy docstrings on every public function (DoD), one logical change per commit. After each Python file write the PostToolUse hook runs ruff; still run `uv run ruff format <file>` + `uv run ruff check --fix <file>` if you edit by hand.

---

## File structure

- **Create** `src/groundmodel/domain/services/litho_contact_surfaces.py` — pure: reconstruct columns, enumerate contacts (body-pair tagged), group into patches, fit one surface per patch (cached). The "fit each contact once" engine.
- **Create** `src/groundmodel/domain/services/litho_body_assembly.py` — pure: assemble one body's closed mesh from its shared patch surfaces (single-patch path + multi-patch M2 fallback) and append a lens void.
- **Modify** `src/groundmodel/domain/services/litho_solid_builder.py` — orchestration only: group picks, detect enclosed lenses, call the two new helpers, keep the disk-marker fallback. Same public `build_body_solids` / `BodyLayerPick`.
- **Modify** `src/groundmodel/application/recompute_litho_solids.py` — pass **all** model picks to the builder (shared contacts need neighbour context); always build all bodies (cheap per the bench; Build uses `force=True`), keep the checksum only to skip rewriting unchanged DB rows.
- **Create** `tests/unit/domain/test_litho_contact_surfaces.py`
- **Create** `tests/unit/domain/test_litho_body_assembly.py`
- **Modify** `tests/unit/domain/test_litho_solid_builder.py` — add shared-surface + lens-void + no-overlap integration cases.

---

## Shared test helpers (used across tasks)

These go at the top of `tests/unit/domain/test_litho_body_assembly.py` and are imported where needed. Write them in Task 4's first step.

```python
from collections import Counter

def closed_manifold(triangles) -> bool:
    """Every undirected edge in exactly 2 triangles."""
    ec: Counter = Counter()
    for a, b, c in triangles:
        for u, v in ((a, b), (b, c), (c, a)):
            ec[frozenset((u, v))] += 1
    return len(triangles) > 0 and all(ct == 2 for ct in ec.values())

def consistently_wound(triangles) -> bool:
    """Every directed edge appears exactly once."""
    ec: Counter = Counter()
    for a, b, c in triangles:
        for u, v in ((a, b), (b, c), (c, a)):
            ec[(u, v)] += 1
    return len(triangles) > 0 and all(ct == 1 for ct in ec.values())

def ray_hits(vertices, triangles, p) -> int:
    """Count +x-ray/triangle intersections from p (Moller-Trumbore)."""
    ox, oy, oz = p
    d = (1.0, 0.0, 0.0)
    eps = 1e-9
    hits = 0
    for a, b, c in triangles:
        v0, v1, v2 = vertices[a], vertices[b], vertices[c]
        e1 = (v1[0]-v0[0], v1[1]-v0[1], v1[2]-v0[2])
        e2 = (v2[0]-v0[0], v2[1]-v0[1], v2[2]-v0[2])
        h = (d[1]*e2[2]-d[2]*e2[1], d[2]*e2[0]-d[0]*e2[2], d[0]*e2[1]-d[1]*e2[0])
        det = e1[0]*h[0]+e1[1]*h[1]+e1[2]*h[2]
        if -eps < det < eps:
            continue
        inv = 1.0/det
        s = (ox-v0[0], oy-v0[1], oz-v0[2])
        u = inv*(s[0]*h[0]+s[1]*h[1]+s[2]*h[2])
        if u < -eps or u > 1+eps:
            continue
        q = (s[1]*e1[2]-s[2]*e1[1], s[2]*e1[0]-s[0]*e1[2], s[0]*e1[1]-s[1]*e1[0])
        v = inv*(d[0]*q[0]+d[1]*q[1]+d[2]*q[2])
        if v < -eps or u+v > 1+eps:
            continue
        t = inv*(e2[0]*q[0]+e2[1]*q[1]+e2[2]*q[2])
        if t > eps:
            hits += 1
    return hits

def inside(vertices, triangles, p) -> bool:
    return ray_hits(vertices, triangles, p) % 2 == 1
```

---

### Task 1: Reconstruct litho columns from picks

**Files:**
- Create: `src/groundmodel/domain/services/litho_contact_surfaces.py`
- Test: `tests/unit/domain/test_litho_contact_surfaces.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/domain/test_litho_contact_surfaces.py
from __future__ import annotations

from groundmodel.domain.services.litho_solid_builder import BodyLayerPick
from groundmodel.domain.services.litho_contact_surfaces import build_columns, LayerSpan


def _pick(inv, x, y, body, top_d, base_d, surf=0.0, fm="f"):
    return BodyLayerPick(
        investigation_id=inv, x_m=x, y_m=y, surface_elev_m=surf,
        body_id=body, formation_id=fm, top_depth_m=top_d, base_depth_m=base_d,
    )


def test_build_columns_sorts_shallow_to_deep_and_keeps_coords():
    picks = [
        _pick("A", 1.0, 2.0, "CLAY", 4.0, 14.0),
        _pick("A", 1.0, 2.0, "SAND", 0.0, 4.0),  # shallower, given out of order
    ]
    columns, coords = build_columns(picks)
    assert coords["A"] == (1.0, 2.0)
    spans = columns["A"]
    assert [s.body_id for s in spans] == ["SAND", "CLAY"]  # shallow first
    # elevation = surface_elev - depth
    assert spans[0].top_elev == 0.0 and spans[0].base_elev == -4.0
    assert spans[1].top_elev == -4.0 and spans[1].base_elev == -14.0
```

- [ ] **Step 2: Run it, verify it fails**

Run: `uv run pytest tests/unit/domain/test_litho_contact_surfaces.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_columns'`.

- [ ] **Step 3: Implement**

```python
# src/groundmodel/domain/services/litho_contact_surfaces.py
"""Fit each litho contact ONCE and share it between the bodies above and below.

The litho column is gap-free (base of layer i == top of layer i+1), so at each
investigation the interface between the body directly above and directly below is
a single elevation. This module reconstructs those interfaces from the builder's
flat ``BodyLayerPick`` list, groups them into *patches* (a maximal set of holes
where the SAME ordered body pair is adjacent), and fits one TIN per patch — the
shared surface the assembler hands to both adjacent bodies. Pure: no I/O.
"""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.domain.services.litho_solid_builder import BodyLayerPick


@dataclass(frozen=True)
class LayerSpan:
    """One body's occupancy at one investigation, in absolute elevation.

    Parameters
    ----------
    body_id : str
        The body occupying this span.
    formation_id : str
        The body's lithology formation id.
    top_elev : float
        Span top elevation (shallower, larger value).
    base_elev : float
        Span base elevation (deeper, smaller value).
    """

    body_id: str
    formation_id: str
    top_elev: float
    base_elev: float


def build_columns(
    picks: list[BodyLayerPick],
) -> tuple[dict[str, list[LayerSpan]], dict[str, tuple[float, float]]]:
    """Reconstruct each investigation's litho column from flat picks.

    Parameters
    ----------
    picks : list[BodyLayerPick]
        All picks across the model (any order).

    Returns
    -------
    tuple[dict[str, list[LayerSpan]], dict[str, tuple[float, float]]]
        ``(columns, coords)`` where ``columns[inv]`` is the investigation's
        spans ordered shallowest-first and ``coords[inv]`` is its ``(x, y)``.
    """
    columns: dict[str, list[LayerSpan]] = {}
    coords: dict[str, tuple[float, float]] = {}
    for p in picks:
        coords[p.investigation_id] = (p.x_m, p.y_m)
        columns.setdefault(p.investigation_id, []).append(
            LayerSpan(
                body_id=p.body_id,
                formation_id=p.formation_id,
                top_elev=p.surface_elev_m - p.top_depth_m,
                base_elev=p.surface_elev_m - p.base_depth_m,
            )
        )
    for inv in columns:
        columns[inv].sort(key=lambda s: s.top_elev, reverse=True)  # shallow first
    return columns, coords
```

- [ ] **Step 4: Run it, verify PASS**

Run: `uv run pytest tests/unit/domain/test_litho_contact_surfaces.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/litho_contact_surfaces.py tests/unit/domain/test_litho_contact_surfaces.py
git commit -m "feat(litho-3d): reconstruct litho columns from picks (M3)"
```

---

### Task 2: Enumerate contacts tagged by ordered body pair

**Files:**
- Modify: `src/groundmodel/domain/services/litho_contact_surfaces.py`
- Test: `tests/unit/domain/test_litho_contact_surfaces.py`

A contact key is the ordered `(upper_body, lower_body)`. The free surface above the shallowest span uses `upper=""` (ground); the free base below the deepest uses `lower=""`.

- [ ] **Step 1: Write the failing test**

```python
def test_enumerate_contacts_keys_by_ordered_pair_and_free_surfaces():
    from groundmodel.domain.services.litho_contact_surfaces import (
        enumerate_contacts, ContactKey,
    )
    picks = [
        _pick("A", 0.0, 0.0, "SAND", 0.0, 4.0),
        _pick("A", 0.0, 0.0, "CLAY", 4.0, 14.0),
    ]
    columns, coords = build_columns(picks)
    contacts = enumerate_contacts(columns, coords)
    # internal SAND/CLAY interface at elev -4
    pts = contacts[ContactKey("SAND", "CLAY")]
    assert len(pts) == 1 and pts[0].elev == -4.0 and pts[0].x == 0.0
    # free ground above SAND at elev 0, free base below CLAY at elev -14
    assert contacts[ContactKey("", "SAND")][0].elev == 0.0
    assert contacts[ContactKey("CLAY", "")][0].elev == -14.0
```

- [ ] **Step 2: Run it, verify it fails** (`ImportError: ContactKey`).

- [ ] **Step 3: Implement (append to `litho_contact_surfaces.py`)**

```python
@dataclass(frozen=True)
class ContactKey:
    """Ordered identity of a contact patch.

    Parameters
    ----------
    upper_body : str
        Body directly above the contact, or ``""`` for the free ground surface.
    lower_body : str
        Body directly below the contact, or ``""`` for the free model base.
    """

    upper_body: str
    lower_body: str


@dataclass(frozen=True)
class ContactPoint:
    """One contact observation at one investigation.

    Parameters
    ----------
    inv_id : str
        Investigation id.
    x : float
        World x.
    y : float
        World y.
    elev : float
        Contact elevation (mTAW).
    """

    inv_id: str
    x: float
    y: float
    elev: float


def enumerate_contacts(
    columns: dict[str, list[LayerSpan]],
    coords: dict[str, tuple[float, float]],
) -> dict[ContactKey, list[ContactPoint]]:
    """Group every contact observation by its ordered ``(upper, lower)`` pair.

    Parameters
    ----------
    columns : dict[str, list[LayerSpan]]
        Per-investigation spans, shallowest-first (from :func:`build_columns`).
    coords : dict[str, tuple[float, float]]
        Per-investigation ``(x, y)``.

    Returns
    -------
    dict[ContactKey, list[ContactPoint]]
        Contact points per ordered body pair. Includes the free ground surface
        (``upper=""``) and free model base (``lower=""``) of every column.
    """
    out: dict[ContactKey, list[ContactPoint]] = {}

    def add(key: ContactKey, inv: str, elev: float) -> None:
        x, y = coords[inv]
        out.setdefault(key, []).append(ContactPoint(inv, x, y, elev))

    for inv, spans in columns.items():
        if not spans:
            continue
        add(ContactKey("", spans[0].body_id), inv, spans[0].top_elev)  # ground
        for upper, lower in zip(spans, spans[1:]):
            add(ContactKey(upper.body_id, lower.body_id), inv, upper.base_elev)
        add(ContactKey(spans[-1].body_id, ""), inv, spans[-1].base_elev)  # base
    return out
```

- [ ] **Step 4: Run it, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/litho_contact_surfaces.py tests/unit/domain/test_litho_contact_surfaces.py
git commit -m "feat(litho-3d): enumerate contacts by ordered body pair (M3)"
```

---

### Task 3: Fit one shared surface per contact patch (cached)

**Files:**
- Modify: `src/groundmodel/domain/services/litho_contact_surfaces.py`
- Test: `tests/unit/domain/test_litho_contact_surfaces.py`

Each patch surface is a TIN over **exactly** its own contact points (this is what removes the 75 cm drift). Points are sorted by `inv_id` so two patches over the same investigation set get identical vertex order → identical triangulation (the property the single-patch assembler relies on).

- [ ] **Step 1: Write the failing test**

```python
def test_fit_patch_surfaces_uses_only_patch_holes_and_sorts_by_inv():
    from groundmodel.domain.services.litho_contact_surfaces import (
        enumerate_contacts, fit_patch_surfaces, ContactKey,
    )
    # SAND over CLAY on a non-collinear quad.
    quad = [("A", 0, 0), ("B", 10, 0), ("C", 10, 10), ("D", 0, 10)]
    picks = []
    for inv, x, y in quad:
        picks.append(_pick(inv, x, y, "SAND", 0.0, 4.0))
        picks.append(_pick(inv, x, y, "CLAY", 4.0, 14.0))
    columns, coords = build_columns(picks)
    surfaces = fit_patch_surfaces(enumerate_contacts(columns, coords))
    verts, tris = surfaces[ContactKey("SAND", "CLAY")]
    assert len(verts) == 4 and len(tris) >= 2
    # vertex order is inv-sorted so it is deterministic / shareable
    assert [round(v[2], 3) for v in verts] == [-4.0, -4.0, -4.0, -4.0]
```

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement (append)**

```python
from groundmodel.domain.services.tin_surface import compute_tin
from groundmodel.domain.value_objects.contact_point_3d import ContactPoint3D

# A fitted patch surface: (vertices, triangles), as produced by compute_tin.
Surface = tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]


def fit_patch_surfaces(
    contacts: dict[ContactKey, list[ContactPoint]],
) -> dict[ContactKey, Surface]:
    """Fit one TIN per contact patch over exactly that patch's holes.

    Points are sorted by ``inv_id`` so any two patches over the same
    investigation set produce identical vertex order — and therefore identical
    Delaunay topology, which the single-patch assembler relies on to pair top
    and base walls.

    Parameters
    ----------
    contacts : dict[ContactKey, list[ContactPoint]]
        Contact points per ordered pair (from :func:`enumerate_contacts`).

    Returns
    -------
    dict[ContactKey, Surface]
        ``(vertices, triangles)`` per patch. Patches with < 3 points are
        skipped (no surface) — the assembler treats their bodies as
        under-constrained (disk-marker fallback upstream).
    """
    out: dict[ContactKey, Surface] = {}
    for key, pts in contacts.items():
        ordered = sorted(pts, key=lambda p: p.inv_id)
        if len(ordered) < 3:
            continue
        tin = compute_tin(
            [ContactPoint3D(contact_id=p.inv_id, x_m=p.x, y_m=p.y, elevation_m=p.elev) for p in ordered]
        )
        if not tin.triangles:
            continue
        out[key] = (list(tin.vertices), list(tin.triangles))
    return out
```

- [ ] **Step 4: Run it, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/litho_contact_surfaces.py tests/unit/domain/test_litho_contact_surfaces.py
git commit -m "feat(litho-3d): fit one shared surface per contact patch (M3)"
```

---

### Task 4: Assemble a single-patch body from shared surfaces

**Files:**
- Create: `src/groundmodel/domain/services/litho_body_assembly.py`
- Test: `tests/unit/domain/test_litho_body_assembly.py`

A body whose top is exactly one `ContactKey` (one body/ground above everywhere) and whose base is exactly one `ContactKey`, both over the body's full footprint, is the common through-going/pinch case. Its top patch and base patch are TINs over the same inv set in the same order → identical topology → reuse the existing `_assemble`.

- [ ] **Step 1: Write the failing test (with the shared helpers from "Shared test helpers" above)**

```python
# tests/unit/domain/test_litho_body_assembly.py
from __future__ import annotations

# (paste the Shared test helpers block here: closed_manifold, consistently_wound,
#  ray_hits, inside)

from groundmodel.domain.services.litho_solid_builder import BodyLayerPick
from groundmodel.domain.services.litho_contact_surfaces import (
    build_columns, enumerate_contacts, fit_patch_surfaces,
)
from groundmodel.domain.services.litho_body_assembly import assemble_body


def _pick(inv, x, y, body, top_d, base_d, surf=0.0, fm="f"):
    return BodyLayerPick(
        investigation_id=inv, x_m=x, y_m=y, surface_elev_m=surf,
        body_id=body, formation_id=fm, top_depth_m=top_d, base_depth_m=base_d,
    )


def _two_body_stack():
    quad = [("A", 0, 0), ("B", 10, 0), ("C", 10, 10), ("D", 0, 10)]
    picks = []
    for inv, x, y in quad:
        picks.append(_pick(inv, x, y, "SAND", 0.0, 4.0))
        picks.append(_pick(inv, x, y, "CLAY", 4.0, 14.0))
    columns, coords = build_columns(picks)
    surfaces = fit_patch_surfaces(enumerate_contacts(columns, coords))
    return columns, surfaces


def test_single_patch_body_is_watertight_and_shares_its_interface():
    columns, surfaces = _two_body_stack()
    sand = assemble_body("SAND", "f", columns, surfaces)
    clay = assemble_body("CLAY", "f", columns, surfaces)
    assert closed_manifold(sand.triangles) and consistently_wound(sand.triangles)
    assert closed_manifold(clay.triangles) and consistently_wound(clay.triangles)
    # SAND's base vertices == CLAY's top vertices (shared, gap = 0)
    sand_base = {(round(x, 6), round(y, 6), round(z, 6)) for (x, y, z) in sand.vertices if abs(z + 4.0) < 1e-6}
    clay_top = {(round(x, 6), round(y, 6), round(z, 6)) for (x, y, z) in clay.vertices if abs(z + 4.0) < 1e-6}
    assert sand_base and sand_base == clay_top
```

- [ ] **Step 2: Run it, verify it fails** (`ImportError: assemble_body`).

- [ ] **Step 3: Implement**

```python
# src/groundmodel/domain/services/litho_body_assembly.py
"""Assemble one body's closed mesh from shared contact-patch surfaces.

Single-patch path (the common through-going / pinch-out case): the body's top is
one patch and its base is one patch, both fitted over the body's footprint in the
same inv order, so they share Delaunay topology and close with the existing
directed-edge wall logic — and the top/base surfaces ARE the neighbour's surfaces
(shared, gap = 0). Multi-patch bodies (a lateral facies change with different
bodies above/below in different places) fall back to a per-body fit (no regression
vs M2) until Task 9 upgrades them. Pure: no I/O.
"""

from __future__ import annotations

from groundmodel.domain.services.litho_contact_surfaces import (
    ContactKey,
    LayerSpan,
    Surface,
)
from groundmodel.domain.services.litho_solid_builder import _assemble  # reuse M2 walls
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh


def _keys_for_body(
    body_id: str, columns: dict[str, list[LayerSpan]]
) -> tuple[set[ContactKey], set[ContactKey]]:
    """Return ``(top_keys, base_keys)`` — the contact patches above/below body.

    Top patches are contacts where the body is the LOWER side; base patches where
    it is the UPPER side.
    """
    top_keys: set[ContactKey] = set()
    base_keys: set[ContactKey] = set()
    for spans in columns.values():
        for i, s in enumerate(spans):
            if s.body_id != body_id:
                continue
            upper = spans[i - 1].body_id if i > 0 else ""
            lower = spans[i + 1].body_id if i + 1 < len(spans) else ""
            top_keys.add(ContactKey(upper, body_id))
            base_keys.add(ContactKey(body_id, lower))
    return top_keys, base_keys


def assemble_body(
    body_id: str,
    formation_id: str,
    columns: dict[str, list[LayerSpan]],
    surfaces: dict[ContactKey, Surface],
) -> LithoBodyMesh | None:
    """Assemble a body's closed mesh from shared patch surfaces.

    Parameters
    ----------
    body_id : str
        Body to assemble.
    formation_id : str
        Body's formation id (drives colour).
    columns : dict[str, list[LayerSpan]]
        Per-investigation spans (from ``build_columns``).
    surfaces : dict[ContactKey, Surface]
        Fitted patch surfaces (from ``fit_patch_surfaces``).

    Returns
    -------
    LithoBodyMesh | None
        The closed body mesh, or ``None`` when the body is multi-patch or its
        single patch could not be fitted (caller applies the M2/disk fallback).
    """
    top_keys, base_keys = _keys_for_body(body_id, columns)
    if len(top_keys) != 1 or len(base_keys) != 1:
        return None  # multi-patch — Task 9 (caller falls back for now)
    top_key = next(iter(top_keys))
    base_key = next(iter(base_keys))
    if top_key not in surfaces or base_key not in surfaces:
        return None
    top_v, top_t = surfaces[top_key]
    base_v, base_t = surfaces[base_key]
    if top_t != base_t:
        return None  # different footprints → not the simple single-patch case
    return _assemble(body_id, formation_id, top_v, base_v, top_t)
```

- [ ] **Step 4: Run it, verify PASS.**

Run: `uv run pytest tests/unit/domain/test_litho_body_assembly.py -v`

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/litho_body_assembly.py tests/unit/domain/test_litho_body_assembly.py
git commit -m "feat(litho-3d): assemble single-patch body from shared surfaces (M3)"
```

---

### Task 5: Detect an enclosed lens and merge its matrix's outer extent

**Files:**
- Modify: `src/groundmodel/domain/services/litho_body_assembly.py`
- Test: `tests/unit/domain/test_litho_body_assembly.py`

An enclosed lens `L` is a body whose direct neighbour above and below is the **same** body `M` at every hole where `L` occurs. For the void construction the matrix `M` must be built over its **merged outer extent** (top of M's shallowest span → base of M's deepest span per hole), so it ignores the lens split and we carve the lens out as a void.

- [ ] **Step 1: Write the failing test**

```python
def _matrix_with_lens():
    # CLAY (matrix) over a square + interior holes; SILT lens at interior holes,
    # bracketed by CLAY above and below.
    outer = [("A", 0, 0), ("B", 20, 0), ("C", 20, 20), ("D", 0, 20)]
    inner = [("E", 8, 10), ("F", 12, 10), ("G", 10, 8), ("H", 10, 12)]
    picks = []
    for inv, x, y in outer:                      # CLAY only, full thickness
        picks.append(_pick(inv, x, y, "CLAY", 4.0, 14.0))
    for inv, x, y in inner:                       # CLAY / SILT / CLAY
        picks.append(_pick(inv, x, y, "CLAY", 4.0, 8.0))
        picks.append(_pick(inv, x, y, "SILT", 8.0, 10.0))
        picks.append(_pick(inv, x, y, "CLAY", 10.0, 14.0))
    columns, _ = build_columns(picks)
    return columns


def test_detect_enclosed_lenses_finds_silt_in_clay():
    from groundmodel.domain.services.litho_body_assembly import detect_enclosed_lenses
    columns = _matrix_with_lens()
    enclosed = detect_enclosed_lenses(columns)
    assert enclosed == {"SILT": "CLAY"}


def test_merged_extent_spans_first_top_to_last_base():
    from groundmodel.domain.services.litho_body_assembly import merged_body_extent
    columns = _matrix_with_lens()
    ext = merged_body_extent("CLAY", columns)   # inv -> (top_elev, base_elev)
    assert ext["E"] == (-4.0, -14.0)            # spans across the lens
    assert ext["A"] == (-4.0, -14.0)
```

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement (append to `litho_body_assembly.py`)**

```python
def detect_enclosed_lenses(columns: dict[str, list[LayerSpan]]) -> dict[str, str]:
    """Map each enclosed-lens body to the matrix body that wraps it.

    A body is an enclosed lens when, at every hole where it occurs, the span
    directly above AND directly below is the SAME body (its matrix). Bodies that
    ever touch the ground, the model base, or two different neighbours are not
    enclosed.

    Parameters
    ----------
    columns : dict[str, list[LayerSpan]]
        Per-investigation spans.

    Returns
    -------
    dict[str, str]
        ``lens_body_id -> matrix_body_id``.
    """
    matrix_of: dict[str, set[str | None]] = {}
    for spans in columns.values():
        for i, s in enumerate(spans):
            above = spans[i - 1].body_id if i > 0 else None
            below = spans[i + 1].body_id if i + 1 < len(spans) else None
            seen = matrix_of.setdefault(s.body_id, set())
            seen.add(above if above == below else None)
    out: dict[str, str] = {}
    for body, mats in matrix_of.items():
        if len(mats) == 1:
            (m,) = tuple(mats)
            if m is not None and m != body:
                out[body] = m
    return out


def merged_body_extent(
    body_id: str, columns: dict[str, list[LayerSpan]]
) -> dict[str, tuple[float, float]]:
    """Per-hole outer extent of a body, merging spans split by interior lenses.

    Parameters
    ----------
    body_id : str
        The (matrix) body.
    columns : dict[str, list[LayerSpan]]
        Per-investigation spans.

    Returns
    -------
    dict[str, tuple[float, float]]
        ``inv -> (top_elev, base_elev)`` where top = shallowest span top and
        base = deepest span base for the body at that hole.
    """
    ext: dict[str, tuple[float, float]] = {}
    for inv, spans in columns.items():
        tops = [s.top_elev for s in spans if s.body_id == body_id]
        bases = [s.base_elev for s in spans if s.body_id == body_id]
        if tops:
            ext[inv] = (max(tops), min(bases))
    return ext
```

- [ ] **Step 4: Run it, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/litho_body_assembly.py tests/unit/domain/test_litho_body_assembly.py
git commit -m "feat(litho-3d): detect enclosed lenses + merged matrix extent (M3)"
```

---

### Task 6: Build a matrix body with an interior lens void

**Files:**
- Modify: `src/groundmodel/domain/services/litho_body_assembly.py`
- Test: `tests/unit/domain/test_litho_body_assembly.py`

This is the spike-proven construction: build the matrix's outer solid over its merged extent, build the lens solid, then append the lens surface **reversed** as an interior void. No CSG.

- [ ] **Step 1: Write the failing test (real behavioural unit test — build both solids inline, void, check parity)**

```python
def test_matrix_with_void_is_watertight_and_excludes_the_lens():
    from groundmodel.domain.services.litho_body_assembly import (
        build_extent_solid, append_void,
    )
    # CLAY matrix over a 20x20 square + interior holes; SILT lens on the 4
    # interior holes only, strictly inside the clay slab (-8..-10 within -4..-14).
    coords = {
        "A": (0.0, 0.0), "B": (20.0, 0.0), "C": (20.0, 20.0), "D": (0.0, 20.0),
        "E": (8.0, 10.0), "F": (12.0, 10.0), "G": (10.0, 8.0), "H": (10.0, 12.0),
    }
    clay_extent = {i: (-4.0, -14.0) for i in coords}
    lens_extent = {i: (-8.0, -10.0) for i in ("E", "F", "G", "H")}
    clay = build_extent_solid("CLAY", "f2", clay_extent, coords)
    lens = build_extent_solid("SILT", "f3", lens_extent, coords)
    assert clay is not None and lens is not None
    assert closed_manifold(lens.triangles) and consistently_wound(lens.triangles)
    voided = append_void(clay, lens)
    # Closed 2-manifold = outer shell + inner (void) shell.
    assert closed_manifold(voided.triangles) and consistently_wound(voided.triangles)
    # Parity is exactly "matrix minus lens".
    assert not inside(voided.vertices, voided.triangles, (10.0, 10.0, -9.0))  # in the void
    assert inside(voided.vertices, voided.triangles, (2.0, 2.0, -9.0))        # in the clay
    assert not inside(voided.vertices, voided.triangles, (2.0, 2.0, -20.0))   # below all
```

- [ ] **Step 2: Run it, verify it fails** (`ImportError: build_extent_solid`).

- [ ] **Step 3: Implement (append)**

```python
from collections import Counter

from groundmodel.domain.value_objects.contact_point_3d import ContactPoint3D
from groundmodel.domain.services.tin_surface import compute_tin


def build_extent_solid(
    body_id: str,
    formation_id: str,
    extent: dict[str, tuple[float, float]],
    coords: dict[str, tuple[float, float]],
) -> LithoBodyMesh | None:
    """Build a closed solid between a body's merged top and base extent.

    Top and base TINs are fitted over the SAME inv set (the body's footprint) in
    the same order, so they share topology and close with ``_assemble``.

    Parameters
    ----------
    body_id, formation_id : str
        Body identity / colour.
    extent : dict[str, tuple[float, float]]
        ``inv -> (top_elev, base_elev)`` (from ``merged_body_extent``).
    coords : dict[str, tuple[float, float]]
        ``inv -> (x, y)``.

    Returns
    -------
    LithoBodyMesh | None
        Closed solid, or ``None`` if < 3 points / no triangulation.
    """
    invs = sorted(extent)
    if len(invs) < 3:
        return None
    top = compute_tin(
        [ContactPoint3D(contact_id=i, x_m=coords[i][0], y_m=coords[i][1], elevation_m=extent[i][0]) for i in invs]
    )
    base = compute_tin(
        [ContactPoint3D(contact_id=i, x_m=coords[i][0], y_m=coords[i][1], elevation_m=extent[i][1]) for i in invs]
    )
    if not top.triangles or top.triangles != base.triangles:
        return None
    return _assemble(body_id, formation_id, list(top.vertices), list(base.vertices), list(top.triangles))


def append_void(matrix: LithoBodyMesh, lens: LithoBodyMesh) -> LithoBodyMesh:
    """Return the matrix mesh with the lens appended as an interior void.

    The lens surface is appended with REVERSED winding so its normals point into
    the void (out of the matrix material). The lens and the void wall are the same
    geometry → they tile with zero gap (spike-validated 2026-06-10).

    Parameters
    ----------
    matrix : LithoBodyMesh
        The matrix body's outer solid.
    lens : LithoBodyMesh
        The lens body's closed solid (its surface becomes the cavity wall).

    Returns
    -------
    LithoBodyMesh
        Matrix-with-void; a closed 2-manifold (outer shell + inner shell).
    """
    n = len(matrix.vertices)
    verts = list(matrix.vertices) + list(lens.vertices)
    tris = list(matrix.triangles) + [(c + n, b + n, a + n) for (a, b, c) in lens.triangles]
    return LithoBodyMesh(
        body_id=matrix.body_id,
        formation_id=matrix.formation_id,
        vertices=verts,
        triangles=tris,
        is_flagged=False,
    )
```

- [ ] **Step 4: Run it, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/litho_body_assembly.py tests/unit/domain/test_litho_body_assembly.py
git commit -m "feat(litho-3d): matrix body with interior lens void (M3)"
```

---

### Task 7: Rewire `build_body_solids` to use shared surfaces + voids

**Files:**
- Modify: `src/groundmodel/domain/services/litho_solid_builder.py` (the `build_body_solids` body only; keep `BodyLayerPick`, `_assemble`, `_disk_markers`, `_get_surface`)
- Test: `tests/unit/domain/test_litho_solid_builder.py`

New orchestration: build columns → enumerate/fit shared surfaces → detect lenses → per body, choose path: lens body (single-patch slab), matrix body (extent solid + append each enclosed lens void), single-patch body (shared assemble), else **fallback** to the existing per-body fit (no regression). Disk-marker fallback for < 3 picks stays.

- [ ] **Step 1: Write the failing test**

```python
# add to tests/unit/domain/test_litho_solid_builder.py
def test_shared_interface_has_zero_gap_between_stacked_bodies():
    from collections import Counter
    quad = [(0, 0), (40, 0), (40, 40), (0, 40), (18, 22)]  # extra interior hole
    picks = []
    for i, (x, y) in enumerate(quad):
        inv = f"q{i}"
        picks.append(BodyLayerPick(investigation_id=inv, x_m=x, y_m=y, surface_elev_m=0.0,
                                   body_id="SAND", formation_id="f1", top_depth_m=0.0, base_depth_m=4.0))
        picks.append(BodyLayerPick(investigation_id=inv, x_m=x, y_m=y, surface_elev_m=0.0,
                                   body_id="CLAY", formation_id="f2", top_depth_m=4.0, base_depth_m=14.0))
    meshes = {m.body_id: m for m in build_body_solids(picks)}
    sand_base = {(round(x, 5), round(y, 5)) for (x, y, z) in meshes["SAND"].vertices if abs(z + 4) < 1e-6}
    clay_top = {(round(x, 5), round(y, 5)) for (x, y, z) in meshes["CLAY"].vertices if abs(z + 4) < 1e-6}
    # every shared-interface vertex coincides (no doubled/drifted surface)
    assert sand_base == clay_top and len(sand_base) == 5


def test_orchestrator_lens_void():
    # CLAY matrix wrapping a SILT lens (mirrors _matrix_with_lens geometry)
    outer = [("A", 0, 0), ("B", 20, 0), ("C", 20, 20), ("D", 0, 20)]
    inner = [("E", 8, 10), ("F", 12, 10), ("G", 10, 8), ("H", 10, 12)]
    picks = []
    for inv, x, y in outer:
        picks.append(BodyLayerPick(investigation_id=inv, x_m=x, y_m=y, surface_elev_m=0.0,
                                   body_id="CLAY", formation_id="f2", top_depth_m=4.0, base_depth_m=14.0))
    for inv, x, y in inner:
        for body, td, bd, fm in [("CLAY", 4.0, 8.0, "f2"), ("SILT", 8.0, 10.0, "f3"), ("CLAY", 10.0, 14.0, "f2")]:
            picks.append(BodyLayerPick(investigation_id=inv, x_m=x, y_m=y, surface_elev_m=0.0,
                                       body_id=body, formation_id=fm, top_depth_m=td, base_depth_m=bd))
    meshes = {m.body_id: m for m in build_body_solids(picks)}
    clay = meshes["CLAY"]
    # CLAY is watertight WITH the void (outer shell + inner shell)
    assert _is_closed_manifold(clay.triangles) and _is_consistently_wound(clay.triangles)
    # a point inside the lens is NOT inside CLAY; a point off-lens IS
    from tests.unit.domain.test_litho_body_assembly import inside  # reuse ray cast
    assert not inside(clay.vertices, clay.triangles, (10.0, 10.0, -9.0))
    assert inside(clay.vertices, clay.triangles, (2.0, 2.0, -9.0))
```

> If the cross-test import is awkward in your runner, copy the `inside`/`ray_hits` helpers into this test file instead of importing — they are tiny and duplication in tests is acceptable here.

- [ ] **Step 2: Run it, verify it fails** (gap/gap-mismatch or void not built).

- [ ] **Step 3: Implement — replace the loop body of `build_body_solids`**

```python
# in litho_solid_builder.py — new imports at top
from groundmodel.domain.services.litho_contact_surfaces import (
    build_columns, enumerate_contacts, fit_patch_surfaces,
)
from groundmodel.domain.services.litho_body_assembly import (
    assemble_body, detect_enclosed_lenses, merged_body_extent,
    build_extent_solid, append_void,
)
```

Rewrite `build_body_solids` so that, after grouping `by_body`:

```python
    columns, coords = build_columns(picks)
    surfaces = fit_patch_surfaces(enumerate_contacts(columns, coords))
    lens_to_matrix = detect_enclosed_lenses(columns)        # lens_id -> matrix_id
    matrix_to_lenses: dict[str, list[str]] = {}
    for lens_id, mat_id in lens_to_matrix.items():
        matrix_to_lenses.setdefault(mat_id, []).append(lens_id)

    # Build every lens body first (single-patch slabs) so matrices can void them.
    lens_meshes: dict[str, LithoBodyMesh] = {}
    for lens_id in lens_to_matrix:
        members = by_body[lens_id]
        formation_id = members[0].formation_id
        m = assemble_body(lens_id, formation_id, columns, surfaces) or _legacy_body(lens_id, members)
        lens_meshes[lens_id] = m

    meshes: list[LithoBodyMesh] = []
    for body_id, members in by_body.items():
        formation_id = members[0].formation_id
        if body_id in lens_to_matrix:
            meshes.append(lens_meshes[body_id])
            continue
        if body_id in matrix_to_lenses:
            outer = build_extent_solid(body_id, formation_id, merged_body_extent(body_id, columns), coords)
            mesh = outer or _legacy_body(body_id, members)
            for lens_id in matrix_to_lenses[body_id]:
                lens_mesh = lens_meshes.get(lens_id)
                if outer is not None and lens_mesh is not None and not lens_mesh.is_flagged:
                    mesh = append_void(mesh, lens_mesh)
            meshes.append(mesh)
            continue
        shared = assemble_body(body_id, formation_id, columns, surfaces)
        meshes.append(shared or _legacy_body(body_id, members))
    return meshes
```

Extract the **existing** M2 top/base/disk logic (lines ~179–214 of the current file) into a private helper `_legacy_body(body_id, members) -> LithoBodyMesh` (the per-body `_get_surface` + `_assemble` else `_disk_markers` path) and call it as the fallback above. This preserves M2 behaviour exactly for multi-patch bodies (Task 9 upgrades them) and keeps the disk-marker path for < 3 picks.

- [ ] **Step 4: Run it, verify PASS** (`uv run pytest tests/unit/domain/test_litho_solid_builder.py -v`) and the existing builder tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/litho_solid_builder.py tests/unit/domain/test_litho_solid_builder.py
git commit -m "feat(litho-3d): build_body_solids uses shared surfaces + lens voids (M3)"
```

---

### Task 8: Feed the builder all model picks + no-overlap invariant

**Files:**
- Modify: `src/groundmodel/application/recompute_litho_solids.py` (the build call only)
- Test: `tests/unit/domain/test_litho_solid_builder.py`

Shared contacts need neighbour context, so the builder must see **all** model picks, not only the bodies whose checksum changed. The cheapest correct change (Build uses `force=True`; bench = ~1 s for 200 bodies): always build all bodies, keep the checksum solely to skip rewriting unchanged DB rows.

- [ ] **Step 1: Write the failing test (domain no-overlap invariant)**

```python
def test_no_two_body_solids_overlap():
    # SAND over CLAY over deep SAND, all through-going on a 5-hole spread.
    holes = [(0, 0), (40, 0), (40, 40), (0, 40), (20, 20)]
    layers = [("SAND", 0, 4, "f1"), ("CLAY", 4, 14, "f2"), ("SAND2", 14, 24, "f3")]
    picks = []
    for i, (x, y) in enumerate(holes):
        for body, td, bd, fm in layers:
            picks.append(BodyLayerPick(investigation_id=f"h{i}", x_m=x, y_m=y, surface_elev_m=0.0,
                                       body_id=body, formation_id=fm, top_depth_m=td, base_depth_m=bd))
    meshes = build_body_solids(picks)
    from tests.unit.domain.test_litho_body_assembly import inside
    # sample interior points; each must be inside at most one body
    for px in (5, 20, 35):
        for py in (5, 20, 35):
            for pz in (-2, -9, -19):
                hits = [m.body_id for m in meshes if inside(m.vertices, m.triangles, (px, py, pz))]
                assert len(hits) <= 1, f"point {(px, py, pz)} in {hits}"
```

- [ ] **Step 2: Run it, verify it fails or passes** — it should PASS already from Task 7 for this through-going case; if it FAILS, fix the builder before continuing (a real overlap bug). Treat a pass here as the regression lock; the wiring change below is what Step 3 delivers.

- [ ] **Step 3: Implement the wiring change in `recompute_litho_solids.py`**

Replace the `bodies_to_build` subsetting for the *build call* with an all-picks build, keeping the checksum for the upsert decision:

```python
        # M3: shared contacts need neighbour context — build from ALL picks.
        built_meshes: list[LithoBodyMesh] = build_body_solids(picks)
        bodies_built = len(built_meshes)
        bodies_flagged = sum(1 for m in built_meshes if m.is_flagged)
```

Then in the upsert loop, skip writing a body whose `source_pick_checksum` is unchanged and not stale and not `force` (look it up in `cached_checksums`/`existing_by_body` as today). Keep `wanted_body_ids`/orphan-delete unchanged. (Net: always triangulate-all, but only DB-write the changed rows.)

- [ ] **Step 4: Run it, verify PASS**

Run: `uv run pytest tests/unit/domain/test_litho_solid_builder.py -v`
Then the integration suite for the use case:
`.\scripts\run-integration-tests.ps1 tests/integration/application` (expect the existing `RecomputeLithoSolids` + stale-cascade tests green).

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/application/recompute_litho_solids.py tests/unit/domain/test_litho_solid_builder.py
git commit -m "feat(litho-3d): recompute feeds builder all picks; no-overlap invariant (M3)"
```

---

### Task 9: Bench + real-data dogfeed gate

**Files:**
- Modify: `tests/benchmarks/bench_litho_solid_builder.py` (add a lens case)

- [ ] **Step 1: Add a benchmark case** with one enclosed lens per ~10 bodies; assert the mesh count and that flagged-count is 0 for the solid bodies. Run:

`uv run pytest tests/benchmarks/ --benchmark-enable -k litho_solid -v`

Expected: within the M2 envelope (~1 s for 200 bodies); record the number in `CLAUDE.local.md` under the litho-3D benchmark section if it shifts materially.

- [ ] **Step 2: Full unit suite green**

Run: `uv run pytest tests/unit -q`
Expected: all pass (incl. the existing `test_litho_solid_builder.py` cases — reconcile any M2 assertion that assumed per-body re-fit; the body meshes are still closed manifolds, only the shared-interface vertices changed).

- [ ] **Step 3: Commit**

```bash
git add tests/benchmarks/bench_litho_solid_builder.py
git commit -m "test(litho-3d): bench litho solids with an enclosed lens (M3)"
```

- [ ] **Step 4: Owner dogfeed (manual gate — not a code step)**

The owner runs `test.strix` in the app and Builds the 3D litho model. Expected: the whole-section hairline between stacked units is **gone**; a known lens renders carved out of its matrix; no new holes. The `.strix` bundle can't reconstruct contacts offline, so this live-app pass is the definitive validation. Record the outcome in `memory/project_litho_3d_model.md` (M3) and `CLAUDE.md`'s litho debt note.

---

### Task 10 (final, the hard residual): true multi-patch conforming stitch

**Files:**
- Modify: `src/groundmodel/domain/services/litho_body_assembly.py`
- Test: `tests/unit/domain/test_litho_body_assembly.py`

> **This is the genuinely-novel geometry the spec flagged for a planning spike.** Bodies with a **lateral facies change** (different bodies above/below in different regions — e.g. SAND above CLAY here, PEAT above CLAY there) currently fall back to the M2 per-body fit (Task 4/7 `return None` → `_legacy_body`), so they're watertight individually but may keep a seam at the facies transition. This task upgrades them. **Do it test-first; the first test below IS the de-risk spike — if it can't be made watertight cleanly, stop and re-brainstorm rather than ship fragile geometry.**

- [ ] **Step 1: Write the failing two-patch test (the de-risk gate)**

```python
def test_two_patch_top_stitches_watertight():
    # CLAY present on all 6 holes; SAND above CLAY on the left 4, PEAT above CLAY
    # on the right 2 -> CLAY's top is two patches meeting along a transition.
    left = [("A", 0, 0), ("B", 20, 0), ("C", 0, 20), ("D", 20, 20)]
    right = [("E", 40, 0), ("F", 40, 20)]
    picks = []
    for inv, x, y in left:
        picks.append(_pick(inv, x, y, "SAND", 0.0, 4.0))
        picks.append(_pick(inv, x, y, "CLAY", 4.0, 14.0))
    for inv, x, y in right:
        picks.append(_pick(inv, x, y, "PEAT", 0.0, 4.0))
        picks.append(_pick(inv, x, y, "CLAY", 4.0, 14.0))
    columns, coords = build_columns(picks)
    surfaces = fit_patch_surfaces(enumerate_contacts(columns, coords))
    clay = assemble_body_multipatch("CLAY", "f", columns, coords, surfaces)
    assert closed_manifold(clay.triangles) and consistently_wound(clay.triangles)
```

- [ ] **Step 2: Run it, verify it fails** (`assemble_body_multipatch` undefined).

- [ ] **Step 3: Implement `assemble_body_multipatch`** — algorithm:
  1. Collect the body's full footprint inv set; fit the **base** as one TIN over the footprint (single base patch is the common case; if base is also multi-patch, recurse the same way).
  2. Build the **top** as the union of its patch surfaces. Each top patch is a TIN over its own holes; along the transition line two patches share the boundary holes (e.g. the SAND-hull edge that PEAT abuts). Insert those shared boundary vertices into both patches so they **conform** (no T-junction). Concretely: triangulate the **whole footprint once** (one Delaunay over all top holes), then assign each resulting triangle's elevations from whichever patch owns its vertices — since all patches agree at shared holes (gap-free column → identical contact elevation where both exist) and the triangulation is shared, the top is one conforming surface with the patch elevations baked in. This reuses the patch **elevations** but a **single shared triangulation** for the body's top, which removes the inter-patch seam.
  3. Close with `_assemble`-style walls between the shared top triangulation and the base triangulation (same footprint → same topology).
  Provide the implementation by following this algorithm; the test in Step 1 is the contract. Keep it pure.

- [ ] **Step 4: Run it, verify PASS**, then route multi-patch bodies in `build_body_solids` to `assemble_body_multipatch` instead of `_legacy_body`.

- [ ] **Step 5: Run the full unit suite + the no-overlap invariant; commit**

```bash
git add src/groundmodel/domain/services/litho_body_assembly.py src/groundmodel/domain/services/litho_solid_builder.py tests/unit/domain/test_litho_body_assembly.py
git commit -m "feat(litho-3d): conforming multi-patch body stitch (M3)"
```

---

## Notes on ordering & shippability

- **Tasks 1–9 are the milestone.** After Task 9 the dominant whole-section hairline is gone and lenses are carved; multi-patch facies bodies degrade gracefully to M2 (no regression). This is a dogfeedable, shippable state — get the owner's dogfeed before Task 10.
- **Task 10 is the hard, deferrable upgrade.** Its first test is the spike the spec called for; if the conforming stitch proves intractable, stop and re-brainstorm rather than ship fragile geometry. The fallback keeps the model correct in the meantime.
- No schema / API / bundle / Cesium changes anywhere in this plan — the `LithoBodyMesh` contract is unchanged.

## Self-review notes (done)

- **Spec coverage:** §3.1 contact-centric surfaces → Tasks 1–3 + 7; §3.2 footprint-aware closure → reused via `_assemble` (single-patch) + Task 10 (multi-patch); §3.3 lens void → Tasks 5–7; §4 reuse → `compute_tin`/`_assemble`/resolver picks; §6 testing (manifold, void parity, no-overlap, bench, dogfeed) → Tasks 4–9; §7 risk (patch stitch spike) → Task 10 Step 1; §8 build order matches Tasks.
- **Type consistency:** `LayerSpan`, `ContactKey`, `ContactPoint`, `Surface` defined in `litho_contact_surfaces.py` and consumed unchanged in `litho_body_assembly.py`; `assemble_body`/`detect_enclosed_lenses`/`merged_body_extent`/`build_extent_solid`/`append_void` names are consistent across Tasks 4–7; `build_body_solids`/`BodyLayerPick`/`_assemble` signatures unchanged.
- **Fallback `_legacy_body`** is the extracted M2 path (Task 7 Step 3) — referenced before definition only within the same task; extract it in the same edit.
