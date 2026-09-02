# Export System

> Extracted from `CLAUDE.md` 2026-06-06 to keep the always-loaded file lean. Load this on demand when the pointer in CLAUDE.md says so.

## Export System

See `infrastructure/exporters/base_exporter.py` (`BaseExporter` ABC). Implement `PlaxisExporter`, `DStabilityExporter`, `GeoStudioExporter`, `DSheetExporter` in Phase 4 / early Phase 5. **Exports are how engineering happens** — once the ground model + parameters + statistics are exported, all design checks (bearing capacity, settlement, slope stability, etc.) run in the destination tool. The platform itself does not perform those calculations.

**Deltares D-Series via GEOLib — SHIPPED 2026-08-26 (v1.0 gate,
owner ballot).** `d-geolib` 2.9.1 is a hard dependency (pydantic-v2
native; pulls `shapely`, `jinja2`, `requests`, `pydantic-extra-types`).
It builds a `DStabilityModel` / `DSheetPilingModel` in memory and
serialises without any D-Series install on the machine. The
probabilistic side (Probabilistic Toolkit / PTK) consumes `.stix`
downstream — Strix is the producer, PTK is not in our integration
surface. D-Settlement and D-Foundations stay unbuilt.

### Cross-section PDF sheet — client-rendered (debt #52 slice 1)

The section PDF is NOT a backend exporter. It is drawn by the desktop app
itself: a second renderer entry (`sheet.html` → `SectionSheet`) renders an
A3-high landscape drawing sheet from a serialisable `SheetPayload` — the same
on-screen partition the D-Series exports POST, plus the column logs, units and
map points — and Chromium prints it through `webContents.printToPDF` in a hidden
window (`main/sheetPdf.ts`). The engineer previews the sheet live in an iframe
and plays with the app's own exaggeration + spacing sliders before exporting, so
preview and PDF are the same DOM. This replaced the old A4-portrait matplotlib /
ReportLab exporter, which redrew contacts as straight chords in depth-below-
surface and never drew a fill — it could not be made faithful, so it was deleted
(route, exporter trio, tests and the `reportlab` dependency; `matplotlib` stays
only as a `d-geolib` transitive dep). Full design:
`docs/superpowers/specs/2026-09-02-section-pdf-sheet-design.md`.

### The closed-geometry contract — `SectionPolygonSet`

D-Stability has no borehole concept: its geometry IS a set of closed
soil-layer polygons. So the D-Series exporters consume a THIRD input
contract, alongside `GroundModelSnapshot` (project-wide) and
`SectionSnapshot` (section picks):

* `application/section_polygon_set.py` — `SectionPolygonSet`:
  absolute `(along_m, elevation_m)` rings + the units they reference
  (name, NAD class, soil code, colour, display order).
* `application/build_section_polygons.py` — `BuildSectionPolygons`:
  resolves a renderer-POSTed `SectionPartitionInput` (gap-local
  fractions) against the project's formations. The fraction→metres
  mapping is linear in the columns' own `along_m`, **the same mapping
  the 3-D voxel builder uses**, so a D-Stability export and a 3-D
  build of one section describe the same ground.
* `infrastructure/exporters/section_geometry_exporter.py` —
  `SectionGeometryExporter` ABC (third sibling of the debt-#109
  split).

**Why the partition is POSTed, not derived.** The fill is computed in
the renderer (`computeSectionFill`), and the section is the editing
surface — what the engineer sees filled IS the model. Re-deriving
polygons on the backend from formation contacts would be a second,
simpler, DIFFERENT partition: a plausible geometry that disagrees with
the screen. So these two exports are **POST** endpoints carrying the
same payload shape the voxel build sends, and the body is REQUIRED
(Pydantic answers 422 when absent).

### DStabilityExporter (`.stix`)

One D-Stability layer per drawn region; one soil per unit, named by
`unit_identifier()` (`NAD-06_ZAND`), with NAD class + soil code +
Strix formation id in the layer note. `projectinfo.Remarks` carries
the datum, the axis definition and the parameters-not-exported
disclaimer.

**Design parameters are written only when the NAD table carries the
unit's class** (see "NAD soil parameters" below). When that table
has no row for the class, cohesion, friction angle and both unit weights stay at
GEOLib's initial **zero** — chosen over a plausible default precisely
because a zero cannot be mistaken for a value Strix stood behind. When a
class IS in the table, its γ, φ′ and c′ ride on the Mohr-Coulomb model
D-Stability applies both above and below the phreatic level, and the
soil's `Notes` names the source table. No phreatic line, head line, load
or reinforcement is ever written.

Regions that cannot close are dropped and counted, never repaired: a
zero-area ring (shapely `make_valid` → `MultiLineString`) and a
self-intersecting ring (→ `MultiPolygon`) both make GEOLib raise, and
picking one half of a repaired bow-tie would invent ground nobody drew.
A section with nothing drawable is **refused** (`ValueError` → 422
`dstability_export_refused`) — an empty `.stix` is a plausible,
correctly-named, completely wrong deliverable.

### DSheetPilingExporter (`.shi`)

D-Sheet models a wall against ONE 1-D soil profile per side, and Strix
knows only the profile. **V1 scope: the soil profile and nothing else.**
It samples the drawn fill at a fraction along the section (mid-section
by default), reading the column by intersecting the vertical line with
every region (even-odd rule), cutting at every boundary elevation,
attributing each slab to the region covering its midpoint, then merging
same-unit runs. Holes and overlaps are counted and WARNed — D-Sheet's
profile can express neither.

The ground surface IS exported (a surface elevation is a measurement).
Everything else is an explicit TODO in `[RUN IDENTIFICATION]`, never an
invented value. Soil γ / φ′ / c′ follow the same NAD-table path as
D-Stability (below); when a soil is parameterised, line 3 of the
`[RUN IDENTIFICATION]` block names the source table instead of the
parameters-at-defaults TODO — a `.shi` `[SOIL]` block has no per-soil
free-text field, so that block is the only place the provenance can go.

### NAD soil parameters — filled 2026-09-02 from the owner's workbook

Both D-Series exporters carry **NAD characteristic soil parameters** (unit
weight γ, effective φ′, effective c′) per packing class, keyed by NAD class
1–31. The values live in `domain/services/nad_soil_parameters_constants.py`
(`NAD_SOIL_PARAMETERS: dict[int, NadSoilParameters]`) and are transcribed by
the owner from the private workbook **"Correlaties uit S en NAD_NEN_v2.xlsx"**
(NEN 9997-1 Tabel 2.b). **The dict ships EMPTY** — Strix never invents a norm
value — and the plumbing is wired so that filling the dict is the only
remaining step: `nad_soil_parameter_lookup.soil_parameters_for_unit(unit)`
returns a class's parameters or `None`, and each exporter writes them into the
GEOLib `Soil` when present.

* **Present** → cohesion + φ′ on the Mohr-Coulomb model (D-Stability sets it
  above AND below the phreatic level so the strength is actually applied under
  the water table); both unit weights; and the annotation `SOURCE_LABEL`
  ("NAD Tabel 2.b — karakteristieke waarde") on the soil `Notes` (D-Stability)
  or folded into `[RUN IDENTIFICATION]` (D-Sheet).
* **Absent** (a class without a row in the table — none today, all 31 are transcribed)
  → **no** parameters; GEOLib's own blank initial values (D-Stability 0/0/0;
  D-Sheet 0.01 kN/m³ unit weight, 0 cohesion/φ′). Never a plausible default.

The values are characterisation, not design outputs — the boundary in CLAUDE.md
"Core Philosophy". The engineer verifies each value against the norm.

### GEOLib quirks — verified against 2.9.1, 2026-08-26 (parameters row group 2026-09-02)

| Quirk | Consequence |
|---|---|
| `DStabilityModel.is_valid` is **False for any model with no layer loads** (`is_valid_layer_loads` requires the loaded-layer set to equal the soil-layer set) | Never gate an export on `is_valid`; verify by GEOLib re-parsing its own output |
| `.stix` **writer emits UTF-8, reader decodes cp1252** | Our bytes are correct; GEOLib's round-trip mojibakes non-ASCII unit names. Assert non-ASCII content against the archive JSON, not against `model.parse`. **Unverified: whether D-Stability itself reads UTF-8** — dogfeed an export with an em dash in a unit name |
| `parse()` needs a real `Path` (`filename` is a pydantic `Path` field) although `serialize()` accepts a buffer | Round-trip tests write a temp file |
| `.stix` archive member is `geometries/geometry.json`, singular | — |
| A fresh `DStabilityModel` ships 13 Deltares library soils | Filter by our own codes when asserting |
| GEOLib writes a `[WATERLEVELS]` block whether or not one is added | The water level cannot be omitted, only NAMED — ours is `TODO set water level` at GEOLib's own 0.00. **Never set it to the ground surface** (the 2026-08-02 Plaxis audit: that made every exported model fully saturated) |
| D-Sheet's GUI shows only **3** `[RUN IDENTIFICATION]` lines (`REQ_RUN_LINES = 2`) | The whole TODO message is budgeted to three lines; a fourth is in the file and invisible |
| GEOLib ships no `py.typed` | `[[tool.mypy.overrides]] module = ["geolib.*"]` in pyproject |
| The GEOLib `Soil` constructor **forbids a `notes` key** (pydantic `extra=forbid`), and `Soil._to_dstability` never transfers a note | To annotate a D-Stability soil, set the PERSISTED soil's `Notes` after `add_soil`: `model.soils.get_soil(code).Notes = ...`. It round-trips into `soils.json` |
| `Soil.mohr_coulomb_parameters` cohesion/friction land in **`MohrCoulombAdvancedShearStrengthModel`**, not `...Classic` | Assert parameters against the *Advanced* model; `...Classic` stays 0 |
| A name+code-only D-Stability soil defaults to `ShearStrengthModelTypeBelowPhreaticLevel = **Su**` with `StrengthIncreaseExponent = **1.0**` — a model choice + number nobody chose | When writing parameters, set the shear model to Mohr-Coulomb on BOTH sides (so cohesion/φ′ apply below the water table too). The empty-table path leaves the `Su`/1.0 default in place — documented, not chosen |
| A name+code-only **D-Sheet** soil is NOT all-zero: `SoilGamDry/Wet = **0.01**`, and GEOLib forces non-zero structural defaults regardless (`SoilOCR 1.0`, `SoilEModMenard 0.01`, subgrade `SoilKb*/Ko* ≈ 1e4`, `SoilPermeabKx 1e-4`, `SoilLn/Lp 0.01`) | These are D-Sheet's own init values, not Strix's. The export only ever writes the four Mohr-Coulomb/weight fields; the rest are GEOLib defaults the engineer edits |
| `parse()` → `serialize()` is **not byte-identical** for either target | `.stix`: only the layer-note member differs, from the cp1252-reader mojibaking our own em dash (the writer-UTF-8/reader-cp1252 quirk above); the model is structurally identical. `.shi`: differs only in the `TIME` stamp and cosmetic leading-whitespace on `Number of …` count lines. Content-stable; do not gate on byte-equality |

**Plaxis is NOT a D-Series tool** — it's Bentley/PLAXIS BV, with
its own remote-scripting API (`plxscripting`). GEOLib doesn't
cover Plaxis. **Target (decided 2026-05-14): Plaxis 2D/3D 2018+;
the PlaxisExporter emits a runnable `plxscripting` Python script
(`.py`) that the engineer runs against their own Plaxis
instance.** No live Plaxis dependency at our build/test time, no
scripting license needed on our side, and the script is human-
readable so engineers can tweak it before running. `.plxs` itself
is undocumented binary (likely SQLite/Firebird inside a
compressed container, exposed via the `.plxzip` variant) and not
viable as a direct file-write target for a solo dev. The legacy
`.geo` ASCII format is pre-2014 and modern Plaxis no longer
guarantees a clean round-trip. The PlaxisExporter is a separate
effort from the GEOLib-backed exporters; targets the same
geometry contract.

**Plaxis 3D exporter — what it emits (shipped 2026-05-14).** A
self-contained `.py` script that connects to a running Plaxis 3D
via its Remote Scripting Server (`plxscripting.easy.new_server`),
clears the project, creates one Mohr-Coulomb-placeholder `soilmat`
per formation (Identification only, parameters blank — Phase 5
fills them), creates one global `soillayer` per formation in
stratigraphic order (display_order DESC → Plaxis layer 0 =
topmost = youngest), creates one `borehole` per investigation
with a known surface elevation, and calls `g_i.setsoillayerlevel`
per (borehole, layer) with the contact's absolute z. Formations
absent at a borehole emit a zero-thickness layer (top z inherits
the next-deeper present formation's top z). Endpoint:
`GET /projects/{pid}/geology/models/{mid}/export/plaxis3d`.

**Level boundaries are N+1, not N.** A PLAXIS borehole with `N` soil
layers has `N + 1` `setsoillayerlevel` boundaries: index `0` is the
top of layer 0, index `i` is the base of layer `i-1` / top of layer
`i`, and index `N` is the **base of the deepest layer — the bottom of
the model**. Both exporters emit all `N + 1` through
`emit_borehole_layer_levels`; the final line is tagged
`# column bottom` and clamped so it can never sit above the deepest
layer's own top. Omitting it left the deepest unit — usually the
founding layer — running to whatever base PLAXIS defaults to instead
of to the depth the investigation reached (audit 2026-08-02).

## Unit identifiers — the three-level export contract (debt #104)

An export has to let a downstream tool map each unit onto a **material
definition**, which display names alone cannot do. Every exporter
therefore reads the two machine-usable fields off the unit —
`nad_class` (Belgian NAD packing class 1..31) and
`litho_main_soil_code` (BaseLithology token) — through ONE shared
module, `infrastructure/exporters/unit_identifier.py`. Its constants
live in `unit_identifier_constants.py`; nothing else may re-derive the
scheme.

**The token.** `unit_identifier()` builds one string per unit:

| Level | nad_class | soil | Token |
|---|---|---|---|
| geotech, classified | 6 | ZAND | `NAD-06_ZAND` |
| geotech, no soil on the litho parent | 6 | – | `NAD-06` |
| litho | – | ZAND | `ZAND` |
| geological | – | – | `None` |

The class is **zero-padded** because CAD layer managers and PLAXIS
material lists sort as text — `NAD-06` must sort above `NAD-21`. The
class leads so the token is a stable prefix: `NAD-06_*` wildcard-selects
every instance of one class. The token is stripped against the DXF
forbidden-character set, so it is always safe to splice into a layer
name.

**The naming rule — one predicate, `naming_identifier()`.** A unit's
*name* in an export changes ONLY when the unit carries a `nad_class`.
Geological formations, litho units and unclassified geotech skeleton
bands keep byte-identical names; their identifiers ride metadata
channels instead (DXF layer description, the mapping table, the PDF
legend). The DXF layer name, the PLAXIS material identification and the
PLAXIS Python variable all ask that one function, so they cannot
disagree about which units were renamed.

**What each artefact carries.**

* **DXF** — layer `GeoModel-NAD-06_ZAND - <unit name>`; layer description
  gains `| NAD class 6 | soil ZAND`; a mapping table in model-space TEXT
  under the title block.
* **PLAXIS 2D + 3D** — material `Identification = "NAD-06_ZAND - <unit
  name>"`, variable `mat_nad_06_zand`, and a `UNIT MAPPING TABLE` block
  in the script's docstring header (after USAGE) listing material → NAD
  class → soil → unit name → formation UUID.
* **Cross-section PDF sheet** — the unit legend + the labels inside the fills
  carry the on-screen unit name (client-rendered; see the sheet subsection
  above).

### Same-NAD thinning — DXF only (debt #104b)

Owner ruling 2026-08-26, verbatim: *"thin in dxf and pdf, keep plaxis
exact, shallower parent name wins."*

Two stacked units of the same NAD class mean two different litho or
geological parents — the geotech find-or-create keys on `(nad_class,
litho parent, geo parent)`, so same-class bands *within* one parent
already share a formation row. That boundary is real geology but carries
no NAD meaning, and in a delivered DXF or PDF it reads as two materials
where the engineer has one.

* **Where** — `ThinExportUnits` (`application/thin_export_units.py`),
  applied in `_build_export_snapshot` (`api/routers/cross_section.py`).
  The DXF handler passes `thin_units=True`; the helper defaults to
  `False`, so a new caller gets the exact snapshot. (The old PDF handler
  thinned too; the PDF is now the client-rendered sheet, which draws the
  on-screen partition and does not route through this snapshot.)
* **Plaxis never thins.** Both Plaxis exporters index ONE global
  `soillayer` stack that every borehole reuses, so an interleaved merge
  would need one global layer twice in a column — inexpressible. The
  script's mapping table names every unit separately instead.
* **"Adjacent"** is defined once, in that module's docstring: at a
  column, B is directly below A iff B's contact is A's immediate
  successor by depth. A and B merge iff they share the identifier, share
  at least one column, and B is directly below A at *every* column where
  both appear. One column with a third unit wedged between them vetoes
  the merge.
* **Shallower wins** — name, colour and formation reference all come
  from the shallower unit. The merge is a deletion of the deeper unit's
  top contacts, so the survivor's extent runs down to whatever lay
  below; nothing is recomputed.
* **Auditable** — the survivor carries `absorbed_unit_names`, and the
  mapping table grows an `Absorbed units` column *only* when something
  merged, so unthinned artefacts stay byte-identical.
* **Default ON with an opt-out** — `?thin_units=false` on the DXF
  endpoint. The merge erases a boundary the engineer drew, so a client
  whose CAD deliverable must show parent boundaries can get them without
  a code change.

**Collisions are expected, not defensive.** Two units legitimately share
a `(nad_class, soil)` pair — NAD 6 sand under two different geological
parents. The token is therefore not unique on its own; each exporter
disambiguates in its own namespace (DXF appends the formation short id,
because layer names are case-folded and capped at 255 chars; PLAXIS
appends ` #2`, because an identification has neither constraint) and the
mapping table carries the formation UUID, which is the real resolver.

**Plaxis 2D per-section exporter — shipped 2026-05-16 (debt #29).**
`PlaxisSectionExporter` consumes a `SectionSnapshot` (investigations
already projected onto the section line) and emits the same shape of
`plxscripting` script as the 3D exporter, but with Plaxis 2D's
single-coordinate `g_i.borehole(x)` placed at each column's
along-section distance. Columns without a surface elevation are
dropped (without Z the column cannot be placed on the level axis —
every `setsoillayerlevel` is an absolute level) and counted in
the script's print summary. Like the 3D exporter it emits `N + 1`
level boundaries per borehole (see above). **Neither Plaxis exporter sets a borehole
`Head`**: in PLAXIS that property is the water head (phreatic level),
not the soil-column top, and writing the surface elevation into it
made every exported model fully saturated (audit 2026-08-02). Both
script headers state that no water table was exported. Endpoint:
`GET /projects/{pid}/sections/{sid}/export/plaxis2d?model_id=...`
(mirrors the section DXF endpoint). Surfaced as a card in the
Export stage hub alongside section DXF; the model-wide Plaxis 3D
export stays its own card.

**Fence-diagram DXF exporter — shipped 2026-08-26 (owner ballot, v1.0
MVP).** `DxfFenceExporter` writes the 3-D fence diagram — the vertical
cross-section walls standing in world space — as a DXF the engineer
opens directly in AutoCAD / Civil3D. Endpoint:
`POST /projects/{pid}/geology/models/{mid}/export/fence-dxf`; toolbar
buttons on the Lithology and Geotechnical stages (never
`SectionsToolbar` — the fence is a 3-D artefact).

*Why DXF and not a scene screenshot.* A PNG is a picture: it cannot be
measured, overlaid on a site plan, or dropped into the drawing set that
is the actual deliverable. It is also the less robust option — a Cesium
capture needs `preserveDrawingBuffer` (a cost on every rendered frame)
and has no defined answer in the two-pane split view.

*Why the geometry travels up in the request.* Fence walls are
triangulated in the RENDERER by `buildProjectFence` → `buildFencePanels`
from the section partition engine, which has no server-side twin. The
request also carries the RENDERED name and colour per panel: both are
presentation-boundary values (litho labels are translated from the raw
soil code at render time; NAD packing colours override the inherited
lithology colour and are never stored), so a server that re-derived
them would produce a DXF disagreeing with the screen it was exported
from.

*Shape of the output.* One `3DFACE` per triangle, one layer per panel
name (sanitised to the DXF layer charset, collisions disambiguated),
layer true-colour from the panel. Interior edges — those shared by two
triangles — are hidden via the 3DFACE per-edge invisibility flags, so
CAD shows clean panel outlines rather than a triangle mesh; this is
deterministic edge counting, without the multi-loop failure modes a
boundary-walk would carry. Coordinates stay in the project CRS (metres,
no reprojection); `$INSUNITS` is metres and the EPSG rides in the
header as a custom property.

*Refusals are loud.* A triangle index out of range for its panel is a
422 naming the panel and index — a silently dropped face would ship a
hole in a deliverable. The client refuses BEFORE the request when no
panel carries geometry, because a valid empty DXF opens fine and reads
as "the model is empty", which is the one failure a CAD user cannot
detect by looking.

`DxfFenceExporter` does NOT subclass `SectionExporter`: that ABC's
`export` takes a `SectionSnapshot` (an application-layer output pulled
from the DB), and a fence panel is the opposite shape — pre-triangulated
client geometry. It takes a `FencePanelSource` Protocol instead, stated
structurally so infrastructure never imports the API request schema.
(Debt #109 covers splitting the ABC; this change does not attempt it.)
