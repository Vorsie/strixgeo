"""PLAXIS 2D per-section exporter — emits a runnable ``plxscripting`` script.

The section-scoped sibling of ``PlaxisExporter`` (debt #29). Where the
3D exporter consumes a project-wide ``GroundModelSnapshot`` and places
one borehole per investigation at its (x, y), the 2D exporter consumes
a ``SectionSnapshot`` — the investigations already projected onto the
section line — and places one borehole per column at its **along-
section distance** (Plaxis 2D's borehole takes a single coordinate).

The emitted script:

1. Connects to a running PLAXIS 2D via its Remote Scripting Server
   (``plxscripting.easy.new_server``).
2. Calls ``g_i.new()`` to start a fresh project (idempotent re-runs).
3. Creates one Mohr-Coulomb-placeholder ``soilmat`` per formation —
   Identification only, no stiffness/strength (per the MVP gate).
4. Creates one global ``soillayer`` per formation, ordered TOP-DOWN
   (youngest first = highest ``display_order`` first), each assigned
   its placeholder material.
5. Creates one ``borehole`` per projected column at its along-section
   x.  It does NOT set ``Head``: in PLAXIS that is the borehole's
   water head (phreatic level), which Strix does not know — the
   column top is communicated by ``setsoillayerlevel`` below.  The
   script header tells the engineer the water table was left unset
   (audit 2026-08-02).
6. For each (borehole, global layer) pair, calls
   ``g_i.setsoillayerlevel`` with the contact's absolute level
   (``surface_elevation - depth_top``). Formations absent at a column
   inherit the next-deeper present formation's top level (zero
   thickness — PLAXIS handles this natively).

What this exporter intentionally does NOT do:

* No parameter values on the materials. Phase 5 owns that slice.
* No phreatic line, no loads, no mesh — geometry contract only, same
  as the DXF + Plaxis-3D exporters.
* No round-trip validation against a real Plaxis — we own the
  geometry contract, not Plaxis's parser quirks across releases.
  The script header tells the engineer to adjust if a line errors.

Columns whose investigation has no recorded surface elevation are
dropped (without Z the column cannot be placed on the level axis —
every ``setsoillayerlevel`` is an absolute level). The script's
print summary reports how many were skipped so the engineer knows to
set Z on those investigations in Strix and re-export.

Shared script primitives (imports/connect, materials, global-layers,
material_variable_name, py_str) live in ``plaxis_script_helpers`` —
the 3D exporter (``PlaxisExporter``) uses the same helpers, so a
Plaxis-API change is fixed in one place (debt #110 / #169).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from uuid import UUID

from groundmodel.application.section_snapshot import (
    SectionFormation,
    SectionInvestigationProjection,
    SectionSnapshot,
)
from groundmodel.infrastructure.exporters.plaxis_script_helpers import (
    emit_borehole_layer_levels,
    emit_global_layers,
    emit_header,
    emit_imports_and_connect,
    emit_materials,
    plaxis_mapping_rows,
    sanitize_script_text,
)
from groundmodel.infrastructure.exporters.section_exporter import SectionExporter
from groundmodel.infrastructure.exporters.unit_identifier import format_mapping_table
from groundmodel.infrastructure.exporters.unit_identifier_constants import (
    MAPPING_TABLE_PLAXIS_MATERIAL_HEADING,
)


class PlaxisSectionExporter(SectionExporter):
    """Exports ONE cross-section's drawn geology to a Plaxis 2D script."""

    def __init__(self) -> None:
        """Initialise with the standard module-named logger."""
        super().__init__(__name__)

    def export(self, snapshot: SectionSnapshot) -> bytes:
        """Serialise the section snapshot to a ``plxscripting`` script.

        Parameters
        ----------
        snapshot : SectionSnapshot
            Section geometry assembled by
            ``application/build_section_snapshot.py``.

        Returns
        -------
        bytes
            UTF-8 encoded Python source. Suitable for writing to a
            ``.py`` file or returning from a FastAPI endpoint with
            ``media_type="text/x-python"``.
        """
        self.info(
            f"Exporting Plaxis 2D script: project={snapshot.project_id} "
            f"section={snapshot.section_name!r} "
            f"investigations={len(snapshot.investigations)} "
            f"formations={len(snapshot.formations)} "
            f"contacts={len(snapshot.contacts)}"
        )

        # Formations top-down: Plaxis layer 0 = topmost = youngest =
        # highest display_order. CLAUDE.md defines display_order ASC =
        # oldest, so DESC = youngest-first. Name tie-break keeps the
        # emitted script diff-stable across re-exports.
        formations_top_down = sorted(snapshot.formations, key=lambda f: (-f.display_order, f.name))

        # depth_top by (investigation_id, formation_id). The section
        # snapshot already carries level_m = surface - depth; we keep
        # depth_m here and recompute level from the column's surface so
        # every layer in a column shares one consistent datum even if a
        # contact's level_m was computed before a later Z edit.
        depth_by_inv_form: dict[UUID, dict[UUID, float]] = defaultdict(dict)
        for c in snapshot.contacts:
            depth_by_inv_form[c.investigation_id][c.formation_id] = c.depth_m

        # Columns = investigations that have a surface elevation. A
        # Plaxis borehole needs an absolute Head; without Z we cannot
        # place the column on the level axis, so it is dropped (same
        # rule as the 3D exporter) and counted for the summary.
        exportable = [inv for inv in snapshot.investigations if inv.surface_elevation_m is not None]
        # Deterministic left-to-right order along the section.
        exportable.sort(key=lambda inv: (inv.along_distance_m, inv.name))
        skipped_no_z = len(snapshot.investigations) - len(exportable)

        lines: list[str] = []
        lines.extend(
            self._emit_header(snapshot, len(exportable), formations_top_down, skipped_no_z)
        )
        lines.extend(emit_imports_and_connect())

        if not formations_top_down or not exportable:
            lines.append(
                'print("Strix \\u2192 PLAXIS 2D: nothing to export '
                '(no formations or no investigations with surface Z).")'
            )
            self.warning(
                "Empty section snapshot for Plaxis 2D — emitted no-op script "
                f"(formations={len(formations_top_down)} "
                f"exportable_columns={len(exportable)})"
            )
            return "\n".join(lines).encode("utf-8")

        lines.extend(emit_materials(formations_top_down))
        lines.extend(emit_global_layers(formations_top_down))
        lines.extend(self._emit_boreholes(exportable, depth_by_inv_form, formations_top_down))
        lines.append("")
        lines.append(
            f'print("Strix \\u2192 PLAXIS 2D: imported {len(exportable)} borehole(s) '
            f"and {len(formations_top_down)} material(s) "
            f'(skipped {skipped_no_z} column(s) without surface Z).")'
        )
        lines.append("")

        script = "\n".join(lines)
        # Identifier coverage (debt #104): "my geotech script has no NAD
        # material names" must be diagnosable from the log alone — nad=0
        # says the units were never classified, not that we dropped them.
        named = sum(1 for f in formations_top_down if f.nad_class is not None)
        with_soil = sum(1 for f in formations_top_down if f.litho_main_soil_code)
        self.success(
            f"Plaxis 2D script emitted: {len(script)} bytes "
            f"({len(exportable)} columns, {skipped_no_z} skipped, "
            f"{len(formations_top_down)} materials "
            f"[nad-named {named}, soil-tagged {with_soil}])"
        )
        return script.encode("utf-8")

    # ------------------------------------------------------------------
    # Sections of the emitted script
    # ------------------------------------------------------------------

    def _emit_header(
        self,
        snapshot: SectionSnapshot,
        column_count: int,
        formations: list[SectionFormation],
        skipped_no_z: int,
    ) -> list[str]:
        """Emit the docstring + provenance header at the top of the script."""
        timestamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%SZ")
        notes = [
            "* The X axis is along-section distance from the section's",
            "  start endpoint (metres). Each borehole sits at its",
            "  projected along-distance — the section view's geometry.",
            "* Soil materials are Mohr-Coulomb PLACEHOLDERS — only the",
            "  identification name is set. Edit parameters in PLAXIS",
            "  after import, or rerun after extending Strix with",
            "  per-formation parameters (Phase 5).",
            "* Stratigraphic order follows display_order from Strix",
            "  (oldest first -> PLAXIS layer 0 = topmost = youngest).",
            "* NO WATER TABLE IS SET. This script writes geometry only —",
            "  it does not set any borehole Head (phreatic level), so",
            "  PLAXIS uses its own default. Set the water table before",
            "  generating initial stresses; Strix does not export one.",
        ]
        if skipped_no_z:
            notes.append(f"* {skipped_no_z} column(s) lacked a surface elevation and")
            notes.append("  were dropped — without Z the column cannot be placed")
            notes.append("  on the level axis. Set Z in Strix and re-export.")
        notes.extend(
            [
                "* If a plxscripting line errors against your PLAXIS",
                "  release, see https://github.com/cemsbv/plxscripting for",
                "  the current property names + adjust the lines below.",
            ]
        )
        return emit_header(
            "Plaxis 2D section geometry import — generated by Strix.",
            [
                f"Project       : {snapshot.project_name}",
                f"Project id    : {snapshot.project_id}",
                f"Section       : {snapshot.section_name}",
                f"Section length: {snapshot.section_length_m:.2f} m",
                f"Horizontal CRS: EPSG:{snapshot.crs_epsg}",
                f"Vertical datum: {snapshot.vertical_datum_label}",
                f"Investigations: {column_count} exported",
                f"Formations    : {len(formations)}",
                f"Generated     : {timestamp}",
            ],
            [
                "1. Open PLAXIS 2D (2018 or newer).",
                "2. Expert -> Configure remote scripting server -> Enable. "
                "Note the port + password.",
                "3. Set HOST / PORT / PASSWORD below to match.",
                "4. Install the wrapper:  pip install plxscripting",
                "5. Run:  python <this_file>.py",
            ],
            notes,
            # debt #104 — the unit identifiers a downstream tool maps onto
            # material definitions. Rows follow the emitted material order.
            format_mapping_table(
                plaxis_mapping_rows(formations),
                label_heading=MAPPING_TABLE_PLAXIS_MATERIAL_HEADING,
            ),
        )

    def _emit_boreholes(
        self,
        exportable: list[SectionInvestigationProjection],
        depth_by_inv_form: dict[UUID, dict[UUID, float]],
        formations_top_down: list[SectionFormation],
    ) -> list[str]:
        """Emit one borehole + per-layer setsoillayerlevel block per column.

        For each column, walks the global formation list top-down and
        computes the top level at this column:

        * If the column has a contact for that formation -> use
          ``surface - depth_top``.
        * If absent -> inherit the top level of the next-deeper present
          formation (zero-thickness layer; PLAXIS handles natively).
        * If absent AND no deeper formation present -> use the column
          bottom (``surface - total_depth`` or the deepest contact).
        """
        lines = ["# ---- Boreholes (one per projected column) ----"]
        formation_ids_top_down = [f.formation_id for f in formations_top_down]

        for i, inv in enumerate(exportable):
            surface_z = inv.surface_elevation_m
            # exportable was filtered on surface_elevation_m is not None;
            # this assertion documents the invariant for the reader.
            assert surface_z is not None  # noqa: S101
            depth_top_by_form: dict[UUID, float] = depth_by_inv_form.get(inv.investigation_id, {})

            # Column bottom for the inherit cascade: prefer the recorded
            # total depth, else the deepest contact depth, else 0 (a
            # bare column with no contacts collapses to the surface).
            if inv.total_depth_m is not None:
                deepest_depth = inv.total_depth_m
            elif depth_top_by_form:
                deepest_depth = max(depth_top_by_form.values())
            else:
                deepest_depth = 0.0
            bottom_z = surface_z - deepest_depth

            bh_var = f"bh_{i}"
            x = inv.along_distance_m
            # No ``.Head`` here on purpose: a PLAXIS borehole's Head is the
            # WATER head (phreatic level), not the top of the soil column.
            # Setting it to the surface elevation generated a fully saturated
            # model at every column (audit 2026-08-02). The column top is
            # emitted by setsoillayerlevel below; the water table stays the
            # engineer's to set, and the header says so.
            # ``inv.name`` is user text spliced into a ``#`` comment — a
            # newline in it would end the comment and drop the rest onto its
            # own line as code. Route it through the shared sanitiser.
            lines.append(
                f"{bh_var} = g_i.borehole({x!r})  "
                f"# {sanitize_script_text(inv.name)} @ along={x:.3f} m, "
                f"surface z = {surface_z!r}"
            )

            lines.extend(
                emit_borehole_layer_levels(
                    bh_var,
                    formation_ids_top_down,
                    depth_top_by_form,
                    surface_z,
                    bottom_z,
                )
            )
            lines.append("")

        return lines
