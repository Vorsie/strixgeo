"""Build the G3Dv3 stratigraphic catalog JSON from the DOV xlsx sources.

The G3Dv3 (Geologisch 3D-model Vlaanderen) is the canonical Flanders
3D subsurface model. DOV publishes two reference tables alongside it:

* ``g3dv3_modeleenheden.xlsx`` — every formation + member with G3D code,
  abbreviation, Dutch name, and the H3D hydrogeology codes.
* ``g3dv3_kleurcode_rgb.xlsx`` — RGB color per formation/member,
  matching the G3D code.

Stratigraphic order is implicit in the G3D code: ``01xx`` = Quartair
(youngest), ``02xx`` = Neogeen, ``03xx`` = Paleogeen, ``04xx`` = Krijt,
... ``10xx`` = Cambrium (oldest). Within a period, sub-codes count
younger-to-older. Source row order in the modeleenheden file is the
authoritative age ranking.

This script joins the two xlsx files into ``g3dv3_units.json`` —
one entry per formation or member, keyed by G3D abbreviation, with:

* ``code`` — numeric G3D prefix (e.g. ``"0206"``)
* ``abbreviation`` — G3D abbreviation (e.g. ``"NE_Di"``)
* ``rank`` — ``"formation"`` or ``"member"``
* ``parent_abbreviation`` — for members, the parent formation's abbrev
* ``name_nl`` — Dutch name from the modeleenheden file
* ``age_rank`` — integer, 0 = youngest, increasing with age. Equals
  the row order in the source xlsx after dropping H3D-continuation
  rows.
* ``color_hex`` — ``"#rrggbb"`` from the kleurcode file (``None`` when
  the unit has no prescribed color row)
* ``h3d_main`` / ``h3d_sub`` / ``h3d_base`` — H3D hydrogeology codes
  (carried for future hydrogeology work; unused in v1)

CLAUDE.md "display_order is the age axis" convention says **lower
display_order = older**. G3D's age_rank goes the opposite direction
(lower = younger), so consumers using this catalog to set
``display_order`` must invert: ``display_order = -age_rank`` (or
``max_age_rank - age_rank``, whichever fits the column type).

Invocation:

    uv run python scripts/build_g3dv3_catalog.py

Re-run whenever DOV publishes a new G3Dv3 revision (refresh the xlsx
files in ``src/groundmodel/infrastructure/codelists/data/`` first).
The script is idempotent — output JSON is fully derived from the
xlsx inputs.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import openpyxl

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "src" / "groundmodel" / "infrastructure" / "codelists" / "data"
MODELEENHEDEN_XLSX = DATA_DIR / "g3dv3_modeleenheden.xlsx"
KLEURCODE_XLSX = DATA_DIR / "g3dv3_kleurcode_rgb.xlsx"
OUTPUT_JSON = DATA_DIR / "g3dv3_units.json"


def _split_formation_code(raw: str | None) -> tuple[str, str] | None:
    """Split a ``Code formatie G3D`` cell into (numeric, abbreviation).

    The cell encodes both pieces concatenated: ``"0101Q_Gt"`` →
    ``("0101", "Q_Gt")``. The Antropogeen row is the special case
    where the cell is just ``"A"`` with no numeric prefix; the
    kleurcode file gives it the code ``"1"``.

    Compound-period codes — ``"06TR_Ke_Mu_Ro_Bu_07PE_He"`` (Triassic +
    Permian joined) and ``"10SI_11OR_12CM"`` (Silurian-Ordovician-
    Cambrian joined) — embed a second numeric run inside the
    abbreviation. The kleurcode table preserves the full raw string
    as the abbreviation for those rows, so the catalog has to do the
    same to keep the join working.
    """
    if not raw:
        return None
    raw = str(raw).strip()
    if raw == "A":
        return ("1", "A")
    # numeric prefix runs until first non-digit
    for i, ch in enumerate(raw):
        if not ch.isdigit():
            tail = raw[i:]
            # Compound period: a second digit run inside the tail means the
            # leading digits belong to the abbreviation, not the code.
            if any(c.isdigit() for c in tail):
                return (raw[:i], raw)
            return (raw[:i], tail) if i else ("", raw)
    return (raw, "")


def _split_member_code(raw: str | None) -> tuple[str, str] | None:
    """Split a ``Code lid G3D`` cell into (numeric, abbreviation).

    Same shape as formation codes: ``"010101Q_GtAb"`` → ``("010101",
    "Q_GtAb")``.
    """
    return _split_formation_code(raw)


def _to_hex(r: Any, g: Any, b: Any) -> str | None:
    if r is None or g is None or b is None:
        return None
    return f"#{int(r):02x}{int(g):02x}{int(b):02x}"


def load_kleurcodes() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """Load the color table indexed by both code and abbreviation.

    Two indexes are returned because the modeleenheden and kleurcode
    files occasionally disagree on abbreviation spelling — e.g. the
    Malle formation appears as ``Q_My`` in modeleenheden and
    ``Q_Ma`` in kleurcode (code ``0109`` in both). Joining by code
    first and abbreviation second catches those source-data typos.

    Returns
    -------
    (by_code, by_abbrev) : tuple of dict
        Each maps a key to ``{code, name_label, color_hex}``.
    """
    wb = openpyxl.load_workbook(KLEURCODE_XLSX, data_only=True)
    ws = wb.active
    by_code: dict[str, dict[str, Any]] = {}
    by_abbrev: dict[str, dict[str, Any]] = {}
    for row in ws.iter_rows(min_row=3, values_only=True):
        code, abbrev, name_label, r, g, b = row[:6]
        if not abbrev:
            continue
        entry = {
            "code": str(code).strip() if code else None,
            "name_label": str(name_label).strip() if name_label else None,
            "color_hex": _to_hex(r, g, b),
        }
        if entry["code"]:
            by_code[entry["code"]] = entry
        by_abbrev[str(abbrev).strip()] = entry
    return by_code, by_abbrev


def load_modeleenheden() -> list[dict[str, Any]]:
    """Walk the modeleenheden file, materialising one entry per unit.

    Sparse-fill semantics: a formation header row carries its own
    name + code; subsequent rows that only fill the member columns
    belong to the same formation; rows that only fill H3D columns
    are H3D continuations of an earlier unit and are skipped here
    (the H3D codes on those rows attach to the most recently seen
    unit via the active-unit pointer).

    Returns
    -------
    list of dict
        One entry per formation or member, in source order. Each
        entry carries: ``code``, ``abbreviation``, ``rank``,
        ``parent_abbreviation``, ``name_nl``, ``h3d_main``,
        ``h3d_sub``, ``h3d_base``, and a placeholder ``age_rank``
        (assigned in the caller).
    """
    wb = openpyxl.load_workbook(MODELEENHEDEN_XLSX, data_only=True)
    ws = wb.active
    entries: list[dict[str, Any]] = []
    current_formation_abbrev: str | None = None

    rows = list(ws.iter_rows(min_row=2, values_only=True))
    for row in rows:
        (
            formation_code_raw,
            member_code_raw,
            formation_name,
            member_name,
            h3d_main,
            h3d_sub,
            h3d_base,
            _unused,
        ) = (row + (None,) * 8)[:8]

        formation_split = _split_formation_code(formation_code_raw)
        member_split = _split_member_code(member_code_raw)

        if formation_split is not None:
            code, abbrev = formation_split
            current_formation_abbrev = abbrev
            entries.append(
                {
                    "code": code,
                    "abbreviation": abbrev,
                    "rank": "formation",
                    "parent_abbreviation": None,
                    "name_nl": str(formation_name).strip() if formation_name else None,
                    "h3d_main": str(h3d_main).strip() if h3d_main else None,
                    "h3d_sub": str(h3d_sub).strip() if h3d_sub else None,
                    "h3d_base": str(h3d_base).strip() if h3d_base else None,
                }
            )

        if member_split is not None and member_name:
            code, abbrev = member_split
            entries.append(
                {
                    "code": code,
                    "abbreviation": abbrev,
                    "rank": "member",
                    "parent_abbreviation": current_formation_abbrev,
                    "name_nl": str(member_name).strip() if member_name else None,
                    "h3d_main": str(h3d_main).strip() if h3d_main else None,
                    "h3d_sub": str(h3d_sub).strip() if h3d_sub else None,
                    "h3d_base": str(h3d_base).strip() if h3d_base else None,
                }
            )

    return entries


def build_catalog() -> list[dict[str, Any]]:
    """Join modeleenheden + kleurcodes into the final catalog list."""
    kleur_by_code, kleur_by_abbrev = load_kleurcodes()
    units = load_modeleenheden()

    seen_abbrev: set[str] = set()
    catalog: list[dict[str, Any]] = []
    age_rank = 0
    for unit in units:
        abbrev = unit["abbreviation"]
        if not abbrev or abbrev in seen_abbrev:
            continue
        seen_abbrev.add(abbrev)

        # Code-first join so source-data abbreviation typos (e.g. Q_My
        # vs Q_Ma for Malle) don't drop the color silently.
        color_info = kleur_by_code.get(unit["code"] or "", {}) or kleur_by_abbrev.get(abbrev, {})
        catalog.append(
            {
                "code": unit["code"] or color_info.get("code"),
                "abbreviation": abbrev,
                "rank": unit["rank"],
                "parent_abbreviation": unit["parent_abbreviation"],
                "name_nl": unit["name_nl"],
                "age_rank": age_rank,
                "color_hex": color_info.get("color_hex"),
                "h3d_main": unit["h3d_main"],
                "h3d_sub": unit["h3d_sub"],
                "h3d_base": unit["h3d_base"],
            }
        )
        age_rank += 1

    return catalog


def main() -> None:
    catalog = build_catalog()
    OUTPUT_JSON.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    n_formations = sum(1 for u in catalog if u["rank"] == "formation")
    n_members = sum(1 for u in catalog if u["rank"] == "member")
    n_with_color = sum(1 for u in catalog if u["color_hex"])
    print(f"Wrote {OUTPUT_JSON}")
    print(f"  {len(catalog)} units total ({n_formations} formations, {n_members} members)")
    print(f"  {n_with_color} units have a prescribed color ({len(catalog) - n_with_color} missing)")


if __name__ == "__main__":
    main()
