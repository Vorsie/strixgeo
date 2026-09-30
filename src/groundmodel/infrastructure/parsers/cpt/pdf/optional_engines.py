"""Pure helpers: probe and load the optional OCR / OpenCV engines lazily.

Owner 2026-09-30: OCR stays OPTIONAL. The vector path (drawing commands, text
layer) needs PyMuPDF only; RapidOCR and the OpenCV it brings sit in the
``pdf-ocr`` extra. Every module of the digitiser must therefore import without
them, and anything raster or OCR loads its engine at call time through here.
"""

from __future__ import annotations

import importlib.util
from types import ModuleType


def _importable(name: str) -> bool:
    """Return whether a top-level module can be imported (without importing it)."""
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def raster_available() -> bool:
    """Return whether OpenCV is installed (scans and pasted images need it).

    Returns
    -------
    bool
        True when ``cv2`` can be imported.
    """
    return _importable("cv2")


def ocr_available() -> bool:
    """Return whether tick labels can be read by OCR (RapidOCR + OpenCV).

    Returns
    -------
    bool
        True when both ``rapidocr_onnxruntime`` and ``cv2`` can be imported.
    """
    return _importable("rapidocr_onnxruntime") and raster_available()


def require_cv2() -> ModuleType:
    """Return the OpenCV module, or explain which extra is missing.

    Returns
    -------
    types.ModuleType
        The ``cv2`` module.

    Raises
    ------
    ValueError
        When OpenCV is not installed: raster pages need the ``pdf-ocr``
        extra. A ValueError, because the digitiser treats a page it cannot
        read as "not digitised" and carries on with the next one.
    """
    try:
        import cv2
    except ImportError as exc:
        raise ValueError(
            "raster reading unavailable: install the 'pdf-ocr' extra (OpenCV) "
            "to read scanned or pasted-image pages"
        ) from exc
    return cv2
