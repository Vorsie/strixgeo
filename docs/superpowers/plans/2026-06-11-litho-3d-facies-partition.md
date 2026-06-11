# Litho-3D Facies Partition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make competing litho units (different bodies above/below the same shared body) tile watertight in 3D by partitioning the shared body's footprint among the competitors at midpoint/Voronoi boundaries and building clipped prisms.

**Architecture:** New pure domain module `litho_facies_partition` labels a shared body's footprint by the competitor directly above (or below) each hole, triangulates it (reusing `compute_tin`), and subdivides each mixed triangle at edge **midpoints** (2-way) or the **circumcenter** (3-way Voronoi junction, with an obtuse-triangle clamp) into a shared-vertex planar partition. `litho_body_assembly` builds each competitor's region as a closed prism between two continuous surfaces (the shared contact = floor, the competitors' tops = one `S_upper` so tops meet); walls between competitors reuse the shared boundary vertices so they coincide → watertight. `build_body_solids` routes multi-patch bodies through this path, accumulating each competitor's region-prisms into one `LithoBodyMesh` per `body_id`.

**Tech Stack:** Python 3.11, pure domain (no I/O), `compute_tin` (SciPy Delaunay), pytest. No new dependency. Run from repo root with `uv run pytest`.

---

## Context the engineer needs

- **Read the spec first:** `docs/superpowers/specs/2026-06-11-litho-3d-facies-partition-design.md`. Then the M3 modules it builds on: `litho_contact_surfaces.py` (`build_columns`, `ContactKey`, `Surface`, `fit_patch_surfaces`), `litho_body_assembly.py` (`_keys_for_body`, `assemble_body`, `build_extent_solid`, `append_void`), `litho_mesh_primitives.py` (`assemble_closed_solid`), `litho_solid_builder.py` (`build_body_solids`, `BodyLayerPick`, `_legacy_body`, `_disk_markers`).
- **The problem:** a "multi-patch" body B has >1 distinct body directly above it across its footprint (e.g. a 52-hole SAND with CLAY, SILT, PEAT above it in different places). M3 hands B's competitors to the old M2 builder → they overlap (a spike measured 165 cm) or seam. This plan partitions B's footprint among the competitors so they tile.
- **`build_columns(picks) -> (columns, coords)`:** `columns[inv]` = list of `LayerSpan(body_id, formation_id, top_elev, base_elev)` shallowest-first; `coords[inv] = (x, y)`.
- **`_keys_for_body(body_id, columns) -> (top_keys, base_keys)`:** sets of `ContactKey(upper, lower)`. A body's competitors-above = the distinct `upper` of its top keys (excluding `""` = ground).
- **`compute_tin(list[ContactPoint3D]) -> tin`** with `tin.vertices` (`list[(x,y,z)]`) and `tin.triangles` (`list[(i,j,k)]`). Triangulation is a function of (x,y) only. `ContactPoint3D(contact_id, x_m, y_m, elevation_m)` in `value_objects/contact_point_3d.py`.
- **`LithoBodyMesh(body_id, formation_id, vertices, triangles, is_flagged)`** — the unchanged output value object.
- **Discipline:** TDD (red→green→commit per step); pure modules (no I/O, no logging — the orchestrator `build_body_solids` logs); numpy docstrings on every public function (DoD); ruff clean before each commit (`uv run ruff check <files>` + the PostToolUse hook auto-formats); `--no-verify` only if the sole pre-existing flake is `test_import_progress` (confirm node ids). Branch: continue on `feat-litho-3d-m3-watertight` (this stacks on Tasks 1–9).
- **Scope note (v1):** a competitor's mesh is the union of its region-prisms over every shared body it competes on. v1 assumes a competitor is fully supported by the shared bodies it competes on (its base/top contact IS those shared bodies) — true for the real 3-way case (CLAY/SILT/PEAT each sit on the 52-hole SAND). A competitor that also extends over a non-shared body (compound) gets its shared-body part in v1; the remainder is a flagged follow-up (spec §7).

---

## File structure

- **Create** `src/groundmodel/domain/services/litho_facies_partition.py` — pure: `FaciesPartition` dataclass, `competitor_labels_above/below`, `circumcenter`, `subdivide_triangle`, `partition_footprint`.
- **Modify** `src/groundmodel/domain/services/litho_body_assembly.py` — add `build_prism` (closed prism over plan triangles + two surface fields) and `assemble_facies_competitors`.
- **Modify** `src/groundmodel/domain/services/litho_solid_builder.py` — route multi-patch bodies through the facies path; accumulate per competitor `body_id`.
- **Create** `tests/unit/domain/test_litho_facies_partition.py`
- **Modify** `tests/unit/domain/test_litho_body_assembly.py`, `tests/unit/domain/test_litho_solid_builder.py`, `tests/benchmarks/bench_litho_solid_builder.py`
- **Create** `desktop/tests/e2e/specs/flow_litho_facies.spec.ts` (Task 9)

Tests reuse the shared mesh helpers in `tests/unit/domain/mesh_test_helpers.py` (`make_pick`, `is_closed_manifold`, `is_consistently_wound`, `ray_hits`, `inside`).

---

### Task 1: Label a shared body's footprint by competitor

**Files:**
- Create: `src/groundmodel/domain/services/litho_facies_partition.py`
- Test: `tests/unit/domain/test_litho_facies_partition.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/domain/test_litho_facies_partition.py
"""Unit tests for the litho facies-partition (no DB, no I/O)."""

from __future__ import annotations

from groundmodel.domain.services.litho_contact_surfaces import build_columns
from groundmodel.domain.services.litho_facies_partition import (
    competitor_labels_above,
    competitor_labels_below,
)
from tests.unit.domain.mesh_test_helpers import make_pick as _pick


def test_labels_above_are_the_body_directly_over_the_shared_body():
    """Each shared-body hole is labelled by the body directly above it there."""
    # B = CLAY everywhere; SAND above CLAY on A,B; PEAT above CLAY on C,D.
    coords = {"A": (0, 0), "B": (0, 10), "C": (10, 0), "D": (10, 10)}
    picks = []
    for inv, (x, y) in coords.items():
        upper = "SAND" if inv in ("A", "B") else "PEAT"
        ub = 4.0 if upper == "SAND" else 3.0
        picks.append(_pick(inv, x, y, upper, 0.0, ub))
        picks.append(_pick(inv, x, y, "CLAY", ub, 14.0))
    columns, _ = build_columns(picks)
    labels = competitor_labels_above("CLAY", columns)
    assert labels == {"A": "SAND", "B": "SAND", "C": "PEAT", "D": "PEAT"}
    # below CLAY there is nothing -> empty labels
    assert competitor_labels_below("CLAY", columns) == {}
```

- [ ] **Step 2: Run it, verify it fails**

Run: `uv run pytest tests/unit/domain/test_litho_facies_partition.py -v`
Expected: FAIL — `ImportError: cannot import name 'competitor_labels_above'`.

- [ ] **Step 3: Implement**

```python
# src/groundmodel/domain/services/litho_facies_partition.py
"""Partition a shared body's footprint among the units competing above/below it.

Where different bodies occupy the space directly above (or below) one shared body
in different lateral regions, they must be divided by a facies boundary or they
overlap. This module labels the shared body's footprint by the competitor at each
hole and subdivides the footprint triangulation at midpoint (2-way) / circumcenter
(3-way Voronoi) boundaries into a shared-vertex planar partition. Pure: no I/O.
"""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.domain.services.litho_contact_surfaces import LayerSpan


def competitor_labels_above(
    body_id: str, columns: dict[str, list[LayerSpan]]
) -> dict[str, str]:
    """Label each shared-body hole by the body directly ABOVE it there.

    Parameters
    ----------
    body_id : str
        The shared body.
    columns : dict[str, list[LayerSpan]]
        Per-investigation spans, shallowest-first.

    Returns
    -------
    dict[str, str]
        ``inv_id -> upper_body_id`` for every hole where ``body_id`` has a body
        directly above it. Holes where it reaches the surface (nothing above) are
        omitted (no competitor there).
    """
    out: dict[str, str] = {}
    for inv, spans in columns.items():
        for i, s in enumerate(spans):
            if s.body_id == body_id and i > 0:
                out[inv] = spans[i - 1].body_id
    return out


def competitor_labels_below(
    body_id: str, columns: dict[str, list[LayerSpan]]
) -> dict[str, str]:
    """Label each shared-body hole by the body directly BELOW it there.

    Mirror of :func:`competitor_labels_above`; omits holes where the body is the
    deepest (nothing below).

    Parameters
    ----------
    body_id : str
        The shared body.
    columns : dict[str, list[LayerSpan]]
        Per-investigation spans, shallowest-first.

    Returns
    -------
    dict[str, str]
        ``inv_id -> lower_body_id``.
    """
    out: dict[str, str] = {}
    for inv, spans in columns.items():
        for i, s in enumerate(spans):
            if s.body_id == body_id and i + 1 < len(spans):
                out[inv] = spans[i + 1].body_id
    return out
```

- [ ] **Step 4: Run it, verify PASS**

Run: `uv run pytest tests/unit/domain/test_litho_facies_partition.py -v`

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/litho_facies_partition.py tests/unit/domain/test_litho_facies_partition.py
git commit -m "feat(litho-3d): label shared-body footprint by competitor (facies)"
```

---

### Task 2: Circumcenter with obtuse-triangle clamp (the Voronoi junction point)

**Files:**
- Modify: `src/groundmodel/domain/services/litho_facies_partition.py` (append)
- Test: `tests/unit/domain/test_litho_facies_partition.py` (append)

- [ ] **Step 1: Write the failing test**

```python
def test_circumcenter_is_equidistant_and_clamps_when_obtuse():
    """Acute triangle -> true circumcenter (equidistant); obtuse -> clamped inside."""
    import math
    from groundmodel.domain.services.litho_facies_partition import circumcenter

    a, b, c = (0.0, 0.0), (4.0, 0.0), (0.0, 4.0)
    cx, cy = circumcenter(a, b, c)
    assert abs(math.dist((cx, cy), a) - math.dist((cx, cy), b)) < 1e-9
    assert abs(math.dist((cx, cy), a) - math.dist((cx, cy), c)) < 1e-9  # equidistant

    # Strongly obtuse: true circumcenter is far outside; clamp keeps it inside.
    a, b, c = (0.0, 0.0), (10.0, 0.0), (5.0, 0.3)
    px, py = circumcenter(a, b, c)
    det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / det
    l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / det
    l3 = 1 - l1 - l2
    assert min(l1, l2, l3) >= -1e-9 and max(l1, l2, l3) <= 1 + 1e-9
```

- [ ] **Step 2: Run it, verify it fails** (`ImportError: circumcenter`).

- [ ] **Step 3: Implement (append)**

```python
def circumcenter(
    a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]
) -> tuple[float, float]:
    """Return the triangle's circumcenter, clamped inside if it falls outside.

    The circumcenter is equidistant from all three vertices — the true Voronoi
    point — so the three perpendicular bisectors (each crossing its edge at the
    midpoint) meet there, consistent with the 2-way midpoint rule. For an obtuse
    triangle the circumcenter lies outside; we clamp it to the triangle via
    barycentric coordinates so the partition stays inside and non-overlapping.

    Parameters
    ----------
    a, b, c : tuple[float, float]
        Triangle vertices ``(x, y)``.

    Returns
    -------
    tuple[float, float]
        The (possibly clamped) junction point.
    """
    ax, ay = a
    bx, by = b
    cx, cy = c
    d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-12:  # degenerate / collinear -> centroid fallback
        return ((ax + bx + cx) / 3.0, (ay + by + cy) / 3.0)
    a2 = ax * ax + ay * ay
    b2 = bx * bx + by * by
    c2 = cx * cx + cy * cy
    ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
    uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
    det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    l1 = ((by - cy) * (ux - cx) + (cx - bx) * (uy - cy)) / det
    l2 = ((cy - ay) * (ux - cx) + (ax - cx) * (uy - cy)) / det
    l3 = 1.0 - l1 - l2
    if min(l1, l2, l3) >= 0.0:
        return (ux, uy)
    l1, l2, l3 = (max(0.0, l1), max(0.0, l2), max(0.0, l3))
    s = l1 + l2 + l3
    l1, l2, l3 = l1 / s, l2 / s, l3 / s
    return (l1 * ax + l2 * bx + l3 * cx, l1 * ay + l2 * by + l3 * cy)
```

- [ ] **Step 4: Run it, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/litho_facies_partition.py tests/unit/domain/test_litho_facies_partition.py
git commit -m "feat(litho-3d): circumcenter Voronoi junction with obtuse clamp (facies)"
```

---

### Task 3: Subdivide one triangle by its vertex labels (shared-vertex pool)

**Files:**
- Modify: `src/groundmodel/domain/services/litho_facies_partition.py` (append)
- Test: `tests/unit/domain/test_litho_facies_partition.py` (append)

A `_PartitionAccumulator` owns the shared 2D vertex pool, dedupes edge midpoints (so adjacent triangles share them → walls coincide), and collects per-label sub-triangles.

- [ ] **Step 1: Write the failing test**

```python
def test_subdivide_two_label_and_three_label():
    """A 2-label triangle splits into the two cells; a 3-label into three at the junction."""
    from groundmodel.domain.services.litho_facies_partition import _PartitionAccumulator

    acc = _PartitionAccumulator([(0.0, 0.0), (10.0, 0.0), (0.0, 10.0)])
    acc.subdivide((0, 1, 2), ("SAND", "SAND", "PEAT"))  # v2 odd
    assert set(acc.regions) == {"SAND", "PEAT"}
    peat_pts = {p for t in acc.regions["PEAT"] for p in t}
    assert 2 in peat_pts and 0 not in peat_pts

    acc2 = _PartitionAccumulator([(0.0, 0.0), (10.0, 0.0), (5.0, 9.0)])
    acc2.subdivide((0, 1, 2), ("CLAY", "SILT", "PEAT"))
    assert set(acc2.regions) == {"CLAY", "SILT", "PEAT"}
    junction = len(acc2.vertices) - 1  # circumcenter is the last-added vertex
    assert all(any(junction in t for t in acc2.regions[k]) for k in ("CLAY", "SILT", "PEAT"))
```

- [ ] **Step 2: Run it, verify it fails** (`ImportError: _PartitionAccumulator`).

- [ ] **Step 3: Implement (append)**

```python
class _PartitionAccumulator:
    """Build the shared-vertex planar partition triangle by triangle.

    Owns the 2D vertex pool (holes first, then midpoints + junctions), dedupes
    edge midpoints by their undirected edge so adjacent triangles reference the
    SAME midpoint (walls coincide), and groups sub-triangles by competitor label.

    Parameters
    ----------
    hole_coords : list[tuple[float, float]]
        The footprint hole coordinates; become vertices ``0 .. len-1``.
    """

    def __init__(self, hole_coords: list[tuple[float, float]]) -> None:
        self.vertices: list[tuple[float, float]] = list(hole_coords)
        self._mid: dict[frozenset[int], int] = {}
        self.regions: dict[str, list[tuple[int, int, int]]] = {}

    def _add(self, p: tuple[float, float]) -> int:
        self.vertices.append(p)
        return len(self.vertices) - 1

    def _midpoint(self, i: int, j: int) -> int:
        key = frozenset((i, j))
        idx = self._mid.get(key)
        if idx is None:
            xi, yi = self.vertices[i]
            xj, yj = self.vertices[j]
            idx = self._add(((xi + xj) / 2.0, (yi + yj) / 2.0))
            self._mid[key] = idx
        return idx

    def _emit(self, label: str, tri: tuple[int, int, int]) -> None:
        self.regions.setdefault(label, []).append(tri)

    def subdivide(self, tri: tuple[int, int, int], labels: tuple[str, str, str]) -> None:
        """Subdivide one footprint triangle by its three vertex labels.

        all-equal -> whole triangle to that label; one-odd -> two cells split at
        the two midpoints of the differing edges; all-distinct -> three cells
        meeting at the circumcenter junction (Voronoi).
        """
        i, j, k = tri
        la, lb, lc = labels
        if la == lb == lc:
            self._emit(la, (i, j, k))
            return
        if len({la, lb, lc}) == 2:
            # rotate so the odd vertex is `k`
            if la == lc:  # b is odd
                i, j, k, la, lb, lc = i, k, j, la, lc, lb
            elif lb == lc:  # a is odd
                i, j, k, la, lb, lc = j, k, i, lb, lc, la
            m_ik = self._midpoint(i, k)
            m_jk = self._midpoint(j, k)
            self._emit(lc, (k, m_jk, m_ik))  # odd vertex's cell
            self._emit(la, (i, j, m_jk))  # pair cell (2 tris)
            self._emit(la, (i, m_jk, m_ik))
            return
        # three distinct -> circumcenter junction
        j_idx = self._add(circumcenter(self.vertices[i], self.vertices[j], self.vertices[k]))
        m_ij = self._midpoint(i, j)
        m_jk = self._midpoint(j, k)
        m_ki = self._midpoint(k, i)
        self._emit(la, (i, m_ij, j_idx))  # vertex i Voronoi quad (2 tris)
        self._emit(la, (i, j_idx, m_ki))
        self._emit(lb, (j, m_jk, j_idx))
        self._emit(lb, (j, j_idx, m_ij))
        self._emit(lc, (k, m_ki, j_idx))
        self._emit(lc, (k, j_idx, m_jk))
```

- [ ] **Step 4: Run it, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/litho_facies_partition.py tests/unit/domain/test_litho_facies_partition.py
git commit -m "feat(litho-3d): subdivide mixed triangle into competitor cells (facies)"
```

---

### Task 4: Partition a whole footprint (triangulate + subdivide all triangles)

**Files:**
- Modify: `src/groundmodel/domain/services/litho_facies_partition.py` (append)
- Test: `tests/unit/domain/test_litho_facies_partition.py` (append)

- [ ] **Step 1: Write the failing test**

```python
def test_partition_footprint_covers_all_competitors_with_shared_pool():
    """The footprint partitions into one region per competitor over a shared vertex pool."""
    from groundmodel.domain.services.litho_facies_partition import partition_footprint

    coords = {"A": (0, 0), "B": (0, 10), "C": (10, 0), "D": (10, 10), "E": (5, 5)}
    labels = {"A": "SAND", "B": "SAND", "C": "PEAT", "D": "PEAT", "E": "CLAY"}
    part = partition_footprint(coords, labels)
    assert set(part.regions) == {"SAND", "PEAT", "CLAY"}
    n = len(part.vertices)
    for tris in part.regions.values():
        for t in tris:
            assert all(0 <= v < n for v in t)
    assert set(part.hole_vertex) == set(coords)
```

- [ ] **Step 2: Run it, verify it fails** (`ImportError: partition_footprint`).

- [ ] **Step 3: Implement (append)**

```python
from groundmodel.domain.services.tin_surface import compute_tin
from groundmodel.domain.value_objects.contact_point_3d import ContactPoint3D


@dataclass(frozen=True)
class FaciesPartition:
    """A planar partition of a shared body's footprint among its competitors.

    Parameters
    ----------
    vertices : list[tuple[float, float]]
        Shared 2D vertex pool (holes first, then midpoints + junctions).
    regions : dict[str, list[tuple[int, int, int]]]
        ``competitor_body_id -> plan triangles`` (indices into ``vertices``).
    hole_vertex : dict[str, int]
        ``inv_id -> vertex index`` for each footprint hole (for surface lookup).
    """

    vertices: list[tuple[float, float]]
    regions: dict[str, list[tuple[int, int, int]]]
    hole_vertex: dict[str, int]


def partition_footprint(
    coords: dict[str, tuple[float, float]], labels: dict[str, str]
) -> FaciesPartition:
    """Partition the labelled footprint among competitors at midpoint/Voronoi lines.

    Triangulates the labelled holes (via :func:`compute_tin`), then subdivides each
    triangle by its vertices' labels into a shared-vertex partition.

    Parameters
    ----------
    coords : dict[str, tuple[float, float]]
        ``inv_id -> (x, y)`` for the shared body's footprint.
    labels : dict[str, str]
        ``inv_id -> competitor_body_id`` (from ``competitor_labels_above/below``).

    Returns
    -------
    FaciesPartition
        The partition; empty ``regions`` if fewer than 3 labelled holes.
    """
    holes = sorted(labels)  # deterministic order
    if len(holes) < 3:
        return FaciesPartition([], {}, {})
    hole_coords = [coords[h] for h in holes]
    tin = compute_tin(
        [ContactPoint3D(contact_id=h, x_m=coords[h][0], y_m=coords[h][1], elevation_m=0.0) for h in holes]
    )
    acc = _PartitionAccumulator(hole_coords)
    for a, b, c in tin.triangles:
        acc.subdivide((a, b, c), (labels[holes[a]], labels[holes[b]], labels[holes[c]]))
    hole_vertex = {h: i for i, h in enumerate(holes)}
    return FaciesPartition(acc.vertices, acc.regions, hole_vertex)
```

> Implementer note: confirm `compute_tin(points).vertices` is in the SAME order as the input (so triangle index `a` ↔ `holes[a]`). Quick check: build a TIN of 4 known points and assert `tin.vertices[i]` ≈ input `i`. If `compute_tin`'s alpha-trim drops vertices, the dropped holes fall outside the body footprint (acceptable) — but verify the index mapping holds for the kept ones; if not, match `tin.vertices` to `hole_coords` by rounded coordinate and remap the triangle indices before subdividing.

- [ ] **Step 4: Run it, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/litho_facies_partition.py tests/unit/domain/test_litho_facies_partition.py
git commit -m "feat(litho-3d): partition a footprint among competitors (facies)"
```

---

### Task 5: Build a closed prism over plan triangles between two surfaces

**Files:**
- Modify: `src/groundmodel/domain/services/litho_body_assembly.py` (append)
- Test: `tests/unit/domain/test_litho_body_assembly.py` (append)

`build_prism` is the spike's prism builder generalised: top/base elevations come from two surface fields (per-vertex), winding normalised to CCW, walls on region boundary edges.

- [ ] **Step 1: Write the failing test**

```python
def test_build_prism_is_watertight_over_a_region():
    """A region of plan triangles closes into a watertight prism between two fields."""
    from groundmodel.domain.services.litho_body_assembly import build_prism
    verts2d = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]
    tris = [(0, 1, 2), (0, 2, 3)]
    top = {i: -2.0 for i in range(4)}
    base = {i: -6.0 for i in range(4)}
    mesh = build_prism("X", "f", verts2d, tris, top, base)
    assert closed_manifold(mesh.triangles) and consistently_wound(mesh.triangles)
    assert inside(mesh.vertices, mesh.triangles, (5.0, 5.0, -4.0))
    assert not inside(mesh.vertices, mesh.triangles, (5.0, 5.0, 0.0))
```

- [ ] **Step 2: Run it, verify it fails** (`ImportError: build_prism`).

- [ ] **Step 3: Implement (append to `litho_body_assembly.py`)**

```python
def build_prism(
    body_id: str,
    formation_id: str,
    vertices_2d: list[tuple[float, float]],
    region_tris: list[tuple[int, int, int]],
    top_elev: dict[int, float],
    base_elev: dict[int, float],
) -> LithoBodyMesh:
    """Close a prism over a set of plan triangles between a top and base field.

    Each used 2D vertex gets a top vertex (at ``top_elev``) and a base vertex (at
    ``base_elev``). Triangles are wound CCW for an upward top normal; walls go on
    boundary edges (edges in exactly one region triangle), so a wall shared with an
    adjacent region (same boundary vertices) coincides. Degenerate (zero-area)
    triangles are skipped.

    Parameters
    ----------
    body_id, formation_id : str
        Identity / colour.
    vertices_2d : list[tuple[float, float]]
        Shared 2D vertex pool.
    region_tris : list[tuple[int, int, int]]
        This competitor's plan triangles (indices into ``vertices_2d``).
    top_elev, base_elev : dict[int, float]
        Elevation of each used 2D vertex on the top / base surface.

    Returns
    -------
    LithoBodyMesh
        Closed prism (``is_flagged=False``); empty (``is_flagged=True``) if no
        non-degenerate triangle.
    """
    from collections import Counter

    used = sorted({p for t in region_tris for p in t})
    top_i = {p: 2 * n for n, p in enumerate(used)}
    base_i = {p: 2 * n + 1 for n, p in enumerate(used)}
    verts: list[tuple[float, float, float]] = []
    for p in used:
        x, y = vertices_2d[p]
        verts.append((x, y, top_elev[p]))
        verts.append((x, y, base_elev[p]))

    def ccw(a: int, b: int, c: int) -> tuple[int, int, int]:
        ax, ay = vertices_2d[a]
        bx, by = vertices_2d[b]
        cx, cy = vertices_2d[c]
        area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
        return (a, b, c) if area > 0 else (a, c, b)

    tris: list[tuple[int, int, int]] = []
    dec: Counter = Counter()
    for raw in region_tris:
        ax, ay = vertices_2d[raw[0]]
        bx, by = vertices_2d[raw[1]]
        cx, cy = vertices_2d[raw[2]]
        if abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) < 1e-9:
            continue  # degenerate
        a, b, c = ccw(*raw)
        tris.append((top_i[a], top_i[b], top_i[c]))  # top face up
        tris.append((base_i[c], base_i[b], base_i[a]))  # base face down
        for u, v in ((a, b), (b, c), (c, a)):
            dec[(u, v)] += 1
    for (u, v), n in dec.items():
        if n == 1 and dec[(v, u)] == 0:  # boundary edge
            tris.append((top_i[v], top_i[u], base_i[u]))
            tris.append((top_i[v], base_i[u], base_i[v]))
    return LithoBodyMesh(
        body_id=body_id,
        formation_id=formation_id,
        vertices=verts,
        triangles=tris,
        is_flagged=not tris,
    )
```

- [ ] **Step 4: Run it, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/litho_body_assembly.py tests/unit/domain/test_litho_body_assembly.py
git commit -m "feat(litho-3d): build closed prism over plan-triangle region (facies)"
```

---

### Task 6: Assemble facies competitors for one shared body

**Files:**
- Modify: `src/groundmodel/domain/services/litho_body_assembly.py` (append)
- Test: `tests/unit/domain/test_litho_body_assembly.py` (append)

`assemble_facies_competitors` ties Tasks 1–5 together for one shared body B and one side (`"above"` or `"below"`): label → partition → evaluate the two continuous surfaces at each partition vertex → build one prism per competitor. Returns `{competitor_body_id: LithoBodyMesh}`. The continuous floor = B's contact toward the competitors; the continuous top `S_upper` = the competitors' tops; both are TINs over B's holes **sampled at every partition vertex** (holes exact, midpoints/junctions interpolated) so tops meet.

- [ ] **Step 1: Write the failing test (the 3-way watertight gate — the spike as a real test)**

```python
def test_facies_competitors_3way_tile_watertight():
    """CLAY/SILT/PEAT competing above a SAND tile watertight, no overlap, tops meet."""
    from groundmodel.domain.services.litho_contact_surfaces import (
        build_columns, enumerate_contacts, fit_patch_surfaces,
    )
    from groundmodel.domain.services.litho_body_assembly import assemble_facies_competitors
    ring = [("A", 0, 0, "CLAY"), ("B", 6, 1, "CLAY"), ("C", 10, 6, "SILT"),
            ("D", 7, 11, "SILT"), ("E", 1, 10, "PEAT"), ("F", -3, 5, "PEAT")]
    picks = []
    for inv, x, y, up in ring:
        picks.append(_pick(inv, x, y, up, 0.0, 2.0))       # competitor above
        picks.append(_pick(inv, x, y, "SAND", 2.0, 9.0))   # shared SAND below
    columns, coords = build_columns(picks)
    surfaces = fit_patch_surfaces(enumerate_contacts(columns, coords))
    comps = assemble_facies_competitors("SAND", "above", columns, coords, surfaces)
    assert set(comps) == {"CLAY", "SILT", "PEAT"}
    meshes = list(comps.values())
    for m in meshes:
        assert closed_manifold(m.triangles) and consistently_wound(m.triangles)
    for x in (0, 3, 5, 7):
        for y in (2, 5, 8):
            hits = [m.body_id for m in meshes if inside(m.vertices, m.triangles, (float(x), float(y), -3.0))]
            assert len(hits) <= 1, (x, y, hits)
```

- [ ] **Step 2: Run it, verify it fails** (`ImportError: assemble_facies_competitors`).

- [ ] **Step 3: Implement.**

Algorithm (write it; the test above is the contract):
1. `labels = competitor_labels_above(B, columns)` for `side == "above"`, else `competitor_labels_below`.
2. `part = partition_footprint(coords, labels)`; if `not part.regions` → return `{}`.
3. Build two continuous surfaces over B's footprint holes as TINs (`compute_tin`):
   - `floor` = B's contact toward the competitors: *above* → B's TOP elevation at each hole (B's `LayerSpan.top_elev`); *below* → B's base.
   - `S_upper` = the competitor span's far edge at each hole: *above* → the top elevation of the span directly above B; *below* → the base elevation of the span directly below B.
4. Sample `floor` and `S_upper` at every `part.vertices` via a private `_sample_tin(tin, x, y)` (barycentric; for a vertex outside the hull, use the nearest hole's value). Build `top_elev = {idx: S_upper(v)}` and `base_elev = {idx: floor(v)}` over all partition-vertex indices.
5. For each `comp, tris` in `part.regions`: `build_prism(comp, _formation_of(comp, columns), part.vertices, tris, top_elev, base_elev)`; keep non-empty meshes.

Add private helpers `_sample_tin(tin, x, y) -> float` (barycentric interpolation, nearest-hole fallback) and `_formation_of(body_id, columns) -> str` (first span with that body_id). Keep the module pure. The 3-way test is the gate; **if it can't be made watertight, STOP and report — do not weaken the assertion.**

- [ ] **Step 4: Run it, verify PASS;** add a 2-way test and a `"below"` test mirroring the above.

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/litho_body_assembly.py tests/unit/domain/test_litho_body_assembly.py
git commit -m "feat(litho-3d): assemble facies competitors for a shared body (3-way watertight)"
```

---

### Task 7: Route multi-patch bodies through the facies path

**Files:**
- Modify: `src/groundmodel/domain/services/litho_solid_builder.py`
- Test: `tests/unit/domain/test_litho_solid_builder.py` (append)

A body B is a *shared* facies body when it has ≥2 distinct competitors above and/or below. For each such B: B builds normally (continuous); its competitors' region-prisms come from `assemble_facies_competitors` and are **accumulated per competitor `body_id`** (a competitor may compete over several shared bodies → concatenate). A competitor that received facies prisms uses the accumulated mesh INSTEAD of its normal build.

- [ ] **Step 1: Write the failing test**

```python
def test_build_body_solids_facies_competitors_dont_overlap():
    """A multi-patch SAND with CLAY/SILT/PEAT above builds competitors that don't overlap."""
    ring = [("A", 0, 0, "CLAY"), ("B", 6, 1, "CLAY"), ("C", 10, 6, "SILT"),
            ("D", 7, 11, "SILT"), ("E", 1, 10, "PEAT"), ("F", -3, 5, "PEAT")]
    picks = []
    for inv, x, y, up in ring:
        picks.append(BodyLayerPick(investigation_id=inv, x_m=x, y_m=y, surface_elev_m=0.0,
                                   body_id=up, formation_id=up, top_depth_m=0.0, base_depth_m=2.0))
        picks.append(BodyLayerPick(investigation_id=inv, x_m=x, y_m=y, surface_elev_m=0.0,
                                   body_id="SAND", formation_id="SAND", top_depth_m=2.0, base_depth_m=9.0))
    meshes = {m.body_id: m for m in build_body_solids(picks)}
    assert {"SAND", "CLAY", "SILT", "PEAT"} <= set(meshes)
    comps = [meshes[b] for b in ("CLAY", "SILT", "PEAT")]
    for x in (0, 3, 5, 7):
        for y in (2, 5, 8):
            hits = [m.body_id for m in comps if _inside(m.vertices, m.triangles, (float(x), float(y), -1.0))]
            assert len(hits) <= 1, (x, y, hits)
    assert _is_closed_manifold(meshes["SAND"].triangles)  # SAND continuous underneath
```

- [ ] **Step 2: Run it, verify it fails or overlaps** (multi-patch competitors currently go to `_legacy_body`).

- [ ] **Step 3: Implement.** In `build_body_solids`, after `surfaces`/lens handling, add a facies pass:

Algorithm:
1. For each body B: `top_keys, base_keys = _keys_for_body(B, columns)`; `ups = {k.upper_body for k in top_keys if k.upper_body}`; `downs = {k.lower_body for k in base_keys if k.lower_body}`. B is facies-shared-above if `len(ups) >= 2`, -below if `len(downs) >= 2`.
2. `facies_meshes: dict[str, list[LithoBodyMesh]] = {}`.
3. For each shared B + side: `for comp, mesh in assemble_facies_competitors(B, side, columns, coords, surfaces).items(): facies_meshes.setdefault(comp, []).append(mesh)`.
4. In the per-body emit loop, BEFORE the existing lens/single-patch/legacy branches: `if body_id in facies_meshes: meshes.append(_concat_meshes(body_id, formation_id, facies_meshes[body_id])); path = "facies"; continue`. A shared body B that is NOT itself a competitor still builds normally. (A body can be both a shared body AND a competitor elsewhere — if it appears in `facies_meshes`, the facies mesh wins; flag in the dogfeed if that ever loses a shared-body's own continuous volume — not expected for the real data.)
5. Add `_concat_meshes(body_id, formation_id, parts) -> LithoBodyMesh`: offset-and-concatenate vertices/triangles; `is_flagged = all(p.is_flagged for p in parts)`. Add the per-body debug log path `"facies"`.

- [ ] **Step 4: Run it, verify PASS;** confirm all existing builder tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/litho_solid_builder.py tests/unit/domain/test_litho_solid_builder.py
git commit -m "feat(litho-3d): route multi-patch bodies through facies partition"
```

---

### Task 8: Invariants — section-midpoint, above+below, no-overlap, bench

**Files:**
- Modify: `tests/unit/domain/test_litho_facies_partition.py`, `tests/unit/domain/test_litho_body_assembly.py`, `tests/unit/domain/test_litho_solid_builder.py`, `tests/benchmarks/bench_litho_solid_builder.py`

Each sub-step is its own red→green→commit; use the shared mesh helpers; follow the Task 6–7 code patterns.

- [ ] **Step 1: Section-midpoint test** (`test_litho_facies_partition.py`). Build a 2-competitor footprint where two adjacent holes (`SAND` at `(0,0)`, `PEAT` at `(10,0)`) share a triangle edge; `partition_footprint`; find the midpoint vertex of that edge and assert it is at `x == 5.0` (= the 2D `meetFraction = 0.5`). Commit.

- [ ] **Step 2: Above-and-below fixture** (`test_litho_body_assembly.py`). A shared body with CLAY/SILT above AND a ZAND/VEEN competition below; assert both sides build watertight and no point is inside two bodies. Commit.

- [ ] **Step 3: No-overlap invariant on a multi-patch model** (`test_litho_solid_builder.py`). Two shared bodies stacked, each with a 2–3-way competition; sample a 3D grid; assert every point inside ≤1 body. Commit.

- [ ] **Step 4: Bench.** Add `_synthetic_picks_with_facies` + `test_bench_build_body_solids_with_facies` to `bench_litho_solid_builder.py` (a fraction of bodies multi-patch with 2–3 competitors); assert competitors aren't flagged; `uv run pytest tests/benchmarks/bench_litho_solid_builder.py --benchmark-enable -v`; record the time in `CLAUDE.local.md` if it shifts materially. Commit.

---

### Task 9: e2e — `flow_litho_facies`

**Files:**
- Create: `desktop/tests/e2e/specs/flow_litho_facies.spec.ts`
- Possibly modify: `desktop/tests/e2e/fixtures/build_synthetic_fixture.py`

- [ ] **Step 1:** Read `desktop/tests/e2e/fixtures/build_synthetic_fixture.py` and `desktop/tests/e2e/specs/flow_litho_solids.spec.ts`. Ensure the synthetic litho model contains a body with ≥2 competitors above it (mirror the ring fixture); extend the fixture only if needed.

- [ ] **Step 2:** Write `flow_litho_facies.spec.ts` following `flow_litho_solids.spec.ts`'s harness exactly: launch app, open the seeded project, open the litho 3D pane, click **Build solids**, switch to **Solid** view, assert the 3D pane mounts and the competing-unit bodies render (legend shows the competitor lithologies; no error toast).

- [ ] **Step 3:** Run `./scripts/run-e2e.ps1 flow_litho_facies` (close the dev app first — it shares :8765). Green.

- [ ] **Step 4:** Commit.

---

### Task 10 (gate, not code): owner dogfeed

Owner Builds `test.strix`: competing-unit hairlines gone; the 52-hole 3-way SAND case renders as CLAY/SILT/PEAT regions meeting at a junction; no new holes. Re-run the read-only path-classifier diagnostic and confirm the multi-patch bodies build via the facies path, not `_legacy_body`. Record the outcome in `memory/project_litho_3d_model.md` + `CLAUDE.md`.

---

## Notes on ordering & shippability
- Tasks 1–5 are pure geometry, independently testable. Task 6 is the watertight gate (the spike as a real test). Task 7 integrates. 8–9 lock invariants + e2e. After Task 9 the dominant real-data case is handled; Task 10 is the dogfeed.
- **Compound competitors** (a competitor that also extends over a non-shared body) get their shared-body part in v1 (concatenated prisms); true single-2-manifold-per-body merging of abutting components is deferred (spec §7). Flag in the dogfeed if a visible seam remains at a competitor's far edge.
- No schema / API / bundle / Cesium change; `LithoBodyMesh` contract unchanged.

## Self-review (done)
- **Spec coverage:** §3a labels → Task 1; §3c midpoint/circumcenter → Tasks 2–4; §3b continuous surfaces + §3d clipped prisms + one-mesh-per-body → Tasks 5–7; §2 success (watertight, no-overlap, tops meet, section==midpoint, per-body mesh) → Tasks 6–8; §6 tests incl. e2e → Tasks 8–9; §7 risks (compound, obtuse) → Task 2 (obtuse) + notes (compound).
- **Placeholder scan:** none; Tasks 6–8 give algorithm + complete gating tests for the integration (the novel geometry is test-driven, as the spec intends).
- **Type consistency:** `FaciesPartition` / `_PartitionAccumulator` / `competitor_labels_above` / `partition_footprint` / `circumcenter` / `build_prism` / `assemble_facies_competitors` / `_concat_meshes` names consistent across tasks; `LithoBodyMesh` / `BodyLayerPick` / `build_columns` / `_keys_for_body` reused unchanged.
