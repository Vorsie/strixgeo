"""LayoutProfileRegistry: pick the layout profile from a page's text."""

from __future__ import annotations

from collections.abc import Sequence

from groundmodel.infrastructure.parsers.cpt.pdf.layout_profile import LayoutProfile
from groundmodel.infrastructure.parsers.cpt.pdf.layout_profile_constants import (
    BUILT_IN_PROFILES,
    GENERIC_PROFILE,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class LayoutProfileRegistry(GroundModelLogger):
    """An ordered list of profiles with a generic fallback.

    Parameters
    ----------
    profiles : sequence of LayoutProfile
        Tried in order; the first fingerprint hit wins.
    fallback : LayoutProfile
        Returned when no fingerprint matches.
    """

    def __init__(
        self, profiles: Sequence[LayoutProfile], fallback: LayoutProfile = GENERIC_PROFILE
    ) -> None:
        super().__init__(__name__)
        self._profiles = tuple(profiles)
        self._fallback = fallback

    @classmethod
    def default(cls) -> LayoutProfileRegistry:
        """Return the registry holding the built-in profiles.

        Returns
        -------
        LayoutProfileRegistry
            DOV, Van der Straaten, generic fallback.
        """
        return cls(BUILT_IN_PROFILES)

    @property
    def profiles(self) -> tuple[LayoutProfile, ...]:
        """Return the fingerprinted profiles in match order."""
        return self._profiles

    def match(self, text: str) -> LayoutProfile:
        """Return the profile whose fingerprint occurs in ``text``.

        Parameters
        ----------
        text : str
            A page's text layer (may be empty for a scan).

        Returns
        -------
        LayoutProfile
            The first matching profile, else the generic fallback.
        """
        for profile in self._profiles:
            if profile.matches(text):
                self.trace("layout profile %s matched", profile.name)
                return profile
        return self._fallback
