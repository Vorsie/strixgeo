"""A log line spells out at most twenty names, then says how many more."""

from __future__ import annotations

from groundmodel.shared.logging.capped_name_list import capped_name_list


def test_short_list_is_shown_in_full() -> None:
    """Up to the limit every name is shown, in order, with no suffix."""
    assert capped_name_list(["GEO-1", "GEO-2"]) == "GEO-1, GEO-2"
    assert capped_name_list([]) == ""


def test_long_list_is_capped_with_the_exact_remainder() -> None:
    """Past the limit only the first names show, then "+N more" with the exact N."""
    names = [f"GEO-{i}" for i in range(25)]
    text = capped_name_list(names)
    assert text.startswith("GEO-0, GEO-1, ")
    assert "GEO-19" in text
    assert "GEO-20" not in text
    assert text.endswith(" +5 more")
    assert capped_name_list(names[:20]).endswith("GEO-19")
