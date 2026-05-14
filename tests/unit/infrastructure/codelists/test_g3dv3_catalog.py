"""Tests for the G3Dv3 stratigraphic catalog loader."""

from __future__ import annotations

import pytest

from groundmodel.infrastructure.codelists.g3dv3_catalog import (
    G3Dv3Catalog,
    G3Dv3Unit,
    get_catalog,
)


@pytest.fixture(scope="module")
def catalog() -> G3Dv3Catalog:
    """Shared catalog instance — load once per module."""
    return G3Dv3Catalog()


class TestG3Dv3CatalogShape:
    """The shipped JSON loads cleanly and contains the expected unit count."""

    def test_loads_all_117_units(self, catalog: G3Dv3Catalog) -> None:
        units = catalog.all_units()
        assert len(units) == 117

    def test_first_unit_is_antropogeen(self, catalog: G3Dv3Catalog) -> None:
        units = catalog.all_units()
        assert units[0].name_nl == "Antropogeen"
        assert units[0].age_rank == 0

    def test_last_unit_is_oldest_paleozoic(self, catalog: G3Dv3Catalog) -> None:
        units = catalog.all_units()
        assert units[-1].age_rank == 116
        # Siluur / Ordovicium / Cambrium are the deepest in Flanders
        assert "Siluur" in units[-1].name_nl

    def test_age_ranks_are_dense_and_monotonic(self, catalog: G3Dv3Catalog) -> None:
        ranks = [u.age_rank for u in catalog.all_units()]
        assert ranks == list(range(len(ranks)))


class TestNameLookup:
    """Dutch-name lookup is case- and whitespace-insensitive."""

    @pytest.mark.parametrize(
        "name,expected_age_rank,expected_color",
        [
            ("Antropogeen", 0, "#ea152e"),
            ("Boom", 43, "#2c73b9"),
            ("Diest", 30, "#ef886f"),
            ("Kortrijk", 86, "#9085ba"),
        ],
    )
    def test_known_formations_resolve(
        self,
        catalog: G3Dv3Catalog,
        name: str,
        expected_age_rank: int,
        expected_color: str,
    ) -> None:
        unit = catalog.lookup_by_name(name)
        assert unit is not None
        assert unit.age_rank == expected_age_rank
        assert unit.color_hex == expected_color

    def test_lookup_is_case_insensitive(self, catalog: G3Dv3Catalog) -> None:
        a = catalog.lookup_by_name("boom")
        b = catalog.lookup_by_name("BOOM")
        c = catalog.lookup_by_name("Boom")
        assert a is b is c
        assert a is not None
        assert a.name_nl == "Boom"

    def test_lookup_tolerates_surrounding_whitespace(self, catalog: G3Dv3Catalog) -> None:
        a = catalog.lookup_by_name("  Diest  ")
        b = catalog.lookup_by_name("Diest")
        assert a is b
        assert a is not None

    def test_historical_name_alias_resolves(self, catalog: G3Dv3Catalog) -> None:
        # G3Dv3 renamed the Ieper formation to Kortrijk, but DOV
        # boreholes interpreted under the old framework still ship
        # "Ieper" / "Ieperiaan". The alias map round-trips them to
        # the modern unit so age-rank lookup still works.
        kortrijk = catalog.lookup_by_name("Kortrijk")
        assert kortrijk is not None
        assert catalog.lookup_by_name("Ieper") is kortrijk
        assert catalog.lookup_by_name("Ieperiaan") is kortrijk
        # Case-insensitive on the alias key too.
        assert catalog.lookup_by_name("IEPER") is kortrijk

    def test_unknown_name_returns_none(self, catalog: G3Dv3Catalog) -> None:
        assert catalog.lookup_by_name("NotARealFormation") is None

    def test_empty_or_none_input_returns_none(self, catalog: G3Dv3Catalog) -> None:
        assert catalog.lookup_by_name(None) is None
        assert catalog.lookup_by_name("") is None
        assert catalog.lookup_by_name("   ") is None


class TestAbbreviationLookup:
    """G3D abbreviation lookup matches the codes used in the kleurcode table."""

    def test_simple_abbreviation_resolves(self, catalog: G3Dv3Catalog) -> None:
        unit = catalog.lookup_by_abbreviation("NE_Di")
        assert unit is not None
        assert unit.name_nl == "Diest"

    def test_antropogeen_single_letter_abbreviation(self, catalog: G3Dv3Catalog) -> None:
        unit = catalog.lookup_by_abbreviation("A")
        assert unit is not None
        assert unit.name_nl == "Antropogeen"

    def test_member_abbreviation_resolves(self, catalog: G3Dv3Catalog) -> None:
        unit = catalog.lookup_by_abbreviation("Q_GtAb")
        assert unit is not None
        assert unit.rank == "member"
        assert unit.parent_abbreviation == "Q_Gt"


class TestCodeLookup:
    """Numeric G3D code lookup is exact."""

    def test_known_code_resolves(self, catalog: G3Dv3Catalog) -> None:
        unit = catalog.lookup_by_code("0303")
        assert unit is not None
        assert unit.name_nl == "Boom"

    def test_member_code_resolves(self, catalog: G3Dv3Catalog) -> None:
        unit = catalog.lookup_by_code("010101")
        assert unit is not None
        assert unit.name_nl == "Achterbos"
        assert unit.rank == "member"

    def test_unknown_code_returns_none(self, catalog: G3Dv3Catalog) -> None:
        assert catalog.lookup_by_code("9999") is None
        assert catalog.lookup_by_code(None) is None


class TestResolve:
    """The omnibus resolver tries name → abbreviation → code."""

    def test_resolves_by_name(self, catalog: G3Dv3Catalog) -> None:
        unit = catalog.resolve("Boom")
        assert unit is not None
        assert unit.code == "0303"

    def test_resolves_by_abbreviation(self, catalog: G3Dv3Catalog) -> None:
        unit = catalog.resolve("PA_Bm")
        assert unit is not None
        assert unit.name_nl == "Boom"

    def test_resolves_by_code(self, catalog: G3Dv3Catalog) -> None:
        unit = catalog.resolve("0303")
        assert unit is not None
        assert unit.name_nl == "Boom"

    def test_unknown_returns_none(self, catalog: G3Dv3Catalog) -> None:
        assert catalog.resolve("WhoKnows") is None
        assert catalog.resolve(None) is None


class TestDisplayOrder:
    """display_order_for() inverts age_rank per CLAUDE.md convention."""

    def test_older_formation_has_lower_display_order(self, catalog: G3Dv3Catalog) -> None:
        boom = catalog.display_order_for("Boom")
        diest = catalog.display_order_for("Diest")
        antropogeen = catalog.display_order_for("Antropogeen")
        assert boom is not None and diest is not None and antropogeen is not None
        # Boom (Oligocene) is older than Diest (Mio-Pliocene) is older than Antropogeen
        assert boom < diest < antropogeen

    def test_alias_resolves_to_canonical_order(self, catalog: G3Dv3Catalog) -> None:
        # Ieper / Ieperiaan should sort identically to Kortrijk.
        assert catalog.display_order_for("Ieper") == catalog.display_order_for("Kortrijk")

    def test_unknown_name_returns_none(self, catalog: G3Dv3Catalog) -> None:
        assert catalog.display_order_for("NotARealFormation") is None
        assert catalog.display_order_for(None) is None

    def test_inversion_is_correct(self, catalog: G3Dv3Catalog) -> None:
        # Spot-check the sign convention: G3D age_rank=43 → display_order=-43
        unit = catalog.lookup_by_name("Boom")
        assert unit is not None
        assert catalog.display_order_for("Boom") == -unit.age_rank


class TestSingleton:
    """get_catalog() returns the same instance across calls."""

    def test_singleton_identity(self) -> None:
        a = get_catalog()
        b = get_catalog()
        assert a is b


class TestUnitDataclass:
    """G3Dv3Unit is frozen and exposes the expected fields."""

    def test_unit_is_frozen(self) -> None:
        unit = G3Dv3Unit(
            code="0001",
            abbreviation="TST",
            rank="formation",
            parent_abbreviation=None,
            name_nl="Test",
            age_rank=0,
            color_hex="#000000",
            h3d_main=None,
            h3d_sub=None,
            h3d_base=None,
        )
        with pytest.raises(Exception):  # FrozenInstanceError, but allow stdlib variation
            unit.name_nl = "Modified"  # type: ignore[misc]
