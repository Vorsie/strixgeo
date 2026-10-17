"""Eager-load option builder for the borehole observation -> layer chain."""

from __future__ import annotations

from sqlalchemy.orm import selectinload
from sqlalchemy.orm.interfaces import LoaderOption

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm


def borehole_observation_layers_options(include_admixtures: bool = False) -> list[LoaderOption]:
    """Build the selectinload options for a borehole's observation -> layer chain.

    Single source of truth for the lighter eager-load spec the stratigraphy use
    cases share (``BoreholeOrm.observations`` -> ``ObservationOrm.layers``),
    distinct from the repository's full detail tree
    (:func:`groundmodel.infrastructure.db.repositories.borehole_repository.borehole_full_tree_options`).
    A lazy load fired for ``observations`` / ``layers`` from a ``lazy="raise"``
    relationship or a Pydantic attribute walk raises ``MissingGreenlet``, so
    every use case that reads a borehole's layers eager-loads through this one
    chain rather than carrying its own byte-identical copy.

    Parameters
    ----------
    include_admixtures : bool, default False
        When ``True`` the chain additionally eager-loads
        ``ObservationLayerOrm.admixtures`` (the superset that
        ``SuggestLithoContacts`` needs). This is a strict extension of the base
        chain -- the same loader with one more level -- never a second copy.

    Returns
    -------
    list[LoaderOption]
        Loader options ready to splat into ``select(BoreholeOrm).options(*...)``.
    """
    chain = selectinload(BoreholeOrm.observations).selectinload(ObservationOrm.layers)
    if include_admixtures:
        chain = chain.selectinload(ObservationLayerOrm.admixtures)
    return [chain]
