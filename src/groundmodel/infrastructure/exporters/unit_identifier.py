"""Machine-usable unit identifiers for the exporters (debt #104).

The v1.0 gate's export step is "export the three-level model geometry
**with unit identifiers**". Until this module existed the exporters
emitted display names only, so a downstream tool could read a geotech
export but could not map its units onto material definitions: the two
fields that carry the machine identity — ``nad_class`` (Belgian NAD
packing class 1..31) and ``litho_main_soil_code`` (BaseLithology token
ZAND / KLEI / SILT / GRIND / VEEN) — never left Strix.

The scheme
----------
One token per unit, built from whichever identifiers the unit carries::

    NAD-06_ZAND    geotechnical unit — class 6 within a sand unit
    NAD-06         geotechnical unit whose litho parent has no soil code
    ZAND           lithostratigraphic unit — the soil code IS the identity
    None           geological formation — carries neither identifier

Why this shape:

* **The ``NAD-`` prefix is spelled out** because the engineer meets the
  token in a CAD layer manager with no legend beside it.
* **The class is zero-padded.** CAD layer lists and Plaxis material
  lists sort as text; ``NAD-06`` sorts above ``NAD-21`` where a bare
  ``NAD-6`` would sort below it, scrambling the list the engineer is
  trying to read in class order.
* **The soil code follows the class**, so the identifier is a stable
  PREFIX: ``NAD-06_*`` selects every instance of one class with one CAD
  wildcard, and ``NAD-06_ZAND*`` narrows to one class within one soil.
* **The token is stripped against the DXF forbidden set**, so it is safe
  to splice straight into a layer name; it contains no character that
  needs escaping in a Python string literal either, which is what the
  Plaxis script emits.

Naming rule the exporters follow
--------------------------------
A unit's *name* in an export changes only when the unit carries a
``nad_class``. Geological formations, litho units and unclassified
geotech skeleton bands keep byte-identical names — their identifiers
travel through metadata channels instead (the DXF layer description and
the mapping table), which no downstream consumer keys on today.

Collisions
----------
Two units legitimately share a ``(nad_class, soil)`` pair — NAD 6 sand
under two different geological parents is a normal model. The token is
therefore NOT unique on its own; each exporter disambiguates in its own
namespace (the DXF appends the formation's short id, the Plaxis emitter
appends an ordinal to the Python variable) and the mapping table carries
the formation UUID so the ambiguity is always resolvable.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from groundmodel.infrastructure.exporters.unit_identifier_constants import (
    DXF_FORBIDDEN_LAYER_CHARS,
    MAPPING_TABLE_ABSENT,
    MAPPING_TABLE_ABSORBED_HEADING,
    MAPPING_TABLE_ABSORBED_JOIN,
    MAPPING_TABLE_GAP,
    MAPPING_TABLE_GEO_HEADING,
    MAPPING_TABLE_GEO_JOIN,
    MAPPING_TABLE_ID_HEADING,
    MAPPING_TABLE_NAD_HEADING,
    MAPPING_TABLE_NAME_HEADING,
    MAPPING_TABLE_RULE_CHAR,
    MAPPING_TABLE_SOIL_HEADING,
    MAPPING_TABLE_TITLE,
    NAD_TOKEN_DIGITS,
    NAD_TOKEN_PREFIX,
    UNIT_ID_SOIL_SEPARATOR,
)


@dataclass(frozen=True)
class UnitMappingRow:
    """One row of the unit-identifier mapping table.

    Holds data only — no behaviour — so it does not inherit
    ``GroundModelLogger`` (CLAUDE.md "Logging via inheritance").

    Attributes
    ----------
    export_label : str
        The identity the ARTEFACT actually carries — the DXF layer name
        or the Plaxis material identification. Stated verbatim so the
        table describes reality rather than the scheme's intent; a unit
        whose label was disambiguated on collision shows the
        disambiguated label here.
    nad_class : int | None
        Belgian NAD packing class 1..31, or ``None`` on a unit that has
        not been classified (geological formation, litho unit,
        unclassified geotech skeleton band).
    soil_code : str | None
        BaseLithology token (ZAND / KLEI / SILT / GRIND / VEEN), or
        ``None`` on a geological formation.
    display_name : str
        The unit's name as the engineer sees it in Strix.
    formation_id : UUID
        Source ``geological_formation`` row id. The only globally unique
        handle on the unit — carried so a downstream script can resolve
        two units that share a class and a soil.
    """

    export_label: str
    nad_class: int | None
    soil_code: str | None
    display_name: str
    # Optional because the project-wide ``GroundModelSnapshot`` predates
    # per-formation ids on its display rows; rendered as the absent
    # marker when a caller cannot supply one.
    formation_id: UUID | None = None
    # Units merged into this one by export thinning (debt #104b). Always
    # empty on the Plaxis artefacts, which the owner ruled stay exact.
    absorbed: tuple[str, ...] = ()
    # Geological formations this unit's body crosses (debt #278, R2),
    # shallowest first. Empty on a geology-agnostic export and on a unit
    # wholly inside one formation carrying no explicit list; the "Geo"
    # column is emitted only when at least one row is non-empty.
    geo_formations: tuple[str, ...] = ()


def unit_identifier(*, nad_class: int | None, litho_main_soil_code: str | None) -> str | None:
    """Build the machine-usable identifier token for one unit.

    Parameters
    ----------
    nad_class : int | None
        Belgian NAD packing class (1..31) on a geotechnical unit;
        ``None`` on every other model level.
    litho_main_soil_code : str | None
        BaseLithology token on a litho or geotech unit; ``None`` on a
        geological formation. Normalised to upper case and stripped of
        DXF-illegal characters — the vocabulary is a closed five-token
        set, so the strip cannot collapse two distinct codes onto one.

    Returns
    -------
    str | None
        ``"NAD-06_ZAND"`` / ``"NAD-06"`` / ``"ZAND"``, or ``None`` when
        the unit carries neither identifier. ``None`` is the exporters'
        signal to fall back to display-name-only behaviour.
    """
    soil = _normalised_soil_code(litho_main_soil_code)
    if nad_class is None:
        return soil
    class_token = f"{NAD_TOKEN_PREFIX}{nad_class:0{NAD_TOKEN_DIGITS}d}"
    if soil is None:
        return class_token
    return f"{class_token}{UNIT_ID_SOIL_SEPARATOR}{soil}"


def naming_identifier(*, nad_class: int | None, litho_main_soil_code: str | None) -> str | None:
    """Return the identifier that is allowed to enter a unit's export NAME.

    This is the one place the naming rule lives: **a unit's name in an
    export changes only when the unit carries a ``nad_class``.** The DXF
    layer name, the PLAXIS material identification and the PLAXIS
    variable name all ask this function, so the three can never disagree
    about which units were renamed.

    Parameters
    ----------
    nad_class : int | None
        Belgian NAD packing class on a geotechnical unit.
    litho_main_soil_code : str | None
        BaseLithology token on a litho or geotech unit.

    Returns
    -------
    str | None
        The identifier token when the unit is classified, else ``None``
        — the caller's signal to keep the display name untouched.
    """
    if nad_class is None:
        return None
    return unit_identifier(nad_class=nad_class, litho_main_soil_code=litho_main_soil_code)


def format_mapping_table(rows: list[UnitMappingRow], *, label_heading: str) -> list[str]:
    """Render the unit mapping table as aligned plain-text lines.

    The same renderer serves the DXF (one model-space TEXT entity per
    line) and the Plaxis script (docstring header), so an engineer who
    receives either artefact reads the same table.

    Parameters
    ----------
    rows : list[UnitMappingRow]
        One row per exported unit, already in the order the caller wants
        them listed. Sorting is the caller's business — the exporters
        pass them in the order the artefact emits the units, so the
        table reads in the same order as the layer / material list.
    label_heading : str
        Heading for the first column — ``"DXF layer"`` or
        ``"Plaxis material"``. Names the artefact-side identity so the
        reader knows which column to match against what is in front of
        them.

    Returns
    -------
    list[str]
        Title, heading row, rule row, then one line per unit. **Empty
        list when ``rows`` is empty** — a geological-model export has no
        identifiers to map, and an empty-bodied table would read as a
        bug rather than as "nothing to map".
    """
    if not rows:
        return []

    cells = [
        [
            row.export_label,
            MAPPING_TABLE_ABSENT if row.nad_class is None else str(row.nad_class),
            row.soil_code or MAPPING_TABLE_ABSENT,
            row.display_name,
            MAPPING_TABLE_ABSENT if row.formation_id is None else str(row.formation_id),
        ]
        for row in rows
    ]
    headings = [
        label_heading,
        MAPPING_TABLE_NAD_HEADING,
        MAPPING_TABLE_SOIL_HEADING,
        MAPPING_TABLE_NAME_HEADING,
        MAPPING_TABLE_ID_HEADING,
    ]
    # The geo column appears ONLY when a unit crosses more than one
    # geological formation (debt #278, R2) — same absorbed-column pattern:
    # a geology-agnostic export carries no geo names, so its table renders
    # byte-identically to before.
    if any(row.geo_formations for row in rows):
        headings.append(MAPPING_TABLE_GEO_HEADING)
        for cell_row, row in zip(cells, rows, strict=True):
            cell_row.append(MAPPING_TABLE_GEO_JOIN.join(row.geo_formations) or MAPPING_TABLE_ABSENT)
    # The absorbed column appears ONLY when something was thinned
    # (debt #104b), so an unthinned artefact — every Plaxis script, every
    # geological export — renders the table byte-identically to before.
    if any(row.absorbed for row in rows):
        headings.append(MAPPING_TABLE_ABSORBED_HEADING)
        for cell_row, row in zip(cells, rows, strict=True):
            cell_row.append(MAPPING_TABLE_ABSORBED_JOIN.join(row.absorbed) or MAPPING_TABLE_ABSENT)
    widths = [
        max(len(headings[col]), *(len(r[col]) for r in cells)) for col in range(len(headings))
    ]

    def _line(values: list[str]) -> str:
        return MAPPING_TABLE_GAP.join(
            v.ljust(w) for v, w in zip(values, widths, strict=True)
        ).rstrip()

    lines = [
        MAPPING_TABLE_TITLE,
        MAPPING_TABLE_RULE_CHAR * len(MAPPING_TABLE_TITLE),
        _line(headings),
        _line([MAPPING_TABLE_RULE_CHAR * w for w in widths]),
    ]
    lines.extend(_line(row) for row in cells)
    return lines


def _normalised_soil_code(raw: str | None) -> str | None:
    """Upper-case the soil token and drop DXF-illegal characters."""
    if raw is None:
        return None
    cleaned = "".join(c for c in raw.strip().upper() if c not in DXF_FORBIDDEN_LAYER_CHARS)
    return cleaned or None
