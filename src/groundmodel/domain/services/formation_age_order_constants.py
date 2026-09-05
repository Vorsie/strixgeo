"""Constants for :mod:`formation_age_order`.

The anthropogenic unit (Dutch ``Antropogeen`` — man-made fill, DOV code
``A``) is by definition the youngest thing in any Belgian/Dutch column:
it is deposited by people, on top of everything natural. No amount of
per-borehole contact evidence can make it older, so the age-order
inference pins it to the youngest end whenever it is present (owner
ruling 2026-09-05).

The recognition tokens live here, as data, so the rule is one edit away
from covering a new label variant without touching the algorithm.
"""

from __future__ import annotations

# Normalised labels that identify the anthropogenic (man-made fill) unit.
# WHY these two: DOV ships the unit as the name "Antropogeen" and the
# formal-stratigraphy code "A". Both are matched so the pin fires whether
# the caller passes a formation's display name or its regional_ref code.
# Matching is against the *normalised* label (lowercased, whitespace
# collapsed) produced by ``_normalize_label`` — never a substring test,
# so a formation merely mentioning fill in a longer name is not caught.
ANTHROPOGENIC_TOKENS: frozenset[str] = frozenset({"antropogeen", "a"})


def _normalize_label(label: str | None) -> str:
    """Lowercase and collapse whitespace for a case-insensitive match.

    Parameters
    ----------
    label : str or None
        A formation name or regional-reference code, possibly ``None``.

    Returns
    -------
    str
        The normalised form, or the empty string for ``None``/blank input.
    """
    if not label:
        return ""
    return " ".join(label.lower().split())


def is_anthropogenic(*labels: str | None) -> bool:
    """Return whether any supplied label identifies the anthropogenic unit.

    Parameters
    ----------
    *labels : str or None
        One or more candidate labels for a single formation — typically
        its name and its regional-reference code. Blank/``None`` labels
        are ignored.

    Returns
    -------
    bool
        ``True`` when a normalised label exactly equals one of
        :data:`ANTHROPOGENIC_TOKENS`.
    """
    return any(_normalize_label(label) in ANTHROPOGENIC_TOKENS for label in labels)
