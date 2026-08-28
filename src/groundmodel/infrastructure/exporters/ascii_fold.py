"""Fold user text to ASCII for a D-Series artefact.

WHY
---
The ``.shi`` (and its D-Series siblings) are cp1252 files written for a
Windows program, so a Dutch section name has always *encoded* fine. What is
not fine is that every reader picks its own encoding: GEOLib's own parser
opens the file with the ambient locale, so a file written on a cp1252 Windows
box fails to parse anywhere UTF-8 is the default.

Found by CI on Linux (Actions run 33135927403, 2026-08-28): the section name
``section A–A'`` carries an EN DASH (U+2013), cp1252 byte ``0x96``, and
GEOLib died on it with ``UnicodeDecodeError: invalid start byte``. "A–A'" is
exactly how an engineer names a cross-section, and Flemish project names carry
accents routinely, so the artefact has to be portable rather than the readers.

The text this applies to is provenance and identification — free-form labels
whose only job is to say where the file came from. Folding them to ASCII costs
nothing a reader needs. It is NOT applied to values a downstream tool parses.

The mapping is explicit for the punctuation a project name actually contains
(the dashes and quotes word processors substitute), then falls back to Unicode
decomposition so an accented letter keeps its base form — ``Wetteren-Zuid é``
becomes ``Wetteren-Zuid e``, not ``Wetteren-Zuid``.
"""

from __future__ import annotations

import unicodedata

# Punctuation a word processor or a copy-paste introduces, mapped to the ASCII
# a CAD/geotechnical toolchain expects. Decomposition alone would DELETE these
# (they have no canonical ASCII form), which silently loses the separator in
# "A–A'" — worse than a wrong-looking dash.
_PUNCTUATION = {
    "‐": "-",  # hyphen
    "‑": "-",  # non-breaking hyphen
    "‒": "-",  # figure dash
    "–": "-",  # en dash — the byte that broke the Linux parse
    "—": "-",  # em dash
    "―": "-",  # horizontal bar
    "‘": "'",  # left single quote
    "’": "'",  # right single quote / apostrophe
    "‚": "'",
    "“": '"',  # left double quote
    "”": '"',  # right double quote
    "„": '"',
    "…": "...",  # ellipsis
    " ": " ",  # non-breaking space
    "°": " deg",  # degree sign, common in a bearing
    "×": "x",  # multiplication sign
}

# What replaces a character with no ASCII form at all (a CJK glyph, an emoji).
# A visible marker, not silence: a name that came out mangled should look
# mangled rather than losing characters invisibly.
_UNMAPPABLE = "?"


def ascii_fold(text: str) -> str:
    """Return ``text`` with every character replaced by an ASCII equivalent.

    Parameters
    ----------
    text
        Free-form label — a project name, a section name, a provenance line.

    Returns
    -------
    str
        A string whose every character is ASCII (code point < 128), so the
        artefact decodes identically under cp1252, latin-1 and UTF-8.
    """
    mapped = "".join(_PUNCTUATION.get(ch, ch) for ch in text)
    # NFKD splits an accented letter into base + combining mark; dropping the
    # marks (category Mn) leaves the base letter.
    decomposed = unicodedata.normalize("NFKD", mapped)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return "".join(ch if ord(ch) < 128 else _UNMAPPABLE for ch in stripped)
