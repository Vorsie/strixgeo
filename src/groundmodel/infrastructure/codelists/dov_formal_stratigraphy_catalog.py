"""DOV formal-stratigraphy code→canonical-name catalog loader.

Loads the precomputed ``dov_formal_stratigraphy.json`` (built by
``scripts/build_dov_formal_stratigraphy.py`` from the DOV XSD
``FormeleStratigrafieDataCodes.xsd``) and exposes lookup by the
typographically normalised DOV permkey code.

The catalog answers one production question:

**What is the canonical Dutch name for DOV formal-stratigraphy code X?**

Examples:

* ``"KoAa"`` → ``"Lid van Aalbeke (Formatie van Kortrijk)"``
* ``"Q"`` → ``"Groep van Quartaire afzetting"``
* ``"Bm"`` → ``"Formatie van Boom"``

Codes not in the catalog (e.g. ``"U"`` = Onbekend, compound strings
``"QH-T-QP"``) return ``None`` — callers fall through to raw passthrough.

Compound codes (``"QH-T-QP"`` from the DOV interpreter's
``lid1-relatie-lid2`` notation, where relatie is ``T``/``O``/``E``)
are decomposed by the caller before looking up each atomic part.
See ``dov_formal_stratigraphy_constants.py`` for the relation-word map.

The JSON file ships with the distribution.  Network access is never
required at runtime.  Rebuilding the JSON requires the XSD source +
the build script (see ``scripts/build_dov_formal_stratigraphy.py``).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from groundmodel.shared.formation_key import normalize_formation_key
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_CATALOG_PATH = Path(__file__).resolve().parent / "data" / "dov_formal_stratigraphy.json"


@dataclass(frozen=True)
class FormalStratigraphyEntry:
    """One DOV formal-stratigraphy code with its canonical Dutch name.

    Attributes
    ----------
    code : str
        The DOV permkey code as it appears in the XSD enumeration
        (e.g. ``"KoAa"``, ``"Q"``, ``"Bm"``).  Raw, not normalised —
        the normalised key is computed by the catalog at load time and
        used as the lookup key.
    full_name_nl : str
        The verbatim ``xs:documentation`` text from the XSD — the
        canonical Dutch name (e.g.
        ``"Lid van Aalbeke (Formatie van Kortrijk)"``).
    age_rank : int or None
        G3Dv3 age rank recovered via suffix match on the G3Dv3
        abbreviation index (e.g. ``"KoAa"`` → G3Dv3 ``"PA_KoAa"``).
        ``None`` for Quaternary period codes, DOV-internal codes, and
        entries without an unambiguous G3Dv3 counterpart.
    color_hex : str or None
        G3Dv3 prescribed RGB color (``"#rrggbb"``), same provenance as
        ``age_rank``.  ``None`` when ``age_rank`` is ``None``.
    """

    code: str
    full_name_nl: str
    age_rank: int | None
    color_hex: str | None


class DovFormalStratigraphy(GroundModelLogger):
    """Loads + indexes the DOV formal-stratigraphy code catalog from JSON.

    One index is built once at first lookup:

    * By normalised code → entry (``normalize_formation_key`` applied to
      the raw code so dash/space/case variants round-trip cleanly).

    Intended to be shared as a process-singleton via ``get_formal_stratigraphy()``.
    """

    def __init__(self, catalog_path: Path = _CATALOG_PATH) -> None:
        """Load the catalog JSON and build the normalised lookup index.

        Parameters
        ----------
        catalog_path : Path
            Path to ``dov_formal_stratigraphy.json``.  Override only
            in tests.
        """
        super().__init__(__name__)
        with catalog_path.open(encoding="utf-8") as fh:
            raw = json.load(fh)

        self._entries: list[FormalStratigraphyEntry] = [
            FormalStratigraphyEntry(
                code=str(entry["code"]),
                full_name_nl=str(entry["full_name_nl"]),
                age_rank=entry["age_rank"],
                color_hex=entry["color_hex"],
            )
            for entry in raw
        ]

        # Normalised code → entry.  normalize_formation_key is the shared
        # typographic normalisation imported from the application layer;
        # reusing it ensures that the key produced by the catalog and the
        # key produced by the seeder's _derive_layer_names_and_key are
        # always in the same normal form.
        self._by_norm_code: dict[str, FormalStratigraphyEntry] = {}
        for entry in self._entries:
            norm = normalize_formation_key(entry.code)
            # First entry wins on collision (no collision expected — all
            # DOV permkeys are unique in the XSD by definition).
            self._by_norm_code.setdefault(norm, entry)

        self.debug(
            f"DovFormalStratigraphy catalog loaded: {len(self._entries)} entries "
            f"({sum(1 for e in self._entries if e.age_rank is not None)} with G3Dv3 age_rank)"
        )

    def resolve(self, normalized_code: str) -> FormalStratigraphyEntry | None:
        """Return the catalog entry for a normalised formal-stratigraphy code.

        The caller is responsible for normalising the code via
        ``normalize_formation_key`` before calling this method.  The
        catalog key is in the same normal form.

        Parameters
        ----------
        normalized_code : str
            The typographically normalised form of the DOV permkey code
            (output of ``normalize_formation_key``).

        Returns
        -------
        FormalStratigraphyEntry or None
            The matching entry, or ``None`` when the code is not in the
            catalog (unknown code, ``"U"`` = Onbekend, compound strings
            not yet decomposed, etc.).
        """
        return self._by_norm_code.get(normalized_code)

    def all_entries(self) -> list[FormalStratigraphyEntry]:
        """Return every entry in XSD source order.

        Returns
        -------
        list[FormalStratigraphyEntry]
            All 403 entries (as of the 2026-05-18 XSD snapshot).
        """
        return list(self._entries)


@lru_cache(maxsize=1)
def get_formal_stratigraphy() -> DovFormalStratigraphy:
    """Process-singleton accessor for the formal-stratigraphy catalog.

    First call loads and indexes the catalog (~403 entries, sub-ms).
    Subsequent calls are free.  ``lru_cache`` is the lightest way to
    get singleton semantics without a module-global guard.

    Returns
    -------
    DovFormalStratigraphy
        The loaded catalog instance.
    """
    return DovFormalStratigraphy()
