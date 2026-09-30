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

Eviction
--------
A cache that grows forever fills the user's disk on a heavy install. We
sweep lazily: every ``_EVICT_CHECK_INTERVAL`` ``put()`` calls the cache
totals its directory size and, if over ``max_bytes``, deletes oldest-by-
mtime files until under ``EVICT_HEADROOM_RATIO * max_bytes`` (10 %
headroom so the next sweep isn't immediate). The sweep runs inline on
the writing task — DOV imports already serialise on the network, and
the sweep itself only touches files we own. ``max_bytes=None`` disables
eviction (legacy behaviour, useful for tests).
"""

from __future__ import annotations

import os
from pathlib import Path

from groundmodel.infrastructure.parsers.cpt.dov.dov_constants import DOV_VALID_PERMKEY_RE
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Run an eviction sweep every N writes — high enough that a typical
# import doesn't pay sweep cost on every file, low enough that we don't
# overshoot ``max_bytes`` by an order of magnitude.
_EVICT_CHECK_INTERVAL = 64
# Sweep down to this fraction of ``max_bytes`` so the next eviction
# doesn't fire on the very next write. Two-finger margin against
# thrashing.
_EVICT_HEADROOM_RATIO = 0.9


class DovXmlCache(GroundModelLogger):
    """Persistent on-disk cache for DOV XML payloads, keyed by permkey.

    Parameters
    ----------
    cache_dir : Path
        Directory to store cached XMLs in. Created on first use if it
        doesn't exist.
    max_bytes : int | None, optional
        Soft cap on the total size of files inside ``cache_dir``. When
        the cache exceeds it after a write, oldest-mtime files are
        deleted until size is under ``_EVICT_HEADROOM_RATIO *
        max_bytes``. Pass ``None`` to disable eviction (default).
        Settings translate ``DOV_CACHE_MAX_BYTES=0`` to ``None`` so
        users can disable eviction via the env var.
    """

    def __init__(self, cache_dir: Path, max_bytes: int | None = None) -> None:
        super().__init__(__name__)
        self._dir = cache_dir
        self._max_bytes = max_bytes
        self._writes_since_check = 0
        dir_ok = True
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            # If we can't create the cache dir, every get() returns None and every
            # put() is a no-op — caller transparently falls back to the network path.
            self.warning(
                f"DOV cache: could not create directory {self._dir}: {exc}. "
                "Cache will be disabled this session."
            )
            dir_ok = False

        # Run one eviction sweep at startup so a long-lived cache survives
        # process restarts under the cap. The in-memory ``_writes_since_check``
        # counter resets every restart, so without this hook a series of short
        # app sessions (each writing < ``_EVICT_CHECK_INTERVAL`` files) could
        # let the cache drift indefinitely past the configured ceiling.
        if dir_ok and self._max_bytes is not None:
            self._maybe_evict()

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

    def permkeys(self) -> list[str]:
        """Return every cached permkey (the ``*.xml`` stems), sorted; [] on a scan error."""
        try:
            return sorted(
                entry.stem
                for entry in self._dir.iterdir()
                if entry.is_file() and entry.suffix == ".xml"
            )
        except OSError as exc:
            self.warning(f"DOV cache: listing failed at {self._dir}: {exc}")
            return []

    def read_head(self, permkey: str, max_bytes: int) -> bytes | None:
        """Return the first ``max_bytes`` of the cached XML, or None on a miss / read error."""
        path = self._path_for(permkey)
        if path is None:
            return None
        try:
            with open(path, "rb") as f:
                return f.read(max_bytes)
        except FileNotFoundError:
            return None
        except OSError as exc:
            self.warning(f"DOV cache: head read failed for {permkey!r}: {exc}")
            return None

    def put(self, permkey: str, xml_bytes: bytes) -> None:
        """Atomically write *xml_bytes* to the cache. Silently no-op on failure."""
        path = self._path_for(permkey)
        if path is None:
            return
        # Write to a temp file then rename — a half-written .xml file would later
        # parse as broken XML and confuse the import. os.replace is atomic on the
        # same filesystem on every platform we target.
        #
        # fsync BEFORE the rename: the rename is atomic w.r.t. directory entries,
        # but without flushing the file's own data first a crash between write and
        # rename (or a rename whose metadata reaches disk before the data blocks)
        # can leave the published cache entry pointing at zero/garbage bytes that
        # later parse as broken XML. Forcing the bytes to disk first means the
        # atomic rename only ever publishes fully-written data.
        tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        try:
            with open(tmp, "wb") as f:
                f.write(xml_bytes)
                f.flush()
                os.fsync(f.fileno())
            tmp.replace(path)
        except OSError as exc:
            self.warning(f"DOV cache: write failed for {permkey!r}: {exc}")
            # Best-effort cleanup — fine if it doesn't exist.
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
            return

        self._writes_since_check += 1
        if self._max_bytes is not None and self._writes_since_check >= _EVICT_CHECK_INTERVAL:
            self._writes_since_check = 0
            self._maybe_evict()

    def delete(self, permkey: str) -> None:
        """Remove the cached entry for *permkey*. Silently no-op when absent.

        Used to invalidate a cached XML that no longer parses: the download
        helper unlinks the poisoned entry so a single network re-fetch can
        replace it, rather than reading the same broken bytes on every future
        import. Like every cache operation this never raises — a failed unlink
        (permission / race) is logged and the import continues; the stale entry
        simply survives to be retried again next time.
        """
        path = self._path_for(permkey)
        if path is None:
            return
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            self.warning(f"DOV cache: delete failed for {permkey!r}: {exc}")

    def _path_for(self, permkey: str) -> Path | None:
        """Return the cache file path for *permkey*, or None if the key is unsafe."""
        if not DOV_VALID_PERMKEY_RE.match(permkey):
            self.warning(f"DOV cache: rejecting unsafe permkey {permkey!r}")
            return None
        return self._dir / f"{permkey}.xml"

    def _maybe_evict(self) -> None:
        """Sweep oldest-by-mtime files when total cache size exceeds ``max_bytes``.

        Best-effort: every OS error is caught and logged so a failed
        sweep can never break an in-flight import. Hidden tempfiles
        (``.<name>.<pid>.tmp``) and non-XML files are ignored — we only
        own the ``*.xml`` extension.
        """
        if self._max_bytes is None:
            return
        try:
            entries = [
                (entry, entry.stat())
                for entry in self._dir.iterdir()
                if entry.is_file() and entry.suffix == ".xml"
            ]
        except OSError as exc:
            self.warning(f"DOV cache: eviction scan failed at {self._dir}: {exc}")
            return

        total = sum(stat.st_size for _, stat in entries)
        if total <= self._max_bytes:
            return

        # Sort oldest-mtime first; delete until under the headroom target.
        entries.sort(key=lambda pair: pair[1].st_mtime)
        target = int(self._max_bytes * _EVICT_HEADROOM_RATIO)
        deleted = 0
        freed = 0
        for path, stat in entries:
            if total <= target:
                break
            try:
                path.unlink()
            except OSError as exc:
                # A concurrent reader may already have the file open; skip it
                # rather than abort the sweep. Next sweep tries again.
                self.warning(f"DOV cache: eviction unlink failed for {path.name}: {exc}")
                continue
            total -= stat.st_size
            freed += stat.st_size
            deleted += 1

        if deleted:
            self.info(
                f"DOV cache evicted {deleted} files ({freed / 1_048_576:.1f} MiB) "
                f"from {self._dir.name}; new size ≈{total / 1_048_576:.1f} MiB"
            )
