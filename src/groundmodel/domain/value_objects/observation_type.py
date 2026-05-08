"""Observation type enum — kind of subsurface observation log on a borehole."""

from enum import StrEnum


class ObservationType(StrEnum):
    """Type of subsurface observation log attached to a borehole.

    Each type corresponds to a separate DOV interpretation stream:

    * CODED_LITHOLOGY — coded soil description (main soil + admixture codes).
    * GEOTECHNICAL_CODING — geotechnical re-interpretation by an engineer.
    * LITHOLOGICAL_DESCRIPTION — free-text lithological description.
    * INFORMAL_STRATIGRAPHY — informal stratigraphic units.
    * FORMAL_STRATIGRAPHY — formal stratigraphic units (e.g. "HyEg - Lid van
      Egem" = "Member of Egem", from the Formation of Hyon).
    * QUATERNARY_STRATIGRAPHY — Quaternary-specific stratigraphic interpretation.
    * HYDROGEOLOGICAL_STRATIGRAPHY — HCOV / hydrogeological units.
    * INFORMAL_HYDROGEOLOGICAL_STRATIGRAPHY — informal hydrogeological units.

    Multiple types may coexist on the same borehole — a driller's coded lithology
    plus an engineer's later geotechnical re-coding plus a formal stratigraphic
    interpretation are all common. Each is its own ``Observation`` entity.
    """

    CODED_LITHOLOGY = "coded_lithology"
    GEOTECHNICAL_CODING = "geotechnical_coding"
    LITHOLOGICAL_DESCRIPTION = "lithological_description"
    INFORMAL_STRATIGRAPHY = "informal_stratigraphy"
    FORMAL_STRATIGRAPHY = "formal_stratigraphy"
    QUATERNARY_STRATIGRAPHY = "quaternary_stratigraphy"
    HYDROGEOLOGICAL_STRATIGRAPHY = "hydrogeological_stratigraphy"
    INFORMAL_HYDROGEOLOGICAL_STRATIGRAPHY = "informal_hydrogeological_stratigraphy"
