"""Tests for the admixture → NAD-family prompt (owner ruling 2026-09-04).

The ruling: *"we can keep the admixture mix, but then we need to prompt user in
geotech stage on subdivide. Hey we see you have an admixture here, which NAD
classes do you want, pure sand or sand with admixture."*

These pin the two pure functions that decide (a) which litho units the prompt
must ask about and (b) how a stored answer selects the NAD column. Both read the
EXISTING ``NAD_QC_BANDS`` table — no invented thresholds.
"""

from groundmodel.domain.services.nad_admixture_choice import (
    resolve_admixture_variant,
    unit_admixture_is_ambiguous,
)
from groundmodel.domain.value_objects.admixture import Admixture

# The qualifying admixtures: silt/clay for coarse soils, sand for fine soils.
SILTY = (Admixture(soil_code="KL", amount="M"),)  # clay admixture (silt-/kleihoudend)
SANDY = (Admixture(soil_code="XZ", amount="M"),)  # sand admixture (zandhoudend)
# A gravel admixture — NOT the coarse-soil fork (owner ruling 2026-09-05). NB the
# DOV gravel code is XG, not GL — GL is glauconiet.
GRAVELLY = (Admixture(soil_code="XG", amount="M"),)
# A glauconite admixture — forks a SAND to secondary (owner ruling walk22b).
GLAUCONITIC = (Admixture(soil_code="GL", amount="M"),)


class TestUnitAdmixtureIsAmbiguous:
    """A unit is ambiguous when 'pure {soil}' and '{soil} with admixture' are
    both real NAD columns AND the unit carries the admixture that forks them."""

    def test_silty_sand_is_ambiguous_the_user_must_choose_pure_or_silty_sand(self):
        """Sand + a silt/clay admixture → the classifier could pick clean (5-8)
        or secondary (9-12): a real fork, so the engineer is prompted."""
        assert unit_admixture_is_ambiguous("ZAND", SILTY) is True

    def test_silty_gravel_is_ambiguous(self):
        """Gravel + a silt/clay admixture forks clean (1-2) vs secondary (3-4)."""
        assert unit_admixture_is_ambiguous("GRIND", SILTY) is True

    def test_sandy_silt_is_ambiguous(self):
        """Silt + a sand admixture forks clean (13-16) vs secondary (17-20)."""
        assert unit_admixture_is_ambiguous("SILT", SANDY) is True

    def test_sandy_clay_is_ambiguous(self):
        """Clay + a sand admixture forks clean (21-24) vs secondary (25-28)."""
        assert unit_admixture_is_ambiguous("KLEI", SANDY) is True

    def test_clean_sand_is_not_ambiguous_nothing_to_ask(self):
        """No admixture → nothing forks → no prompt."""
        assert unit_admixture_is_ambiguous("ZAND", ()) is False

    def test_sandy_sand_is_not_ambiguous_the_table_has_no_such_variant(self):
        """A SAND admixture on SAND is not the coarse-soil fork (silt/clay is);
        the NAD table has no 'sandy sand' column, so there is nothing to ask."""
        assert unit_admixture_is_ambiguous("ZAND", SANDY) is False

    def test_gravelly_sand_is_not_ambiguous_gravel_does_not_count(self):
        """Owner ruling 2026-09-05: *"if it is gravel it does not count and it
        should default to normal sand."* A gravel admixture is not the coarse-soil
        fork (silt/clay is), so a gravelly sand is never prompted — it classifies
        as plain sand."""
        assert unit_admixture_is_ambiguous("ZAND", GRAVELLY) is False

    def test_glauconitic_sand_asks_the_admixture_question(self):
        """Owner ruling walk22b: *"I want to be able to add glauconiet as
        bijmenging; it should also trigger admixture in sand in geotech."* A
        glauconitic sand forks clean (5-8) vs secondary (9-12), so it is
        prompted exactly like a silty/clayey sand."""
        assert unit_admixture_is_ambiguous("ZAND", GLAUCONITIC) is True

    def test_silty_silt_is_not_ambiguous_the_table_has_no_such_variant(self):
        """A silt/clay admixture on SILT is not the fine-soil fork (sand is);
        no 'silty silt' NAD column exists, so no prompt."""
        assert unit_admixture_is_ambiguous("SILT", SILTY) is False

    def test_peat_is_never_ambiguous_secondary_mirrors_clean(self):
        """VEEN's secondary NAD column equals its clean column (29-31 both), so
        even a sand admixture on peat forks nothing → never prompted."""
        assert unit_admixture_is_ambiguous("VEEN", SANDY) is False

    def test_unknown_soil_is_not_ambiguous(self):
        """A soil with no NAD column at all is not ambiguous (the caller skips it)."""
        assert unit_admixture_is_ambiguous("ROCK", SANDY) is False


class TestResolveAdmixtureVariant:
    """The stored answer selects the NAD column: pure → clean, with_admixture →
    secondary, no answer → let the classifier decide from the admixtures."""

    def test_pure_forces_the_clean_column(self):
        """'pure' → the clean NAD column, even on a unit carrying a silty admixture."""
        assert resolve_admixture_variant("ZAND", SILTY, "pure") == "clean"

    def test_with_admixture_forces_the_secondary_column(self):
        """'with_admixture' → the secondary NAD column."""
        assert resolve_admixture_variant("ZAND", SILTY, "with_admixture") == "secondary"

    def test_no_answer_defers_to_the_classifier(self):
        """NULL choice → no override; the classifier keeps today's
        auto-from-admixtures behaviour."""
        assert resolve_admixture_variant("ZAND", SILTY, None) is None
