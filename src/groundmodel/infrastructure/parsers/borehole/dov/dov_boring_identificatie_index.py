"""Persistent ``<identificatie>`` -> permkey index over the DOV boring cache.

Why it exists (owner finding 2026-10-04, "Reset to DOV ... takes 5 to 10
seconds"): a stored borehole keeps its boornummer but not its boring permkey,
which is the cache file name, so a reset had to open every cached boring and
read its ``<identificatie>``. Measured on the owner's cache (582 files): a
COLD scan took 7.2 s - each first open of a file costs about 25 ms (on-access
scan / file cache) - a warm one 0.05 s. The cache goes cold within minutes,
so nearly every reset paid the full scan.

The index lives inside the cache directory
(``DOV_BORING_IDENTIFICATIE_INDEX_FILENAME``), one JSON object per line::

    {"v": 1, "permkey": "2026-244531", "identificatie": "1445-GEO-26/001-B2",
     "size": 3548, "mtime_ns": 1790000000000000000}

* **Hit** - the index names a permkey for the boornummer: ONE head read checks
  the file still names it, and the permkey is the answer. No other file is
  opened.
* **Miss** - one directory listing (``DovXmlCache.entries``: size + mtime, no
  file opened) finds the files the index does not know or whose size / mtime
  changed; only those are head-read, the index is rewritten (tmp + replace),
  and the boornummer is looked up again. A complete index answers an unknown
  boornummer (an XML-file import) without opening any file.
* **Stale** - a hit whose file is gone (eviction) or now names another boring
  is dropped and the miss path runs.
* **Corrupt / missing index** - unreadable lines are skipped; the miss path
  rebuilds what is missing and the file is rewritten whole.
* **Record** - the bbox import's boring cache calls ``record`` after each
  write (``DovXmlCache(put_observer=...)``), which appends one line when the
  index exists, so a fresh import never forces a scan. With no index yet it
  writes nothing: the first lookup builds the index from the whole cache.

All reads and writes run on the backend's single event-loop thread (the cache
``put`` and the reset are both synchronous calls there), so an append and a
rewrite never interleave in-process. The index is a pure accelerator: every
error is logged and the lookup falls back to reading the files.
"""

from __future__ import annotations

import json
import os
import time
from html import unescape
from pathlib import Path

from groundmodel.infrastructure.parsers.borehole.dov.dov_constants import (
    DOV_BORING_IDENTIFICATIE_HEAD_BYTES,
    DOV_BORING_IDENTIFICATIE_INDEX_FILENAME,
    DOV_BORING_IDENTIFICATIE_INDEX_VERSION,
    DOV_BORING_IDENTIFICATIE_RE,
)
from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.timing import ms_since

# permkey -> (identificatie, size_bytes, mtime_ns). An empty identificatie marks
# a file whose head names none, so it is not re-read on every miss.
_IndexEntries = dict[str, tuple[str, int, int]]


def _identificatie_of(head: bytes) -> str | None:
    """Return the ``<identificatie>`` a boring XML head names, or None.

    Parameters
    ----------
    head : bytes
        The first ``DOV_BORING_IDENTIFICATIE_HEAD_BYTES`` of a boring XML (or
        the whole document).

    Returns
    -------
    str | None
        The boornummer, XML entities resolved; None when the head names none.
    """
    match = DOV_BORING_IDENTIFICATIE_RE.search(head)
    if match is None:
        return None
    return unescape(match.group(1).decode("utf-8", errors="replace"))


class DovBoringIdentificatieIndex(GroundModelLogger):
    """Find a cached boring XML by the boornummer it names, without a full scan.

    Parameters
    ----------
    cache : DovXmlCache
        The ``boring/`` cache the bbox import fills. The index file lives in
        its directory.
    """

    def __init__(self, cache: DovXmlCache) -> None:
        """Initialise over ``cache``; nothing is read until the first lookup."""
        super().__init__(__name__)
        self._cache = cache
        self._path = cache.directory / DOV_BORING_IDENTIFICATIE_INDEX_FILENAME

    @property
    def path(self) -> Path:
        """The index file inside the cache directory."""
        return self._path

    def size(self) -> int:
        """Return how many cached files the index file describes (0 when absent).

        Returns
        -------
        int
            The number of usable entries on disk.
        """
        entries, _ = self._load()
        return len(entries)

    def lookup(self, identificatie: str) -> str | None:
        """Return the permkey of the cached boring that names ``identificatie``.

        Parameters
        ----------
        identificatie : str
            The borehole's DOV boornummer (``BoreholeOrm.test_id``).

        Returns
        -------
        str | None
            The permkey (the cache key of the boring XML), or None when no
            cached boring names it. When several do, the lowest permkey wins
            (the order the full scan used).
        """
        start = time.perf_counter()
        entries, dirty = self._load()

        for permkey in self._candidates(entries, identificatie):
            if self._verify(permkey, identificatie):
                if dirty:
                    self._write_all(entries)
                self.info(
                    f"boring index: hit {identificatie!r} -> {permkey} "
                    f"({len(entries)} entries, {ms_since(start)} ms)"
                )
                return permkey
            # Evicted, or re-downloaded naming another boring: forget it so the
            # refresh below re-reads it if it is still there.
            self.debug(f"boring index: stale entry {permkey} for {identificatie!r} dropped")
            del entries[permkey]
            dirty = True

        scanned, dropped = self._refresh(entries)
        if dirty or scanned or dropped:
            self._write_all(entries)
        candidates = self._candidates(entries, identificatie)
        answer = candidates[0] if candidates else None
        self.info(
            f"boring index: {len(entries)} entries, {scanned} new file(s) scanned, "
            f"{dropped} gone; {identificatie!r} -> {answer or 'not cached'} "
            f"({ms_since(start)} ms)"
        )
        return answer

    def record(self, permkey: str, xml_bytes: bytes) -> None:
        """Append the boring the cache just stored, when the index exists.

        The ``DovXmlCache`` put observer of the bbox import's boring cache.
        Never raises: a failure only costs one head read at the next lookup.

        Parameters
        ----------
        permkey : str
            The cache key the XML was written under.
        xml_bytes : bytes
            The XML that was written.
        """
        if not self._path.exists():
            return
        try:
            stat = (self._cache.directory / f"{permkey}.xml").stat()
        except OSError as exc:
            self.warning(f"boring index: cannot stat {permkey} to record it: {exc}")
            return
        ident = _identificatie_of(xml_bytes[:DOV_BORING_IDENTIFICATIE_HEAD_BYTES]) or ""
        line = self._line(permkey, (ident, stat.st_size, stat.st_mtime_ns))
        try:
            with open(self._path, "a", encoding="utf-8") as f:
                f.write(line)
        except OSError as exc:
            self.warning(f"boring index: append failed for {permkey}: {exc}")
            return
        self.debug(f"boring index: recorded {permkey} -> {ident!r}")

    # ------------------------------------------------------------------
    # internals
    # ------------------------------------------------------------------

    @staticmethod
    def _candidates(entries: _IndexEntries, identificatie: str) -> list[str]:
        """The permkeys the index says name ``identificatie``, lowest first."""
        return sorted(pk for pk, (ident, _, _) in entries.items() if ident == identificatie)

    def _verify(self, permkey: str, identificatie: str) -> bool:
        """True when the cached file of ``permkey`` still names ``identificatie``."""
        head = self._cache.read_head(permkey, DOV_BORING_IDENTIFICATIE_HEAD_BYTES)
        return head is not None and _identificatie_of(head) == identificatie

    def _refresh(self, entries: _IndexEntries) -> tuple[int, int]:
        """Bring ``entries`` in line with the directory; return (scanned, dropped).

        Only files the index does not know, or whose size / mtime changed, are
        opened; entries whose file is gone are dropped.
        """
        listing = self._cache.entries()
        listed = {pk for pk, _, _ in listing}
        gone = [pk for pk in entries if pk not in listed]
        for pk in gone:
            del entries[pk]
        to_scan = [
            (pk, size, mtime)
            for pk, size, mtime in listing
            if pk not in entries or entries[pk][1:] != (size, mtime)
        ]
        for i, (pk, size, mtime) in enumerate(to_scan, 1):
            head = self._cache.read_head(pk, DOV_BORING_IDENTIFICATIE_HEAD_BYTES)
            if head is None:
                continue
            ident = _identificatie_of(head) or ""
            entries[pk] = (ident, size, mtime)
            self.debug(f"boring index [{i}/{len(to_scan)}]: {pk} -> {ident!r}")
        return len(to_scan), len(gone)

    def _load(self) -> tuple[_IndexEntries, bool]:
        """Read the index file; return (entries, needs_rewrite).

        A missing file is an empty index. An unreadable line (a torn append,
        a foreign version, garbage) is skipped and marks the file for a
        rewrite; later lines win over earlier ones for the same permkey.
        """
        entries: _IndexEntries = {}
        try:
            raw = self._path.read_bytes()
        except FileNotFoundError:
            return entries, False
        except OSError as exc:
            self.warning(f"boring index: read failed at {self._path}: {exc}; rebuilding")
            return entries, True
        bad = 0
        for line in raw.splitlines():
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
                if obj["v"] != DOV_BORING_IDENTIFICATIE_INDEX_VERSION:
                    raise ValueError(f"index line version {obj['v']!r}")
                entries[str(obj["permkey"])] = (
                    str(obj["identificatie"]),
                    int(obj["size"]),
                    int(obj["mtime_ns"]),
                )
            except (ValueError, KeyError, TypeError) as exc:
                bad += 1
                self.debug(f"boring index: unreadable line skipped ({exc})")
        if bad:
            self.warning(
                f"boring index: {bad} unreadable line(s) in {self._path.name}; "
                f"kept {len(entries)} entries, the file will be rewritten"
            )
        return entries, bad > 0

    def _write_all(self, entries: _IndexEntries) -> None:
        """Rewrite the whole index atomically (tmp + replace); log on failure."""
        tmp = self._path.with_name(f".{self._path.name}.{os.getpid()}.tmp")
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                f.writelines(self._line(pk, entries[pk]) for pk in sorted(entries))
            tmp.replace(self._path)
        except OSError as exc:
            self.warning(f"boring index: rewrite failed at {self._path}: {exc}")
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass

    @staticmethod
    def _line(permkey: str, entry: tuple[str, int, int]) -> str:
        """One index line (JSON + newline) for ``permkey``."""
        ident, size, mtime = entry
        return (
            json.dumps(
                {
                    "v": DOV_BORING_IDENTIFICATIE_INDEX_VERSION,
                    "permkey": permkey,
                    "identificatie": ident,
                    "size": size,
                    "mtime_ns": mtime,
                },
                ensure_ascii=False,
            )
            + "\n"
        )
