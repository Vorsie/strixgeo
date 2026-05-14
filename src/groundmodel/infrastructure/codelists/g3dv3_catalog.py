"""G3Dv3 stratigraphic catalog loader — canonical Flanders units.

Loads the precomputed ``g3dv3_units.json`` (built by
``scripts/build_g3dv3_catalog.py`` from the two DOV xlsx sources) and
exposes lookup helpers.

The catalog answers two production questions:

1. **Is layer A older than layer B?** Every unit has an integer
   ``age_rank`` (0 = youngest = Antropogeen, 116 = oldest). To set
   ``GeologicalFormation.display_order`` per CLAUDE.md's "lower
   display_order = older" convention, invert the sign:
   ``display_order = -age_rank``. Comparing two formations becomes a
   single integer comparison that's location-independent within
   Flanders.
2. **What's the canonical color?** Each unit ships with the
   G3Dv3-prescribed RGB. Manual-create autocomplete uses this so
   engineers don't have to pick colors that disagree across projects.

Both lookups are case-insensitive on the Dutch name. The Dutch name is
the most reliable join key because:

* DOV formal-stratigraphy XML ships `lid1` / `lid2` codes that are
  permkey-specific (e.g. ``"HyEg"``, ``"Eg"``) and don't map cleanly
  to G3Dv3 abbreviations.
* Manually-created formations carry human names ("Boom", "Diest",
  "Ieper") that DO match G3Dv3 ``name_nl`` directly.

Future code-mapping work (DOV permkey codes → G3Dv3 abbreviations) is
a separate concern — see debt #50 (BRO / regional catalog abstraction).

Network access is never required at runtime. The JSON ships with the
distribution; rebuilding requires the xlsx sources + the build script.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_CATALOG_PATH = Path(__file__).resolve().parent / "data" / "g3dv3_units.json"
_ALIASES_PATH = Path(__file__).resolve().parent / "data" / "g3dv3_aliases.json"


@dataclass(frozen=True)
class G3Dv3Unit:
    """One G3Dv3 formation or member.

    Attributes
    ----------
    code : str
        Numeric G3D code (e.g. ``"0206"`` for Diest, ``"010101"`` for the
        Achterbos member, ``"1"`` for Antropogeen). Compound-period
        units like ``"06TR_..."`` carry the full original cell.
    abbreviation : str
        G3D abbreviation (e.g. ``"NE_Di"``, ``"Q_GtAb"``, ``"A"``).
    rank : str
        Either ``"formation"`` or ``"member"``.
    parent_abbreviation : str | None
        For members, the parent formation's abbreviation; ``None`` for
        formations.
    name_nl : str
        Dutch name (``"Diest"``, ``"Achterbos"``, ``"Antropogeen"``).
        The primary join key for human-entered formation names.
    age_rank : int
        Stratigraphic age rank. 0 = youngest (Antropogeen), 116 =
        oldest (Siluur-Ordovicium-Cambrium). Lower = younger. To set
        ``display_order`` per CLAUDE.md convention, invert sign.
    color_hex : str | None
        Prescribed RGB color (``"#rrggbb"``). ``None`` for the rare
        unit with no row in the kleurcode table.
    h3d_main : str | None
    h3d_sub : str | None
    h3d_base : str | None
        Hydrogeology unit codes from H3D. Carried for future use;
        unused in v1.
    """

    code: str
    abbreviation: str
    rank: str
    parent_abbreviation: str | None
    name_nl: str
    age_rank: int
    color_hex: str | None
    h3d_main: str | None
    h3d_sub: str | None
    h3d_base: str | None


def _normalize(s: str | None) -> str:
    """Lowercase + collapse whitespace for case-insensitive name match.

    DOV layer descriptions and engineer-entered names arrive with
    inconsistent casing and occasionally trailing spaces; the catalog
    side is also messy (one entry has a trailing space in name_nl).
    Strip everything down to a single normalised form on both sides
    so the lookup tolerates "Boom", "boom", " Boom " all equally.
    """
    if not s:
        return ""
    return " ".join(s.lower().split())


# Historical / alternative formation names live in
# ``data/g3dv3_aliases.json`` next to the unit catalog. The map is
# expected to grow over time — every borehole-interpretation campaign
# under an older stratigraphic framework can surface a new label that
# no longer matches modern G3Dv3 nomenclature. Keeping aliases as data
# (not code) means adding one is a single-line JSON change, not a
# code commit.


class G3Dv3Catalog(GroundModelLogger):
    """Loads + indexes the G3Dv3 unit catalog from JSON.

    Three indexes are built once at first lookup:

    * by normalised name → unit
    * by normalised abbreviation → unit
    * by code (exact, no normalisation — codes are numeric/structural)

    The instance is intended to be shared (one per process). The
    module-level ``get_catalog()`` returns a process-singleton.
    """

    def __init__(
        self,
        catalog_path: Path = _CATALOG_PATH,
        aliases_path: Path = _ALIASES_PATH,
    ) -> None:
        """Load the catalog + alias JSON files and build the lookup indexes.

        Parameters
        ----------
        catalog_path : Path
            Path to ``g3dv3_units.json``. Override only in tests.
        aliases_path : Path
            Path to ``g3dv3_aliases.json``. Override only in tests.
        """
        super().__init__(__name__)
        with catalog_path.open(encoding="utf-8") as fh:
            raw = json.load(fh)
        self._units: list[G3Dv3Unit] = [
            G3Dv3Unit(
                code=str(entry["code"]),
                abbreviation=str(entry["abbreviation"]),
                rank=str(entry["rank"]),
                parent_abbreviation=entry["parent_abbreviation"],
                name_nl=str(entry["name_nl"]),
                age_rank=int(entry["age_rank"]),
                color_hex=entry["color_hex"],
                h3d_main=entry["h3d_main"],
                h3d_sub=entry["h3d_sub"],
                h3d_base=entry["h3d_base"],
            )
            for entry in raw
        ]
        self._by_name: dict[str, G3Dv3Unit] = {_normalize(u.name_nl): u for u in self._units}
        self._by_abbrev: dict[str, G3Dv3Unit] = {_normalize(u.abbreviation): u for u in self._units}
        self._by_code: dict[str, G3Dv3Unit] = {u.code: u for u in self._units}

        # Aliases — every entry normalised on both sides so callers
        # don't have to worry about casing in either the alias JSON or
        # at lookup time.
        with aliases_path.open(encoding="utf-8") as fh:
            alias_raw = json.load(fh)
        self._aliases: dict[str, str] = {
            _normalize(k): _normalize(v) for k, v in alias_raw.get("aliases", {}).items()
        }

        self.debug(
            f"G3Dv3 catalog loaded: {len(self._units)} units "
            f"({sum(1 for u in self._units if u.rank == 'formation')} formations, "
            f"{sum(1 for u in self._units if u.rank == 'member')} members), "
            f"{len(self._aliases)} aliases"
        )

    def all_units(self) -> list[G3Dv3Unit]:
        """Return every unit, in age order (youngest first)."""
        return list(self._units)

    def lookup_by_name(self, name: str | None) -> G3Dv3Unit | None:
        """Match a unit by Dutch name (case-insensitive, whitespace-tolerant).

        Falls through ``self._aliases`` (loaded from
        ``data/g3dv3_aliases.json``) for historical names — a
        borehole logged as "Ieper" or "Ieperiaan" resolves to the
        modern G3Dv3 "Kortrijk" entry.
        """
        normalized = _normalize(name)
        direct = self._by_name.get(normalized)
        if direct is not None:
            return direct
        alias_target = self._aliases.get(normalized)
        if alias_target is not None:
            return self._by_name.get(alias_target)
        return None

    def lookup_by_abbreviation(self, abbrev: str | None) -> G3Dv3Unit | None:
        """Match a unit by G3D abbreviation (case-insensitive)."""
        return self._by_abbrev.get(_normalize(abbrev))

    def lookup_by_code(self, code: str | None) -> G3Dv3Unit | None:
        """Match a unit by exact G3D numeric code."""
        if not code:
            return None
        return self._by_code.get(code)

    def resolve(self, token: str | None) -> G3Dv3Unit | None:
        """Try name → abbreviation → code, in that order.

        Use this when the input string is engineer-supplied or
        DOV-derived and you don't know which form it's in. Returns
        the first match or ``None`` if no index hits.
        """
        if not token:
            return None
        return (
            self.lookup_by_name(token)
            or self.lookup_by_abbreviation(token)
            or self.lookup_by_code(token)
        )

    def display_order_for(self, token: str | None) -> int | None:
        """Return the CLAUDE.md-convention display_order for a unit name.

        Lower display_order = older. G3D's age_rank goes the opposite
        direction (lower = younger), so this helper does the inversion
        once so callers don't have to remember the sign.

        Returns ``None`` when the token doesn't resolve — callers fall
        back to their own ordering heuristic (typically depth-derived).
        """
        unit = self.resolve(token)
        if unit is None:
            return None
        return -unit.age_rank


@lru_cache(maxsize=1)
def get_catalog() -> G3Dv3Catalog:
    """Process-singleton accessor.

    First call loads + indexes the catalog (~117 entries, sub-ms);
    subsequent calls are free. ``lru_cache`` is the lightest way to
    get singleton semantics without a module-global guard.
    """
    return G3Dv3Catalog()
