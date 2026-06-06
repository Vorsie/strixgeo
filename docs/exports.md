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

**Plaxis 2D per-section exporter — shipped 2026-05-16 (debt #29).**
`PlaxisSectionExporter` consumes a `SectionSnapshot` (investigations
already projected onto the section line) and emits the same shape of
`plxscripting` script as the 3D exporter, but with Plaxis 2D's
single-coordinate `g_i.borehole(x)` placed at each column's
along-section distance. Columns without a surface elevation are
dropped (a Plaxis borehole needs an absolute Head) and counted in
the script's print summary. Endpoint:
`GET /projects/{pid}/sections/{sid}/export/plaxis2d?model_id=...`
(mirrors the section DXF endpoint). Surfaced as a card in the
Export stage hub alongside section DXF; the model-wide Plaxis 3D
export stays its own card.
