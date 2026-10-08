"""Pure helpers: read what a printed description or sample id says, by the owner's rulings.

* An interval that prints only the drill technique and a sample remark has
  no lithology (owner 2026-10-08: the sample was taken there, "you can leave
  it empty"); its text stays verbatim as the description.
* The printed sample number before the dash ("S10", "9") is what the lab
  reports reference; the id itself stays verbatim.
"""

from __future__ import annotations

from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_constants import (
    DRILL_TECHNIQUE_PHRASE,
    LITHOLOGY_ABSENT_SAMPLED,
    SAMPLE_LABEL_PATTERN,
    SAMPLE_REMARK_PHRASE,
)


def lithology_absent_reason(description: str) -> str | None:
    """Return why an interval has no lithology, or None when it is described.

    Parameters
    ----------
    description : str
        The interval's printed text.

    Returns
    -------
    str or None
        ``"sampled"`` when every comma-separated phrase is a drill technique
        or a sample remark and at least one is a sample remark ("Sonic Drill,
        steekbus niet vol"); None otherwise (a described layer, an empty row,
        a technique printed alone).
    """
    phrases = [p.strip().rstrip(".") for p in description.split(",")]
    phrases = [p for p in phrases if p]
    if not phrases:
        return None
    remarks = [p for p in phrases if SAMPLE_REMARK_PHRASE.fullmatch(p)]
    techniques = [p for p in phrases if DRILL_TECHNIQUE_PHRASE.fullmatch(p)]
    if remarks and len(remarks) + len(techniques) == len(phrases):
        return LITHOLOGY_ABSENT_SAMPLED
    return None


def sample_label(sample_id: str) -> str | None:
    """Return the printed sample number before the dash of a sample id.

    Parameters
    ----------
    sample_id : str
        The id as printed ("S10-0550471459/", "9-0550471461X", "1 -", "3").

    Returns
    -------
    str or None
        "S10", "9", "1", "3"; None when the id does not start with a number.
    """
    match = SAMPLE_LABEL_PATTERN.match(sample_id)
    return match.group(1) if match else None
