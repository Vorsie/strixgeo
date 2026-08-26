# Export System

> Extracted from `CLAUDE.md` 2026-06-06 to keep the always-loaded file lean. Load this on demand when the pointer in CLAUDE.md says so.

## Export System

See `infrastructure/exporters/base_exporter.py` (`BaseExporter` ABC). Implement `PlaxisExporter`, `DStabilityExporter`, `GeoStudioExporter`, `DSheetExporter` in Phase 4 / early Phase 5. **Exports are how engineering happens** — once the ground model + parameters + statistics are exported, all design checks (bearing capacity, settlement, slope stability, etc.) run in the destination tool. The platform itself does not perform those calculations.

**Implementation note — Deltares D-Series via GEOLib.** The Deltares
D-Series (D-Stability `.stix`, D-Settlement `.sli`, D-Sheet Piling,
D-Foundations, ...) all share a single Python wrapper:
`pip install d-geolib` (MIT, actively maintained — v2.8.0 Sep 2025).
GEOLib lets us build a `DStabilityModel` (soils + polygonal layers
+ phreatic line + loads) in memory and serialise to `.stix` purely
in Python — no D-Stability install needed on the build machine.
That makes the D-Series exporters near-zero marginal cost once the
geometry contract is defined: one GEOLib call per target tool.
The probabilistic side (Probabilistic Toolkit / PTK) consumes
`.stix` downstream — Strix is the producer, PTK is not in our
integration surface.

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
* **PDF section report** — the figure legend leads with the token.

### Same-NAD thinning — DXF and PDF only (debt #104b)

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
  The DXF and PDF handlers pass `thin_units=True`; the helper defaults
  to `False`, so a new caller gets the exact snapshot.
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
* **Default ON with an opt-out** — `?thin_units=false` on the DXF and
  PDF endpoints. The merge erases a boundary the engineer drew, so a
  client whose CAD deliverable must show parent boundaries can get them
  without a code change.

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
