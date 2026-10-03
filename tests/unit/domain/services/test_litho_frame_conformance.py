"""Unit tests for the litho-frame conformance warning (owner order 2026-08-21).

FC-1..FC-5: the pure rule — different soils warn, same-soil unconnected
warns with the correlate-first advice, connected same-soil ties stay silent,
and an unresolved parent never warns (absence of evidence).
"""

from groundmodel.domain.services.litho_frame_conformance import (
    FRAME_MISMATCH_REVIEW_REASON,
    frame_tie_warning,
)


class TestFrameTieWarning:
    """FC-1..FC-5 — the pure conformance rule."""

    def test_fc1_different_soils_warn_as_surface_only(self) -> None:
        """FC-1: silt↔clay can never band — the warning says surface, not mass."""
        warning = frame_tie_warning(
            soil_a="SILT",
            soil_b="KLEI",
            litho_connected=False,
            band_a="GEO-10/170-S11 -6.21..-7.53",
            band_b="GEO-23/125-S6 -5.87..-9.96",
        )
        assert warning is not None
        assert "different soils" in warning
        assert "GEO-10/170-S11" in warning and "GEO-23/125-S6" in warning

    def test_fc2_same_soil_unconnected_advises_litho_first(self) -> None:
        """FC-2: same soil, no litho path — advise correlating the litho units."""
        warning = frame_tie_warning(
            soil_a="SILT",
            soil_b="SILT",
            litho_connected=False,
            band_a="1411-GEO-23/126-B3 8.48..6.48",
            band_b="GEO-23/125-S9 11.73..6.23",
        )
        assert warning is not None
        assert "Correlate the litho units first" in warning

    def test_fc3_connected_same_soil_is_silent(self) -> None:
        """FC-3: a conforming tie warns nothing."""
        assert (
            frame_tie_warning(
                soil_a="ZAND",
                soil_b="ZAND",
                litho_connected=True,
                band_a="a",
                band_b="b",
            )
            is None
        )

    def test_fc4_unresolved_parent_is_silent(self) -> None:
        """FC-4: an unresolved parent unit is not evidence of non-conformance."""
        assert (
            frame_tie_warning(
                soil_a=None,
                soil_b="KLEI",
                litho_connected=False,
                band_a="a",
                band_b="b",
            )
            is None
        )

    def test_fc5_no_ids_in_the_message(self) -> None:
        """FC-5: the message names columns and depths, never UUIDs (owner D5)."""
        warning = frame_tie_warning(
            soil_a="SILT",
            soil_b="SILT",
            litho_connected=False,
            band_a="GEO-23/125-S9 11.73..6.23",
            band_b="1411-GEO-23/126-B3 8.48..6.48",
        )
        assert warning is not None
        assert "uuid" not in warning.lower()
        assert FRAME_MISMATCH_REVIEW_REASON == "frame_mismatch"


class TestFrameTieAcrossLithoUnits:
    """FC-6 — owner 2026-10-03: two litho units of one soil never weld."""

    def test_fc6_zand_to_zand_matig_siltig_warns_as_surface_only(self) -> None:
        """FC-6: "a zand and zand/matig siltig are 2 different lithologies".

        Same main soil, litho-connected by a tie, but two litho UNITS: the tie
        states a shared surface, never one mass, and the engineer is told so.
        """
        warning = frame_tie_warning(
            soil_a="ZAND",
            soil_b="ZAND",
            litho_connected=True,
            band_a="ZAND (NAD 6) on S1",
            band_b="ZAND (SL:M) (NAD 6) on S2",
            same_litho_unit=False,
        )
        assert warning is not None
        assert "different litho units" in warning
        assert "S1" in warning and "S2" in warning

    def test_fc6b_same_unit_connected_is_still_silent(self) -> None:
        """FC-6b: negative control - one unit, connected: no warning."""
        assert (
            frame_tie_warning(
                soil_a="ZAND",
                soil_b="ZAND",
                litho_connected=True,
                band_a="a",
                band_b="b",
                same_litho_unit=True,
            )
            is None
        )
