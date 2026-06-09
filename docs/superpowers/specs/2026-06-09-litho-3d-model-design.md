# Litho 3D Model — Design Spec

- **Date:** 2026-06-09
- **Status:** Draft (brainstormed; awaiting owner review)
- **Scope:** Turn the 2D lithostratigraphic cross-sections into a watertight,
  full-fidelity 3D lithomodel viewable inside Strix. DXF / Plaxis 3D **export is
  deferred to its own follow-up spec** but the persisted shape is designed so the
  exporter can read it unchanged.
- **Brainstorm artifacts:** `.superpowers/brainstorm/6400-1781029251/content/*.html`

---

## 0. In plain words (read this first)

**What you have today.** You draw the ground as a few flat cross-section "walls."
Each wall shows the soil layers, where a layer thins to nothing (a *pinch-out*),
and any isolated blobs (*lenses*). But the walls are flat and disconnected — there
is no solid 3D model of the ground.

**What we are building.** A solid 3D block of the ground you can rotate inside
Strix. It is built automatically from the walls you draw, so it always matches
your sections: layers that pinch out really taper to a point in 3D, and lenses
become enclosed blobs floating inside the block.

**The catch we found.** The three sections in test.strix are *parallel* — like
three slices of bread standing up side by side — and nothing connects them. The
software does not know that the sand on slice 1 is the same sand on slice 2. So
before any 3D can be built, the slices have to be connected.

**How we connect them.** You draw a few thin *tie-sections* running across the
parallel slices (like a skewer through the bread). Where a tie-section crosses a
slice it picks up a real test there, and you draw the soil correlations along it.
That tells the software how the slices relate. The good news: drawing and
correlating sections is something Strix *already does* — a tie-section is just a
normal section drawn crosswise.

**How the 3D is built.** Think of every soil boundary (say the line between sand
and clay) as a stretched sheet. The software fits **one sheet through all the
points where you marked that boundary**, across every section. A soil body is
simply the volume trapped **between two sheets**. Where two sheets touch, the body
pinches out. Where they wrap around each other, you get a lens. Because
neighbouring bodies *share* the same sheet, the whole thing is airtight — no gaps,
no overlaps — which is exactly what you need to export it later.

**What you actually do in the app.** (1) Draw a few tie-sections and correlate
across them. (2) Hit "build." (3) Rotate the 3D block and sanity-check it. Editing
still happens on the 2D sections; the 3D just redraws itself.

**Why this is achievable.** Strix already builds 3D surfaces for the *geological*
model. We reuse that exact surface-fitting engine, just pointed at soil boundaries
instead of geological formations. Most of the correlation plumbing exists too. The
genuinely new piece is the "stretch the sheets into solid bodies" builder.

### 0.1 Glossary (jargon → plain meaning)

| Term | Plain meaning |
|------|---------------|
| Contact | The boundary between two soil layers (e.g. sand-on-clay). |
| Body | One continuous lump of a single soil type traced through the ground. |
| Correlation edge | Your hand-drawn link: "this layer here = that layer there." |
| `body_id` | The software's internal name for one body, shared across every section it appears on. |
| Tie-section | A thin section drawn *across* the parallel ones to connect them. |
| Surface / TIN | A stretched triangular sheet fitted through scattered 3D points. |
| Partition | A complete tiling of space with no gaps and no overlaps. |
| Pinch-out | Where a layer thins to zero thickness and disappears sideways. |
| Lens | An isolated blob of one soil fully enclosed by another. |
| Watertight | Solids that fit together perfectly — required for clean export. |
| Fence diagram | Sections shown as walls in 3D *without* filling the gaps between them. |
| Freedraw nodes | The points you place when hand-drawing a body's exact shape. |

### 0.2 Background: where this sits

- This is **Phase 4** (the v1.0 commercial MVP gate). The litho model is the
  central deliverable; a 3D view + export are part of "the product is sellable
  here."
- The **geological** model already has a working 3D viewer (formations →
  surfaces → Cesium). The **litho** model has *no* 3D yet. This spec gives litho
  its own 3D, but finer-grained (per-body, with pinch-outs and lenses) because
  litho geology *interfingers* and cannot be drawn as simple stacked layers — the
  codebase already encodes that fact (`rebuild_model_surfaces.py:222`).
- Export to DXF / Plaxis 3D is the ultimate business reason for the 3D model, but
  we build the **in-app viewer first** so you can debug the geometry by *looking*
  at it rather than by re-importing into Plaxis.

---

## 1. Core problem

The litho model is authored as a set of **2D cross-sections**. Each section is a
true 2D *partition* (bands / onlaps / lenses / pinch-outs) produced by
`computeSectionFill` (`partitionFill.ts`). There is **no 3D lithomodel** — no
litho body solids, no `litho_body_solid` table, no builder, no render path
(`LithologyCanvas` is a placeholder that *would* reuse `Geology3DViewer` if litho
geometry existed).

We want to go from the flat slices to a solid 3D block where bodies pinch out and
lenses become enclosed blobs — built **from the drawn section geometry** (full
fidelity, not just borehole dots) and **watertight** so a later exporter can hand
clean tagged solids to Plaxis 3D / DXF.

### Who it is for
The owner (a geotechnical engineer) and, ultimately, their coworkers/clients
(the 3D view is also the demo surface) and downstream design tools (export, later).

### What success looks like
A rotatable 3D litho block of a real project (test.strix) inside Strix that
faithfully reproduces what the engineer drew on the 2D sections — including
pinch-outs and lenses — with watertight, individually-identifiable bodies.

### What this does NOT do (non-goals)
- **No editing in 3D.** Cross-sections remain the only editing surface
  (explicit-content invariant). 3D is a derived, auto-rebuilt view.
- **No DXF / Plaxis export in this spec** (own follow-up; persisted shape is
  export-ready).
- **No automatic geological inference / auto-correlation across sections**
  (no LeapFrog-style implicit modelling). Correlation stays user-driven.
- **No voxel / block model.** Possible later add-on; explicitly out now.
- **No design-ready parameters** (Phase 5, unchanged).

---

## 2. The data reality (test.strix, measured 2026-06-09)

- **3 cross-sections, all parallel** (azimuths 44° / 47° / 48°), offset in the
  perpendicular direction: CS1 at 0 m, CS2 at +80 m, CS3 at +180 m.
- **67 CPTs + 29 boreholes.** In-corridor counts at each section's real buffer:
  CS1 = 36 (±35 m), CS2 = 32 (±25 m), CS3 = 11 (±65 m).
- **0 shared tests, 0 section crossings, 0 cross-section correlation links.**
  All 296 correlation edges are `section_id`-scoped to a single section; all 130
  bodies carry a single `primary_section_id`.

**Consequence:** the three sections are three independent 2D interpretations with
**nothing tying them together in the perpendicular direction.** A 3D model is not
well-posed until that cross-direction link exists. This is the foundational gap
the design must close first.

---

## 3. Key decisions (owner-confirmed in brainstorm)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Ultimate purpose | Export-grade solids (but build order is viewer-first) |
| 2 | Representation | "Stretch between walls" — loft correlated bodies into closed solids; pinch-outs; voxel deferred |
| 3 | Built from | **The drawings** — full fidelity, honour drawn pinch/lens shapes (not just borehole dots) |
| 4 | Section correlation | **Tie-sections** form a connected fence (option C, made real for parallel sections) |
| 5 | Tie-section shape | Many **thin** tie-sections, ~1 real test per parallel-section crossing, minimal overlap; stitched via real shared tests + the existing resolver |
| 6 | Build order | **Viewer first**, exporter second |
| 7 | First spec scope | **Whole in-app 3D model** (tie-sections + builder + pinch-outs + lenses + full fidelity + viewer); export its own later spec |

---

## 4. Mechanism (the heart of the design)

**Boundaries become surfaces; bodies are the volume between their two bounding
surfaces.**

1. **One surface per contact-boundary.** For each litho contact, fit a surface
   `z = f(x, y)` through *all* its control points across the connected fence:
   - the contact's depth picks at every investigation it touches on every section
     (existing data: `litho_layer` depths × investigation `(x, y)` × surface
     elevation), **plus**
   - the vertices of the user's drawn freedraw boundary (`body_boundary_nodes`),
     projected from section `(along, elevation)` to world `(x, y, z)`.
   - Reuse the geology surface primitive (`compute_tin`, Delaunay +
     concave-hull) — applied **per contact-boundary**, not per formation.
2. **A body is the volume between its two bounding contact surfaces.** Because
   adjacent bodies *share* a boundary surface (the base of one is the top of the
   next — the litho column is gap-free, enforced by the FC↔LL triggers), the
   stack is **watertight automatically**: no gaps, no overlaps.
3. **Pinch-outs are free.** Where two bounding surfaces converge, the body
   between them goes to zero thickness and terminates. Drawn pinch nodes act as
   the control points that pull the convergence to where the engineer drew it.
4. **Lenses are a special case of the same rule** — a body whose top and base
   surfaces close on each other on all sides → an enclosed blob. Built as a
   closed surface pair and **carved out of the surrounding matrix** (the 3D port
   of the existing 2D lens carve-out, `carveOverlays`), preserving the partition.

This is why the approach reuses the geology engine yet expresses interfingering
that stacked formation tops cannot — and why the codebase already excludes litho
from age-ordered surface stacking (`rebuild_model_surfaces.py:222`,
`NON_STRATIGRAPHIC_KINDS`).

---

## 5. Architecture & components

Dependencies flow API → Application → Domain ← Infrastructure (unchanged).
Grey = exists, **bold** = new.

```
EXISTING inputs: contacts · layers · correlation edges · body_boundary_nodes · DEM
        │                         ▲
        │            Tie-sections │ (thin, perpendicular — mostly existing machinery)
        ▼                         │
ResolveLithoInstances (EXISTING) — unions edges across ALL sections → body_id spans walls
        ▼
**LithoSolidBuilder** (NEW · domain service)
   per-contact surfaces → bodies between surfaces → pinch-outs → lens carve
        ▼
**RecomputeLithoSolids** (NEW · application use case) + **litho_body_solid** (NEW · ORM)
        ▼
**GET /geology/models/{id}/litho-solids** (NEW · API, mirrors geology surfaces)
        ▼
LithologyCanvas → reuse Geology3DViewer (Cesium) — the V1 win
        ▼
(DEFERRED) DXF / Plaxis 3D exporter reads litho_body_solid
```

### 5.1 Tie-section workflow (mostly existing)
- **What:** the user draws thin, perpendicular cross-sections that cross the
  parallel ones, each catching ~1 real test per crossing, and correlates *along*
  them. The resulting edges carry the tie's `section_id`; `ResolveLithoInstances`
  already unions them into model-level `body_id`, so bodies span the parallel
  walls. The 2D parallel sections do not show the perpendicular edges (they are
  `section_id`-scoped to the tie) — by design.
- **New code (small):** a "create tie-section" affordance + light guidance
  (perpendicular hint, thin default buffer). The synthetic "auto-read crossing
  column" (interpolate a parallel section's stack where no real test sits) is an
  **optional fallback, deferred** unless dogfeeding shows real tests are too
  sparse.
- **Depends on:** existing section create, correlation, accept, resolver.

### 5.2 LithoSolidBuilder (NEW — domain service, pure)
- **What it does:** given the model's accepted layers, `body_id` membership,
  approved correlation edges, drawn `body_boundary_nodes`, investigation `(x,y)`,
  surface elevations, and the DEM, produce per-body closed triangle meshes
  (`vertices`, `triangles`) that tile space watertightly.
- **How used:** called by `RecomputeLithoSolids`; returns plain geometry
  (no I/O, no ORM) — testable in `tests/unit` with synthetic fences.
- **Depends on:** `compute_tin` (reused), the model_kind constant. **Must not**
  import infrastructure.
- **Internal units (each independently testable):**
  - `contact_surface_set` — group control points per contact-boundary, fit one
    surface each, clip to lateral extent.
  - `body_between_surfaces` — assemble a body volume from its bounding surfaces;
    detect + terminate pinch-outs.
  - `lens_carve` — build closed-blob lenses and subtract them from the matrix
    (3D analog of the 2D carve).

### 5.3 Persistence (NEW — `litho_body_solid`)
- One row per body: `body_id`, `model_id`, `formation_id`, `vertices`,
  `triangles`, `is_stale`, `method`. Mirrors `formation_surface_orm`.
- **Stale-on-edit:** any contact / correlation / body-boundary / tie-section
  change marks the model's solids stale (same pattern as formation surfaces).

### 5.4 API (NEW)
- `GET /geology/models/{model_id}/litho-solids` → `{ body_id → LithoSolidResponse }`
  (vertices, triangles, formation colour key, is_stale). Mirrors
  `listFormationSurfaces`. Rebuild trigger mirrors `recompute_formation_surface`.
- Additive only; the frontend always goes through the API.

### 5.5 Viewer wiring (NEW glue)
- `LithologyCanvas` fetches litho-solids and feeds them to the **reused**
  `Geology3DViewer` (already generic over `(formation, geometry)` pairs). Colour
  by lithology; render beneath the DEM lid; split-viewport support already there.

---

## 6. "Build from the drawings" — where the geometry is computed

**Server-side, from stored raw inputs.** The builder reads contacts, layers,
`body_id`, edges, `body_boundary_nodes`, and the DEM — all already persisted — so
**no port of the TS `partitionFill` engine is required**. Fidelity to the
drawings comes from feeding the **stored freedraw boundary nodes** as surface
control points alongside the contact picks. This keeps the builder consistent
with the geology pipeline and makes it export-ready (the deferred exporter reads
the same rows).

**Known fidelity gap (open question Q1):** the *auto-derived* (non-freedraw)
pinch positions that `partitionFill` computes client-side (e.g. meeting-fraction)
are not stored. In 3D those pinches instead fall out of where the interpolated
surfaces converge, which may not match the 2D auto-position pixel-for-pixel. Where
the engineer cared, they freedrew (stored, honoured exactly). Acceptable for V1;
revisit if 2D/3D pinch mismatch is visible and bothers the owner.

---

## 7. Error handling & edge cases

- **Disconnected fence (a body on only one section, no cross-link):** cannot form
  a perpendicular extent. Render it as a thin slab extruded ±halfway to the
  nearest neighbour and **flag it** (it is under-constrained) rather than
  silently inventing geometry. Log the count of under-constrained bodies.
- **Surface fit failure** (collinear / <3 control points): skip that body, log,
  continue — never abort the whole rebuild.
- **Non-watertight residue** from independent lens carves: assert the partition
  invariant in tests (every probe point belongs to exactly one body); if a carve
  leaves a sliver, log + prefer the matrix.
- **Stale read:** the viewer shows stale solids dimmed/badged until rebuilt
  (mirror the formation `is_stale` UX), never a blank.

---

## 8. Testing strategy

- **Unit (`tests/unit`, no DB):** `LithoSolidBuilder` on synthetic fences —
  (a) two parallel sections, one through-going body → watertight slab;
  (b) a body that pinches out between sections → zero-thickness terminus;
  (c) an enclosed lens → closed blob carved from matrix, partition preserved;
  (d) drawn freedraw node pulls the surface to the drawn position;
  (e) disconnected body → flagged slab, no crash.
  Each test's comment paraphrases the geological rule, not the impl (TDD: red
  first).
- **Integration (`tests/integration`, real DB):** RecomputeLithoSolids end-to-end
  on a seeded connected fence; stale-on-edit cascade; API response shape +
  eager-load chain.
- **Frontend (Vitest + tsc):** LithologyCanvas fetch + feed; section-geometry
  check for any new section-view overlay (tie-section affordance).
- **Bench:** add `bench_litho_solid_builder.py` once the builder lands (per
  the "benchmark alongside CPU-bound code" rule); not before.

---

## 9. Build order within this spec (for the plan)

1. **Tie-section workflow** — confirm/enable thin perpendicular sections +
   cross-direction correlation on test.strix (mostly existing; small UX).
2. **Through-going bodies + pinch-outs** — builder + table + API + viewer →
   first rotatable 3D block of test.strix on screen (de-risks the whole pipe).
3. **Lenses + full drawn-shape fidelity** — closed-blob builder + 3D carve +
   freedraw control points.
4. **(Deferred, own spec)** DXF / Plaxis 3D export.

Full fidelity (steps 1–3) is this spec's destination; step 2 simply lands first
so there is a visible, testable artifact early.

---

## 10. Open questions for owner review

- **Q1 — auto-pinch fidelity:** is surface-convergence-derived pinch geometry
  acceptable where the engineer did *not* freedraw, or must 3D match the 2D
  auto-position exactly (would require a partial `partitionFill` port)? (§6)
- **Q2 — tie-section ergonomics:** is "draw a thin perpendicular section through
  real tests + correlate" enough for V1, or do you want the synthetic
  "auto-read the crossing column" fallback in scope now? (§5.1)
- **Q3 — disconnected bodies:** flag-and-slab (proposed) vs hide entirely vs
  block the rebuild until correlated? (§7)
- **Q4 — colour / identity:** colour solids by lithology (proposed) and tag each
  with `body_id` + formation for the future export — any other identifier the
  downstream tools need?
