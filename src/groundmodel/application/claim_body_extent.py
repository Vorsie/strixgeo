"""Claim-body-extent use case — user-claim path for body extents.

Sets one side (left or right) of one body to a user-claimed kind:
``pinch_out_halfway``, ``extrapolated``, or ``open``. Creates the body
row if it doesn't exist yet (using the resolver-provided body_ordinal +
the request's source_investigation_id).

Provenance rule (spec §5.2)
----------------------------
Refuses to overwrite an existing ``to_target`` (detector-set) extent
without an explicit ``ClearBodyExtent`` call first. The user must clear
the detector's claim before claiming their own — this prevents silent
override of auto-detection.

Kind-specific validation
------------------------
* ``pinch_out_halfway`` — ``neighbour_inv_id`` required. Must NOT equal
  ``source_investigation_id`` (a body can't pinch out to itself).
* ``extrapolated`` — ``neighbour_inv_id`` required (same as halfway).
  The dip-extrapolation math itself is computed at render time; this
  use case only persists the claim. The renderer's helper handles the
  geometrically-undefined case.
* ``open`` — neither ``neighbour_inv_id`` nor ``target_contact_id``
  used. The renderer extends the wedge to the section boundary.

Commits.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.shared.constants.extent_kind import (
    EXTENT_KIND_EXTRAPOLATED,
    EXTENT_KIND_OPEN,
    EXTENT_KIND_PINCH_OUT_HALFWAY,
    EXTENT_KIND_TO_TARGET,
    EXTENT_SIDES,
    is_user_claimed_extent_kind,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class ProvenanceViolationError(ValueError):
    """Raised when a user-claim would overwrite a detector-set ``to_target`` extent.

    Subclasses ``ValueError`` so existing bare ``except ValueError`` catchers
    still fire, but the router can catch *this* class first and map it to a
    dedicated HTTP 409 response rather than the generic 422.
    """


_VALID_CLAIM_KINDS = (
    EXTENT_KIND_PINCH_OUT_HALFWAY,
    EXTENT_KIND_EXTRAPOLATED,
    EXTENT_KIND_OPEN,
)


class ClaimBodyExtent(GroundModelLogger):
    """User-claim use case for one side of one body.

    Sets ``extent_<side>_kind`` + related columns on the body row
    identified by ``(model_id, formation_id, body_ordinal)``. Creates
    the body row when none exists yet.  Commits the transaction.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        formation_id: UUID,
        source_investigation_id: UUID,
        side: str,
        kind: str,
        neighbour_inv_id: UUID | None = None,
        primary_section_id: UUID | None = None,
    ) -> BodyOrm:
        """Claim one side of one body.

        Parameters
        ----------
        project_id : UUID
            Scope. Model and formation must both belong to this project
            (raises ``ValueError`` / 404 otherwise).
        model_id : UUID
            The lithostratigraphic model the body belongs to.
        formation_id : UUID
            The formation the body belongs to. Must belong to project.
        source_investigation_id : UUID
            The investigation carrying the body's framing contacts.
            Polymorphic id (CPT or borehole).  Used only when creating a
            new body row; ignored when updating an existing one.
        side : str
            Either ``"left"`` or ``"right"``.
        kind : str
            One of ``pinch_out_halfway``, ``extrapolated``, ``open``.
            Must be a user-claim kind — ``to_target`` and ``None`` are
            rejected.
        neighbour_inv_id : UUID | None
            Required for ``pinch_out_halfway`` and ``extrapolated``.
            Must differ from ``source_investigation_id`` (a body can't
            pinch out to itself).  Ignored for ``open``.
        primary_section_id : UUID | None
            The section the user invoked the gesture from.  Stored on
            the body row when creating; updates an existing NULL value
            but never overwrites an existing non-NULL value.

        Returns
        -------
        BodyOrm
            The body row (created or updated), refreshed from the DB.

        Raises
        ------
        ValueError
            On any validation failure: invalid side, invalid kind,
            missing ``neighbour_inv_id`` for halfway/extrapolated,
            ``neighbour_inv_id == source_investigation_id``, or a
            provenance violation (attempting to overwrite a
            ``to_target`` extent without clearing first).
        """
        # ----- Input validation -------------------------------------------
        if side not in EXTENT_SIDES:
            raise ValueError(f"side must be 'left' or 'right', got {side!r}")
        if kind not in _VALID_CLAIM_KINDS:
            raise ValueError(
                f"kind must be one of {_VALID_CLAIM_KINDS}, got {kind!r}; "
                "detector-only kinds and NULL are not allowed via this endpoint"
            )
        if kind in (EXTENT_KIND_PINCH_OUT_HALFWAY, EXTENT_KIND_EXTRAPOLATED):
            if neighbour_inv_id is None:
                raise ValueError(f"neighbour_inv_id is required for kind={kind!r}")
            if neighbour_inv_id == source_investigation_id:
                raise ValueError(
                    "neighbour_inv_id must not equal source_investigation_id "
                    "(a body can't pinch out to its own source investigation)"
                )

        # ----- Scope guards -----------------------------------------------
        await load_scoped_or_raise(
            self._session, GeologicalModelOrm, model_id, project_id, label="Model"
        )
        await load_scoped_or_raise(
            self._session,
            GeologicalFormationOrm,
            formation_id,
            project_id,
            label="Formation",
        )

        # ----- Resolve body_ordinal from formation ------------------------
        # instance_ordinal is set by the resolver; use 0 as fallback when
        # the resolver hasn't run yet (e.g. in tests or a brand-new model).
        formation_row = await self._session.get(GeologicalFormationOrm, formation_id)
        # Non-None guaranteed by load_scoped_or_raise above.
        assert formation_row is not None
        body_ordinal: int = formation_row.instance_ordinal or 0

        # Column name helpers — avoids repetition below.
        kind_col = f"extent_{side}_kind"
        target_col = f"extent_{side}_target_contact_id"
        neighbour_col = f"extent_{side}_neighbour_inv_id"

        # ----- Find or create body row ------------------------------------
        existing_stmt = select(BodyOrm).where(
            BodyOrm.model_id == model_id,
            BodyOrm.formation_id == formation_id,
            BodyOrm.body_ordinal == body_ordinal,
        )
        body = (await self._session.execute(existing_stmt)).scalar_one_or_none()

        if body is None:
            self.info(
                f"ClaimBodyExtent: creating new body "
                f"(formation={formation_id}, ordinal={body_ordinal}, "
                f"side={side}, kind={kind})"
            )
            body = BodyOrm(
                id=uuid7(),
                app_project_id=project_id,
                model_id=model_id,
                formation_id=formation_id,
                body_ordinal=body_ordinal,
                source_investigation_id=source_investigation_id,
                primary_section_id=primary_section_id,
            )
            setattr(body, kind_col, kind)
            if kind in (EXTENT_KIND_PINCH_OUT_HALFWAY, EXTENT_KIND_EXTRAPOLATED):
                setattr(body, neighbour_col, neighbour_inv_id)
            # 'open' uses neither target_contact_id nor neighbour_inv_id.
            self._session.add(body)
        else:
            # ----- Provenance + update path -------------------------------
            existing_kind: str | None = getattr(body, kind_col)

            # Provenance rule §5.2: refuse to overwrite a detector-set
            # 'to_target' extent.  The user must call ClearBodyExtent first.
            # Raises ProvenanceViolationError (subclass of ValueError) so the
            # router can map it to HTTP 409 while other ValueErrors stay 422.
            if existing_kind == EXTENT_KIND_TO_TARGET:
                raise ProvenanceViolationError(
                    f"Cannot overwrite detector-set 'to_target' extent on "
                    f"side={side!r}. Clear the existing extent first via "
                    "ClearBodyExtent."
                )

            # Replacing one user-claim kind with a different one is allowed;
            # the user is explicitly changing their mind.
            if is_user_claimed_extent_kind(existing_kind) and existing_kind != kind:
                self.info(
                    f"ClaimBodyExtent: replacing user-claim "
                    f"{existing_kind!r} → {kind!r} on side={side}"
                )

            # Write the new claim.
            setattr(body, kind_col, kind)
            # Always clear the target_contact_id on a user-claim (only the
            # detector sets target contacts; user-claims don't reference them).
            setattr(body, target_col, None)
            if kind in (EXTENT_KIND_PINCH_OUT_HALFWAY, EXTENT_KIND_EXTRAPOLATED):
                setattr(body, neighbour_col, neighbour_inv_id)
            else:
                # 'open' — clear neighbour_inv_id as well.
                setattr(body, neighbour_col, None)

            # Upgrade primary_section_id when it was not set yet.
            if body.primary_section_id is None and primary_section_id is not None:
                body.primary_section_id = primary_section_id

        await self._session.commit()
        await self._session.refresh(body)
        self.success(f"ClaimBodyExtent: committed body={body.id} side={side} kind={kind}")
        return body
