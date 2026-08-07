"""Set a geotech model's representative-qc statistic — owner rulings 7 + 8.

Ruling 7 (docs/debt.md #227): the statistic the NAD classifier reads is
selectable PER GEOTECH MODEL — median / arithmetic / harmonic / geometric —
because the choice systematically shifts classes and is part of the model's
provenance.

Ruling 8: changing it marks the model STALE, it never silently re-derives the
bands. This use case therefore writes exactly ONE column
(``geological_model.representative_statistic``) and commits. It touches no
``litho_layer`` row, runs no reclassification, and does NOT stale the 3-D
solid cache (the bands are unchanged, so the solids still match them — what
goes stale is the CLASSIFICATION, surfaced as a "re-subdivide under
<statistic>" affordance). Staleness is DERIVED, never stored:
``classified_with_statistic != representative_statistic`` — the build stamps
``classified_with_statistic`` on success, so the flag self-clears.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.services.representative_statistic import REPRESENTATIVE_STATISTICS
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class SetGeotechStatisticResult:
    """Outcome of the statistic change.

    Attributes
    ----------
    representative_statistic : str
        The choice now stored on the model.
    classified_with_statistic : str | None
        What the last full build classified with (``None`` before any build).
    bands_stale : bool
        Derived: a build has run AND its statistic differs from the choice —
        the bands need a re-subdivide to match.
    """

    representative_statistic: str
    classified_with_statistic: str | None
    bands_stale: bool


class SetGeotechStatistic(GroundModelLogger):
    """Write the one choice column; everything else is derived.

    Parameters
    ----------
    session : AsyncSession
        Active session; this use case owns the commit boundary.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(self, *, model_id: UUID, statistic: str) -> SetGeotechStatisticResult:
        """Set the model's representative statistic.

        Parameters
        ----------
        model_id : UUID
            The geotechnical model (the router's kind guard has already run).
        statistic : str
            One of ``REPRESENTATIVE_STATISTICS``.

        Returns
        -------
        SetGeotechStatisticResult
            The stored choice, the build's stamp, and the derived staleness.

        Raises
        ------
        ValueError
            When *statistic* is not a known token (mapped to 422 by the
            router) or the model does not exist.
        """
        self.info(f"SetGeotechStatistic: model={model_id} statistic={statistic!r}")
        if statistic not in REPRESENTATIVE_STATISTICS:
            raise ValueError(
                f"Unknown representative statistic {statistic!r} — expected one of "
                f"{REPRESENTATIVE_STATISTICS}"
            )
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None:
            raise ValueError(f"Geological model {model_id} not found.")

        model.representative_statistic = statistic
        await self._session.commit()

        bands_stale = (
            model.classified_with_statistic is not None
            and model.classified_with_statistic != statistic
        )
        self.success(
            f"SetGeotechStatistic: model={model_id} representative={statistic} "
            f"classified_with={model.classified_with_statistic} bands_stale={bands_stale}"
        )
        return SetGeotechStatisticResult(
            representative_statistic=statistic,
            classified_with_statistic=model.classified_with_statistic,
            bands_stale=bands_stale,
        )
