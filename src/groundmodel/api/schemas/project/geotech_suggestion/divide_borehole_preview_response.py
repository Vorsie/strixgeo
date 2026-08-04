"""Pydantic schemas for the ``divide-boreholes/preview`` dry run.

Three classes rather than one, because the payload is a tree (model → column →
band) and the renderer draws one ghost rectangle per band.  They live together
here for the same reason ``shared/exceptions.py`` groups its hierarchy: they are
one wire shape, meaningless apart.

No NAD **label** is sent.  The class integer is the stable identity; the English
packing-class names live in the renderer's ``utils/nadClasses.ts`` lookup, and
CLAUDE.md's translate-at-the-presentation-boundary rule keeps them there.  A
label duplicated into this payload would be a second place to update.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class DivideBoreholePreviewBand(BaseModel):
    """One packing band the commit would write on a borehole column.

    Parameters
    ----------
    depth_top_m : float
        Top of the band, metres below the borehole collar.
    depth_base_m : float
        Base of the band, metres below the collar.
    nad_class : int
        NAD packing class (1–31) derived for this interval.
    source : str
        Provenance: ``cpt_interpolated`` (a same-lithology CPT resolved this
        depth), ``body_min`` (weakest class observed anywhere in the body), or
        ``absolute_min`` (the lithology floor — no CPT evidence at all).
    confidence : str
        ``high`` for ``cpt_interpolated``; ``low`` for both conservative
        fallbacks.  The same value the committed ``litho_layer`` row carries.

    Notes
    -----
    There is deliberately NO ``body_id`` here.  The plan does assign each band a
    provisional packing body (nearest same-class CPT), but the commit then runs
    ``ResolveLithoInstances`` over the whole geotech model once the
    borehole-mediated edges exist, and that pass re-stamps ``body_id`` on every
    band — CPT bands included.  A body id reported before that pass is a value
    the commit will change, and the parity gate caught exactly that on its first
    run.  Only fields the plan genuinely owns are promised here.
    """

    depth_top_m: float = Field(..., description="Top of the band (m below collar).")
    depth_base_m: float = Field(..., description="Base of the band (m below collar).")
    nad_class: int = Field(..., description="NAD packing class 1–31.")
    source: str = Field(
        ...,
        description="cpt_interpolated | body_min | absolute_min — how the class was reached.",
    )
    confidence: str = Field(..., description="high | low, as the committed row would carry it.")


class DivideBoreholePreviewColumn(BaseModel):
    """Every planned band on one borehole column, top to bottom.

    Parameters
    ----------
    borehole_id : UUID
        The borehole the bands sit on.
    name : str
        Display name, so the client never has to resolve the id itself.
    bands : list[DivideBoreholePreviewBand]
        The planned bands, sorted by ``depth_top_m``.
    """

    borehole_id: UUID = Field(..., description="The borehole the bands sit on.")
    name: str = Field(..., description="Borehole display name.")
    bands: list[DivideBoreholePreviewBand] = Field(
        default_factory=list,
        description="Planned bands, sorted top to bottom.",
    )


class DivideBoreholePreviewResponse(BaseModel):
    """Response of ``POST .../geotech/divide-boreholes/preview`` — a dry run.

    Produced by the SAME planner ``divide-boreholes`` commits, so every band
    listed here is a band the button writes.  Nothing is persisted: the request
    issues only ``SELECT``\\ s and the session is rolled back with the response.

    Parameters
    ----------
    geotech_model_id : UUID
        The geotech model a commit would write into.
    columns : list[DivideBoreholePreviewColumn]
        One entry per borehole that would receive bands.
    borehole_count : int
        Number of borehole columns in ``columns``.
    divided_borehole_count : int
        Body-group fills that would produce ≥ 2 bands (the same counter the
        commit reports, so preview and commit summaries are comparable).
    single_band_borehole_count : int
        Body-group fills that would produce exactly 1 band.
    layer_count : int
        Total ``litho_layer`` rows a commit would insert.
    carried_tie_count : int
        Accepted packing ties on a borehole column the commit would carry onto
        the rebuilt bands, INCLUDING the flagged ones.
    review_tie_reasons : dict[str, int]
        Carried-but-flagged ties per reason (``class_changed`` /
        ``ambiguous_band``).
    lost_tie_count : int
        Accepted borehole ties the commit could NOT carry — the engineer would
        have to redraw them.
    lost_tie_reasons : dict[str, int]
        Breakdown of ``lost_tie_count``.
    """

    geotech_model_id: UUID = Field(..., description="Geotech model a commit would write into.")
    columns: list[DivideBoreholePreviewColumn] = Field(
        default_factory=list,
        description="One entry per borehole that would receive planned bands.",
    )
    borehole_count: int = Field(0, description="Number of borehole columns in `columns`.")
    divided_borehole_count: int = Field(
        0, description="Body-group fills that would produce >= 2 bands."
    )
    single_band_borehole_count: int = Field(
        0, description="Body-group fills that would produce exactly 1 band."
    )
    layer_count: int = Field(0, description="Total litho_layer rows a commit would insert.")
    carried_tie_count: int = Field(
        0,
        description=(
            "Accepted borehole ties the commit would carry onto the rebuilt bands "
            "(includes the flagged ones)."
        ),
    )
    review_tie_reasons: dict[str, int] = Field(
        default_factory=dict,
        description="Carried-but-flagged ties per reason: class_changed / ambiguous_band.",
    )
    lost_tie_count: int = Field(0, description="Accepted borehole ties the commit could not carry.")
    lost_tie_reasons: dict[str, int] = Field(
        default_factory=dict,
        description="Why they would be lost: class_changed / interval_moved / band_absent.",
    )
