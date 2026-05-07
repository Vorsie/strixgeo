"""Filesystem cache for downloaded DOV sondering XMLs.

DOV sondering data is historical — once a CPT is measured and uploaded its XML
representation is essentially immutable. Caching forever means a region you've
imported once is near-instant on every subsequent import that overlaps it.

Layout: one file per permkey, named ``<permkey>.xml``. The filename IS the cache
key; no separate manifest or index file is needed.

Concurrency: writes use a temp-file + ``Path.replace`` for atomicity, so two
async tasks racing on the same permkey can't corrupt the cached file.

Failure mode: cache errors (disk full, permission denied, etc.) NEVER block the
import. The cache is a pure performance optimisation — every operation logs a
warning on failure and falls through to the network path.

The permkey-validation regex lives in ``dov_constants.py`` per the project's
"constants in a dedicated file" convention.
"""

from __future__ import annotations

import os
from pathlib import Path

from groundmodel.infrastructure.parsers.cpt.dov.dov_constants import DOV_VALID_PERMKEY_RE
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DovXmlCache(GroundModelLogger):
    """Persistent on-disk cache for DOV XML payloads, keyed by permkey.

    Parameters
    ----------
    cache_dir : Path
        Directory to store cached XMLs in. Created on first use if it doesn't exist.
    """

    def __init__(self, cache_dir: Path) -> None:
        super().__init__(__name__)
        self._dir = cache_dir
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            # If we can't create the cache dir, every get() returns None and every
            # put() is a no-op — caller transparently falls back to the network path.
            self.warning(
                f"DOV cache: could not create directory {self._dir}: {exc}. "
                "Cache will be disabled this session."
            )

    def get(self, permkey: str) -> bytes | None:
        """Return cached XML for *permkey*, or None on cache miss / read error."""
        path = self._path_for(permkey)
        if path is None:
            return None
        try:
            return path.read_bytes()
        except FileNotFoundError:
            return None
        except OSError as exc:
            self.warning(f"DOV cache: read failed for {permkey!r}: {exc}")
            return None

    def put(self, permkey: str, xml_bytes: bytes) -> None:
        """Atomically write *xml_bytes* to the cache. Silently no-op on failure."""
        path = self._path_for(permkey)
        if path is None:
            return
        # Write to a temp file then rename — a half-written .xml file would later
        # parse as broken XML and confuse the import. os.replace is atomic on the
        # same filesystem on every platform we target.
        tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        try:
            tmp.write_bytes(xml_bytes)
            tmp.replace(path)
        except OSError as exc:
            self.warning(f"DOV cache: write failed for {permkey!r}: {exc}")
            # Best-effort cleanup — fine if it doesn't exist.
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass

    def _path_for(self, permkey: str) -> Path | None:
        """Return the cache file path for *permkey*, or None if the key is unsafe."""
        if not DOV_VALID_PERMKEY_RE.match(permkey):
            self.warning(f"DOV cache: rejecting unsafe permkey {permkey!r}")
            return None
        return self._dir / f"{permkey}.xml"
