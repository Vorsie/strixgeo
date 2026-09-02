"""Export a 1-D soil profile through one cross-section to D-Sheet Piling (``.shi``).

Scope decision (v1, 2026-08-26)
-------------------------------
D-Sheet Piling is a retaining-wall tool: its model is a wall, a set of
construction stages, water levels on both sides, surcharges, anchors —
and, underneath all of that, ONE 1-D soil profile per side. Strix knows
exactly one of those things. So the v1 export supplies the soil profile
and nothing else:

* the profile is sampled from the section's drawn partition at a
  **fraction along the section line**, mid-section by default, so an
  engineer picking a wall position exports the ground at that position;
* each layer is named by its unit identifier (``NAD-06_ZAND`` — see
  ``unit_identifier.py``, debt #104), so the profile keys onto the same
  materials as the DXF, Plaxis and D-Stability exports;
* the ground surface at the sampled position IS exported — a surface
  elevation is a measurement, not a design input;
* everything else D-Sheet demands is written into the file's
  ``[RUN IDENTIFICATION]`` block as an explicit ``TODO``. Never a
  default value: a guessed phreatic level changes every earth-pressure
  result, and a plausible number is indistinguishable from a measured
  one once it is in the file.

Same characterisation-only stance as every other Strix export
(CLAUDE.md "Core Philosophy"): strength, stiffness and unit weight stay
at D-Sheet's own initial values, which GEOLib sets to 0 / 0 / 0.01 —
unmistakably blanks.

How the 1-D column is read out of the 2-D partition
---------------------------------------------------
The vertical line at the sampled along-distance is intersected with
every drawn region. Each region contributes the elevation intervals
where that line is inside it (even-odd rule, so a non-convex region
correctly contributes two intervals). The intervals are then cut at
every boundary elevation and each resulting slab is attributed to the
region covering its midpoint, which makes overlaps deterministic and
holes visible. Slabs of the same unit are merged, and the result is the
top-down layer stack.

Two structural anomalies are counted and logged rather than silently
absorbed, because D-Sheet's profile has no way to express either: a
**hole** (no region covers a slab) would be swallowed by the layer
above it, and an **overlap** (two regions claim one slab) would be
resolved arbitrarily.

GEOLib quirks this exporter works around
----------------------------------------
* ``SoilProfile`` validates that layer tops are non-increasing, so two
  layers sharing a top elevation are rejected — hence the
  minimum-thickness floor.
* ``DSheetPilingModel.parse`` needs a real path (its ``filename`` field
  is a pydantic ``Path``), even though ``serialize`` accepts a buffer.
* A ``.shi`` is D-Series ASCII text, not JSON: it is written and read as
  cp1252, so non-ASCII unit names survive only within that repertoire.
"""

from __future__ import annotations

from io import BytesIO
from uuid import UUID

from geolib.geometry.one import Point
from geolib.models import DSheetPilingModel
from geolib.models.dsheetpiling.dsheetpiling_model import SheetModelType
from geolib.models.dsheetpiling.profiles import SoilLayer, SoilProfile
from geolib.models.dsheetpiling.settings import (
    LateralEarthPressureMethod,
    LateralEarthPressureMethodStage,
    PassiveSide,
    Side,
)
from geolib.models.dsheetpiling.surface import Surface
from geolib.models.dsheetpiling.water_level import WaterLevel
from geolib.soils import MohrCoulombParameters, Soil, SoilWeightParameters

from groundmodel.application.section_polygon_set import (
    SectionPolygon,
    SectionPolygonSet,
    SectionPolygonUnit,
)
from groundmodel.domain.services.nad_soil_parameters_constants import (
    SOURCE_LABEL,
    NadSoilParameters,
)
from groundmodel.infrastructure.exporters.ascii_fold import ascii_fold
from groundmodel.infrastructure.exporters.dsheet_piling_exporter_constants import (
    DEFAULT_SAMPLE_FRACTION,
    MIN_LAYER_THICKNESS_M,
    MIN_POLYGON_AREA_M2,
    MIN_POLYGON_POINTS,
    PROFILE_NAME,
    RUN_IDENTIFICATION_LINES,
    RUN_LINE_MISSING_INPUTS,
    RUN_LINE_PARAMETERS,
    RUN_LINE_PARAMETERS_FROM_TABLE,
    RUN_LINE_PROVENANCE,
    STAGE_NAME,
    SURFACE_NAME,
    TODO_WATER_LEVEL_M,
    TODO_WATER_LEVEL_NAME,
)
from groundmodel.infrastructure.exporters.nad_soil_parameter_lookup import (
    soil_parameters_for_unit,
)
from groundmodel.infrastructure.exporters.section_geometry_exporter import (
    SectionGeometryExporter,
)
from groundmodel.infrastructure.exporters.section_unit_labels import (
    build_unit_labels,
    label_collisions,
)


class DSheetPilingExporter(SectionGeometryExporter):
    """Serialise a 1-D profile through a ``SectionPolygonSet`` into a ``.shi``."""

    def __init__(self) -> None:
        """Initialise with this module's logger name."""
        super().__init__(__name__)

    def export(
        self,
        polygons: SectionPolygonSet,
        fraction: float = DEFAULT_SAMPLE_FRACTION,
    ) -> bytes:
        """Build the ``.shi`` input file for one position on one section.

        Parameters
        ----------
        polygons : SectionPolygonSet
            The section's drawn fill, resolved to absolute
            ``(along_m, elevation_m)`` rings.
        fraction : float, optional
            Where along the section line to sample, ``0.0`` at the
            section's start endpoint and ``1.0`` at its end. Defaults to
            mid-section.

        Returns
        -------
        bytes
            The complete ``.shi`` input file, cp1252-encoded D-Series
            ASCII.

        Raises
        ------
        ValueError
            When ``fraction`` falls outside ``[0, 1]``, or when the
            sampled position has no drawn ground — an empty profile is
            a plausible, correctly-named, completely wrong deliverable.
        """
        if not 0.0 <= fraction <= 1.0:
            self.error(
                f"D-Sheet Piling export refused: fraction={fraction} is outside "
                "[0, 1] — the sample would fall off the section line"
            )
            raise ValueError(
                f"Sample fraction {fraction} is outside the section: it must be "
                "between 0.0 (section start) and 1.0 (section end)."
            )

        along_m = fraction * polygons.section_length_m
        self.info(
            f"D-Sheet Piling export: section='{polygons.section_name}' "
            f"fraction={fraction:.3f} along={along_m:.2f} m "
            f"units={len(polygons.units)} regions={len(polygons.polygons)} "
            f"datum={polygons.vertical_datum_label}"
        )

        unit_by_id = {unit.formation_id: unit for unit in polygons.units}
        stack = self._sample_column(polygons.polygons, unit_by_id, along_m)
        if not stack:
            self.error(
                f"D-Sheet Piling export refused: section='{polygons.section_name}' has "
                f"no drawn ground at {along_m:.2f} m — "
                f"{len(polygons.polygons)} region(s) received, none spans that position"
            )
            raise ValueError(
                f"Cross-section '{polygons.section_name}' has no drawn ground at "
                f"{along_m:.2f} m along the line (fraction {fraction:.3f}). Draw the "
                "section fill there, or sample a different position."
            )

        labels = build_unit_labels(polygons.units)
        collisions = label_collisions(polygons.units)
        if collisions:
            self.warning(
                "D-Sheet Piling export: identifier collisions disambiguated with an "
                f"ordinal suffix — {collisions}"
            )

        ground_level_m = stack[0][0]
        model, parameterised = self._build_model(polygons, stack, labels, ground_level_m)
        self._stamp_run_identification(model, polygons, fraction, along_m, parameterised)

        buffer = BytesIO()
        model.serialize(buffer)
        payload = buffer.getvalue()

        self.success(
            f"D-Sheet Piling export written: section='{polygons.section_name}' "
            f"at {along_m:.2f} m — layers={len(stack)} "
            f"ground={ground_level_m:.2f} {polygons.vertical_datum_label} "
            f"base={stack[-1][2]:.2f} bytes={len(payload)}"
        )
        return payload

    def _build_model(
        self,
        polygons: SectionPolygonSet,
        stack: list[tuple[float, UUID, float]],
        labels: dict[UUID, str],
        ground_level_m: float,
    ) -> tuple[DSheetPilingModel, int]:
        """Assemble the GEOLib model; return it with the count of parameterised soils.

        Returns
        -------
        tuple[DSheetPilingModel, int]
            The model and how many soils carried NAD-table parameters. The
            count drives the ``[RUN IDENTIFICATION]`` provenance line — when it
            is zero the file keeps the parameters-at-defaults TODO.
        """
        model = DSheetPilingModel()
        model.set_model(SheetModelType(method=LateralEarthPressureMethod.KA_KO_KP))

        unit_by_id = {unit.formation_id: unit for unit in polygons.units}
        parameterised = 0
        soil_count = 0
        for formation_id in dict.fromkeys(entry[1] for entry in stack):
            unit = unit_by_id[formation_id]
            params = soil_parameters_for_unit(unit)
            model.add_soil(_build_soil(labels[formation_id], params))
            soil_count += 1
            if params is not None:
                parameterised += 1
                self.debug(
                    f"D-Sheet Piling soil added: name='{labels[formation_id]}' "
                    f"strix='{unit.name}' nad_class={unit.nad_class} "
                    f"soil={unit.litho_main_soil_code} parameters=NAD Tabel 2.b "
                    f"(gamma_unsat={params.gamma_unsat_kn_m3} "
                    f"gamma_sat={params.gamma_sat_kn_m3} phi={params.phi_deg} "
                    f"c={params.c_kpa})"
                )
            else:
                self.debug(
                    f"D-Sheet Piling soil added: name='{labels[formation_id]}' "
                    f"strix='{unit.name}' nad_class={unit.nad_class} "
                    f"soil={unit.litho_main_soil_code} "
                    "(strength / stiffness / unit weight left at D-Sheet defaults)"
                )
        self.info(
            f"D-Sheet Piling soil parameters: {parameterised}/{soil_count} soil(s) "
            f"carried NAD Tabel 2.b characteristic values, {soil_count - parameterised} "
            "left at D-Sheet's blank defaults"
        )

        stage_id = model.add_stage(
            name=STAGE_NAME,
            passive_side=PassiveSide.DSHEETPILING_DETERMINED,
            method_left=LateralEarthPressureMethodStage.KA_KO_KP,
            method_right=LateralEarthPressureMethodStage.KA_KO_KP,
        )

        profile = SoilProfile(
            name=PROFILE_NAME,
            layers=[
                SoilLayer(top_of_layer=top_m, soil=labels[formation_id])
                for top_m, formation_id, _ in stack
            ],
        )
        # Both sides get the same profile: Strix knows one ground model,
        # and D-Sheet's left/right split is an excavation concept the
        # engineer introduces, not something the section states.
        model.add_profile(profile, Side.LEFT, stage_id)
        model.add_profile(profile, Side.RIGHT, stage_id)

        surface = Surface(name=SURFACE_NAME, points=[Point(x=0.0, z=ground_level_m)])
        model.add_surface(surface, Side.LEFT, stage_id)
        model.add_surface(surface, Side.RIGHT, stage_id)

        # GEOLib writes a [WATERLEVELS] block regardless, so the water
        # table cannot be omitted — only labelled. See the constant.
        water_level = WaterLevel(level=TODO_WATER_LEVEL_M, name=TODO_WATER_LEVEL_NAME)
        model.add_head_line(water_level, Side.LEFT, stage_id)
        model.add_head_line(water_level, Side.RIGHT, stage_id)
        self.warning(
            "D-Sheet Piling export: no water table is known for this section — the "
            f"[WATERLEVELS] block carries GEOLib's own {TODO_WATER_LEVEL_M:.2f} "
            f"placeholder named '{TODO_WATER_LEVEL_NAME}', which the engineer must set"
        )
        return model, parameterised

    def _stamp_run_identification(
        self,
        model: DSheetPilingModel,
        polygons: SectionPolygonSet,
        fraction: float,
        along_m: float,
        parameterised: int,
    ) -> None:
        """Write the provenance + TODO lines into the ``.shi``, within budget.

        When ``parameterised`` is non-zero, line 3 names the NAD table the
        parameters came from (D-Sheet's ``[SOIL]`` block has no per-soil
        free-text field, so this block is where their provenance is stated);
        otherwise it keeps the parameters-at-defaults TODO.
        """
        # ASCII-folded: the .shi is cp1252, but every reader picks its own
        # encoding — GEOLib's own parser opens it with the ambient locale, so a
        # section named "A–A'" (EN DASH, cp1252 byte 0x96) parses on Windows
        # and dies with UnicodeDecodeError anywhere UTF-8 is the default.
        # Found by CI on Linux, Actions run 33135927403. These are free-text
        # provenance labels, so folding them costs nothing a reader needs. The
        # SOURCE_LABEL carries an em dash, so it too is folded to stay ASCII.
        if parameterised:
            parameters_line = RUN_LINE_PARAMETERS_FROM_TABLE.format(
                source_label=ascii_fold(SOURCE_LABEL)
            )
        else:
            parameters_line = RUN_LINE_PARAMETERS
        lines = (
            RUN_LINE_PROVENANCE.format(
                project_name=ascii_fold(polygons.project_name),
                section_name=ascii_fold(polygons.section_name),
                along_m=along_m,
                fraction=fraction,
                datum=ascii_fold(polygons.vertical_datum_label),
            ),
            RUN_LINE_MISSING_INPUTS.format(water_level_name=TODO_WATER_LEVEL_NAME),
            parameters_line,
        )
        if len(lines) != RUN_IDENTIFICATION_LINES:
            # A fourth line lands in the file and is never shown to the
            # engineer, which for a TODO is the same as not writing it.
            self.warning(
                f"D-Sheet Piling export: {len(lines)} run-identification line(s) "
                f"written but D-Sheet's GUI shows only {RUN_IDENTIFICATION_LINES} — "
                "the surplus is invisible to the engineer"
            )
        model.datastructure.input_data.run_identification = "\n".join(lines)

    def _sample_column(
        self,
        polygons: tuple[SectionPolygon, ...],
        unit_by_id: dict[UUID, SectionPolygonUnit],
        along_m: float,
    ) -> list[tuple[float, UUID, float]]:
        """Read the top-down layer stack out of the 2-D fill at one position.

        Parameters
        ----------
        polygons : tuple[SectionPolygon, ...]
            The section's drawn regions.
        unit_by_id : dict[UUID, SectionPolygonUnit]
            Units the regions may reference; a region naming anything
            else is dropped.
        along_m : float
            Along-section distance of the vertical sample line.

        Returns
        -------
        list[tuple[float, UUID, float]]
            ``(top_elevation_m, formation_id, base_elevation_m)`` per
            merged run, ordered top-down. Empty when nothing is drawn at
            that position.
        """
        spans: list[tuple[float, float, UUID]] = []
        for index, polygon in enumerate(polygons, start=1):
            if polygon.formation_id not in unit_by_id:
                self.warning(
                    f"[{index}/{len(polygons)}] D-Sheet Piling sampling skipped a region "
                    f"whose unit is not in the section's unit list "
                    f"(gap={polygon.gap_index} formation={polygon.formation_id})"
                )
                continue
            if len(polygon.points) < MIN_POLYGON_POINTS:
                continue
            if _ring_area(polygon.points) < MIN_POLYGON_AREA_M2:
                continue
            for top_m, base_m in _vertical_spans(polygon.points, along_m):
                spans.append((top_m, base_m, polygon.formation_id))

        if not spans:
            return []

        boundaries = sorted({edge for top_m, base_m, _ in spans for edge in (top_m, base_m)})
        stack: list[tuple[float, UUID, float]] = []
        holes: list[tuple[float, float]] = []
        overlaps = 0
        for lower_m, upper_m in zip(boundaries, boundaries[1:], strict=False):
            if upper_m - lower_m < MIN_LAYER_THICKNESS_M:
                continue
            middle_m = (lower_m + upper_m) / 2.0
            covering = [
                formation_id for top_m, base_m, formation_id in spans if base_m <= middle_m <= top_m
            ]
            if not covering:
                holes.append((upper_m, lower_m))
                continue
            if len(set(covering)) > 1:
                overlaps += 1
            stack.append((upper_m, covering[0], lower_m))

        stack.sort(key=lambda entry: entry[0], reverse=True)
        merged = _merge_runs(stack)

        if holes:
            self.warning(
                f"D-Sheet Piling sampling found {len(holes)} unfilled interval(s) at "
                f"{along_m:.2f} m — {[f'{t:.2f}..{b:.2f}' for t, b in holes]}. D-Sheet "
                "has no void, so the layer above each one now runs through it."
            )
        if overlaps:
            self.warning(
                f"D-Sheet Piling sampling found {overlaps} interval(s) claimed by more "
                f"than one unit at {along_m:.2f} m — the first drawn region won each"
            )
        self.debug(
            f"D-Sheet Piling column at {along_m:.2f} m: {len(spans)} span(s) from "
            f"{len(polygons)} region(s) -> {len(merged)} layer(s)"
        )
        return merged


def _build_soil(label: str, params: NadSoilParameters | None) -> Soil:
    """Build a D-Sheet soil for a profile layer, with NAD parameters when present.

    Parameters
    ----------
    label : str
        The unique export label; it is both the soil ``name`` and ``code``
        because D-Sheet references a profile layer's soil by name.
    params : NadSoilParameters | None
        Characteristic parameters for the unit's NAD class, or ``None`` when
        the class is not in the table. When ``None`` the soil carries no
        parameters — GEOLib leaves its own blank initial values (0.01 kN/m³
        unit weight, cohesion / phi 0) — never an invented default.

    Returns
    -------
    Soil
        A GEOLib soil whose cohesion, friction angle and both unit weights map
        onto D-Sheet's ``SoilCohesion`` / ``SoilPhi`` / ``SoilGamDry`` /
        ``SoilGamWet`` when parameterised.
    """
    if params is None:
        return Soil(name=label, code=label)
    return Soil(
        name=label,
        code=label,
        mohr_coulomb_parameters=MohrCoulombParameters(
            cohesion=params.c_kpa, friction_angle=params.phi_deg
        ),
        soil_weight_parameters=SoilWeightParameters(
            unsaturated_weight=params.gamma_unsat_kn_m3,
            saturated_weight=params.gamma_sat_kn_m3,
        ),
    )


def _merge_runs(stack: list[tuple[float, UUID, float]]) -> list[tuple[float, UUID, float]]:
    """Collapse consecutive slabs of the same unit into one layer."""
    merged: list[tuple[float, UUID, float]] = []
    for top_m, formation_id, base_m in stack:
        if merged and merged[-1][1] == formation_id:
            previous_top, _, _ = merged[-1]
            merged[-1] = (previous_top, formation_id, base_m)
            continue
        merged.append((top_m, formation_id, base_m))
    return merged


def _vertical_spans(
    points: tuple[tuple[float, float], ...],
    along_m: float,
) -> list[tuple[float, float]]:
    """Elevation intervals where the vertical line at ``along_m`` is inside a ring.

    Uses the even-odd rule over the ring's edge crossings, with a
    half-open horizontal test so a vertex sitting exactly on the sample
    line is counted once rather than twice.

    Two consequences of the half-open rule, both deliberate:

    * a sample landing exactly ON a column belongs to the gap to its
      RIGHT, so the two gaps sharing that column never both contribute
      and the stack is unambiguous;
    * a sample landing exactly on the drawn fill's RIGHT-most edge falls
      outside every region and yields nothing. The caller then refuses
      the export with a message naming the position, which is honest —
      but it means ``fraction=1.0`` on a section whose last column sits
      at the line's end has no profile. Sample just inside instead.

    Parameters
    ----------
    points : tuple[tuple[float, float], ...]
        The ring as ``(along_m, elevation_m)`` pairs, not closed.
    along_m : float
        Along-section distance of the sample line.

    Returns
    -------
    list[tuple[float, float]]
        ``(top_elevation_m, base_elevation_m)`` per interval, ordered
        top-down. Empty when the line misses the ring.
    """
    crossings: list[float] = []
    count = len(points)
    for i in range(count):
        x1, z1 = points[i]
        x2, z2 = points[(i + 1) % count]
        if (x1 <= along_m < x2) or (x2 <= along_m < x1):
            crossings.append(z1 + (z2 - z1) * (along_m - x1) / (x2 - x1))
    crossings.sort()
    return [(crossings[i + 1], crossings[i]) for i in range(0, len(crossings) - 1, 2)][::-1]


def _ring_area(points: tuple[tuple[float, float], ...]) -> float:
    """Absolute shoelace area of a ring, in m^2 (winding-agnostic)."""
    total = 0.0
    count = len(points)
    for i in range(count):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % count]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0
