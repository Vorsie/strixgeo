"""The DOV XML cache as a Reset to DOV reads it (owner 2026-09-30).

The bbox import stores every boring XML under ``<dov_cache_dir>/boring/`` and
every interpretation XML under ``<dov_cache_dir>/interpretatie/``, each file
named after its DOV permkey (``DovXmlCache``). A reset needs them back:

* an interpretation: the observation kept its permkey (``dov_permkey``), so
  the file is read directly;
* the boring (field logs): the borehole row keeps only its boornummer
  (``test_id``), not the boring permkey. The boring XML names the boornummer
  in ``<identificatie>``, so the cache is scanned for it - the head of each
  file only (``DOV_BORING_IDENTIFICATIE_HEAD_BYTES``). The cache is capped
  (``dov_cache_max_bytes``), so the scan is bounded; it runs once per reset
  click, never in a loop.

Never touches the network: a miss is a ``None`` the reset turns into a refusal.
"""

from __future__ import annotations

from html import unescape

from groundmodel.infrastructure.parsers.borehole.dov.dov_constants import (
    DOV_BORING_IDENTIFICATIE_HEAD_BYTES,
    DOV_BORING_IDENTIFICATIE_RE,
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
    """

    def __init__(self, boring_cache: DovXmlCache, interpretation_cache: DovXmlCache) -> None:
        """Initialise with the two caches the reset reads."""
        super().__init__(__name__)
        self._boring = boring_cache
        self._interpretation = interpretation_cache

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
        permkeys = self._boring.permkeys()
        self.debug(f"boring lookup: {boornummer!r} among {len(permkeys)} cached boring(s)")
        for permkey in permkeys:
            head = self._boring.read_head(permkey, DOV_BORING_IDENTIFICATIE_HEAD_BYTES)
            if head is None:
                continue
            match = DOV_BORING_IDENTIFICATIE_RE.search(head)
            if match is None:
                continue
            if unescape(match.group(1).decode("utf-8", errors="replace")) == boornummer:
                self.info(f"boring lookup: {boornummer!r} -> cached permkey {permkey}")
                return self._boring.get(permkey)
        self.info(
            f"boring lookup: no cached boring names {boornummer!r} "
            f"({len(permkeys)} file(s) scanned)"
        )
        return None

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
