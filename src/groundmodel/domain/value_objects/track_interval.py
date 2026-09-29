"""Track interval value object — one depth interval of a hand-edited borehole track."""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.domain.value_objects.admixture import Admixture


@dataclass(frozen=True)
class TrackInterval:
    """One depth interval of a borehole track, as the engineer typed it.

    One wide shape for every track kind (the ``ObservationLayerOrm`` layout
    rationale applies): a field-log kind fills ``value``; a coded-lithology
    kind fills ``main_soil_codes`` (+ ``admixtures`` / ``color``); a
    description or stratigraphy kind fills ``description``. The unused fields
    stay at their empty defaults.

    Parameters
    ----------
    top_m : float
        Depth of the interval's top below the collar, metres.
    base_m : float
        Depth of the interval's base below the collar, metres.
    value : str | None
        Field-log value (raw DOV token, e.g. ``"plastisch"``).
    description : str | None
        Free text, or a stratigraphy unit code (e.g. ``"KoAa"``).
    color : str | None
        Optional layer colour on a coded-lithology row (raw DOV token).
    main_soil_codes : tuple[str, ...]
        DOV hoofdnaam codes (``"FZ"``, ``"KL"``, ...), order preserved.
    admixtures : tuple[Admixture, ...]
        Secondary soil components (raw DOV tokens).
    """

    top_m: float
    base_m: float
    value: str | None = None
    description: str | None = None
    color: str | None = None
    main_soil_codes: tuple[str, ...] = ()
    admixtures: tuple[Admixture, ...] = ()
