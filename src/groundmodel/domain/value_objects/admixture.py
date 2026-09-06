"""Admixture value object — secondary soil component within a lithological layer."""

from dataclasses import dataclass

from groundmodel.domain.value_objects.admixture_constants import canonical_amount


@dataclass(frozen=True)
class Admixture:
    """Secondary soil component within a lithological layer.

    A layer's main soil type (e.g. "fine sand") may contain admixtures of other
    soil types (e.g. "weak clay", "some shells"). The MAIN soil type lives on
    the parent layer at ``ObservationLayer.main_soil_codes`` (a list, since DOV
    allows multiple equally-dominant main soils per layer); ``Admixture`` only
    carries the SECONDARY components. DOV represents these in the
    ``<bijmenging>`` element of an interpretation XML.

    Parameters
    ----------
    soil_code : str
        Source-vocabulary code for the admixture soil type (e.g. "GL" for
        glauconite, "KL" for clay). Translation to a human label is a parser concern.
    amount : str
        Amount qualifier — source-vocabulary code (e.g. "Z" = weak, "M" = medium,
        "S" = strong, "V" = much). Empty string means unspecified.
    locally : bool
        True when the admixture is only locally present within the interval
        (DOV ``<plaatselijk>true</plaatselijk>``); False when it occurs throughout.

    Raises
    ------
    ValueError
        If ``soil_code`` is empty.
    """

    soil_code: str
    amount: str = ""
    locally: bool = False

    def __post_init__(self) -> None:
        if not self.soil_code:
            raise ValueError("Admixture.soil_code cannot be empty")

    def canonical_key(self) -> str:
        """Deterministic string key for admixture identity.

        Used to build the ``canonical_admixture_signature`` for the Accept
        find-or-create key.  The ``locally`` flag is intentionally excluded
        from the key so two admixtures that differ only in locality are
        treated as the same composition for deduplication purposes (owner
        decision: composition buckets, not presence-within-layer detail).

        Returns
        -------
        str
            ``"<soil_code>:<amount>"`` (e.g. ``"KL:Z"``), with the amount folded
            onto its canonical synonym (``"S"`` reads as ``"V"``: sterk = veel,
            owner ruling 2026-09-06) so equal compositions compare equal.
        """
        return f"{self.soil_code}:{canonical_amount(self.amount)}"
