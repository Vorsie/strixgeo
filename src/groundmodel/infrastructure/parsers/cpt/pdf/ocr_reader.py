"""OcrReader: optional OCR of page regions (scans, unreadable text layers)."""

from __future__ import annotations

import os
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

import numpy as np
import pymupdf

from groundmodel.infrastructure.parsers.cpt.pdf.ocr_word_cache import OcrWordCache
from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    OCR_AXIS_DPI,
    OCR_AXIS_LEFT_SHARE,
    OCR_AXIS_TOP_SHARE,
    OCR_BOTTOM_STRIP,
    OCR_DPI,
    OCR_MAX_THREADS,
    OCR_TOP_STRIP,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_image_helpers import render_page
from groundmodel.shared.exceptions import TriageCancelled
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# The RapidOCR engine of this process. Loading its three ONNX models takes
# seconds (30 s in the owner's log of 2026-10-05, next to a running triage):
# every triage job builds its own OcrReader, so the engine lives here, loaded
# once per process. ONNX runtime sessions are safe to call from two threads.
_SHARED_ENGINE: Any = None
_SHARED_ENGINE_LOCK = threading.Lock()


class OcrReader(GroundModelLogger):
    """Word-level OCR through RapidOCR (ONNX runtime, pure pip wheel).

    OCR is optional: the digitiser works without it (a raster calibration then
    starts as a draft the user completes). The engine is created lazily on
    first use, because loading its models takes a few seconds, and shared by
    every reader of the process.

    RapidOCR returns text lines; they are split into words with boxes placed
    proportionally to character positions, so the geometric field reader and
    tick-run finder see words as they do on a text layer.

    Within a :meth:`session` the page-region reads go through a word cache
    (a region read once is never OCR'd again) and check a stop flag before
    every region (a cancelled triage stops between two strips of a page).

    Parameters
    ----------
    engine : object or None
        A ready engine (tests pass a fake); the process-wide RapidOCR engine
        when None.
    """

    def __init__(self, engine: Any = None) -> None:
        super().__init__(__name__)
        self._engine: Any = engine
        self._cache: OcrWordCache | None = None
        self._should_stop: Callable[[], bool] | None = None
        # Engine calls made (cache hits excluded): the triager compares it
        # before and after a page to know whether that page went through OCR.
        self.engine_calls = 0
        self.engine_seconds = 0.0

    @contextmanager
    def session(
        self,
        cache: OcrWordCache | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[OcrReader]:
        """Read through ``cache`` and honour ``should_stop`` inside the ``with`` block.

        A None argument keeps what an enclosing session set, so the triager's
        session (cache + stop flag) survives the page triage's own one.

        Parameters
        ----------
        cache : OcrWordCache or None
            Where region words are looked up first and remembered.
        should_stop : callable or None
            Checked before every region; True raises ``TriageCancelled``.

        Yields
        ------
        OcrReader
            This reader.
        """
        previous = (self._cache, self._should_stop)
        if cache is not None:
            self._cache = cache
        if should_stop is not None:
            self._should_stop = should_stop
        try:
            yield self
        finally:
            self._cache, self._should_stop = previous

    @staticmethod
    def available() -> bool:
        """Return whether the OCR engine can be imported.

        Returns
        -------
        bool
            True when ``rapidocr_onnxruntime`` is installed.
        """
        try:
            import rapidocr_onnxruntime  # noqa: F401
        except ImportError:
            return False
        return True

    def read_image(self, image: np.ndarray) -> list[PageWord]:
        """Return the words found on an RGB image, in image pixels.

        Parameters
        ----------
        image : numpy.ndarray
            ``(h, w, 3)`` RGB.

        Returns
        -------
        list of PageWord
            Words with pixel boxes.

        Raises
        ------
        RuntimeError
            When the OCR engine is not installed.
        """
        engine = self._get_engine()
        started = time.perf_counter()
        result, _ = engine(np.ascontiguousarray(image[:, :, ::-1]))  # RapidOCR expects BGR
        self.engine_calls += 1
        self.engine_seconds += time.perf_counter() - started
        words: list[PageWord] = []
        for box, text, _score in result or []:
            xs = [float(p[0]) for p in box]
            ys = [float(p[1]) for p in box]
            words.extend(_split_line(min(xs), min(ys), max(xs), max(ys), str(text)))
        self.debug("ocr: %d words", len(words))
        return words

    def read_page_region(
        self, page: pymupdf.Page, clip: pymupdf.Rect, dpi: int = 200
    ) -> list[PageWord]:
        """OCR a region of a PDF page; return words in PDF points.

        Parameters
        ----------
        page : pymupdf.Page
            The page.
        clip : pymupdf.Rect
            Region in PDF points.
        dpi : int
            Render resolution for the OCR pass.

        Returns
        -------
        list of PageWord
            Words with boxes in the page's PDF-point space.

        Raises
        ------
        TriageCancelled
            When the session's stop flag is up (the user cancelled).
        """
        number = page.number + 1
        if self._should_stop is not None and self._should_stop():
            self.info("triage cancelled during the OCR of page %d", number)
            raise TriageCancelled(number - 1, page.parent.page_count)
        key = OcrWordCache.key(number, clip, dpi)
        if self._cache is not None:
            cached = self._cache.get(key)
            if cached is not None:
                self.trace("page %d: OCR words of region %s from the cache", number, key)
                return cached
        pix = page.get_pixmap(dpi=dpi, clip=clip, alpha=False)
        image = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
        scale = 72.0 / dpi
        words = [
            PageWord(
                clip.x0 + w.x0 * scale,
                clip.y0 + w.y0 * scale,
                clip.x0 + w.x1 * scale,
                clip.y0 + w.y1 * scale,
                w.text,
            )
            for w in self.read_image(image[:, :, :3].copy())
        ]
        if self._cache is not None:
            self._cache.put(key, words)
        return words

    def read_page(self, page: pymupdf.Page, dpi: int = 200) -> list[PageWord]:
        """OCR a whole page; return words in PDF points.

        Parameters
        ----------
        page : pymupdf.Page
            The page.
        dpi : int
            Render resolution.

        Returns
        -------
        list of PageWord
            Words in PDF points.
        """
        scale = 72.0 / dpi
        return [
            PageWord(w.x0 * scale, w.y0 * scale, w.x1 * scale, w.y1 * scale, w.text)
            for w in self.read_image(render_page(page, dpi))
        ]

    def read_title_strips(self, page: pymupdf.Page) -> list[PageWord]:
        """OCR the bottom and top strips of a page (title block, header, axis labels).

        Used when the text layer is unreadable: the numbers of the tick
        labels usually survive, the words (labels, company, sounding block)
        do not.

        Parameters
        ----------
        page : pymupdf.Page
            The page.

        Returns
        -------
        list of PageWord
            Words in PDF points.
        """
        r = page.rect
        bottom = pymupdf.Rect(0, r.height * (1 - OCR_BOTTOM_STRIP), r.width, r.height)
        top = pymupdf.Rect(0, 0, r.width, r.height * OCR_TOP_STRIP)
        words = self.read_page_region(page, bottom, OCR_DPI)
        words += self.read_page_region(page, top, OCR_DPI)
        self.info("page %d: OCR of title strips gave %d words", page.number + 1, len(words))
        return words

    def read_axis_strips(self, page: pymupdf.Page) -> list[PageWord]:
        """OCR the strips where axis tick labels sit: along the top and the left edge.

        Used when the tick labels are not in the text layer (fonts converted
        to outlines). Narrow strips at a higher resolution read small labels
        far better than a whole-page pass.

        Parameters
        ----------
        page : pymupdf.Page
            The page.

        Returns
        -------
        list of PageWord
            Words in PDF points.
        """
        r = page.rect
        top = pymupdf.Rect(0, 0, r.width, r.height * OCR_AXIS_TOP_SHARE)
        left = pymupdf.Rect(0, 0, r.width * OCR_AXIS_LEFT_SHARE, r.height)
        words = self.read_page_region(page, top, OCR_AXIS_DPI)
        words += self.read_page_region(page, left, OCR_AXIS_DPI)
        self.info("page %d: OCR of the axis strips gave %d words", page.number + 1, len(words))
        return words

    def _get_engine(self) -> Any:
        """Return this reader's engine: the injected one, else the process-wide one."""
        global _SHARED_ENGINE
        if self._engine is None:
            with _SHARED_ENGINE_LOCK:
                if _SHARED_ENGINE is None:
                    self.info("loading the RapidOCR engine (once per process)")
                    started = time.perf_counter()
                    _SHARED_ENGINE = _load_rapidocr()
                    self.info("RapidOCR engine loaded in %.1f s", time.perf_counter() - started)
                self._engine = _SHARED_ENGINE
        return self._engine


def _ocr_threads() -> int:
    """Return the ONNX runtime threads per model: half the logical cores, capped."""
    return max(1, min(OCR_MAX_THREADS, (os.cpu_count() or 2) // 2))


def _load_rapidocr() -> Any:
    """Load the RapidOCR engine (its three ONNX models).

    Raises
    ------
    RuntimeError
        When the optional ``pdf-ocr`` extra is not installed.
    """
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise RuntimeError(
            "OCR needs the rapidocr-onnxruntime package (uv add rapidocr-onnxruntime)"
        ) from exc
    return RapidOCR(intra_op_num_threads=_ocr_threads())


def _split_line(x0: float, y0: float, x1: float, y1: float, text: str) -> list[PageWord]:
    """Split one OCR text line into words with proportional boxes."""
    stripped = text.strip()
    if not stripped:
        return []
    n = len(text)
    per_char = (x1 - x0) / max(n, 1)
    words: list[PageWord] = []
    i = 0
    for part in text.split(" "):
        if part:
            words.append(PageWord(x0 + i * per_char, y0, x0 + (i + len(part)) * per_char, y1, part))
        i += len(part) + 1
    return words
