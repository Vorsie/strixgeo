"""Request schema for POST /borehole/detail-batch — debt #39.

Folds N per-borehole detail GETs (the section-open hot path) into
one call. Mirrors the shape of ``CptPlotBatchRequest`` so the two
batch endpoints stay symmetric.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel

# Cap on ids per batch. Matches CptPlotBatchRequest's ceiling — a section
# with 500 in-buffer boreholes is well beyond the dogfeed target (typical
# is <30); the cap guards the endpoint against a runaway caller DOS-ing
# the API with one giant request.
_MAX_IDS = 500


class BoreholeDetailBatchRequest(StrictRequestModel):
    """Body of ``POST /borehole/detail-batch``.

    ``ids`` is the list of borehole row IDs the caller wants detail
    for. Order of the response is NOT guaranteed to match ``ids`` —
    callers should index by ``id`` on each ``BoreholeDetailResponse``
    rather than by array position. Unknown ids are silently dropped
    (the cross-section render path already gates on "detail row exists
    for this borehole" before drawing strips).

    ``app_project_id`` is the project scope guard (debt #4 / VULN-6).
    REQUIRED — a caller in project A who knows or guesses a UUID from
    project B would otherwise retrieve that foreign borehole's tree.

    ``include`` mirrors the per-id GET endpoint's query parameter:
    comma-separated lab-test family aliases. Omitting the field loads
    EVERY lab family (the original always-load behaviour); passing an
    explicit list loads only those families. Section views typically
    pass ``include=[]`` because the column glyphs don't render lab
    data — saves the six lab-family SELECTs per borehole.
    """

    ids: list[UUID] = Field(min_length=1, max_length=_MAX_IDS)
    app_project_id: UUID
    # Optional per-batch include list. ``None`` (default) preserves the
    # pre-debt-#39 always-load behaviour; an explicit list (including
    # the empty list) narrows the load. Per-id validation lives in the
    # router so a malformed value surfaces a 400 with the valid set.
    include: list[str] | None = None
