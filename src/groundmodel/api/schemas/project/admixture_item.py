"""Pydantic schema: :class:`AdmixtureItem`."""

from __future__ import annotations

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class AdmixtureItem(StrictRequestModel):
    """Secondary soil component within a litho layer or formation.

    The single API-boundary mirror of
    :class:`groundmodel.domain.value_objects.admixture.Admixture`,
    shared by the litho-suggestion request family
    (``suggested_admixtures``) and the admixture-propagation family
    (``PropagateAdmixturesRequest.admixtures``). The two families
    previously carried near-identical private copies; this superset
    (with defaults) serves both — wire field names are unchanged.

    Parameters
    ----------
    soil_code : str
        DOV vocabulary code (e.g. ``"KL"`` for clay, ``"GL"`` for
        glauconite).
    amount : str
        Qualitative amount token (e.g. ``"Z"`` = weak, ``"M"`` =
        medium/moderate, ``"S"`` = strong).  Empty string when
        unspecified.
    locally : bool
        ``True`` when the admixture is only locally present within the
        interval (sporadic lens).
    """

    soil_code: str
    amount: str = ""
    locally: bool = False
