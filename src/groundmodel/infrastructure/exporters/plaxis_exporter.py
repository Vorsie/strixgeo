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
   surface elevation. Sets ``Head`` to the surface z.
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
    emit_global_layers,
    emit_imports_and_connect,
    emit_materials,
)
from groundmodel.infrastructure.exporters.project_exporter import ProjectExporter


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
            self.warning("Empty snapshot — emitted no-op script")
            return "\n".join(lines).encode("utf-8")
        lines.extend(emit_materials(formations_top_down))
        lines.extend(emit_global_layers(formations_top_down))
        lines.extend(self._emit_boreholes(ordered_columns, columns, formations_top_down))
        lines.append("")
        lines.append(
            f'print("Strix → PLAXIS: imported {len(ordered_columns)} borehole(s) '
            f'and {len(formations_top_down)} material(s).")'
        )
        lines.append("")

        script = "\n".join(lines)
        self.success(f"Plaxis 3D script emitted: {len(script)} bytes")
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
        return [
            '"""Plaxis 3D geometry import — generated by Strix.',
            "",
            f"Project       : {snapshot.project_name}",
            f"Project id    : {snapshot.project_id}",
            f"Horizontal CRS: EPSG:{snapshot.crs_epsg}",
            f"Investigations: {column_count}",
            f"Formations    : {len(formations)}",
            f"Generated     : {timestamp}",
            "",
            "USAGE",
            "-----",
            "1. Open PLAXIS 3D (2018 or newer).",
            "2. Expert → Configure remote scripting server → Enable. Note the port + password.",
            "3. Set HOST / PORT / PASSWORD below to match.",
            "4. Install the wrapper:  pip install plxscripting",
            "5. Run:  python <this_file>.py",
            "",
            "NOTES",
            "-----",
            "* Soil materials are Mohr-Coulomb PLACEHOLDERS — only the",
            "  identification name is set. Edit parameters in PLAXIS",
            "  after import, or rerun this script after extending Strix",
            "  with per-formation parameters (Phase 5).",
            "* Stratigraphic order follows display_order from Strix",
            "  (oldest first → PLAXIS layer 0 = topmost = youngest).",
            "* Boreholes without a recorded surface elevation are not",
            "  exportable to PLAXIS 3D and were dropped during snapshot",
            "  assembly. Set Z on those investigations in Strix to",
            "  include them.",
            "* If a plxscripting line errors against your PLAXIS",
            "  release, see https://github.com/cemsbv/plxscripting for",
            "  the current property names + adjust the lines below.",
            '"""',
            "",
        ]

    def _emit_boreholes(
        self,
        ordered_columns: list[tuple[float, float]],
        columns_layers: dict[tuple[float, float], list[LayerGeometry]],
        formations_top_down: list[FormationDisplay],
    ) -> list[str]:
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

        for i, (x, y) in enumerate(ordered_columns):
            column_layers = columns_layers[(x, y)]
            # Every layer in this column carries the same surface_elevation_m
            # and the same (x, y) — by construction in the snapshot builder.
            surface_z = column_layers[0].surface_elevation_m
            if surface_z is None:
                # Defensive — the builder filters these out, but if
                # the snapshot is hand-built skip with a comment.
                lines.append(f"# Skipped column ({x:.3f}, {y:.3f}) — no surface elevation.")
                continue

            # Map formation_name → depth_top_m for O(1) lookups while
            # walking the global order.
            depth_top_by_name: dict[str, float] = {
                ly.formation_name: ly.top_depth_m for ly in column_layers
            }
            deepest_base_m = max(ly.base_depth_m for ly in column_layers)

            bh_var = f"bh_{i}"
            lines.append(f"{bh_var} = g_i.borehole({x!r}, {y!r})  # surface z = {surface_z}")
            lines.append(f"{bh_var}.Head = {surface_z!r}")

            # Walk top-down; track "next present top z below" by
            # scanning bottom-up first to fill the cascade.
            present_top_z_below: list[float | None] = [None] * len(formation_names_top_down)
            running_next: float | None = surface_z - deepest_base_m
            for idx in range(len(formation_names_top_down) - 1, -1, -1):
                name = formation_names_top_down[idx]
                if name in depth_top_by_name:
                    z = surface_z - depth_top_by_name[name]
                    present_top_z_below[idx] = z
                    running_next = z
                else:
                    present_top_z_below[idx] = running_next

            for idx, name in enumerate(formation_names_top_down):
                top_z = present_top_z_below[idx]
                if top_z is None:
                    top_z = surface_z - deepest_base_m
                tag = "" if name in depth_top_by_name else "  # absent — zero thickness"
                lines.append(f"g_i.setsoillayerlevel({bh_var}, {idx}, {top_z!r}){tag}")
            lines.append("")

        return lines
