"""The DOV XML cache as a Reset to DOV reads it (owner 2026-09-30).

The bbox import stores every boring XML under ``<dov_cache_dir>/boring/`` and
every interpretation XML under ``<dov_cache_dir>/interpretatie/``, each file
named after its DOV permkey (``DovXmlCache``). A reset needs them back:

* an interpretation: the observation kept its permkey (``dov_permkey``), so
  the file is read directly;
* the boring (field logs): the borehole row keeps only its boornummer
  (``test_id``), not the boring permkey. The boring XML names the boornummer
  in ``<identificatie>``; ``DovBoringIdentificatieIndex`` maps it to the
  permkey from a persistent index in the cache directory, so a reset opens
  one boring file, not all of them (owner finding 2026-10-04: a cold scan of
  582 files took 7.2 s).

Never touches the network: a miss is a ``None`` the reset turns into a refusal.
"""

from __future__ import annotations

from groundmodel.infrastructure.parsers.borehole.dov.dov_boring_identificatie_index import (
    DovBoringIdentificatieIndex,
)
from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache
from groundmodel.shared.config import settings
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class CachedDovTrackSource(GroundModelLogger):
    """``DovTrackSource`` over the on-disk DOV XML cache.

    Parameters
    ----------
    boring_cache : DovXmlCache
        The ``boring/`` cache of the bbox import.
    interpretation_cache : DovXmlCache
        The ``interpretatie/`` cache of the bbox import.
    boring_index : DovBoringIdentificatieIndex | None
        The boornummer -> permkey index over ``boring_cache``; None builds one
        over that cache's directory.
    """

    def __init__(
        self,
        boring_cache: DovXmlCache,
        interpretation_cache: DovXmlCache,
        boring_index: DovBoringIdentificatieIndex | None = None,
    ) -> None:
        """Initialise with the two caches the reset reads."""
        super().__init__(__name__)
        self._boring = boring_cache
        self._interpretation = interpretation_cache
        self._boring_index = (
            boring_index if boring_index is not None else DovBoringIdentificatieIndex(boring_cache)
        )

    @classmethod
    def from_settings(cls) -> CachedDovTrackSource:
        """Build the source over the cache directories the DOV import writes.

        Returns
        -------
        CachedDovTrackSource
            Reads ``settings.dov_cache_dir / "boring"`` and ``/ "interpretatie"``
            (no eviction cap: the reset only reads).
        """
        return cls(
            boring_cache=DovXmlCache(settings.dov_cache_dir / "boring"),
            interpretation_cache=DovXmlCache(settings.dov_cache_dir / "interpretatie"),
        )

    def boring_xml(self, boornummer: str) -> bytes | None:
        """Return the cached boring XML whose ``<identificatie>`` is ``boornummer``.

        Parameters
        ----------
        boornummer : str
            The borehole's DOV boornummer (``BoreholeOrm.test_id``).

        Returns
        -------
        bytes | None
            The whole XML, or None when no cached boring names it.
        """
        permkey = self._boring_index.lookup(boornummer)
        if permkey is None:
            return None
        return self._boring.get(permkey)

    def interpretation_xml(self, permkey: str) -> bytes | None:
        """Return the cached interpretation XML of ``permkey``, or None.

        Parameters
        ----------
        permkey : str
            The observation's ``dov_permkey``.

        Returns
        -------
        bytes | None
            The XML, or None on a cache miss.
        """
        xml = self._interpretation.get(permkey)
        self.debug(f"interpretation lookup: {permkey} -> {'hit' if xml else 'miss'}")
        return xml
