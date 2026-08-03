"""Pydantic schema: :class:`SubdivideAllBodiesResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class SubdivideAllBodiesResponse(BaseModel):
    """Response of ``POST .../geotech/subdivide-all-bodies``.

    Parameters
    ----------
    geotech_model_id : UUID
        The geotechnical model used (find-or-created by the use case
        itself; reused when it already exists).
    created_formation_ids : list[UUID]
        Classified geotech ``geological_formation`` rows created in this call.
        Find-or-create is DB-backed, so a re-run returns only newly created
        rows; formations created in a prior run are reused and not listed here.
    layer_count : int
        Total ``litho_layer`` rows inserted into the geotech model across all
        model investigations (section-independent).
    body_count : int
        Total ``BodyOrm`` rows created after the resolver runs, i.e. the
        number of distinct spatial geotech bodies in the model.
    split_body_count : int
        Number of body groups that received a consistent multi-band split
        (B-policy: the CPT profiles agreed on more than one NAD class band).
    one_class_body_count : int
        Number of body groups assigned one representative NAD class
        (inconsistent CPT profiles → thickness-dominant single class).
    borehole_only_count : int
        Number of body groups that were borehole-only (no CPT qc data →
        skeleton sub-body with ``nad_class=None``; use DivideBoreholes to
        assign TIN-divided packing bands after SAB + manual correlations).
    section_count : int
        Number of project sections for which geotech correlation edges were
        derived from the litho model's approved edges.
    reanchored_tie_count : int
        Accepted packing ties carried across the rebuild.  A rebuilt band is
        the band the tie pointed at when the investigation, the depth interval
        and the NAD class all match (owner ruling 2026-08-01), so the tie is
        re-created against it — still accepted, still carrying its original
        provenance.
    review_tie_reasons : dict[str, int]
        Carried ties that need the engineer to confirm them, per reason:
        ``class_changed`` = the qc re-derived a different packing class over
        those depths; ``ambiguous_band`` = several same-class bands overlap
        where the old one was.  They are included in ``reanchored_tie_count``
        — flagged, not lost.
    lost_tie_count : int
        Accepted packing ties that could not be carried because at least one
        endpoint's band is not in the rebuild.  Surface this to the engineer:
        the ties are gone and only he can redraw them.
    lost_tie_reasons : dict[str, int]
        Breakdown of ``lost_tie_count``.  ``class_changed`` = the qc re-derived
        a different packing class over the same depths; ``interval_moved`` = a
        boundary shifted; ``band_absent`` = the rebuild no longer draws that
        geology; ``borehole_endpoint_deferred`` = the endpoint is a borehole
        column, whose bands are materialised by the later DivideBoreholes step.
        Only THIS verb can report ``borehole_endpoint_deferred``: past
        DivideBoreholes the same endpoint reads ``band_absent``.
    lost_tie_labels : list[str]
        One line per lost tie naming both investigations and each endpoint's
        depth range, so the engineer can find them in the section.
    """

    geotech_model_id: UUID = Field(
        ...,
        description="The geotechnical model used (created or reused).",
    )
    created_formation_ids: list[UUID] = Field(
        ...,
        description="Classified geotech geological_formation rows created in this call.",
    )
    layer_count: int = Field(
        ...,
        description="Total litho_layer rows inserted into the geotech model.",
    )
    body_count: int = Field(
        ...,
        description="Total BodyOrm rows created after resolution.",
    )
    split_body_count: int = Field(
        ...,
        description="Body groups that received a consistent multi-band split.",
    )
    one_class_body_count: int = Field(
        ...,
        description="Body groups assigned one representative NAD class.",
    )
    borehole_only_count: int = Field(
        ...,
        description=(
            "Body groups that were borehole-only (no CPT qc data). "
            "Run DivideBoreholes to assign TIN-divided packing bands."
        ),
    )
    section_count: int = Field(
        0,
        description="Project sections for which geotech edges were derived.",
    )
    reanchored_tie_count: int = Field(
        0,
        description=(
            "Accepted packing ties re-anchored onto the rebuilt bands "
            "(same investigation, same depth interval, same NAD class)."
        ),
    )
    review_tie_reasons: dict[str, int] = Field(
        default_factory=dict,
        description=(
            "Carried ties the engineer must confirm, per reason: class_changed / "
            "ambiguous_band. These are NOT losses — they survived and are counted "
            "in reanchored_tie_count — but the band they came back on is not "
            "clearly the one they were drawn on, so they carry a review flag."
        ),
    )
    lost_tie_count: int = Field(
        0,
        description=(
            "Accepted packing ties whose band is not in the rebuild, so they "
            "could not be carried across. The engineer has to redraw them."
        ),
    )
    lost_tie_reasons: dict[str, int] = Field(
        default_factory=dict,
        description=(
            "Why the lost ties were lost: class_changed / interval_moved / "
            "band_absent / borehole_endpoint_deferred."
        ),
    )
    lost_tie_labels: list[str] = Field(
        default_factory=list,
        description=(
            "One line per lost tie naming BOTH investigations and each endpoint's "
            "depth range, e.g. 'GEO-22/115-S10 4.20-6.10 m <-> BH-3 4.00-5.90 m'. "
            "A count alone tells the engineer accepted work vanished and nothing "
            "about where to redraw it; the ids were only ever in a server log."
        ),
    )
