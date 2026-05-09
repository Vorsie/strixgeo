"""Shared XML element helpers used by every DOV-side parser.

The CPT, borehole, interpretation, and grain-size parsers all read DOV's
``dov-schema``-rooted XML in the same way: find a child by bare tag name,
extract its text, optionally coerce to ``float`` or ``date.fromisoformat``,
return ``None`` (or empty string) when missing or unparseable. We extract
that shape here so the parsers stay focused on DOV's per-test schema
quirks rather than re-implementing the basics each time.

Why a separate module from ``dov_common``
-----------------------------------------
``dov_common`` carries WFS-row helpers and constants — those operate on
GeoJSON property dicts. These helpers operate on ``ET.Element``s. Mixing
the two would force every WFS client to import XML primitives it never
uses (and vice versa). Split by data-source shape.

Why text returns "" but float / date return None
------------------------------------------------
DOV's schema treats "absent" and "empty" as the same state for text
fields — both render as no useful content. ``""`` is what the parsers
already pass downstream (e.g. into ``or None`` to coerce). Numbers and
dates have a meaningful distinction: a missing element vs a present-but-
unparseable element both produce ``None`` (the parser logs in the latter
case).
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import date


def text(elem: ET.Element | None, tag: str) -> str:
    """Return stripped text of the *tag* child of *elem*, or ``""`` when absent.

    ``""`` is the chosen empty representation because most callers compose
    with ``or None`` to coerce. Returning ``None`` here would force callers
    to write ``str | None`` everywhere a text value flows through.
    """
    if elem is None:
        return ""
    child = elem.find(tag)
    return (child.text or "").strip() if child is not None else ""


def float_value(elem: ET.Element | None, tag: str) -> float | None:
    """Parse a numeric *tag* child of *elem*, or ``None`` when missing/non-numeric.

    Empty strings, missing elements, and ``ValueError`` from ``float()``
    all collapse to ``None`` so callers don't need to discriminate between
    "absent" and "unparseable".
    """
    raw = text(elem, tag)
    try:
        return float(raw) if raw else None
    except ValueError:
        return None


def date_iso(elem: ET.Element | None, tag: str) -> date | None:
    """Parse an ISO-format ``<tag>YYYY-MM-DD</tag>`` child, or ``None`` on failure.

    DOV ships dates as plain ISO 8601 strings (``"2002-11-26"``); empty
    strings or unparseable values both produce ``None``. Callers that
    need stricter validation (e.g. reject pre-1900 dates) layer that on
    top of this helper.
    """
    raw = text(elem, tag)
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None
