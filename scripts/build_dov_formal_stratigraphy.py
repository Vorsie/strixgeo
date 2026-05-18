"""Build the DOV formal-stratigraphy code→canonical-name lexicon JSON.

Source: DOV XSD ``FormeleStratigrafieDataCodes.xsd``, type
``FormeleStratigrafieLedenEnumType`` — authoritative list of formal
stratigraphy permkey codes for Belgian boreholes.  Each ``xs:enumeration``
entry carries:

* ``value``  — the DOV permkey code (e.g. ``"KoAa"``, ``"Q"``, ``"QH"``)
* ``xs:annotation/xs:documentation`` — the full Dutch canonical name
  (e.g. ``"Lid van Aalbeke (Formatie van Kortrijk)"``,
  ``"Groep van Quartaire afzetting"``, ``"Quartair Holoceen"``)

Output: ``src/groundmodel/infrastructure/codelists/data/dov_formal_stratigraphy.json``
Schema (one object per entry, XSD source order preserved):

.. code-block:: json

    {
        "code": "KoAa",
        "full_name_nl": "Lid van Aalbeke (Formatie van Kortrijk)",
        "age_rank": 86,
        "color_hex": "#9085ba"
    }

``age_rank`` and ``color_hex`` are enriched via a suffix-match against
``g3dv3_units.json`` (e.g. DOV code ``"KoAa"`` suffix-matches G3Dv3
abbreviation ``"PA_KoAa"``).  Both are ``null`` when no G3Dv3 match
exists — expected for Quaternary period codes (``"Q"``, ``"QH"``,
``"QP"``), purely Belgian internal codes, and DOV-specific regional
entries that the G3Dv3 doesn't model at member level.

The script writes the XSD to
``src/groundmodel/infrastructure/codelists/data/FormeleStratigrafieDataCodes.xsd``
on a successful live fetch so subsequent rebuilds are offline-reproducible.
On network failure the committed snapshot is used instead.

Invocation::

    uv run python scripts/build_dov_formal_stratigraphy.py

Idempotent — output is fully derived from the XSD.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import defusedxml.ElementTree as ET
import httpx

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "src" / "groundmodel" / "infrastructure" / "codelists" / "data"

# Live source (authoritative — fetch before falling back to snapshot).
XSD_URL = (
    "https://www.dov.vlaanderen.be/xdov/schema/latest/xsd/kern/interpretatie/"
    "FormeleStratigrafieDataCodes.xsd"
)
# Committed snapshot — used when the live fetch fails AND written/refreshed
# whenever the live fetch succeeds so the next rebuild is offline-reproducible.
XSD_SNAPSHOT = DATA_DIR / "FormeleStratigrafieDataCodes.xsd"

OUTPUT_JSON = DATA_DIR / "dov_formal_stratigraphy.json"
G3DV3_JSON = DATA_DIR / "g3dv3_units.json"

# XSD namespace for xs: elements.
XS_NS = "http://www.w3.org/2001/XMLSchema"

# The target type name inside the XSD.
ENUM_TYPE_NAME = "FormeleStratigrafieLedenEnumType"


def _fetch_xsd() -> bytes:
    """Fetch the XSD from DOV, fall back to the committed snapshot on failure.

    Returns
    -------
    bytes
        Raw XSD content.

    Raises
    ------
    SystemExit
        When the live fetch fails AND no snapshot is available.
    """
    try:
        print(f"Fetching {XSD_URL} ...")
        resp = httpx.get(XSD_URL, timeout=30, follow_redirects=True)
        resp.raise_for_status()
        raw = resp.content
        print(f"  Live fetch OK — {len(raw):,} bytes (HTTP {resp.status_code})")
        # Refresh the snapshot so the next offline run stays current.
        XSD_SNAPSHOT.write_bytes(raw)
        print(f"  Snapshot written: {XSD_SNAPSHOT}")
        return raw
    except Exception as exc:
        print(f"  Live fetch FAILED: {exc}", file=sys.stderr)
        if XSD_SNAPSHOT.exists():
            print(f"  Falling back to committed snapshot: {XSD_SNAPSHOT}", file=sys.stderr)
            return XSD_SNAPSHOT.read_bytes()
        print(
            "ERROR: live fetch failed and no snapshot exists. Cannot build without a source XSD.",
            file=sys.stderr,
        )
        sys.exit(1)


def _parse_enumerations(xsd_bytes: bytes) -> list[tuple[str, str]]:
    """Extract (code, full_name_nl) pairs from the XSD enumeration type.

    Walks ``FormeleStratigrafieLedenEnumType`` inside the XSD and collects
    every ``xs:enumeration`` value + its ``xs:documentation`` text.

    Parameters
    ----------
    xsd_bytes : bytes
        Raw XSD content (UTF-8 encoded XML).

    Returns
    -------
    list[tuple[str, str]]
        ``[(code, full_name_nl), ...]`` in XSD source order.

    Raises
    ------
    SystemExit
        When the target type or any expected enumeration element is missing.
    """
    root = ET.fromstring(xsd_bytes)
    ns = {"xs": XS_NS}

    # Locate the target simple type.
    target_type = None
    for simple_type in root.findall(".//xs:simpleType", ns):
        if simple_type.get("name") == ENUM_TYPE_NAME:
            target_type = simple_type
            break

    if target_type is None:
        print(
            f"ERROR: type '{ENUM_TYPE_NAME}' not found in XSD. The XSD structure may have changed.",
            file=sys.stderr,
        )
        sys.exit(1)

    pairs: list[tuple[str, str]] = []
    missing_doc: list[str] = []

    for enum_elem in target_type.findall(".//xs:enumeration", ns):
        code = (enum_elem.get("value") or "").strip()
        if not code:
            continue
        doc_elem = enum_elem.find(".//xs:documentation", ns)
        doc_text = (doc_elem.text or "").strip() if doc_elem is not None else ""
        if not doc_text:
            # Log but continue — keep the code with an empty name so callers
            # know it exists (empty name handled in loader as a pass-through).
            missing_doc.append(code)
            continue
        pairs.append((code, doc_text))

    if missing_doc:
        print(
            f"  WARNING: {len(missing_doc)} enumeration(s) had no xs:documentation "
            f"and were SKIPPED: {missing_doc[:10]}" + ("..." if len(missing_doc) > 10 else ""),
            file=sys.stderr,
        )

    print(f"  Parsed {len(pairs)} enumeration(s) from '{ENUM_TYPE_NAME}'")
    return pairs


def _build_g3dv3_suffix_index(g3dv3_json: Path) -> dict[str, dict]:
    """Build a DOV-code → G3Dv3-unit index via abbreviation suffix matching.

    The DOV formal-stratigraphy codes are the trailing part of G3Dv3
    abbreviations after the period prefix (e.g. DOV ``"KoAa"`` matches
    G3Dv3 abbreviation ``"PA_KoAa"`` which has suffix ``"_KoAa"``).
    The match recovers ``age_rank`` + ``color_hex`` for Paleogene and
    Neogene members.  Quaternary period codes (``"Q"``, ``"QH"``, ``"QP"``)
    have no G3Dv3 member-level entry — their match result is null, which
    is expected and correct.

    Parameters
    ----------
    g3dv3_json : Path
        Path to ``g3dv3_units.json``.

    Returns
    -------
    dict[str, dict]
        ``{ dov_code -> {"age_rank": int, "color_hex": str|None} }``
        Only codes with an unambiguous single match are included.
        Codes that match multiple G3Dv3 units are logged but excluded
        (ambiguous match → null, safe fall-through).
    """
    if not g3dv3_json.exists():
        print(f"  WARNING: {g3dv3_json} not found — age_rank / color_hex will all be null")
        return {}

    units = json.loads(g3dv3_json.read_text(encoding="utf-8"))
    # Build: suffix (after last "_") → list of (age_rank, color_hex).
    # The suffix is the DOV code embedded in the G3Dv3 abbreviation.
    # e.g. "PA_KoAa" → suffix "KoAa"; "A" → suffix "A" (no underscore).
    suffix_to_units: dict[str, list[dict]] = {}
    for u in units:
        abbrev: str = u.get("abbreviation", "") or ""
        # The DOV permkey is the part after the last "_", or the whole
        # abbreviation if there is no "_".
        suffix = abbrev.split("_")[-1] if "_" in abbrev else abbrev
        if not suffix:
            continue
        suffix_to_units.setdefault(suffix, []).append(u)

    index: dict[str, dict] = {}
    ambiguous: list[str] = []
    for suffix, matched in suffix_to_units.items():
        if len(matched) == 1:
            u = matched[0]
            index[suffix] = {"age_rank": u["age_rank"], "color_hex": u.get("color_hex")}
        else:
            # e.g. DOV "Di" matches both "NE_Di" (Diest) and "CA_Di" — ambiguous.
            ambiguous.append(suffix)

    if ambiguous:
        print(
            f"  G3Dv3 suffix index: {len(ambiguous)} ambiguous suffix(es) excluded "
            f"(null age_rank/color_hex): {ambiguous[:10]}" + ("..." if len(ambiguous) > 10 else "")
        )
    print(f"  G3Dv3 suffix index: {len(index)} unambiguous suffix(es) from {len(units)} units")
    return index


def build_lexicon() -> list[dict]:
    """Build the complete formal-stratigraphy lexicon.

    Fetches the XSD, parses enumerations, and enriches each entry with
    G3Dv3 age_rank + color_hex via suffix matching.

    Returns
    -------
    list[dict]
        One dict per enumeration entry, XSD source order preserved.
    """
    xsd_bytes = _fetch_xsd()
    pairs = _parse_enumerations(xsd_bytes)
    g3dv3_index = _build_g3dv3_suffix_index(G3DV3_JSON)

    entries: list[dict] = []
    matched_count = 0

    for code, full_name_nl in pairs:
        # Suffix match: DOV code IS the suffix (after last "_" in G3Dv3 abbrev).
        # For DOV code "KoAa": try "KoAa" directly against the suffix index.
        g3dv3 = g3dv3_index.get(code)
        if g3dv3 is not None:
            matched_count += 1

        entries.append(
            {
                "code": code,
                "full_name_nl": full_name_nl,
                "age_rank": g3dv3["age_rank"] if g3dv3 else None,
                "color_hex": g3dv3["color_hex"] if g3dv3 else None,
            }
        )

    print(
        f"  G3Dv3 enrichment: {matched_count}/{len(entries)} entries have age_rank/color_hex "
        f"({len(entries) - matched_count} null — expected for Quaternary period codes, "
        f"internal codes, and regional entries not in G3Dv3)"
    )
    return entries


def main() -> None:
    """Entry point — build and write the formal-stratigraphy lexicon."""
    print("Building DOV formal-stratigraphy lexicon...")
    entries = build_lexicon()
    OUTPUT_JSON.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    n_with_color = sum(1 for e in entries if e["color_hex"])
    n_with_age = sum(1 for e in entries if e["age_rank"] is not None)
    print(f"Wrote {OUTPUT_JSON}")
    print(f"  {len(entries)} formal-stratigraphy codes total")
    print(f"  {n_with_age} entries with age_rank ({len(entries) - n_with_age} null)")
    print(f"  {n_with_color} entries with color_hex ({len(entries) - n_with_color} null)")


if __name__ == "__main__":
    main()
