"""Pure helpers for scrubbing raw DOV WFS GeoJSON property values.

Every DOV WFS client receives a ``properties`` dict per feature where values
arrive as native JSON types — strings, numbers, ``None``, sometimes
numeric-looking strings. These helpers turn those raw values into the typed
Python primitives the row-builders need, returning ``None`` consistently
when the source is absent or unparseable.

Why a separate module from ``dov_common``
-----------------------------------------
``dov_common`` is for **constants**. These helpers are **functions**.
Splitting by concern (data vs behaviour) keeps both files single-purpose:

* ``dov_common.py`` — pure data (URLs, EPSG codes, regexes, the singleton
  ``Transformer``)
* ``dov_wfs_helpers.py`` — pure functions (this module)
* ``dov_xml_helpers.py`` — XML element parsing functions (different shape)
* ``dov_http.py`` — async HTTP client factory
* ``dov_wfs_bbox.py`` — recursive bbox-split helper

Each is small and focused; consumers import only what they need.
"""

from __future__ import annotations

import urllib.parse
from datetime import date
from typing import Any


def last_path_segment(url: str) -> str:
    """Return the last path segment of *url* (e.g. ``"2017-137886"``).

    Used to extract a DOV permkey from a ``fiche`` / ``observatie_link`` /
    ``gekoppeld_aan_link`` URL. Robust against trailing slashes, query
    strings, fragments, and ``;params`` — ``urllib.parse.urlsplit``
    handles those edge cases so a permkey extracted from any DOV URL
    shape stays correct.
    """
    parsed = urllib.parse.urlsplit(url)
    return parsed.path.rstrip("/").rsplit("/", 1)[-1]


def optional_float(value: Any) -> float | None:
    """Return ``float(value)`` or ``None`` when value is None / non-numeric.

    Used to scrub WFS GeoJSON property values where DOV may emit ``null``,
    a numeric, or a numeric-like string. ``TypeError`` and ``ValueError``
    both fall through to ``None`` so callers don't have to discriminate.
    """
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def optional_int(value: Any) -> int | None:
    """Return ``int(value)`` or ``None`` when value is None / non-numeric."""
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def optional_date(value: Any) -> date | None:
    """Return ``date.fromisoformat(value)`` or ``None`` when value is None / unparseable.

    Empty strings count as "missing" — DOV occasionally emits ``""`` for
    optional date fields, and we don't want to bubble that up as a value.
    """
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None
