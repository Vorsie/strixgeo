"""Claim-body-extent use case — user-claim path for body extents.

Sets one side (left or right) of one body to a user-claimed kind:
``pinch_out_halfway``, ``extrapolated``, or ``open``. The body is
addressed directly by ``body_id`` — the resolver
(``ResolveLithoInstances``) owns body creation, so the body always
exists by the time any claim/pinch-out gesture is possible. There is no
create branch.

Provenance rule (revised owner directive 2026-06-04)
----------------------------------------------------
A user claim ALWAYS wins. Claiming over a detector-set ``to_target`` extent
overwrites it directly — a ``to_target`` is a machine guess, not a committed
decision, so the engineer's explicit open/pinch takes precedence with no
``ClearBodyExtent`` step (the old refuse-and-409 blocked the manual
interpretation workflow, dogfeed 2026-06-04). The protection that remains —
the DETECTOR never clobbering a USER claim — lives in ``DetectBodies``.

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

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.scope_guard import load_scoped_or_raise
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
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


async def _validate_investigation_in_project(
    session: AsyncSession,
    inv_id: UUID,
    project_id: UUID,
    *,
    label: str,
) -> None:
    """Assert that ``inv_id`` belongs to a CPT or borehole in ``project_id``.

    The investigation id is polymorphic — it may reference either ``cpt`` or
    ``borehole``.  The check mirrors the bundle-restore validation in
    ``project_bundle.py`` (lines 1480–1496): try CPT first, then borehole,
    raise ``ValueError`` if neither matches.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    inv_id : UUID
        The polymorphic investigation id to check.
    project_id : UUID
        The project the investigation must belong to.
    label : str
        Human-readable name for the id in the error message
        (e.g. ``"source_investigation_id"``, ``"neighbour_inv_id"``).

    Raises
    ------
    ValueError
        When ``inv_id`` does not resolve to a CPT or borehole in
        ``project_id``.  The same message is used for both "wrong project"
        and "does not exist" cases so the caller cannot distinguish them.
    """
    # One round-trip with a UNION — returns a row iff the id is in scope.
    stmt = text(
        "SELECT 1 FROM cpt WHERE id = :inv_id AND app_project_id = :pid "
        "UNION "
        "SELECT 1 FROM borehole WHERE id = :inv_id AND app_project_id = :pid "
        "LIMIT 1"
    )
    row = (await session.execute(stmt, {"inv_id": inv_id, "pid": project_id})).first()
    if row is None:
        raise ValueError(f"{label} {inv_id} not found in project {project_id}")


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
    identified directly by ``body_id``. The body must already exist (the
    resolver owns creation); a missing or out-of-model body id raises
    ``ValueError``. Commits the transaction.
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
        body_id: UUID,
        side: str,
        kind: str,
        source_investigation_id: UUID | None = None,
        neighbour_inv_id: UUID | None = None,
        primary_section_id: UUID | None = None,
    ) -> BodyOrm:
        """Claim one side of one body.

        Parameters
        ----------
        project_id : UUID
            Scope. The model (and thus the body) must belong to this
            project (raises ``ValueError`` / 404 otherwise).
        model_id : UUID
            The lithostratigraphic model the body belongs to.
        body_id : UUID
            The body whose extent is being claimed. Must already exist and
            belong to ``model_id`` — there is no create branch (the
            resolver owns body creation). A missing / wrong-model id raises
            ``ValueError``.
        side : str
            Either ``"left"`` or ``"right"``.
        kind : str
            One of ``pinch_out_halfway``, ``extrapolated``, ``open``.
            Must be a user-claim kind — ``to_target`` and ``None`` are
            rejected.
        source_investigation_id : UUID | None
            Optional. Retained only for logging / back-filling the body's
            ``source_investigation_id`` if it is ever NULL. The body
            already carries its own source, so callers normally omit this.
        neighbour_inv_id : UUID | None
            Required for ``pinch_out_halfway`` and ``extrapolated``.
            Must differ from the body's source investigation (a body can't
            pinch out to itself).  Ignored for ``open``.
        primary_section_id : UUID | None
            The section the user invoked the gesture from.  Updates an
            existing NULL value but never overwrites an existing non-NULL
            value.

        Returns
        -------
        BodyOrm
            The body row (updated), refreshed from the DB.

        Raises
        ------
        ValueError
            On any validation failure: invalid side, invalid kind,
            missing ``neighbour_inv_id`` for halfway/extrapolated,
            ``neighbour_inv_id`` equal to the body's source investigation,
            or a body that does not exist / belongs to another model.
            (Overwriting a detector ``to_target`` is allowed — see the
            provenance note in the module docstring.)
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

        # ----- Scope guards -----------------------------------------------
        await load_scoped_or_raise(
            self._session, GeologicalModelOrm, model_id, project_id, label="Model"
        )

        # ----- Load the target body directly by id ------------------------
        # The resolver owns body creation; this endpoint never creates a
        # body. A missing id, or a body that belongs to a different model,
        # is a hard ValueError (the candidate / body-acting UI always holds
        # a live body_id, so this should not happen in practice).
        body = await self._session.get(BodyOrm, body_id)
        if body is None or body.model_id != model_id:
            raise ValueError(f"body {body_id} not found in model {model_id}")

        # A body can't pinch out to its own source investigation. Compare
        # against the body's authoritative source (not the optional request
        # field, which is only for back-fill).
        if (
            kind in (EXTENT_KIND_PINCH_OUT_HALFWAY, EXTENT_KIND_EXTRAPOLATED)
            and neighbour_inv_id == body.source_investigation_id
        ):
            raise ValueError(
                "neighbour_inv_id must not equal source_investigation_id "
                "(a body can't pinch out to its own source investigation)"
            )

        # ----- Cross-project investigation guard (S2 audit) ---------------
        # Validate that a supplied neighbour id belongs to this project. The
        # body row stores it as a bare UUID with no FK constraint (mirrors
        # the formation_contact.borehole_id / cpt_id pattern — spec §4.2),
        # so the DB won't catch a cross-project UUID at insert time.
        if neighbour_inv_id is not None:
            await _validate_investigation_in_project(
                self._session,
                neighbour_inv_id,
                project_id,
                label="neighbour_inv_id",
            )

        # Column name helpers — avoids repetition below.
        kind_col = f"extent_{side}_kind"
        target_col = f"extent_{side}_target_contact_id"
        neighbour_col = f"extent_{side}_neighbour_inv_id"

        # ----- Provenance + update path -----------------------------------
        existing_kind: str | None = getattr(body, kind_col)

        # Provenance (revised owner directive 2026-06-04): a user claim ALWAYS
        # wins over a detector-set 'to_target' extent — a to_target is a guess,
        # not a committed decision, so an explicit open/pinch from the engineer
        # overwrites it directly (no ClearBodyExtent dance, no 409).  Forcing a
        # clear-first blocked the manual interpretation workflow (dogfeed
        # 2026-06-04).  The protection that still matters — the DETECTOR never
        # clobbering a USER claim — is enforced in ``DetectBodies``, not here.
        if existing_kind == EXTENT_KIND_TO_TARGET:
            self.info(
                f"ClaimBodyExtent: user claim {kind!r} overrides detector "
                f"'to_target' on side={side} (body={body_id})"
            )
        elif is_user_claimed_extent_kind(existing_kind) and existing_kind != kind:
            # Replacing one user-claim kind with a different one is allowed;
            # the user is explicitly changing their mind.
            self.info(
                f"ClaimBodyExtent: replacing user-claim {existing_kind!r} → {kind!r} on side={side}"
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

        # Back-fill the body's source investigation only if it is NULL.
        #
        # Do NOT re-anchor the source to the claimed column on every claim: a
        # body's left and right caps can be claimed on DIFFERENT columns (a
        # pinch on one end, an open on the other), and one ``source`` field
        # can't hold both — re-anchoring on the second claim drags the whole
        # body to that column (dogfeed 2026-06-03).  The correct fix is to frame
        # each cap from its own band END at render time (leftmost member for the
        # left cap, rightmost for the right), which makes ``source`` irrelevant
        # for cap framing; tracked separately.
        if body.source_investigation_id is None and source_investigation_id is not None:
            body.source_investigation_id = source_investigation_id

        # Upgrade primary_section_id when it was not set yet.
        if body.primary_section_id is None and primary_section_id is not None:
            body.primary_section_id = primary_section_id

        await self._session.commit()
        await self._session.refresh(body)
        self.success(f"ClaimBodyExtent: committed body={body.id} side={side} kind={kind}")
        return body
