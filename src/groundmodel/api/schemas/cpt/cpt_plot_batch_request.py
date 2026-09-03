"""Request schema for POST /cpt/plot-batch — fetch many plots in one call."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel

# Cap on ids per batch. Guards the endpoint against a runaway caller
# DOS-ing the API with one giant request. 500 leaves headroom for
# very dense project bboxes — typical section views call with <30.
_MAX_IDS = 500


class CptPlotBatchRequest(StrictRequestModel):
    """Body of ``POST /cpt/plot-batch``.

    ``ids`` is the list of CPT row IDs the caller wants plot data for.
    Order of the response is not guaranteed to match ``ids`` — callers
    should index by ``cpt_id`` on each ``CptPlotResponse`` rather than
    by array position. Unknown ids and series-less CPTs are silently
    dropped from the response (same skip-on-missing semantics the
    cross-section panel already needs at render time).

    ``app_project_id`` is the project scope. The endpoint filters
    returned CPTs to those that belong to this project so a caller
    can't fetch series for a foreign-project CPT by guessing its UUID
    (VULN-5). REQUIRED — the cross-section panel always knows the
    project id from the section row and threads it through.
    """

    ids: list[UUID] = Field(min_length=1, max_length=_MAX_IDS)
    # Project scope is required — the unfiltered path (None) is no
    # longer reachable from the API (VULN-5). The repository still
    # accepts None for test/admin/CLI callers that construct the use
    # case directly; the API boundary enforces the scope requirement.
    app_project_id: UUID
