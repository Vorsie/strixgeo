"""PLAXIS 3D exporter — emits a runnable ``plxscripting`` Python script.

Decided 2026-05-14 (see CLAUDE.md "Export System"): target Plaxis
2D/3D 2018+, output a self-contained ``.py`` script the engineer
runs against their own Plaxis instance. No live Plaxis dependency
at our build/test time; the script is human-readable so engineers
can patch a line if their Plaxis version's API surface differs.

The emitted script:

1. Connects to a running PLAXIS 3D via its Remote Scripting Server
   (``plxscripting.easy.new_server``).
2. Calls ``g_i.new()`` to start a fresh project (idempotent re-runs).
3. Creates one Mohr-Coulomb-placeholder ``soilmat`` per formation
   — Identification only, no stiffness/strength (per MVP gate).
4. Creates one global ``soillayer`` per formation, ordered TOP-DOWN
   (youngest first = highest ``display_order`` first). Assigns the
   matching material to each.
5. Creates one ``borehole`` per investigation column with a known
   surface elevation.  It does NOT set ``Head``: in PLAXIS that is
   the borehole's water head (phreatic level), which Strix does not
   know — the column top is communicated by ``setsoillayerlevel``
   below.  The script header tells the engineer the water table was
   left unset (audit 2026-08-02).
6. For each (borehole, global layer) pair, calls
   ``g_i.setsoillayerlevel`` with the contact's absolute z
   (``surface_elevation - depth_top``). Formations absent at a
   borehole inherit the next-deeper present formation's top z
   (zero-thickness — Plaxis 3D handles this natively).

What this exporter intentionally does NOT do:

* No parameter values on the materials. Phase 5 owns that slice.
* No Plaxis 2D per-section variant — same data shape applies
  but the projection step is the section snapshot's job; the
  section-scoped exporter will sit alongside this one when it
  lands.
* No round-trip validation against a real Plaxis — we own the
  geometry contract, not Plaxis's parser quirks across releases.
  The script's header tells the engineer to adjust if a line errors.

Shared script primitives (imports/connect, materials, global-layers,
material_variable_name, py_str) live in ``plaxis_script_helpers`` —
the 2D exporter (``PlaxisSectionExporter``) uses the same helpers,
so a Plaxis-API change is fixed in one place (debt #110 / #169).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime

from groundmodel.application.ground_model_snapshot import (
    FormationDisplay,
    GroundModelSnapshot,
    LayerGeometry,
)
from groundmodel.infrastructure.exporters.plaxis_script_helpers import (
    emit_borehole_layer_levels,
    emit_global_layers,
    emit_header,
    emit_imports_and_connect,
    emit_materials,
    plaxis_mapping_rows,
)
from groundmodel.infrastructure.exporters.project_exporter import ProjectExporter
from groundmodel.infrastructure.exporters.unit_identifier import format_mapping_table
from groundmodel.infrastructure.exporters.unit_identifier_constants import (
    MAPPING_TABLE_PLAXIS_MATERIAL_HEADING,
)


class PlaxisExporter(ProjectExporter):
    """Exports a ground-model snapshot to a runnable Plaxis 3D Python script."""

    def __init__(self) -> None:
        """Initialise with the standard module-named logger."""
        super().__init__(__name__)

    def export(self, snapshot: GroundModelSnapshot) -> bytes:
        """Serialise the snapshot to a ``plxscripting`` Python script.

        Parameters
        ----------
        snapshot : GroundModelSnapshot
            Project + geological-model geometry assembled by
            ``application/build_ground_model_snapshot.py``.

        Returns
        -------
        bytes
            UTF-8 encoded Python source. Suitable for writing to a
            ``.py`` file or returning from a FastAPI endpoint with
            ``media_type="text/x-python"``.
        """
        self.info(
            f"Exporting Plaxis 3D script: project={snapshot.project_id} "
            f"layers={len(snapshot.layers)} formations={len(snapshot.formations)}"
        )

        # Group layers by (x, y) — that's the investigation column.
        # We don't carry investigation_id on LayerGeometry, so (x, y)
        # is the natural grouping key. Same column = same coordinates.
        columns: dict[tuple[float, float], list[LayerGeometry]] = defaultdict(list)
        for layer in snapshot.layers:
            columns[(layer.location_x, layer.location_y)].append(layer)

        # Sort formations top-down (Plaxis layer 0 = topmost = youngest
        # = highest display_order). CLAUDE.md defines display_order
        # ASC = oldest, so DESC = youngest-first.
        formations_top_down = sorted(snapshot.formations, key=lambda f: (-f.display_order, f.name))

        # Order columns deterministically so the emitted script is
        # diff-friendly across re-exports (handy for users keeping
        # the script under version control).
        ordered_columns = sorted(columns.keys())

        lines: list[str] = []
        lines.extend(self._emit_header(snapshot, len(ordered_columns), formations_top_down))
        lines.extend(emit_imports_and_connect())
        if not formations_top_down or not ordered_columns:
            lines.append('print("Strix → PLAXIS: nothing to export (empty snapshot).")')
            # Carry the project identity + which half was empty so the no-op
            # export is attributable (was a bare "empty snapshot" with no way to
            # tell WHICH project or whether formations vs columns were missing).
            self.warning(
                f"Plaxis 3D empty snapshot — emitted no-op script "
                f"(project={snapshot.project_name!r} id={snapshot.project_id} "
                f"{len(formations_top_down)} formations, {len(ordered_columns)} columns)"
            )
            return "\n".join(lines).encode("utf-8")
        lines.extend(emit_materials(formations_top_down))
        lines.extend(emit_global_layers(formations_top_down))
        borehole_lines, skipped_columns = self._emit_boreholes(
            ordered_columns, columns, formations_top_down
        )
        lines.extend(borehole_lines)
        lines.append("")
        lines.append(
            f'print("Strix → PLAXIS: imported {len(ordered_columns)} borehole(s) '
            f'and {len(formations_top_down)} material(s).")'
        )
        lines.append("")

        script = "\n".join(lines)
        # A dropped borehole (no surface Z) was previously only a comment INSIDE
        # the emitted script — invisible to an operator who never opens the file.
        # Surface it as a WARNING with the project identity + count.
        if skipped_columns:
            self.warning(
                f"Plaxis 3D export skipped {skipped_columns} borehole(s) with no "
                f"surface elevation (project={snapshot.project_name!r} id={snapshot.project_id})"
            )
        emitted_columns = len(ordered_columns) - skipped_columns
        self.success(
            f"Plaxis 3D script emitted: {len(script)} bytes "
            f"(project={snapshot.project_name!r}, "
            f"{emitted_columns}/{len(ordered_columns)} boreholes, "
            f"{len(formations_top_down)} formations, {skipped_columns} skipped)"
        )
        return script.encode("utf-8")

    # ------------------------------------------------------------------
    # Sections of the emitted script
    # ------------------------------------------------------------------

    def _emit_header(
        self,
        snapshot: GroundModelSnapshot,
        column_count: int,
        formations: list[FormationDisplay],
    ) -> list[str]:
        """Emit the docstring + version header at the top of the script."""
        timestamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%SZ")
        return emit_header(
            "Plaxis 3D geometry import — generated by Strix.",
            [
                f"Project       : {snapshot.project_name}",
                f"Project id    : {snapshot.project_id}",
                f"Horizontal CRS: EPSG:{snapshot.crs_epsg}",
                f"Investigations: {column_count}",
                f"Formations    : {len(formations)}",
                f"Generated     : {timestamp}",
            ],
            [
                "1. Open PLAXIS 3D (2018 or newer).",
                "2. Expert → Configure remote scripting server → Enable. Note the port + password.",
                "3. Set HOST / PORT / PASSWORD below to match.",
                "4. Install the wrapper:  pip install plxscripting",
                "5. Run:  python <this_file>.py",
            ],
            [
                "* Soil materials are Mohr-Coulomb PLACEHOLDERS — only the",
                "  identification name is set. Edit parameters in PLAXIS",
                "  after import, or rerun this script after extending Strix",
                "  with per-formation parameters (Phase 5).",
                "* Stratigraphic order follows display_order from Strix",
                "  (oldest first → PLAXIS layer 0 = topmost = youngest).",
                "* NO WATER TABLE IS SET. This script writes geometry only —",
                "  it does not set any borehole Head (phreatic level), so",
                "  PLAXIS uses its own default. Set the water table before",
                "  generating initial stresses; Strix does not export one.",
                "* Boreholes without a recorded surface elevation are not",
                "  exportable to PLAXIS 3D and were dropped during snapshot",
                "  assembly. Set Z on those investigations in Strix to",
                "  include them.",
                "* If a plxscripting line errors against your PLAXIS",
                "  release, see https://github.com/cemsbv/plxscripting for",
                "  the current property names + adjust the lines below.",
            ],
            # debt #104 — the unit identifiers a downstream tool maps onto
            # material definitions. Rows follow the emitted material order.
            format_mapping_table(
                plaxis_mapping_rows(formations),
                label_heading=MAPPING_TABLE_PLAXIS_MATERIAL_HEADING,
            ),
        )

    def _emit_boreholes(
        self,
        ordered_columns: list[tuple[float, float]],
        columns_layers: dict[tuple[float, float], list[LayerGeometry]],
        formations_top_down: list[FormationDisplay],
    ) -> tuple[list[str], int]:
        """Emit one borehole + per-layer setsoillayerlevel block per column.

        For each borehole, walks the global formation list in order
        and computes the top z at this borehole:

        * If the borehole has a contact for that formation → use it.
        * If absent → inherit the top z of the next-deeper present
          formation (zero-thickness layer; PLAXIS 3D handles natively).
        * If absent AND no deeper formation present → use the
          borehole's deepest known base (so the layer collapses to
          the column bottom).
        """
        lines = ["# ---- Boreholes ----"]
        formation_names_top_down = [f.name for f in formations_top_down]
        skipped = 0

        for i, (x, y) in enumerate(ordered_columns):
            column_layers = columns_layers[(x, y)]
            # Every layer in this column carries the same surface_elevation_m
            # and the same (x, y) — by construction in the snapshot builder.
            surface_z = column_layers[0].surface_elevation_m
            if surface_z is None:
                # Defensive — the builder filters these out, but if
                # the snapshot is hand-built skip with a comment. The comment
                # lands in the emitted script; the count is returned so the
                # caller can also log it (a script comment is invisible to an
                # operator who never opens the file).
                lines.append(f"# Skipped column ({x:.3f}, {y:.3f}) — no surface elevation.")
                skipped += 1
                continue

            # Map formation_name → depth_top_m for O(1) lookups while
            # walking the global order.
            depth_top_by_name: dict[str, float] = {
                ly.formation_name: ly.top_depth_m for ly in column_layers
            }
            deepest_base_m = max(ly.base_depth_m for ly in column_layers)

            bh_var = f"bh_{i}"
            # No ``.Head`` here on purpose: a PLAXIS borehole's Head is the
            # WATER head (phreatic level), not the top of the soil column.
            # Setting it to the surface elevation generated a fully saturated
            # model at every column (audit 2026-08-02). The column top is
            # emitted by setsoillayerlevel below; the water table stays the
            # engineer's to set, and the header says so.
            lines.append(f"{bh_var} = g_i.borehole({x!r}, {y!r})  # surface z = {surface_z}")

            lines.extend(
                emit_borehole_layer_levels(
                    bh_var,
                    formation_names_top_down,
                    depth_top_by_name,
                    surface_z,
                    surface_z - deepest_base_m,
                )
            )
            lines.append("")

        return lines, skipped
