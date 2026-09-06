"""Constants for the :class:`Admixture` value object."""

# Amount qualifiers that name the SAME step in different source vocabularies.
# DOV interpretations log "V" (veel) where NEN 5104 style descriptions say
# "sterk" ("S"); the owner ruled 2026-09-06 that "sterk siltig zand" and
# "veel siltig zand" are the same admixture, and "zwak" ("Z") and "weinig"
# ("W") are the same lowest step. The raw token stays as stored
# (translate at the presentation boundary); only the comparison key folds the
# synonym onto its canonical form, so Accept and auto-correlate agree.
ADMIXTURE_AMOUNT_SYNONYMS: dict[str, str] = {"S": "V", "Z": "W"}


def canonical_amount(amount: str) -> str:
    """Return the canonical amount token for comparison purposes.

    Parameters
    ----------
    amount : str
        Source-vocabulary amount code (``"Z"``, ``"W"``, ``"M"``, ``"V"``,
        ``"S"`` or ``""`` for unspecified).

    Returns
    -------
    str
        The same code, or its canonical synonym when one is registered.
    """
    return ADMIXTURE_AMOUNT_SYNONYMS.get(amount, amount)
