"""Export one cross-section's drawn geometry to Deltares D-Stability (``.stix``).

What this exporter states, and what it deliberately does not
------------------------------------------------------------
D-Stability's geometry IS a set of closed soil-layer polygons, so this
is the first Strix export that carries the section fill itself rather
than the picks behind it. Each region of the drawn partition becomes
one D-Stability layer, and each Strix unit becomes one D-Stability soil
named by its export identifier (``NAD-06_ZAND`` — see
``unit_identifier.py``, debt #104), with its NAD class, soil code and
Strix formation id in the layer note.

**No design parameter is written.** Cohesion, friction angle and both
unit weights are left exactly as GEOLib initialises a new soil — zero.
That is the product's liability line (CLAUDE.md "Core Philosophy"):
Strix ships characterisation outputs, and a strength value that goes
into a ULS/SLS check without intermediate judgement is not our output.
A zero is chosen over a plausible-looking default on purpose: it is
unmistakably a blank the engineer must fill, where ``phi = 30`` would
read as a value Strix stood behind. The same reasoning governs what
else is absent — no phreatic line, no head line, no load, no
reinforcement. We never observed a water table on this section, so the
export never states one.

GEOLib quirks this exporter works around
----------------------------------------
* ``DStabilityModel.is_valid`` is **False for any model with no layer
  loads** — its ``is_valid_layer_loads`` check requires the set of
  loaded layers to equal the set of soil layers, so a perfectly good
  geometry-only model fails it. The export is therefore never gated on
  ``is_valid``; correctness is verified by GEOLib parsing its own
  output back (``tests/unit/infrastructure/exporters``).
* ``add_layer`` runs the ring through shapely ``make_valid``. A
  zero-area ring becomes a ``MultiLineString`` and a self-intersecting
  ring becomes a ``MultiPolygon``; both raise an opaque
  ``ValueError: shapely_object must be a LineString or Polygon``. Such
  regions are dropped and counted rather than repaired — picking one
  half of a repaired bow-tie would invent ground that nobody drew.
* ``DStabilityModel.set_meta_property`` mutates a module-level
  singleton shared by every model in the process, so this exporter
  writes ``datastructure.projectinfo`` directly instead.
"""

from __future__ import annotations

from io import BytesIO
from uuid import UUID

from geolib.geometry.one import Point
from geolib.models import DStabilityModel
from geolib.soils import (
    MohrCoulombParameters,
    ShearStrengthModelTypePhreaticLevel,
    Soil,
    SoilWeightParameters,
)

from groundmodel.application.section_polygon_set import (
    SectionPolygon,
    SectionPolygonSet,
    SectionPolygonUnit,
)
from groundmodel.domain.services.nad_soil_parameters_constants import (
    SOURCE_LABEL,
    NadSoilParameters,
)
from groundmodel.infrastructure.exporters.dstability_exporter_constants import (
    LAYER_NOTE_TEMPLATE,
    MIN_POLYGON_AREA_M2,
    MIN_POLYGON_POINTS,
    NOTE_ABSENT,
    STIX_LAST_MODIFIER,
    STIX_REMARKS,
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


class DStabilityExporter(SectionGeometryExporter):
    """Serialise a ``SectionPolygonSet`` into a D-Stability ``.stix``."""

    def __init__(self) -> None:
        """Initialise with this module's logger name."""
        super().__init__(__name__)

    def export(self, polygons: SectionPolygonSet) -> bytes:
        """Build the ``.stix`` archive for one cross-section.

        Parameters
        ----------
        polygons : SectionPolygonSet
            The section's drawn fill, resolved to absolute
            ``(along_m, elevation_m)`` rings with their units' export
            identity attached.

        Returns
        -------
        bytes
            The complete ``.stix`` archive (a zip container). Callers
            stream it straight to a file write or an HTTP response.

        Raises
        ------
        ValueError
            When no region survived the drawability checks. An empty
            ``.stix`` is a plausible, correctly-named, completely wrong
            deliverable, so the export refuses rather than shipping one.
        """
        self.info(
            f"D-Stability export: section='{polygons.section_name}' "
            f"units={len(polygons.units)} regions={len(polygons.polygons)} "
            f"datum={polygons.vertical_datum_label}"
        )

        unit_by_id = {unit.formation_id: unit for unit in polygons.units}
        drawable, dropped = self._partition_drawable(polygons.polygons, unit_by_id)
        if not drawable:
            self.error(
                f"D-Stability export refused: section='{polygons.section_name}' has no "
                f"closed geometry — {len(polygons.polygons)} region(s) received, "
                f"{dropped} dropped, {len(polygons.units)} unit(s) declared"
            )
            raise ValueError(
                f"Cross-section '{polygons.section_name}' has no closed geometry to "
                "export. Draw the section fill (the three-level partition) before "
                "exporting to D-Stability."
            )

        model = DStabilityModel()
        self._stamp_project_info(model, polygons)

        labels = build_unit_labels(polygons.units)
        collisions = label_collisions(polygons.units)
        if collisions:
            self.warning(
                "D-Stability export: identifier collisions disambiguated with an "
                f"ordinal suffix — {collisions}"
            )

        drawn_formation_ids = {polygon.formation_id for polygon in drawable}
        emitted_units = self._emit_soils(model, polygons.units, drawn_formation_ids, labels)

        emitted_layers = self._emit_layers(model, drawable, unit_by_id, labels)
        if not emitted_layers:
            # Every survivor of the cheap checks was still refused by
            # GEOLib's own ring validation (self-intersection).
            self.error(
                f"D-Stability export refused: section='{polygons.section_name}' — "
                f"GEOLib rejected all {len(drawable)} candidate ring(s)"
            )
            raise ValueError(
                f"Cross-section '{polygons.section_name}' has no closed geometry to "
                "export: every drawn region is self-intersecting."
            )

        buffer = BytesIO()
        model.serialize(buffer)
        payload = buffer.getvalue()

        self.success(
            f"D-Stability export written: section='{polygons.section_name}' "
            f"soils={emitted_units} layers={emitted_layers} "
            f"dropped_regions={dropped + len(drawable) - emitted_layers} "
            f"bytes={len(payload)}"
        )
        return payload

    def _partition_drawable(
        self,
        polygons: tuple[SectionPolygon, ...],
        unit_by_id: dict[UUID, SectionPolygonUnit],
    ) -> tuple[list[SectionPolygon], int]:
        """Split the regions into those worth handing GEOLib, and count the rest."""
        drawable: list[SectionPolygon] = []
        dropped = 0
        total = len(polygons)
        for index, polygon in enumerate(polygons, start=1):
            reason = self._undrawable_reason(polygon, unit_by_id)
            if reason is None:
                drawable.append(polygon)
                continue
            dropped += 1
            self.warning(
                f"[{index}/{total}] D-Stability export dropped a region: {reason} "
                f"(gap={polygon.gap_index} formation={polygon.formation_id} "
                f"vertices={len(polygon.points)})"
            )
        return drawable, dropped

    def _undrawable_reason(
        self,
        polygon: SectionPolygon,
        unit_by_id: dict[UUID, SectionPolygonUnit],
    ) -> str | None:
        """Name why this region cannot become a layer, or ``None`` when it can."""
        if polygon.formation_id not in unit_by_id:
            return (
                "its unit is not in the section's unit list — the formation was "
                "deleted or belongs to another model"
            )
        if len(polygon.points) < MIN_POLYGON_POINTS:
            return f"fewer than {MIN_POLYGON_POINTS} vertices"
        area = _ring_area(polygon.points)
        if area < MIN_POLYGON_AREA_M2:
            return f"zero area ({area:.3e} m2 — the ring is a line)"
        return None

    def _stamp_project_info(self, model: DStabilityModel, polygons: SectionPolygonSet) -> None:
        """Write the Strix provenance + the parameters-not-exported note."""
        info = model.datastructure.projectinfo
        info.Project = polygons.project_name
        info.CrossSection = polygons.section_name
        info.LastModifier = STIX_LAST_MODIFIER
        info.Remarks = (
            f"{STIX_REMARKS} Vertical datum: {polygons.vertical_datum_label}. "
            f"Horizontal axis: distance along the section line from its start point, "
            f"in metres (section length {polygons.section_length_m:.2f} m, "
            f"EPSG:{polygons.crs_epsg})."
        )

    def _emit_soils(
        self,
        model: DStabilityModel,
        units: tuple[SectionPolygonUnit, ...],
        drawn_formation_ids: set[UUID],
        labels: dict[UUID, str],
    ) -> int:
        """Add one soil per unit that actually fills something. Returns the count."""
        emitted = 0
        parameterised = 0
        skipped = [unit.name for unit in units if unit.formation_id not in drawn_formation_ids]
        for unit in units:
            if unit.formation_id not in drawn_formation_ids:
                continue
            code = labels[unit.formation_id]
            params = soil_parameters_for_unit(unit)
            model.add_soil(_build_soil(unit, code, params))
            if params is not None:
                # GEOLib's Soil constructor forbids a ``notes`` key (pydantic
                # extra=forbid), so the provenance label is written on the
                # persisted soil after it is added — the ``Notes`` field round-
                # trips into soils.json.
                model.soils.get_soil(code).Notes = SOURCE_LABEL
                parameterised += 1
                self.debug(
                    f"D-Stability soil added: code='{code}' name='{unit.name}' "
                    f"nad_class={unit.nad_class} soil={unit.litho_main_soil_code} "
                    f"parameters=NAD Tabel 2.b (gamma_unsat={params.gamma_unsat_kn_m3} "
                    f"gamma_sat={params.gamma_sat_kn_m3} phi={params.phi_deg} "
                    f"c={params.c_kpa})"
                )
            else:
                self.debug(
                    f"D-Stability soil added: code='{code}' name='{unit.name}' "
                    f"nad_class={unit.nad_class} soil={unit.litho_main_soil_code} "
                    "(strength / stiffness / unit weight left at GEOLib defaults)"
                )
            emitted += 1
        self.info(
            f"D-Stability soil parameters: {parameterised}/{emitted} soil(s) carried "
            f"NAD Tabel 2.b characteristic values, {emitted - parameterised} left at "
            "GEOLib's blank defaults"
        )
        if skipped:
            self.debug(f"D-Stability export: {len(skipped)} unit(s) fill nothing — {skipped}")
        return emitted

    def _emit_layers(
        self,
        model: DStabilityModel,
        drawable: list[SectionPolygon],
        unit_by_id: dict[UUID, SectionPolygonUnit],
        labels: dict[UUID, str],
    ) -> int:
        """Add one D-Stability layer per drawable region. Returns the count."""
        emitted = 0
        total = len(drawable)
        for index, polygon in enumerate(drawable, start=1):
            unit = unit_by_id[polygon.formation_id]
            points = [Point(x=along, z=elevation) for along, elevation in polygon.points]
            try:
                model.add_layer(
                    points=points,
                    soil_code=labels[polygon.formation_id],
                    label=unit.name,
                    notes=_layer_note(unit),
                )
            except ValueError as exc:
                # GEOLib's shapely repair produced something that is not a
                # single simple polygon — a self-intersecting ring. Dropping
                # it is the honest answer; half of a repaired bow-tie is
                # ground nobody drew.
                self.warning(
                    f"[{index}/{total}] D-Stability export dropped a region GEOLib "
                    f"refused: gap={polygon.gap_index} unit='{unit.name}' "
                    f"vertices={len(polygon.points)} — {exc}"
                )
                continue
            self.trace(
                f"[{index}/{total}] D-Stability layer added: unit='{unit.name}' "
                f"gap={polygon.gap_index} body={polygon.body_id} "
                f"vertices={len(polygon.points)}"
            )
            emitted += 1
        return emitted


def _build_soil(
    unit: SectionPolygonUnit,
    code: str,
    params: NadSoilParameters | None,
) -> Soil:
    """Build the GEOLib soil for a unit, with NAD parameters when present.

    Parameters
    ----------
    unit : SectionPolygonUnit
        The unit the soil represents (supplies the display name).
    code : str
        The unique export code the layer keys on.
    params : NadSoilParameters | None
        Characteristic parameters for the unit's NAD class, or ``None`` when
        the class is not in the table. When ``None`` the soil is built with
        name + code only, leaving every strength / weight field at GEOLib's
        blank initial value — never an invented default.

    Returns
    -------
    Soil
        A GEOLib soil. When parameterised, cohesion + friction angle sit on
        the Mohr-Coulomb model D-Stability applies both above AND below the
        phreatic level (so the strength is used below the water table, not
        GEOLib's default Su model), and both unit weights are set.
    """
    if params is None:
        return Soil(name=unit.name, code=code)
    return Soil(
        name=unit.name,
        code=code,
        mohr_coulomb_parameters=MohrCoulombParameters(
            cohesion=params.c_kpa, friction_angle=params.phi_deg
        ),
        soil_weight_parameters=SoilWeightParameters(
            unsaturated_weight=params.gamma_unsat_kn_m3,
            saturated_weight=params.gamma_sat_kn_m3,
        ),
        shear_strength_model_above_phreatic_level=ShearStrengthModelTypePhreaticLevel.MOHR_COULOMB,
        shear_strength_model_below_phreatic_level=ShearStrengthModelTypePhreaticLevel.MOHR_COULOMB,
    )


def _layer_note(unit: SectionPolygonUnit) -> str:
    """Render the layer's machine-identity note."""
    return LAYER_NOTE_TEMPLATE.format(
        name=unit.name,
        nad_class=NOTE_ABSENT if unit.nad_class is None else unit.nad_class,
        soil_code=unit.litho_main_soil_code or NOTE_ABSENT,
        formation_id=unit.formation_id,
    )


def _ring_area(points: tuple[tuple[float, float], ...]) -> float:
    """Absolute shoelace area of a ring, in m^2 (winding-agnostic)."""
    total = 0.0
    count = len(points)
    for i in range(count):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % count]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0
