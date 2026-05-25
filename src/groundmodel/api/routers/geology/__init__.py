"""Geology API package — aggregates the per-cluster sub-routers.

The former ``geology.py`` (~1,100 lines) was split into focused
modules (debt #40). Each sub-module owns a bare ``APIRouter()``; this
package mounts them on ONE parent carrying the shared
``/projects/{project_id}/geology`` prefix + ``geology`` tag, so every
final path is byte-identical to the monolith. ``main.py``'s
``from ...routers import geology; app.include_router(geology.router)``
keeps working unchanged — ``geology.router`` is now this aggregate.
"""

from fastapi import APIRouter

from . import (
    contact_correlations,
    contacts,
    correlations,
    exports,
    formations,
    lenses,
    models,
    surfaces,
)

router = APIRouter(prefix="/projects/{project_id}/geology", tags=["geology"])
router.include_router(formations.router)
router.include_router(models.router)
router.include_router(contacts.router)
router.include_router(surfaces.router)
router.include_router(exports.router)
router.include_router(correlations.router)
router.include_router(contact_correlations.router)
router.include_router(lenses.router)
