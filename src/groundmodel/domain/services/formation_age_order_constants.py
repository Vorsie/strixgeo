"""Constants for :mod:`formation_age_order`.

The anthropogenic unit (Dutch ``Antropogeen`` — man-made fill, DOV code
``A``) is by definition the youngest thing in any Belgian/Dutch column:
it is deposited by people, on top of everything natural. No amount of
per-borehole contact evidence can make it older, so the age-order
inference pins it to the youngest end whenever it is present (owner
ruling 2026-09-05). DOV's formal stratigraphy ships the same thing under
a second label: code ``G``, "Groep van geroerd/verstoord" (reworked /
disturbed ground, the man-made top of a column) — pinned the same way
(owner 2026-09-23: a new project built from DOV boreholes "put
aangebracht geroerd below quartair" because no borehole logged both and
the UUID tie-break decided).

The recognition tokens live here, as data, so the rule is one edit away
from covering a new label variant without touching the algorithm.
"""

from __future__ import annotations

# Normalised labels that identify the anthropogenic (man-made) unit.
# WHY these: DOV ships it as the name "Antropogeen" with the formal-
# stratigraphy code "A", and as the disturbed-ground group "Groep van
# geroerd/verstoord" with the code "G" (``dov_formal_stratigraphy.json``).
# Both name and code forms are matched so the pin fires whether the caller
# passes a formation's display name or its regional_ref code. Matching is
# against the *normalised* label (lowercased, whitespace collapsed)
# produced by ``_normalize_label`` — never a substring test, so a
# formation merely mentioning fill in a longer name is not caught.
ANTHROPOGENIC_TOKENS: frozenset[str] = frozenset(
    {
        "antropogeen",
        "a",
        "groep van geroerd/verstoord",
        "geroerd/verstoord",
        "g",
    }
)


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
