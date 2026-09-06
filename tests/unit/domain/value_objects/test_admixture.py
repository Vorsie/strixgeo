"""Unit tests for the Admixture value object."""

import pytest

from groundmodel.domain.value_objects.admixture import Admixture


class TestAdmixtureConstruction:
    def test_minimal_construction(self) -> None:
        ad = Admixture(soil_code="GL")
        assert ad.soil_code == "GL"
        assert ad.amount == ""
        assert ad.locally is False

    def test_full_construction(self) -> None:
        ad = Admixture(soil_code="KL", amount="M", locally=True)
        assert ad.soil_code == "KL"
        assert ad.amount == "M"
        assert ad.locally is True

    def test_is_frozen(self) -> None:
        ad = Admixture(soil_code="GL")
        with pytest.raises(Exception):
            ad.soil_code = "KL"  # type: ignore[misc]


class TestAdmixtureValidation:
    def test_empty_soil_code_rejected(self) -> None:
        with pytest.raises(ValueError, match="soil_code cannot be empty"):
            Admixture(soil_code="")


def test_sterk_siltig_and_veel_siltig_are_the_same_admixture() -> None:
    """Owner ruling 2026-09-06: "sterk siltig zand and veel siltig zand are the same".

    DOV logs the amount step as "V" (veel) while NEN 5104 style descriptions
    say "sterk" ("S"); both name the same step, so they must share one
    canonical key wherever admixtures are compared (accept, auto-correlate).
    The raw token itself stays as stored; only the comparison folds them.
    """
    from groundmodel.domain.value_objects.admixture import Admixture

    assert Admixture("SI", "S").canonical_key() == Admixture("SI", "V").canonical_key()
    assert Admixture("SI", "S").amount == "S"
    assert Admixture("SI", "Z").canonical_key() != Admixture("SI", "V").canonical_key()


def test_zwak_siltig_and_weinig_siltig_are_the_same_admixture() -> None:
    """Owner ruling 2026-09-06: "zwak and weinig can be the same too" (the lowest step)."""
    from groundmodel.domain.value_objects.admixture import Admixture

    assert Admixture("SI", "Z").canonical_key() == Admixture("SI", "W").canonical_key()
    assert Admixture("SI", "Z").amount == "Z"
    assert Admixture("SI", "W").canonical_key() != Admixture("SI", "M").canonical_key()
