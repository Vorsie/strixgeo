"""Atterberg limits lab test — liquid limit, plastic limit, derived plasticity index."""

from dataclasses import dataclass
from datetime import date

from groundmodel.domain.models.lab.lab_test import LabTest


@dataclass
class AtterbergLimits(LabTest):
    """Atterberg consistency limits for fine-grained soil.

    Stores the two measured limits (liquid and plastic) as separate water-content
    percentages; the plasticity index is **derived** (PI = LL - PL) and exposed
    via :attr:`plasticity_index_pct`. Storing the limits rather than the index
    preserves source fidelity — many design checks need LL and PL separately
    (Casagrande chart, plasticity classification), and rounding the index away
    would lose information.

    A soil reported as "non-plastic" (no measurable PL) sets ``non_plastic=True``
    and typically leaves ``plastic_limit_pct`` as ``None``.

    DOV exposes both limits under ``parametergroep = "Onderkenning - proeven"``:

    * "Consistentiegrenzen - Vloeigrens" = liquid limit, unit ``%``.
    * "Consistentiegrenzen - Uitrolgrens" = plastic limit, unit ``%``.

    Parameters
    ----------
    liquid_limit_pct : float | None
        Liquid limit (LL / w\\_L) as water-content percentage of dry mass.
        Typical range 20–120 %, rare extremes up to ~500 % for high-plasticity
        clays. ``None`` if not measured.
    plastic_limit_pct : float | None
        Plastic limit (PL / w\\_P) as water-content percentage of dry mass.
        Typical range 10–60 %. ``None`` if not measured or non-plastic.
    non_plastic : bool | None
        ``True`` when the soil cannot be rolled into a 3 mm thread (no plastic
        limit). ``None`` if not asserted by the source. ``False`` is a positive
        statement that the soil IS plastic.
    method : str | None
        Raw source-vocabulary measurement method. DOV typically does not
        populate ``methode`` for these — leave ``None`` if absent.
    test_date : date | None
        Date the test was performed.

    Raises
    ------
    ValueError
        If ``liquid_limit_pct`` or ``plastic_limit_pct`` is outside [0, 1000].
        Upper bound is intentionally generous — typical soils stay below ~120
        but extreme bentonites and quick clays can read higher; we reject only
        values that are clearly non-physical.
    """

    liquid_limit_pct: float | None = None
    plastic_limit_pct: float | None = None
    non_plastic: bool | None = None
    method: str | None = None
    test_date: date | None = None

    def __post_init__(self) -> None:
        if self.liquid_limit_pct is not None and not 0 <= self.liquid_limit_pct <= 1000:
            raise ValueError(
                f"AtterbergLimits.liquid_limit_pct must be in [0, 1000]: {self.liquid_limit_pct}"
            )
        if self.plastic_limit_pct is not None and not 0 <= self.plastic_limit_pct <= 1000:
            raise ValueError(
                f"AtterbergLimits.plastic_limit_pct must be in [0, 1000]: {self.plastic_limit_pct}"
            )

    @property
    def plasticity_index_pct(self) -> float | None:
        """Plasticity index PI = LL - PL — derived on read, not persisted.

        Implemented as a Python ``@property`` rather than a dataclass field, so
        it is recomputed every time it is accessed and never stored. Concretely:

        * Not present in ``__init__`` (callers cannot set it).
        * Not listed in ``dataclasses.fields(AtterbergLimits)``.
        * Skipped by ``dataclasses.asdict()`` and similar serializers.
        * The Layer 2 ORM maps only ``liquid_limit_pct``, ``plastic_limit_pct``,
          and ``non_plastic`` as columns — the DB stores measured values only.

        Keeping derived values out of storage avoids the classic data-integrity
        trap where a row's stored PI drifts away from its stored LL/PL after an
        edit. Consumers that need PI in an API response or export simply call
        this property at serialization time.

        Returns
        -------
        float | None
            ``None`` when either limit is missing, or when ``non_plastic`` is
            ``True``. Otherwise the arithmetic difference; can be 0 or negative
            for nearly non-plastic or anomalous samples — the value is returned
            as-measured rather than clamped, so callers can distinguish "soil
            is barely plastic" from "soil declared non-plastic".
        """
        if self.non_plastic:
            return None
        if self.liquid_limit_pct is None or self.plastic_limit_pct is None:
            return None
        return self.liquid_limit_pct - self.plastic_limit_pct
