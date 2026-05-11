"""Request schema for POST /cpt/plot-batch — fetch many plots in one call."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

# Cap on ids per batch. Guards the endpoint against a runaway caller
# DOS-ing the API with one giant request. 500 leaves headroom for
# very dense project bboxes — typical section views call with <30.
_MAX_IDS = 500


class CptPlotBatchRequest(BaseModel):
    """Body of ``POST /cpt/plot-batch``.

    ``ids`` is the list of CPT row IDs the caller wants plot data for.
    Order of the response is not guaranteed to match ``ids`` — callers
    should index by ``cpt_id`` on each ``CptPlotResponse`` rather than
    by array position. Unknown ids and series-less CPTs are silently
    dropped from the response (same skip-on-missing semantics the
    cross-section panel already needs at render time).
    """

    ids: list[UUID] = Field(min_length=1, max_length=_MAX_IDS)
