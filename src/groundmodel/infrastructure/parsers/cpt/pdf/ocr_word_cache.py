"""OcrWordCache: the OCR words of one report's page regions, kept on disk next to it."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import TYPE_CHECKING

from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import OCR_CACHE_VERSION
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

if TYPE_CHECKING:
    # The report store (imported at API boot) builds this cache; PyMuPDF
    # loads on the first report opened, not at start-up.
    import pymupdf


class OcrWordCache(GroundModelLogger):
    """Remember what OCR read in each page region of one report.

    OCR of a sheet whose text layer is unreadable costs seconds; a report of
    ~100 such sheets takes minutes. The words of every region read are kept
    under a key naming the page, the region and the resolution, so the
    digitise pass (which reads the same title strips the classify pass read)
    and a second triage of the same file never OCR the region again.

    The cache is one JSON file next to the stored report (the report store
    owns its path and prunes it with the report). ``path`` None keeps it in
    memory only (one triage run).

    Parameters
    ----------
    path : pathlib.Path or None
        The cache file; read now when it exists and carries the current
        format version, written by :meth:`save`.
    """

    def __init__(self, path: Path | None = None) -> None:
        super().__init__(__name__)
        self._path = path
        self._words: dict[str, list[list[float | str]]] = {}
        self._dirty = False
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0
        if path is not None and path.exists():
            self._load(path)

    @staticmethod
    def key(page_number: int, clip: pymupdf.Rect, dpi: int) -> str:
        """Return the cache key of one OCR'd page region.

        Parameters
        ----------
        page_number : int
            1-based page number.
        clip : pymupdf.Rect
            The region, in PDF points.
        dpi : int
            The render resolution of the OCR pass.

        Returns
        -------
        str
            ``"<page>|<x0>,<y0>,<x1>,<y1>|<dpi>"``, the region rounded to 0.1 pt.
        """
        box = ",".join(f"{v:.1f}" for v in (clip.x0, clip.y0, clip.x1, clip.y1))
        return f"{page_number}|{box}|{dpi}"

    def get(self, key: str) -> list[PageWord] | None:
        """Return the words cached under ``key``, or None (counted as a hit / miss).

        Parameters
        ----------
        key : str
            From :meth:`key`.

        Returns
        -------
        list of PageWord or None
            The words, in PDF points; None when the region was never read.
        """
        with self._lock:
            rows = self._words.get(key)
            if rows is None:
                self.misses += 1
                return None
            self.hits += 1
        return [
            PageWord(float(r[0]), float(r[1]), float(r[2]), float(r[3]), str(r[4])) for r in rows
        ]

    def put(self, key: str, words: list[PageWord]) -> None:
        """Remember the words OCR read under ``key``.

        Parameters
        ----------
        key : str
            From :meth:`key`.
        words : list of PageWord
            The words, in PDF points.
        """
        with self._lock:
            self._words[key] = [[w.x0, w.y0, w.x1, w.y1, w.text] for w in words]
            self._dirty = True

    def keys(self) -> list[str]:
        """Return the cached keys, sorted.

        Returns
        -------
        list of str
            Every region key held.
        """
        with self._lock:
            return sorted(self._words)

    def save(self) -> None:
        """Write the cache file when anything new was read (atomic replace).

        A failed write is logged and swallowed: the cache only saves time, it
        must never fail a triage.
        """
        if self._path is None or not self._dirty:
            return
        with self._lock:
            text = json.dumps({"version": OCR_CACHE_VERSION, "regions": self._words})
            regions = len(self._words)
            self._dirty = False
        tmp = self._path.with_name(self._path.name + ".tmp")
        try:
            tmp.write_text(text, encoding="utf-8")
            os.replace(tmp, self._path)
        except OSError as exc:
            tmp.unlink(missing_ok=True)
            self.warning("OCR cache %s not written: %s", self._path.name[:12], exc)
            return
        self.debug("OCR cache %s written: %d region(s)", self._path.name[:12], regions)

    def _load(self, path: Path) -> None:
        """Read the cache file; an unreadable or older-format file is ignored."""
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            self.warning("OCR cache %s unreadable, starting empty: %s", path.name[:12], exc)
            return
        if not isinstance(data, dict) or data.get("version") != OCR_CACHE_VERSION:
            found = data.get("version") if isinstance(data, dict) else type(data).__name__
            self.info(
                "OCR cache %s has format %s, not %d: ignored",
                path.name[:12],
                found,
                OCR_CACHE_VERSION,
            )
            return
        regions = data.get("regions")
        if isinstance(regions, dict):
            self._words = regions
        self.debug("OCR cache %s read: %d region(s)", path.name[:12], len(self._words))
