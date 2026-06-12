# Handoff — litho-3D builder geometry bug + section auto-fill toggle

- **Date:** 2026-06-12
- **For:** a FRESH branch + a FRESH session. Two related litho-stage issues surfaced
  during the geo-bounding dogfeed on `test.strix`. **Neither is part of the
  geo-bounding feature** (that is done + dogfed — see "Context" below).
- **Process for the fresh session:** `superpowers:brainstorming` (implementation —
  Issue A has real design depth) → `superpowers:writing-plans` →
  `superpowers:subagent-driven-development`. Issue B is small; Issue A is the hard one.
- **First gate (the day's lesson):** for each issue, name the **render surface / owning
  layer** before touching code. Issue A lives in the **Python 3D solid builder**
  (`build_body_solids`), Issue B in the **2D section renderer** (`SectionPanel` overlays).

---

## Context — where this came from

The geo-bounding feature (branch `litho-geo-bounding`, off `develop@66d3c846`) was
dogfed on `test.strix`. It **works**: the rebuild produced 40 geo-split bodies, picks
are confined to geological bands, 4 too-shallow tests were marked + floored. The owner
then spotted two things that are **NOT** geo-bounding:

1. SILT + SAND rendering **below the basal CLAY** in the 3D litho model.
2. An **automatic colored fill** drawn on the 2D cross-section after Build that the
   owner wants to be able to hide.

This session diagnosed #1 to the backend builder and identified #2's likely source.
Both are captured here for the fresh session.

---

## Issue A — `build_body_solids`: facies-competitor meshes overshoot below their picks

### Symptom
In the 3D litho model (`test.strix`), silt/sand/peat bodies appear **below** the basal
clay — geometry that exists in neither the litho columns nor the correlations.

### Evidence (dev-DB diagnostics, this session — decisive)
Per-lithology, the **stored solid mesh** elevation vs the **deepest pick** (litho layer,
elevation = surface − depth):

| lithology | solid mesh min elev | deepest pick elev | overshoot |
|---|---|---|---|
| KLEI (clay) | -16.4 | -16.5 | ~0 — **faithful** |
| SILT | **-11.6** | **-7.5** | **4.1 m below any silt pick** |
| ZAND (sand) | **-9.0** | **-7.6** | 1.4 m |
| VEEN (peat) | **+0.7** | **+4.3** | 3.6 m |

- The overshoot is in the **stored `litho_body_solid.vertices`** → **backend geometry
  bug, not rendering.**
- No silt/sand/peat *pick* exists that deep (data + correlations don't contain it) →
  the builder **invents** the geometry.
- Same -11.6 m on the **stale pre-geo-bounding** model → **pre-existing**, independent
  of geo-bounding (which bounds *picks* to bands; it cannot stop a *mesh* overshooting
  its picks).
- The offending silt bodies are **real TIN meshes** (14–80 verts, not flagged disk
  markers, mostly original/non-geo-split) → built by the single-patch / **facies** path.
- The build log was full of `build_body_solids: facies … produced no prism for N
  competitor(s) … fall back to M2 legacy`.

### Leading hypothesis (root cause — confirm first)
The **facies-competitor path**. A facies competitor (silt/sand/peat) is built as a
**clipped prism whose FLOOR = the shared/matrix body's contact surface** (the facies
design: "competitor floors = the shared contact"). Here the matrix is the **clay**. So
the **clay (matrix) is built faithfully to its own picks**, but the silt/sand/peat
**competitor prisms get dragged down to the clay's deep floor** instead of stopping at
their own pick depths. That precisely matches the data ("clay faithful, everyone else
overshoots"). The M2 **legacy fallback** for the no-prism competitors is a second
suspect — verify which path each overshooting body took.

### Files to read first
- `src/groundmodel/domain/services/litho_facies_partition.py`
  (`competitor_labels_above/below`, `partition_footprint`, circumcenter junction)
- `src/groundmodel/domain/services/litho_body_assembly.py`
  (`build_prism`, `assemble_facies_competitors`, `_legacy_body`)
- `src/groundmodel/domain/services/litho_solid_builder.py`
  (`build_body_solids` — the facies routing branch + the `fall back to M2 legacy` warns)
- `src/groundmodel/domain/services/litho_contact_surfaces.py` (shared-contact surfaces)
- Spec/plan history: `docs/superpowers/specs/2026-06-11-litho-3d-facies-partition-design.md`
  + `memory/project_litho_3d_model.md` (the facies-partition design + known limits).

### Fix direction (to brainstorm)
Clip each facies-competitor prism's **floor to the competitor's own deepest pick / own
base contact**, not the shared body's deep floor (and/or fix the legacy fallback the
same way). The body's mesh must be bounded by its own member picks.

### Verification (build this as the regression guard)
A per-body invariant + diagnostic: **for every body, `solid_mesh_min_elev >=
body_deepest_pick_elev − ε`** (a body's mesh may not dip below its own deepest pick).
Re-build `test.strix`, re-run the dev-DB diagnostic (solid-vs-pick elevation per
lithology), confirm zero overshoot; owner dogfeed on the 3D model. The
`strix-suggestion-eval` skill + a hand-marked case can help if needed.

### Diagnostic query used this session (reuse it)
```sql
-- solid mesh elevation per lithology (dev DB, docker exec psql -d groundmodel)
SELECT f.name, round(min((v->>2)::numeric),1) AS solid_min_elev
FROM litho_body_solid s JOIN geological_formation f ON f.id=s.formation_id
CROSS JOIN LATERAL jsonb_array_elements(s.vertices) v
WHERE s.model_id='<litho_model_id>' GROUP BY f.name ORDER BY 2;
-- deepest pick elevation per lithology
SELECT f.name, round(min(coalesce(b.elevation_m,c.elevation_m)-l.depth_base_m)::numeric,1)
FROM litho_layer l JOIN geological_formation f ON f.id=l.formation_id
LEFT JOIN borehole b ON b.id=l.borehole_id LEFT JOIN cpt c ON c.id=l.cpt_id
WHERE l.model_id='<litho_model_id>' AND l.status='accepted' GROUP BY f.name ORDER BY 2;
```
(Container is `strix-db-1`, host port **5433**, dev DB `groundmodel`.)

---

## Issue B — toggle to hide the automatic section fill that appears after Build

### Requirement (owner, verbatim intent)
After clicking **Build litho** / **Build solids**, an **automatic colored fill** appears
on the 2D cross-section. The owner wants a toggle to **hide it**. It is explicitly **NOT**:
- **"Fill bands"** (`PartitionFillOverlay`) — separate, off-by-default, user-clicked.
- **"Hide correlations"** (`CorrelationEdgesOverlay`) — a toggle built this session (see
  "Wrap-up state"); the owner confirmed this was *not* the overlay they meant ("you can
  leave it").

### Investigation (identify the exact overlay FIRST)
**Leading candidate:** `ContactsLayer`'s **per-column litho bands**
(`perColumnBandsFromContacts={axisMode === 'lithostratigraphic'}`,
`SectionPanel.tsx:~2619`, `bandFillOpacity` ~0.55). The owner was at **5% column
spacing** — at low spacing the per-column bands pack together and read as a continuous
fill across the section. **Confirm by toggling candidates on the real section** (the
owner can point at it live). Rule out any body-derived fill overlay.

### Approach
Mirror the existing tiny-store pattern — the **`correlationOverlayStore` built this
session is the exact template** (`utils/correlationOverlayStore.ts` +
`SectionsToolbar` Bodies-dropdown item + `SectionPanel` render gate). Add a
"Hide litho fill"-style toggle gating the identified overlay. Consider **consolidating
the section-overlay toggles** (Fill bands / correlations / litho fill) into one coherent
"View" group so the user has one obvious place to declutter.

### Files
- `desktop/src/renderer/src/utils/correlationOverlayStore.ts` (template, this session)
- `desktop/src/renderer/src/utils/bandFillStore.ts` (the original template)
- `desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx` (Bodies dropdown)
- `desktop/src/renderer/src/components/SectionPanel.tsx` (overlay render gates,
  `perColumnBandsFromContacts` at ~2619)
- `desktop/src/renderer/src/components/sections/ContactsLayer.tsx` (per-column bands — the
  likely target)

### Open questions for the fresh session
- Which overlay exactly? (confirm live with the owner).
- Should the toggle hide the per-column litho bands entirely, or only a derived fill?
- Consolidate the three section-overlay visibility toggles into a "View" submenu?
- Add a Vitest for each store (mirror any `bandFillStore` test).

---

## Wrap-up state (2026-06-12)

- **Geo-bounding feature — DONE + dogfed.** Branch `litho-geo-bounding`, off
  `develop@66d3c846`, **UNPUSHED**. 40 geo-split bodies on `test.strix`; picks confined
  to bands; 4 marked tests floored. dev DB migrated to head `7deb298fb5c1` (host port
  5433). 1224 unit + 529 integration green; full holistic review = SHIP FOR DOGFEED.
  **The silt-below-clay is NOT this feature** (Issue A above). **Mergeable on its own
  merits — merge decision is the owner's** (rebase per `feedback_pr_merge_style`, no push).
- **Hide-correlations toggle** — built this session, **uncommitted in the `develop`
  working tree** (main repo): `utils/correlationOverlayStore.ts` +
  `SectionsToolbar.tsx` + `SectionPanel.tsx`. Owner said keep it. The fresh session folds
  it in with Issue B (and decides whether to commit / consolidate / add tests).
- **This doc** is the brief for the fresh session/branch.
