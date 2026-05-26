"""Shared schemas for litho-correlation endpoints.

Contains admixture-propagation schemas consumed by the contact-level
router (``contact_correlations.py``).  The formation-level correlation
schemas (``LithoCorrelationRequest``, ``LithoCorrelationResponse``,
``ResolveInstancesResponse``, ``LithoCorrelationEdgeListItem``,
``AutoCorrelateResponse``, ``DeleteAutoCorrelationsResponse``) were
removed alongside the formation-level ``correlations.py`` router in
#133 Phase 3 (Task 14).
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from groundmodel.api.schemas.project.geological_formation import GeologicalFormationResponse


class AdmixtureItemSchema(BaseModel):
    """One admixture entry in a litho formation's admixture list.

    Attributes
    ----------
    soil_code : str
        BaseLithology token for the admixture (ZAND, KLEI, SILT, GRIND, VEEN,
        or an extended admixture code such as ZN, KL, SL, GR, VE, OM).
    amount : str
        Qualitative amount token (e.g. 'M' = moderate, 'S' = strongly).
    locally : bool
        ``True`` when the admixture is present only locally (sporadic lens).
    """

    soil_code: str
    amount: str
    locally: bool


class PropagateAdmixturesRequest(BaseModel):
    """Body for ``PATCH /projects/{pid}/geology/models/{mid}/contact-correlations/admixtures``.

    Attributes
    ----------
    formation_id : UUID
        Any formation in the target correlated body.  BFS finds every other
        formation in the same connected component and applies the admixtures
        to all of them.
    admixtures : list[AdmixtureItemSchema]
        The new admixture list to write.  An empty list clears admixtures for
        the entire correlated body.
    """

    formation_id: UUID
    admixtures: list[AdmixtureItemSchema] = []


class PropagateAdmixturesResponse(BaseModel):
    """Response for ``PATCH .../contact-correlations/admixtures``.

    Attributes
    ----------
    updated_formations : list[GeologicalFormationResponse]
        Every formation that was updated (the full connected component), each
        refreshed from the DB after commit so the caller can replace its local
        cache entries directly.
    component_size : int
        Total number of formations in the connected component (>= 1).  Equal
        to ``len(updated_formations)`` unless a formation in the BFS set was
        absent from the DB (defensive only; should not happen in practice).
    """

    updated_formations: list[GeologicalFormationResponse]
    component_size: int
