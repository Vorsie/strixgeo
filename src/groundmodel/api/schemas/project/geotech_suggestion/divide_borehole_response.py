"""Pydantic schema: :class:`DivideBoreholeResponse`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class DivideBoreholeResponse(BaseModel):
    """Response of ``POST .../geotech/divide-boreholes``.

    Parameters
    ----------
    geotech_model_id : UUID
        The geotechnical model that was updated.
    divided_borehole_count : int
        Number of borehole columns that received ≥ 2 TIN-divided packing bands.
    single_band_borehole_count : int
        Number of borehole columns assigned a single band (no CPT split surfaces
        in their body group, or all splits clamped out of the geo extent).
    layer_count : int
        Total ``litho_layer`` rows inserted for boreholes in this call.
    created_formation_ids : list[UUID]
        Geotech ``geological_formation`` rows created in this call (find-or-create;
        a re-run lists only rows not already in the DB from a prior SAB or
        DivideBoreholes run).
    reanchored_tie_count : int
        Accepted packing ties touching a borehole column that were carried onto
        the rebuilt bands.  Deleting the borehole bands cascades their edges
        away, so without this pass a hand-drawn tie would vanish on every
        re-divide.  Includes the ties counted in ``review_tie_reasons``.
    review_tie_reasons : dict[str, int]
        Carried ties the engineer must confirm, per reason: ``class_changed`` /
        ``ambiguous_band``.  Flagged, not lost.
    lost_tie_count : int
        Accepted ties on a borehole column that could not be carried — the
        rebuild draws nothing where they were anchored.  Surface this: only the
        engineer can redraw them.
    lost_tie_reasons : dict[str, int]
        Breakdown of ``lost_tie_count``: ``class_changed`` / ``interval_moved``
        / ``band_absent``.  Never ``borehole_endpoint_deferred`` — that token
        means "the borehole bands come back one verb later", and this verb IS
        that later step, so a borehole endpoint with no band here reads
        ``band_absent``.
    lost_tie_labels : list[str]
        One line per lost tie naming both investigations and each endpoint's
        depth range, so the engineer can find them in the section.
    crossing_tie_count : int
        Machine ties deleted for crossing another tie in the same gap.  Legacy
        rows only: the emit-time guard refuses a crossing candidate.  Hand-drawn
        ties are never deleted.
    superseded_jump_tie_count : int
        Bridged CPT↔CPT jump ties deleted because the borehole-mediated chain
        now carries the same connection (owner ruling 2026-08-14).
    """

    geotech_model_id: UUID = Field(
        ...,
        description="The geotechnical model that was updated.",
    )
    divided_borehole_count: int = Field(
        ...,
        description="Borehole columns that received ≥ 2 TIN-divided packing bands.",
    )
    single_band_borehole_count: int = Field(
        ...,
        description=(
            "Borehole columns assigned a single band (no CPT split surfaces in their body group)."
        ),
    )
    layer_count: int = Field(
        ...,
        description="Total litho_layer rows inserted for boreholes.",
    )
    created_formation_ids: list[UUID] = Field(
        default_factory=list,
        description="Newly created geotech geological_formation rows.",
    )
    reanchored_tie_count: int = Field(
        0,
        description=(
            "Accepted packing ties on a borehole column that were carried onto "
            "the rebuilt bands (includes the flagged ones)."
        ),
    )
    review_tie_reasons: dict[str, int] = Field(
        default_factory=dict,
        description=(
            "Carried ties the engineer must confirm, per reason: class_changed / "
            "ambiguous_band. Not losses — they survived, flagged."
        ),
    )
    lost_tie_count: int = Field(
        0,
        description=(
            "Accepted ties on a borehole column whose band is not in the rebuild, "
            "so they could not be carried. The engineer has to redraw them."
        ),
    )
    lost_tie_reasons: dict[str, int] = Field(
        default_factory=dict,
        description=(
            "Why the lost ties were lost: class_changed / interval_moved / band_absent. "
            "Never borehole_endpoint_deferred — this verb is the step that token defers to."
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
    superseded_jump_tie_count: int = Field(
        0,
        description=(
            "Bridged CPT-to-CPT jump ties deleted because the borehole-mediated "
            "chain now carries the same connection (owner ruling 2026-08-14: the "
            "chain replaces the jump tie, hand-drawn or machine)."
        ),
    )
    crossing_tie_count: int = Field(
        0,
        description=(
            "Machine-made packing ties deleted because they crossed another tie in "
            "the same gap (owner ruling 2026-08-17: ties should not be able to "
            "cross). These are legacy rows from an older derivation, which no "
            "emit-time guard can reach because the re-anchor carries stored ties "
            "across every band rebuild. Hand-drawn ties are never deleted."
        ),
    )
