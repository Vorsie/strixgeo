# Litho model is the solids — cross-section fill from the 3D body solids

- **Date:** 2026-06-12
- **Status:** design approved (owner, browser-companion brainstorm), ready for a plan
- **Base:** off `develop@65d834e3` (Issue A overshoot fix + Issue B toggles already merged)
- **Supersedes:** the `formationFillBands` fill + the "Hide formation fill" toggle
  shipped in Issue B (those gated the now-retired Build-litho surface fill).

## Problem

The litho model has two divergent build paths:

* **Build litho** → `handleRebuildLithoSurfaces` → Delaunay TIN *surfaces* per
  formation. These drive `formationFillBands` on the 2D cross-section and a
  "Surfaces" layer in the 3D viewer.
* **Build solids** → `RecomputeLithoSolids` → watertight closed *body solids* (the
  3D model).

The TIN-surface path is **wrong for interfingering litho**: the surfaces are tops
only, and `formationFillBands` fills each formation down to the next in
stratigraphic order, so a unit like sand floods the section floor regardless of
where clay's picks actually are (dogfeed: yellow "sand" flooding the bottom under
grey clay). The surfaces also draped a wrong coloured top over the 3D model and
the "Surfaces" layer toggle was disabled, so the fence couldn't be isolated.

Owner directive (2026-06-12): **the body solids are *the* model. Retire Build
litho. The 2D cross-section fill comes from the built solids, so the cross-section
is a real check on the 3D.**

## Design (approved)

### Build — one "Build model" button

* **Retire "Build litho"** and the litho formation TIN surfaces it produces.
* Replace the two-button split ("Build litho" + "Build solids") with a single
  **"Build model"** button that builds the body solids (and the fence). Keep the
  Fence/Solid 3D toggle and the stale-badge convention.
* Remove the 3D **"Surfaces" layer** (no more TIN surfaces to show).

### 2D cross-section fill — from the built solid meshes (client-side)

Both modes read the **actual built `litho_body_solid` meshes** (already fetched
into the renderer for the 3D viewer), computed **client-side** (matches the
existing `computeSectionFill` / `sliceTin` pattern; a server endpoint is deferred
until section export needs it):

* **Default (A) — at exact test locations (geology-model style).** At each
  investigation's real (x, y) on the section, cast a vertical ray through every
  body mesh → each body's top/base elevation there → stack into a column; connect
  adjacent tests' same-body segments. Anchored to where the data is.
* **Toggle (B) — section-line slice.** Intersect each body mesh with the vertical
  section plane → fill the resulting polygons (continuous cut between tests).

This **replaces `formationFillBands`** (retired). The **"Hide formation fill"
toggle from Issue B is repurposed** to show/hide this solids-derived **model fill**
(rename, e.g. "Hide model fill").

* **Setting:** `view_state.litho_segmenter.section_fill_at_section_line`
  (bool, default `false` = test locations) in Settings → Litho segmenter. `true`
  switches to mode B.
* **Before Build:** no solids yet → the cross-section shows the per-column bands +
  contacts; the model fill appears once "Build model" has run.

### Kept unchanged

* **Per-column litho bands** (`perColumnBandsFromContacts`) — the immediate
  raw-data view, no build required.
* **"Fill bands"** (`computeSectionFill` / `PartitionFillOverlay`) — the on-demand
  partition fill used **during interpretation, pre-model** (owner: "pre-litho-model
  stage functionality"). `computeSectionFill` also stays as the internal source the
  solid build + the fence are derived from.
* **Correlations** overlay + the "Hide correlations" toggle.
* **3D solids + fence** (only the "Surfaces" layer is removed).

## Components (the *where*)

* `desktop/.../shell/stages/lithology/LithologyStage.tsx` — replace the two build
  buttons with one "Build model"; drop the surfaces build + stale-surface badge.
* Build handlers (`useGeologicalModel` / `useLithoSolids`) — "Build model" runs the
  solids build; `handleRebuildLithoSurfaces` retired (audit dependents — the 3D
  pane mount currently required litho `formation_surface` rows to exist; that gate
  must change to "solids exist").
* `desktop/.../components/sections/ContactsLayer.tsx` — remove `formationFillBands`
  (+ its `showFormationFill` prop wiring); the slice-of-TIN surface lines for litho
  go too.
* **New:** `desktop/.../utils/sectionFromSolids.ts` — client-side ray-sample
  (mode A) + plane-slice (mode B) of `LithoBodySolid` meshes → per-section fill
  geometry. **New:** a `ModelFillOverlay` (or fold into ContactsLayer) rendering it.
* `desktop/.../components/SectionPanel.tsx` — wire the built solids into the
  Sections stage (fetch/share `useLithoSolids`), feed the new overlay, gate on the
  new setting + the repurposed toggle.
* `desktop/.../shell/stages/lithology/{LithologyCanvas,Geology3DViewer}.tsx` —
  remove the "Surfaces" layer/legend entry.
* Settings UI + `view_state.litho_segmenter` — new `section_fill_at_section_line`.

## Open implementation questions (resolve in the plan)

1. **Mesh ray-sample (mode A):** a body mesh is a closed 2-manifold; cast a vertical
   ray at (x, y) and pair entry/exit intersections into top/base intervals. Bodies
   the test isn't a member of → ray misses → no column there (correct). Confirm the
   robust-ray helper (`mesh_test_helpers` ray logic exists in Python; need the TS
   analogue — `ContactsLayer`/`Geology3DViewer` may already have one).
2. **Plane-slice (mode B):** mesh ∩ vertical section plane → ordered polygon per
   body. New TS geometry.
3. **Solids in the Sections stage:** the meshes are fetched in the Lithology stage;
   share via the shell bus or fetch in SectionPanel. Per-section: only the bodies
   whose members include this section's investigations.
4. **Fence build under "Build model":** the fence renders live from
   `computeSectionFill`; confirm "Build model" doesn't need a separate fence step.
5. **3D-pane mount gate** after retiring litho surfaces (see Components).

## Out of scope

* Server-side section-slice endpoint + DXF/Plaxis section export (deferred — owner:
  "we'll worry about exports afterwards").
* Geological-stage build ("Build 3D model") — unchanged.

## Testing

* Vitest for `sectionFromSolids` (ray-sample + plane-slice) on synthetic meshes:
  a through-going body, a pinch-out, a body absent at a test, mode-A vs mode-B
  parity at a test column.
* Component tests: "Build model" button (renders, triggers the solids build);
  model-fill overlay gated by the toggle + the setting; geological axis unaffected.
* tsc(web) + run the lithology/sections vitest; e2e `flow_litho_solids` selector
  update for the merged button.
* Manual: dogfeed on `test.strix` — Build model → cross-section model fill at test
  locations matches the 3D solids; toggle the section-line slice; the bottom is
  grey clay, not flooded yellow.
