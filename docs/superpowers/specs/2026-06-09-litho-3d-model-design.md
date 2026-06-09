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

**And Strix proposes the ties for you (owner-confirmed, in scope).** Rather than
hand-drawing every skewer, the app auto-suggests a tidy *ladder* of tie-sections —
each connecting **one test per wall** so correlating along it is unambiguous — and
**the ties never cross each other** (a crossing would mean a geologically
impossible swap). You accept or reject the ghost suggestions, then correlate. See
§5.1.1; validated on test.strix in §2.1.

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

### 2.1 Auto-tie validated on this data

Running the proposed auto-tie matcher (§5.1.1) over the real test.strix
coordinates produced **29 non-crossing tie-sections** (9 connecting all three
walls, 20 connecting two), **0 order inversions** (zero crossings, verified),
mean strike-spread 24 m / max 42 m, tying 28/36 CS1, 28/32 CS2, and all 11/11
CS3 tests. CS3 (sparsest) caps full-triplet coverage, as expected. This is the
empirical basis for putting auto-tie in scope rather than deferring it.

---

## 3. Key decisions (owner-confirmed in brainstorm)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Ultimate purpose | Export-grade solids (but build order is viewer-first) |
| 2 | Representation | "Stretch between walls" — loft correlated bodies into closed solids; pinch-outs; voxel deferred |
| 3 | Built from | **The drawings** — full fidelity, honour drawn pinch/lens shapes (not just borehole dots) |
| 4 | Section correlation | **Tie-sections** form a connected fence (option C, made real for parallel sections) |
| 5 | Tie-section shape | Many **thin** tie-sections, ~1 real test per parallel-section crossing, minimal overlap; stitched via real shared tests + the existing resolver |
| 5b | Tie-section generation | **Auto-proposed (in scope), not hand-drawn.** Non-crossing monotonic match, ~1 test per wall, presented as ghosts the user accepts/rejects. Correlation along the tie stays user-driven (§5.1.1) |
| 6 | Build order | **Viewer first**, exporter second |
| 7 | First spec scope | **Whole in-app 3D model** (auto-tie workflow + builder + pinch-outs + lenses + full fidelity + viewer); export its own later spec |

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
   - add the uncertainty on the model also, with a toggle button in the frontend
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
        │   **Auto-tie generator**│ (NEW) → ghost ties → user accepts → correlate
        │   (non-crossing ladder) │  (reuses correlation + resolver)
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

### 5.1 Tie-section workflow
- **What:** thin, perpendicular cross-sections cross the parallel ones, each
  catching ~1 real test per crossing. Correlating *along* a tie produces ordinary
  edges carrying the tie's `section_id`; `ResolveLithoInstances` already unions
  them into model-level `body_id`, so bodies span the parallel walls. The 2D
  parallel sections do not show the perpendicular edges (they are
  `section_id`-scoped to the tie) — by design.
- **Depends on:** existing section create, correlation, accept, resolver.
- **Reused vs new:** correlation + resolver + section persistence are existing;
  the auto-tie generator (§5.1.1) is the one new piece.

#### 5.1.1 Auto-tie generator (NEW — the in-scope accelerator)
- **What it does:** instead of the user hand-drawing every skewer, Strix proposes
  a tidy *ladder* of tie-sections as **ghosts** the user accepts/rejects.
- **Algorithm (non-crossing monotonic match):**
  1. Project every in-corridor test onto the parallel-section direction → a
     *strike* coordinate; group by which wall it belongs to; sort each wall by
     strike.
  2. Sweep a pointer up all walls together; at each step form a *rung* from the
     frontier test(s) within a strike-spread tolerance of the current minimum,
     then advance only those pointers. Because pointers only move forward, rungs
     are strike-ordered → **ties can never cross** (a crossing would be a
     geologically impossible lateral swap).
  3. A rung touching ≥2 walls becomes a candidate tie (a straight line through its
     ~1-test-per-wall members); tests too far out of line are left untied rather
     than forced through a fat buffer.
- **Invariants (must hold, tested):** every proposed tie has ≤1 test per wall;
  the proposed set has **zero order inversions** (no crossings); a tie's buffer is
  the minimum that catches its members.
- **User control:** ghosts only — the user accepts/rejects, then correlates along
  the accepted ties. Correlation stays user-driven (no auto-correlation).
- **Tunable:** strike-spread tolerance (default ≈45 m); whether 2-wall pairs are
  allowed alongside full triplets (default: yes).
- **Depends on:** existing section create + the projection math
  (`sectionProjection.ts` / its server analog); emits ghost section rows the user
  commits.
- **Deferred fallback:** the synthetic "auto-read crossing column" (interpolate a
  parallel section's stack where no real test sits) stays out unless dogfeeding
  shows real tests are too sparse.

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
  `Geology3DViewer` (already generic over `(formation, geometry)` pairs). Render
  beneath the DEM lid; split-viewport support already there.
- **Colour:** default = the body's lithology/soil colour. Each body's colour is
  **adjustable in the 3D litho pane** (a per-body colour picker). Identity tag =
  `body_id` + formation (for the future export).

### 5.6 Per-body colour override (NEW)
- **What:** a colour picker in the litho 3D pane sets an explicit colour for a
  chosen body, overriding the lithology default; reset clears it back to default.
- **Persistence:** stored as a nullable `display_color` on the body
  (`null` ⇒ use lithology colour), so it **rides in the `.gmproj` bundle** and a
  colleague opening the file sees the same colours. It is a per-project
  engineering decision, not per-user chrome → not localStorage (see
  `project_decisions_in_bundle`). Consistent with "all user edits stored as
  truth" (§6).
- **API:** additive `PATCH` on the body to set/clear `display_color`; the
  litho-solids response carries the effective colour (override ?? lithology).

---

## 6. "Build from the drawings" — where the geometry is computed

**Server-side, from stored raw inputs.** The builder reads contacts, layers,
`body_id`, edges, `body_boundary_nodes`, and the DEM — all already persisted — so
**no port of the TS `partitionFill` engine is required**. Fidelity to the
drawings comes from feeding the **stored freedraw boundary nodes** as surface
control points alongside the contact picks. This keeps the builder consistent
with the geology pipeline and makes it export-ready (the deferred exporter reads
the same rows).

**All user edits are stored as truth (owner directive — must build).** Anything
the engineer touches — a freedraw boundary, a dragged pinch position, an accepted
auto-tie, a correlation — is **persisted** and treated as ground truth by the
builder; the 3D never silently re-derives over a user decision. This is the
explicit-content invariant carried into 3D.

Consequence for pinch positions: today `partitionFill` *derives* some pinch
positions client-side (e.g. meeting-fraction) without storing them. To honour the
directive we must **persist the pinch position whenever the user adjusts it** (so
it round-trips into the 3D build). Where the user has *not* touched a pinch, the
default falls out of where the interpolated surfaces converge — an automatic
default, not a stored decision, and therefore free to differ slightly from the 2D
auto-position. (Resolves former open question Q1.)

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

- **Unit (`tests/unit`, no DB) — auto-tie matcher:** non-crossing invariant
  (zero order inversions on a randomised fence), ≤1 test per wall per tie,
  monotonic rung order, spread-tolerance skip (out-of-line tests left untied).
- **Unit (`tests/unit`, no DB) — `LithoSolidBuilder`** on synthetic fences:
  (a) two parallel sections, one through-going body → watertight slab;
  (b) a body that pinches out between sections → zero-thickness terminus;
  (c) an enclosed lens → closed blob carved from matrix, partition preserved;
  (d) drawn freedraw node pulls the surface to the drawn position;
  (e) disconnected body → flagged slab, no crash.
  Each test's comment paraphrases the geological rule, not the impl (TDD: red
  first).
- **Integration (`tests/integration`, real DB):** RecomputeLithoSolids end-to-end
  on a seeded connected fence; stale-on-edit cascade; API response shape +
  eager-load chain; user-edited pinch persists + round-trips into the build.
- **Frontend (Vitest + tsc):** LithologyCanvas fetch + feed; ghost-tie
  accept/reject; `strix-section-geometry-check` on any new section-view overlay
  (ghost ties, tie affordance).
- **Bench:** add `bench_litho_solid_builder.py` once the builder lands (per
  the "benchmark alongside CPU-bound code" rule); not before.
- **e2e (Playwright):** auto-propose ties on the seeded fixture → accept → 3D
  block renders; offline + deterministic per `run-e2e.ps1`.

---

## 9. Build order within this spec (for the plan)

1. **Auto-tie workflow** — non-crossing monotonic matcher → ghost ties →
   accept/reject → correlate; produces the connected fence on test.strix.
   (In scope from the start, per decision 5b.)
2. **Through-going bodies + pinch-outs** — builder + table + API + viewer
   (incl. per-body colour picker, §5.6) → first rotatable 3D block of test.strix
   on screen (de-risks the whole pipe).
3. **Lenses + full drawn-shape fidelity** — closed-blob builder + 3D carve +
   freedraw/edited-pinch control points (user edits stored as truth, §6).
4. **(Deferred, own spec)** DXF / Plaxis 3D export.

Full fidelity (steps 1–3) is this spec's destination; step 2 simply lands first
so there is a visible, testable artifact early.

---

## 10. Open questions for owner review

- ~~**Q1 — auto-pinch fidelity**~~ — **RESOLVED:** all user edits are stored as
  truth; user-adjusted pinches persist + round-trip into the build; untouched
  pinches use the surface-convergence default (§6).
- ~~**Q2 — tie-section ergonomics**~~ — **RESOLVED:** auto-tie generation is in
  scope (non-crossing monotonic match, ghost-propose, ~1 test/wall, §5.1.1). The
  synthetic "auto-read crossing column" stays a deferred fallback.
- ~~**Q3 — disconnected bodies**~~ — **RESOLVED:** flag-and-show-as-slab
  (extrude ±halfway to the nearest neighbour, flag as under-constrained). (§7)
- ~~**Q4 — colour / identity**~~ — **RESOLVED:** default to soil/lithology
  colour, **per-body colour adjustable in the 3D litho pane** and persisted in the
  bundle; identity tag = `body_id` + formation. (§5.5–5.6)

All open questions resolved — spec ready for planning.
