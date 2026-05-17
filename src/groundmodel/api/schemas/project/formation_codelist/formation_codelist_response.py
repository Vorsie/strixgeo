"""Pydantic schema: :class:`FormationCodelistResponse`."""

from __future__ import annotations

from pydantic import BaseModel

from .nad_class_option import NadClassOption


class FormationCodelistResponse(BaseModel):
    """Body of ``GET /projects/{id}/geology/formations/codelist?kind=``.

    Kind-aware suggestion set for the formation-name autocomplete. The
    backend stays permissive (the formation create endpoint accepts any
    name); this only drives the editor's suggestions:

    * ``geological`` → both lists empty (free / G3Dv3-seeded names,
      out of v1 scope here).
    * ``lithostratigraphic`` → ``lithologies`` (the 5 base tokens) +
      ``admixtures`` (informational qualifiers); ``nad_classes`` empty.
    * ``geotechnical`` → ``nad_classes`` (the 31 NAD classes) +
      ``lithologies`` (the base axis); ``admixtures`` empty.

    ``lithology_labels`` maps each base token to its English label so
    the editor can show "ZAND (Sand)" without its own lookup table
    (translate-at-the-presentation-boundary holds — the domain stores
    the raw token).
    """

    kind: str
    lithologies: list[str]
    lithology_labels: dict[str, str]
    admixtures: list[str]
    nad_classes: list[NadClassOption]
