# Litho suggestion handles + lens shaping — design (#163f and follow-ons)

**Date:** 2026-05-28
**Status:** approved for overnight autonomous build (owner delegated; review in the morning)
**Origin:** debt #163(f) "split a suggestion into two for lenses", reframed during the
2026-05-28 brainstorm into two direct-manipulation slices.

## Goal

Make litho lens authoring a direct-manipulation gesture instead of the invisible
sticky-arm correlation gesture. The owner's words: *"put 3 round dots where we can
grab vertically for each suggestion … once a lens is added I need to be able to click
somewhere on the correlation band and drag it … to shape the lens (ghost nodes)."*

Two separable slices:

- **Slice 1 — 3-dot grab handle on a litho suggestion** (frontend-only).
- **Slice 2 — shape a lens with draggable ghost nodes + a boundary render style**
  (straight / blocky / rounded), persisted (backend + frontend).

## What already ships (verified this session — do NOT rebuild)

- The 1→2 correlation gesture (#135): arm a source contact, click two contacts in the
  same target test → two edges. Invisible sticky-arm; no "you're authoring a lens" cue.
- `DetectLithoLenses` keys on exactly that topology and auto-creates `LithoLensOrm`
  rows (`model_id`, `formation_id`, `body_ordinal`). Companion sections auto-materialise.
- Today a detected lens renders as **two flat correlation ribbons**, not a shaped wedge.
  The boundary is not stored; #131-a (lens_id on the edge) is deferred.

So Slice 2 adds the **missing shape persistence + shaped rendering + drag UI**, not the
detection (which works).

## Scope / phase boundary

Both slices are **user-driven, explicit** manipulation → they sit on the Phase-4 side of
the carve-out (like the shipped pinch-out wedge tool), NOT the Phase-5 auto-interfingering
inference. Geology-surface wiring (snap a lens to a geological surface) is explicitly
deferred per owner ("wire the geological features into that maybe later").

---

## Slice 1 — 3-dot suggestion handle

**Surface:** litho **suggestion** ghost bands only (pre-accept), on the litho axis of the
section. Shown only on **hover or selected** (owner: avoid clutter when a section is full
of suggestions). Accepted bands are out of scope for this slice (their contacts are
already individually draggable).

**Affordance:** three solid dots stacked vertically at the band's column centre:

| Dot | Action |
|---|---|
| top | drag the suggestion's **top** boundary only (reuse existing ghost-contact drag + clamp + snap) |
| middle | **rigid move** of the whole layer — both boundaries translate by the same Δ, thickness preserved, clamped so neither boundary crosses a neighbour |
| bottom | drag the **base** boundary only |

- Keyboard: ↑/↓ nudge the selected suggestion (whole-layer move) by a small step; Shift =
  larger step. (Nice-to-have; ship if it lands cleanly, else defer to a debt note.)
- The middle-dot rigid move is the only genuinely new mechanic; top/bottom reuse the
  existing single-boundary ghost drag.

**Components touched (frontend only):** the ghost-suggestion renderer
(`LithoSuggestionGhostColumns` / `ContactsLayer`), a small `SuggestionGrabHandles`
subcomponent (3 dots + drag wiring), hover/selected state in `SectionsCanvas`. No schema,
no backend, no bundle change.

**Tests (Vitest):** dots render only on hover/selected; top dot moves only top boundary;
bottom only base; middle moves both preserving thickness; middle move clamps at a
neighbour; (if shortcuts land) arrow-key nudge. Behaviour-shaped assertions.

---

## Slice 2 — lens shaping with ghost nodes (locked data model)

Design locked with the system-architect. Section-local node polylines owned by the lens.

### Storage

New table **`litho_lens_boundary_node`**:

```
id            uuid PK (uuid7)
lens_id       uuid FK → litho_lens.id  ON DELETE CASCADE  NOT NULL
boundary      TEXT NOT NULL  CHECK (boundary IN ('upper','lower'))
node_index    INTEGER NOT NULL              -- 0-based, sorted by along_m
along_m       DOUBLE PRECISION NOT NULL     -- section-local distance
elevation_m   DOUBLE PRECISION NOT NULL
UNIQUE (lens_id, boundary, node_index)
INDEX (lens_id)
```

New column on **`litho_lens`**: `render_style TEXT NOT NULL DEFAULT 'straight'
CHECK (render_style IN ('straight','blocky','rounded'))`.

Single Alembic migration: table + column. Backwards-compat is suspended pre-ship, so no
upgrade chain — but the `.gmproj` round-trip must still work (below).

**Coordinate space:** section-local `(along_m, elevation_m)` on the lens's
`primary_section_id`. Native space of the section renderer; no 3D round-trip. Nodes render
ONLY on the primary section; companion / other sections fall back to the default straight
boundary (comment this in the render path).

**Survival of shape across lens re-detection:** shape nodes anchor to `litho_lens.id` via
CASCADE. `DetectLithoLenses` REUSES an existing lens row when topology is unchanged
(it inserts only when `existing is None`), so nodes survive normal editing. If
`body_ordinal` shifts (resolver re-run after correlation edits), the lens row is recreated
and the shape is lost — **accepted known limitation → debt #164** (carry-forward by anchor
content-hash is the future fix).

### Lifecycle

- Correlation deleted so the body collapses → `DetectLithoLenses` deletes the lens row →
  CASCADE wipes nodes. Correct.
- Bounding contact dragged → nodes unchanged (they are free-floating intermediates; user
  re-adjusts if desired). No auto-update.
- `ClearLithoModel` → model CASCADE → lens rows → node CASCADE. Clean.
- `primary_section_id` set NULL (section deleted) → treat as "no custom shape; render
  straight"; PUT rejects with 422 `no_primary_section`.

### API (additive; under the existing lens scope)

```
GET   /projects/{pid}/geology/models/{mid}/lenses/{lid}/boundary  → LensBoundaryResponse
PUT   /projects/{pid}/geology/models/{mid}/lenses/{lid}/boundary  (full replace, atomic)
```

`LensBoundaryWriteRequest = { upper_nodes: [{along_m,elevation_m}], lower_nodes: [...],
render_style }`. Server sorts each list by `along_m` and re-indexes 0..N-1. Style folded
into the PUT body (no separate PATCH for the MVP). Scope guard: load the lens, assert
`app_project_id == pid` and `model_id == mid`, else 404. PUT 422s when `primary_section_id`
is null.

### Bundle round-trip

Add `litho_lens_boundary_nodes: []` to `ProjectFileV3` (normalise absent → `[]` on read,
same pattern as `litho_lenses` / `formation_absences`). The bundle GET includes the rows
(joined through `litho_lens` → project scope); restore inserts them AFTER the `litho_lens`
rows (FK order), `ON CONFLICT (id) DO NOTHING`. `render_style` rides the existing
`litho_lenses` array. **Pre-req check:** confirm `litho_lens` rows are already in the
bundle; if not, add them first (the shape is meaningless without the lens).

### Domain geometry (pure)

`src/groundmodel/domain/services/lens_boundary_geometry.py`:

```python
def compute_lens_boundary_polyline(
    *, anchor_contacts: list[tuple[float, float]],   # hard endpoints, sorted by along_m
       nodes: list[LensBoundaryNode],                # interior control handles
       render_style: Literal['straight','blocky','rounded'],
) -> list[tuple[float, float]]: ...
```

Merges anchors + nodes sorted by `along_m`; `straight` → verbatim polyline; `blocky` →
step-expanded; `rounded` → returns the merged points + a flag, the frontend applies the
Catmull-Rom curve (a render detail, not geometry). Two independent polylines (upper, lower)
matching the existing ribbon convention.

### Frontend

- Read boundary nodes on section load (per visible lens on the primary section).
- Render the shaped boundary: `straight` polyline / `blocky` step / `rounded`
  `d3-shape` `curveCatmullRom` (`d3` already bundled).
- Ghost-node drag: hollow draggable circles on the upper/lower boundary between the tests;
  drag commits on mouse-up via PUT; add-a-node by clicking an empty span (insert at
  `along_m`). Reuse the existing section drag plumbing (viewport→section coords).
- Style picker in `InspectLensBodyPanel` (the lens inspector already exists).

### Tests

- Backend unit: domain geometry per style (straight/blocky/rounded point lists);
  `PUT` replaces atomically + re-indexes; CASCADE delete; 422 on null primary section.
- Backend integration: bundle round-trip (save → wipe → restore keeps nodes + style).
- Frontend Vitest: boundary renders per style; ghost node drag fires PUT with new coords;
  companion section falls back to straight.

---

## Sequencing (build order)

1. **Slice 1** — fully (frontend + Vitest). Ship.
2. **Slice 2 increment 1** (architect's "smallest coherent first increment"): migration +
   GET/PUT + backend tests + bundle round-trip + frontend straight-only render. Ship.
3. **Slice 2 increment 2**: ghost-node drag UI + add/delete node + style picker + blocky/
   rounded render + tests. Ship.
4. Debt #164 (shape lost on ordinal shift) filed.

Each increment is independently green + committed.

## Out of scope / deferred

- Geology-surface wiring (snap lens boundary to a geological surface).
- 3D / cross-section-independent shape (section-local only for now).
- Per-node PATCH (full-replace PUT is enough at this scale).
- Carry-shape-forward across ordinal shift (#164).
- Accepted-band 3-dot handle (suggestions only in Slice 1).
