"""Use case — create or promote a formation absence row.

Position 4 architecture (#101 R3).  Supports two gestures from the
"Inspect lens body" panel:

* **Confirm absence** — user promotes an existing ``source='inferred'`` row
  to ``source='manual'`` (lock-in gesture: the inference engine will not
  overwrite it on the next recompute).
* **Manual absence** — user adds an absence for an investigation that the
  engine did not infer (e.g. they observed it in the field but the
  observation layer was not digitised yet).

Both map to the same DB operation: UPSERT on
``(formation_id, investigation_kind, investigation_id)``.

Validation:
* The investigation must exist in the project (checked against borehole or
  CPT table depending on ``investigation_kind``).
* The formation must belong to the project.
* ``source`` must be ``'manual'`` or ``'observed'`` — this use case is
  for user-intent rows only; ``'inferred'`` is the engine's domain.

The caller is responsible for triggering a section refresh after the upsert
so the wedge geometry re-renders with the confirmed/manual style.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Sources the user is allowed to submit via this use case.
_USER_SOURCES: frozenset[str] = frozenset({"manual", "observed"})


@dataclass(frozen=True)
class UpsertFormationAbsenceResult:
    """Return value of :meth:`UpsertFormationAbsence.execute`.

    Attributes
    ----------
    absence_id : UUID
        Primary key of the inserted or updated ``FormationAbsenceOrm`` row.
    was_created : bool
        ``True`` when a new row was inserted; ``False`` when an existing row
        was updated.
    """

    absence_id: UUID
    was_created: bool


class UpsertFormationAbsence(GroundModelLogger):
    """Create or promote a formation absence row.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        formation_id: UUID,
        investigation_id: UUID,
        investigation_kind: str,
        source: str,
    ) -> UpsertFormationAbsenceResult:
        """Upsert a user-intent absence row.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        formation_id : UUID
            The geological formation to record absence for.
        investigation_id : UUID
            The borehole or CPT that lacks this formation.
        investigation_kind : str
            ``'borehole'`` or ``'cpt'``.
        source : str
            ``'manual'`` or ``'observed'``.  ``'inferred'`` is rejected —
            that source belongs to the inference engine.

        Returns
        -------
        UpsertFormationAbsenceResult
            The absence row id and a creation flag.

        Raises
        ------
        ValueError
            When ``source`` is not in the allowed set, when the formation is
            not found in the project, or when the investigation is not found.
        """
        self.info(
            f"UpsertFormationAbsence.execute: "
            f"project={project_id} formation={formation_id} "
            f"investigation={investigation_id} kind={investigation_kind} "
            f"source={source!r}"
        )

        # ------------------------------------------------------------------
        # Validate source.
        # ------------------------------------------------------------------
        if source not in _USER_SOURCES:
            raise ValueError(
                f"source={source!r} is not allowed for user-intent absences. "
                f"Allowed: {sorted(_USER_SOURCES)}"
            )

        # ------------------------------------------------------------------
        # Validate formation scope.
        # ------------------------------------------------------------------
        formation = await self._session.get(GeologicalFormationOrm, formation_id)
        if formation is None or formation.app_project_id != project_id:
            raise ValueError(f"Formation {formation_id} not found in project {project_id}")

        # ------------------------------------------------------------------
        # Validate investigation scope.
        # ------------------------------------------------------------------
        await self._validate_investigation(
            project_id=project_id,
            investigation_id=investigation_id,
            investigation_kind=investigation_kind,
        )

        # ------------------------------------------------------------------
        # UPSERT: INSERT ... ON CONFLICT DO UPDATE SET source = excluded.source
        # so a 'confirm' gesture (inferred → manual) always wins over the
        # existing row regardless of the prior source.
        # ------------------------------------------------------------------
        new_id = uuid7()
        stmt = (
            pg_insert(FormationAbsenceOrm)
            .values(
                id=new_id,
                formation_id=formation_id,
                investigation_id=investigation_id,
                investigation_kind=investigation_kind,
                source=source,
            )
            .on_conflict_do_update(
                constraint="uq_formation_absence_formation_investigation",
                set_={"source": source},
            )
            .returning(FormationAbsenceOrm.id)
        )
        result_row = (await self._session.execute(stmt)).scalar_one()
        await self._session.commit()

        was_created = result_row == new_id
        self.success(
            f"UpsertFormationAbsence done: "
            f"absence={result_row} "
            f"formation={formation_id} "
            f"investigation={investigation_id} "
            f"source={source!r} "
            f"created={was_created}"
        )
        return UpsertFormationAbsenceResult(absence_id=result_row, was_created=was_created)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _validate_investigation(
        self,
        *,
        project_id: UUID,
        investigation_id: UUID,
        investigation_kind: str,
    ) -> None:
        """Assert the investigation exists in the project.

        Parameters
        ----------
        project_id : UUID
            Project scope.
        investigation_id : UUID
            The borehole or CPT id to look up.
        investigation_kind : str
            ``'borehole'`` or ``'cpt'``.

        Raises
        ------
        ValueError
            When ``investigation_kind`` is unknown, or when the investigation
            is not found in the project.
        """
        if investigation_kind == "borehole":
            row = (
                await self._session.execute(
                    select(BoreholeOrm.id).where(
                        BoreholeOrm.id == investigation_id,
                        BoreholeOrm.app_project_id == project_id,
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                raise ValueError(f"Borehole {investigation_id} not found in project {project_id}")
        elif investigation_kind == "cpt":
            row = (
                await self._session.execute(
                    select(CptOrm.id).where(
                        CptOrm.id == investigation_id,
                        CptOrm.app_project_id == project_id,
                    )
                )
            ).scalar_one_or_none()
            if row is None:
                raise ValueError(f"CPT {investigation_id} not found in project {project_id}")
        else:
            raise ValueError(
                f"Unknown investigation_kind={investigation_kind!r}. Expected 'borehole' or 'cpt'."
            )
