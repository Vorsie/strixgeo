"""Pydantic schema: :class:`SubdivideAllBodiesRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class SubdivideAllBodiesRequest(BaseModel):
    """Body of ``POST .../geotech/subdivide-all-bodies``.

    The operation is model-wide: every in-model investigation is classified
    and materialised in one atomic pass.  Geotech layers are written once per
    investigation (section-independent); correlation edges are derived
    per-section from the litho model's approved edges.

    Parameters
    ----------
    litho_model_id : UUID
        The lithostratigraphic model whose picks drive the subdivision.
        (The litho model id also appears in the URL as ``model_id``; this
        field is the canonical source used by the use case.)
    """

    litho_model_id: UUID
