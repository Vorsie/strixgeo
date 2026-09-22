"""The coded-lithology borehole toggle can be saved on a cross-section.

Owner's dogfeed 2026-09-22 on ``npm run dev``: every borehole-stream toggle
answered "Kon de profielwijziging niet opslaan" -- the backend refused the
PATCH with ``lithology: Extra inputs are not permitted``. PR #18 (2026-09-21)
had added the coded-lithology toggle to the renderer's ``BoreholeChannels``
without its backend twin, and the renderer PATCHes the whole bag, so ONE
unknown key blocked every toggle.

Rule in the owner's words: switching the coded lithology stream on or off in a
cross-section must save like the other borehole streams.
"""

from __future__ import annotations

from groundmodel.api.schemas.project.cross_section import (
    CrossSectionUpdateRequest,
    SectionViewState,
)


def test_coded_lithology_toggle_is_accepted_with_the_other_borehole_streams() -> None:
    """The whole borehole bag, coded lithology included, validates."""
    vs = SectionViewState(
        borehole_channels={
            "lithology": True,
            "geotech": True,
            "formal_strat": False,
            "informal_strat": False,
        }
    )
    assert vs.borehole_channels is not None
    assert vs.borehole_channels.lithology is True


def test_the_patch_body_the_renderer_sends_on_a_toggle_validates() -> None:
    """Exactly the body ``SectionPanel`` PATCHes when the engineer flips one stream."""
    body = CrossSectionUpdateRequest.model_validate(
        {
            "view_state": {
                "borehole_channels": {
                    "lithology": False,
                    "geotech": True,
                    "formal_strat": False,
                    "informal_strat": False,
                }
            }
        }
    )
    assert body.view_state is not None
    assert body.view_state.borehole_channels is not None
    assert body.view_state.borehole_channels.lithology is False
