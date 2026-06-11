# Litho-3D facies partition — watertight competing bodies (M3 Task 10, redesigned)

**Status:** design approved (browser brainstorm + two spikes, 2026-06-11). Ready for an
implementation plan.
**Supersedes:** the "multi-patch conforming stitch" sketch in
`docs/superpowers/specs/2026-06-10-litho-3d-m3-watertight-bodies-design.md` §7/Task 10 — a
spike proved that sketch (global TIN + collapse) overlaps; this is the replacement.
**Branch:** off `develop` (after the M3 Tasks 1–9 branch `feat-litho-3d-m3-watertight` merges,
or stacked on it).

---

## 0. In plain words

M3 Tasks 1–9 made 3D bodies watertight for *single-patch* stacks and *enclosed lenses* — but a
diagnostic of the real `test.strix` model showed those cover only **8%** of its 102 bodies.
The dominant case (**65% of solid bodies**) is **multi-patch facies**: a shared body (e.g. a
SAND across 52 holes) has **different units competing for the space above (or below) it** in
different lateral regions — CLAY here, SILT there, PEAT elsewhere. M3 hands those to the old M2
builder unchanged → the hairlines the owner still sees.

This spec makes the competing bodies tile watertight by **partitioning the shared body's
footprint in plan among the competitors**, with the boundary at the **midpoint** between
differently-occupied holes — the *same rule* the 2D `computeSectionFill` already uses
(`partitionFill.ts:1480`, `meetFraction = 0.5`). So a section-cut of the 3D model reproduces the
validated 2D partition exactly, the construction is **area-native** (no section-lofting, no
frontend→backend plumbing), and needs **no new dependency**.

---

## 1. Problem & evidence

- **Diagnostic (2026-06-11, dev DB):** 102 bodies — `shared` 6, `matrix-void`+`lens` 2,
  `legacy-multipatch` 15, `disk` 79. Of the ~23 *solid* (non-disk) bodies, **15 are multi-patch**.
  Real competition signatures: `SILT ← {CLAY, ZAND}` ×4, `KLEI ← {SILT, ZAND}` ×2,
  `VEEN ← {KLEI, SILT}` ×1, and one **3-way** `ZAND ← {KLEI, SILT, VEEN}` over 52 holes.
  Competition occurs **above** bodies (7×2-way + 1×3-way) **and below** (11×2-way + 1×3-way).
- **Spike A (the naive approach fails):** global shared triangulation + collapse-to-contact makes
  the CLAY contacts perfect (0 gap) but the two upper bodies **overlap up to 165 cm across 70% of
  the transition** — because nothing divides them. A clean partition needs an explicit facies
  boundary.
- **Spike B (the chosen approach works):** with **tops meeting** (owner-confirmed) and floors
  meeting (= the shared body's top), the competitors are a **slab partitioned laterally in plan**.
  A hand-built **3-way junction** (CLAY/SILT/PEAT around a SAND below) tiled **watertight**: every
  body a closed 2-manifold, the spoke walls between competitors **coincided** (0 gap at the triple
  junction), 0/591 sampled points inside two bodies, floors shared the SAND top. The mesh assembly
  is sound; the remaining piece is deriving the plan partition (this spec's core).

---

## 2. Goal & success criteria

For every **multi-patch** body, build the competing bodies as a **watertight, non-overlapping 3D
partition** of the slab between the shared contact and the continuous upper (or lower) surface.

Covered:
1. **2-way** competition above or below a shared body.
2. **3-way** competition (triple junction) — the real-data maximum.
3. Competition **above and below** the same shared body (independently).

Done when:
- Each competing body is a closed 2-manifold; adjacent competitors **share their wall geometry
  exactly** (gap 0); no sampled interior point is inside two bodies.
- **Tops meet** — one continuous upper surface across the facies boundary (no step).
- A vertical section through the 3D model reproduces the 2D `computeSectionFill` seam position
  (midpoint) for that section.
- On real `test.strix`, the hairlines between competing units are gone (owner dogfeed).

Out of scope: >3-way competition (absent from data); stepped tops (owner: tops meet); true
sedimentological interfingering geometry beyond a midpoint boundary (a later, separate concern);
the `disk`-marker fragmentation (77% single-hole bodies — a resolver/correlation matter, not this).

---

## 3. Design — partition the footprint, build clipped prisms

For a shared body **B** with competition above it (symmetric below):

**(a) Label B's footprint by competitor.** Each hole where B exists has exactly one body
**directly above** B there (its `ContactKey(upper, B)` upper). Label each B-hole with that upper
body id. ≥2 distinct labels ⇒ facies competition. (`_keys_for_body` + `build_columns` already
expose this.)

**(b) Continuous surfaces.** Fit **one** floor surface = B's top contact over all B-holes
(continuous), and **one** upper surface `S_upper` = the competitors' tops over all B-holes (each
hole at the elevation of the top of the unit above B there) → continuous, so **tops meet** by
construction.

**(c) Partition the footprint at midpoints.** Triangulate B's footprint holes (reuse
`compute_tin`'s Delaunay). Subdivide each triangle by its vertices' labels:
- all 3 labels equal → the triangle belongs to that competitor;
- 2 distinct (one vertex differs) → split the two differing edges at their **midpoints** and cut
  the triangle into the two competitors' pieces;
- 3 distinct (triple junction) → split each edge at its midpoint and connect the three midpoints to
  the triangle **centroid**, giving three pieces meeting at the junction.

This is **local mixed-triangle subdivision** — no CDT library. The midpoint on every edge matches
the 2D `meetFraction = 0.5`, so a section crossing that edge reproduces the 2D seam.

**(d) Build clipped prisms.** Each competitor's region = the union of its labelled (sub-)triangles.
Build its closed mesh = its region triangles at `S_upper` (top) + at B's floor (base, flipped) +
vertical walls on the region boundary. Walls between adjacent competitors are built on the **same
shared midpoint/junction vertices** → they coincide (spike-proven watertight). The shared body B is
built normally (continuous, full footprint between its top and base).

The same machinery runs for competition **below** B (swap roles: floor = the continuous lower
surface, top = B's base).

---

## 4. Inputs & reuse (no new dependency)

| Need | Reuse |
|---|---|
| Per-hole columns + labels | `build_columns`, `_keys_for_body` (Tasks 1–9) |
| Footprint triangulation | `compute_tin` (SciPy Delaunay) |
| Prism + wall assembly | the spike's prism builder → promote to real code (directed-edge walls, same pattern as `assemble_closed_solid`) |
| Continuous floor/upper surfaces | the contact-patch surfaces from `litho_contact_surfaces` |
| Output mesh | `LithoBodyMesh` — **unchanged** (vertices+triangles) → ORM/API/Cesium untouched |

The midpoint rule is a 2-line constant (`FACIES_MEET_FRACTION = 0.5`) mirroring the 2D
`INTERIOR_PINCH_FRACTION`/`meetFraction`. No `triangle`/CDT dependency; no frontend plumbing.

---

## 5. Components to change

- **Create** `src/groundmodel/domain/services/litho_facies_partition.py` — pure: label footprint by
  competitor; midpoint/centroid mixed-triangle subdivision; emit per-competitor region triangles.
- **Modify** `src/groundmodel/domain/services/litho_body_assembly.py` — add `assemble_facies_competitors(...)`
  that builds the clipped prisms from the partition + the continuous floor/upper surfaces (reusing
  the spike's prism builder).
- **Modify** `src/groundmodel/domain/services/litho_solid_builder.py` — route a multi-patch body's
  competitors through the facies path instead of `_legacy_body`. The shared body B itself builds as
  a normal body. (Disk-marker fallback stays for <3-hole bodies.)
- Tests (see §6). No schema/API/bundle/Cesium change.

---

## 6. Testing strategy

- **Unit (pure, TDD):** port the spikes — a 2-way and a **3-way junction** must be closed
  manifolds, walls coincide, and **no sampled interior point is inside two competitors**; floors
  coincide with the shared body's top; tops meet (one `S_upper`).
- **Section-cut == 2D:** a competitor boundary edge crossed by a section reproduces the **midpoint**
  position (assert the wall sits at 0.5 along the gap).
- **Above *and* below** a single shared body in one fixture.
- **Degenerate guards:** collinear/duplicate holes, a competitor with <3 holes (falls back
  gracefully), a triangle with a tiny area.
- **No-overlap invariant** extended to a multi-patch model (the §6 invariant from Tasks 1–9).
- **Bench:** add a multi-patch case to `bench_litho_solid_builder.py`; stay in the on-click Build
  envelope.
- **Real-data dogfeed (the gate):** owner Builds `test.strix` — the competing-unit hairlines gone,
  the 52-hole 3-way SAND case carved into CLAY/SILT/PEAT regions, no new holes.

---

## 7. Risks & open questions

- **Compound bodies** (multi-patch above AND below) — build the two partitions independently and
  intersect the labellings; confirm watertight where an above-junction sits over a below-junction.
- **Competitor coincidence elsewhere** — `S_upper` over the competition region must coincide with
  each competitor's own body surface where that competitor extends beyond the competition (the
  Tasks 1–9 shared-surface concern). If it doesn't, a seam reappears at the edge of the competition
  region. Validate; may require the competitor's top to *be* `S_upper` over the overlap.
- **Midpoint vs the 2D's correlation-extended footprints** — the 2D extends a unit to where it's
  correlated *before* taking the midpoint. The label in (a) is already the *actual* above-body
  (post-resolver, correlation-aware), so the footprints are correlation-extended for free; confirm
  on real data that the midpoint then matches the 2D seam.
- **Centroid junction vs true Voronoi point** — the centroid is a simple, deterministic triple-
  junction point; if a section-cut through the junction triangle must match the 2D exactly there,
  revisit (sections rarely cross exactly at a junction).

---

## 8. Build order

1. `litho_facies_partition.py`: label + midpoint/centroid subdivision (TDD, pure).
2. `assemble_facies_competitors` + prism builder (TDD: 2-way then 3-way watertight + no-overlap).
3. Route multi-patch bodies in `build_body_solids`; keep the shared body normal + disk fallback.
4. Section-cut-matches-midpoint test; above-and-below fixture; degenerate guards.
5. No-overlap invariant on a multi-patch model; bench.
6. Owner dogfeed on `test.strix`.
