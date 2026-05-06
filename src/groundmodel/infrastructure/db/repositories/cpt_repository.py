"""Repository for CPT persistence."""
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class CptRepository(GroundModelLogger):
    """Async CRUD operations for CptOrm records."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active AsyncSession."""
        super().__init__(__name__)
        self._session = session

    async def save(self, cpt: CptOrm) -> None:
        """Persist a new or updated CPT (including its series)."""
        self._session.add(cpt)
        await self._session.flush()
        self.success(f"CPT saved: {cpt.id} — {cpt.name}")

    async def get_by_id(self, cpt_id: UUID) -> CptOrm | None:
        """Return a CPT with its series loaded, or None if not found."""
        result = await self._session.execute(
            select(CptOrm)
            .where(CptOrm.id == cpt_id)
            .options(selectinload(CptOrm.series))
        )
        return result.scalar_one_or_none()

    async def list_all(self) -> list[CptOrm]:
        """Return all CPTs without loading series arrays."""
        result = await self._session.execute(select(CptOrm).order_by(CptOrm.created_at))
        return list(result.scalars().all())

    async def delete(self, cpt_id: UUID) -> None:
        """Delete a CPT and its series (cascade handles series row)."""
        cpt = await self.get_by_id(cpt_id)
        if cpt is not None:
            await self._session.delete(cpt)
            await self._session.flush()
            self.info(f"CPT deleted: {cpt_id}")
