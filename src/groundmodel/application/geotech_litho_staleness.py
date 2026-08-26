"""Answer "did the litho move under these bands?" — debt #266.

The read half of the #266 provenance link.  Each geotech press stamps, per
column, a digest of the litho stack it built that column's bands from
(``geological_model.derived_from_litho_digests``).  This use case recomputes
today's digests from the parent litho model and names the columns that
disagree.

Staleness is DERIVED, never stored — the same shape
``classified_with_statistic`` already uses and the migration for that column
already calls "the #266 compare-on-load pattern".  Consequences worth stating,
because they are the design:

* **Nothing to clear.**  Re-pressing the affected columns re-stamps them, so the
  warning goes away by doing the thing it asks for.  There is no acknowledge
  button, and no clear-endpoint to get wrong.
* **No false alarm on existing projects.**  A column with no stamp is not stale
  (see :func:`~groundmodel.domain.services.litho_column_digest.stale_column_ids`);
  it is reported separately as *unstamped* so a caller that needs certainty —
  the export guard below — can tell "verified current" from "cannot say".

The export-completeness seam
----------------------------
The export guard (a separate, later change) reads THIS use case, not the HTTP
route: it is application-layer, takes only a session and a model id, and needs
no request context.  Two numbers are the contract it should gate on —
``len(stale_columns)`` (bands provably built from litho that has since moved)
and ``unstamped_column_count`` (bands whose provenance is unknown).  A
client-facing export with either above zero is the failure #266 names; what the
guard DOES about it — refuse, warn, or annotate — is the guard's decision and is
deliberately not made here.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.section_membership import load_investigation_names
from groundmodel.domain.services.litho_column_digest import stale_column_ids
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import LithoLayerRepository
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass(frozen=True)
class StaleGeotechColumn:
    """One column whose litho stack moved after its packing bands were made.

    Attributes
    ----------
    investigation_id : UUID
        The CPT or borehole the bands are anchored on.
    label : str
        Its display name (``"GEO-23/125-S17"``), so the message can name the
        column the engineer has to re-press rather than a uuid.  Falls back to
        the id when the row cannot be resolved.
    """

    investigation_id: UUID
    label: str


@dataclass(frozen=True)
class GeotechLithoStalenessResult:
    """What the geotech model can and cannot vouch for.

    Attributes
    ----------
    geotech_model_id : UUID
        The model asked about.
    litho_model_id : UUID | None
        Its parent lithostratigraphic model.  ``None`` only for a malformed
        model with no parent, in which case nothing can be compared.
    stale_columns : tuple[StaleGeotechColumn, ...]
        Columns whose recorded litho stack disagrees with the litho under them
        now — sorted by label so two reads present the same list.
    banded_column_count : int
        Columns carrying at least one band.
    unstamped_column_count : int
        Of those, how many carry no record of what they were built from
        (banded before this shipped).  Not stale — unknown.
    """

    geotech_model_id: UUID
    litho_model_id: UUID | None
    stale_columns: tuple[StaleGeotechColumn, ...]
    banded_column_count: int
    unstamped_column_count: int


class GeotechLithoStaleness(GroundModelLogger):
    """Compare a geotech model's recorded litho provenance against today's litho.

    Parameters
    ----------
    session : AsyncSession
        Active session.  Read-only: this use case writes nothing and never
        commits, so it is safe to call from a request handler or an exporter.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session
        self._repo = LithoLayerRepository(session)

    async def execute(self, *, geotech_model_id: UUID) -> GeotechLithoStalenessResult:
        """Name the columns whose ground moved after their bands were made.

        Parameters
        ----------
        geotech_model_id : UUID
            A ``kind='geotechnical'`` model.  The caller's kind guard has
            already run; a model with no parent is answered rather than raised
            on (see below).

        Returns
        -------
        GeotechLithoStalenessResult
            The stale columns plus the counts an export guard needs.

        Raises
        ------
        ValueError
            When *geotech_model_id* matches no row.
        """
        self.debug(f"GeotechLithoStaleness: geotech_model={geotech_model_id}")
        model = await self._session.get(GeologicalModelOrm, geotech_model_id)
        if model is None:
            raise ValueError(f"Geological model {geotech_model_id} not found.")

        banded = await self._repo.banded_column_ids(geotech_model_id)
        stamps: dict[str, str] = model.derived_from_litho_digests or {}

        if model.parent_model_id is None:
            # No parent means no litho to compare against. Report what IS known
            # — every banded column is unstamped — rather than raising: the
            # caller asked a question with an honest answer, and an exception
            # here would break the section view over a data shape the schema
            # tolerates (parent_model_id is nullable, enforced only at creation).
            self.warning(
                f"GeotechLithoStaleness: geotech_model={geotech_model_id} has no "
                f"parent_model_id — {len(banded)} banded column(s) cannot be "
                f"compared against any litho model; stamps stored={len(stamps)}"
            )
            return GeotechLithoStalenessResult(
                geotech_model_id=geotech_model_id,
                litho_model_id=None,
                stale_columns=(),
                banded_column_count=len(banded),
                unstamped_column_count=len(banded),
            )

        current = await self._repo.load_column_digests(model.parent_model_id)
        # Only columns that still carry bands can be stale — a stamp left over
        # from bands that are gone would point at a re-press with nothing to do.
        live_stamps = {column: digest for column, digest in stamps.items() if column in banded}
        stale_ids = stale_column_ids(stamps=live_stamps, current=current)

        names = await load_investigation_names(self._session, [UUID(c) for c in stale_ids])
        stale_columns = tuple(
            sorted(
                (
                    StaleGeotechColumn(
                        investigation_id=UUID(column),
                        label=names.get(UUID(column), column),
                    )
                    for column in stale_ids
                ),
                key=lambda c: c.label,
            )
        )
        unstamped = len(banded) - len(live_stamps)

        if stale_columns:
            self.warning(
                f"GeotechLithoStaleness: geotech_model={geotech_model_id} — "
                f"{len(stale_columns)} of {len(banded)} banded column(s) have litho "
                f"that moved after their bands were made: "
                f"{', '.join(c.label for c in stale_columns)}"
            )
        else:
            self.debug(
                f"GeotechLithoStaleness: geotech_model={geotech_model_id} — no stale "
                f"column(s) of {len(banded)} banded ({unstamped} unstamped)"
            )
        if unstamped:
            self.info(
                f"GeotechLithoStaleness: geotech_model={geotech_model_id} — "
                f"{unstamped} banded column(s) carry no provenance record "
                "(banded before the #266 stamp shipped); they read as not stale "
                "and re-pressing them records what they are built from"
            )

        return GeotechLithoStalenessResult(
            geotech_model_id=geotech_model_id,
            litho_model_id=model.parent_model_id,
            stale_columns=stale_columns,
            banded_column_count=len(banded),
            unstamped_column_count=unstamped,
        )
