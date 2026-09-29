"""Pure helpers for page images: grey conversion, rendering, pixel runs."""

from __future__ import annotations

import cv2
import numpy as np
import pymupdf

from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    CHROMATIC_SPREAD,
    HUE_TOLERANCE,
    MIN_CURVE_SATURATION,
    MIN_CURVE_VALUE,
    RUN_GAP_PX,
)


def to_gray(image: np.ndarray) -> np.ndarray:
    """Return a uint8 grey image from an RGB or grey array.

    Parameters
    ----------
    image : numpy.ndarray
        ``(h, w, 3)`` RGB or ``(h, w)`` grey.

    Returns
    -------
    numpy.ndarray
        ``(h, w)`` uint8 grey.
    """
    if image.ndim == 2:
        return image.astype(np.uint8, copy=False)
    return cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)


def render_page(page: pymupdf.Page, dpi: int) -> np.ndarray:
    """Render a PDF page to an RGB array.

    Parameters
    ----------
    page : pymupdf.Page
        The page.
    dpi : int
        Resolution.

    Returns
    -------
    numpy.ndarray
        ``(h, w, 3)`` uint8 RGB.
    """
    pix = page.get_pixmap(dpi=dpi, alpha=False)
    rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    return rgb[:, :, :3].copy()


def pixel_runs(columns: np.ndarray, gap: int = RUN_GAP_PX) -> list[tuple[int, int]]:
    """Split sorted column indices into runs of (nearly) touching pixels.

    Parameters
    ----------
    columns : numpy.ndarray
        Sorted column indices of matching pixels in one row.
    gap : int
        Largest hole (px) inside one run.

    Returns
    -------
    list of tuple of int
        ``(first, last)`` column of each run.
    """
    if len(columns) == 0:
        return []
    breaks = np.nonzero(np.diff(columns) > gap)[0]
    starts = np.concatenate([[0], breaks + 1])
    ends = np.concatenate([breaks, [len(columns) - 1]])
    return [(int(columns[s]), int(columns[e])) for s, e in zip(starts, ends, strict=True)]


def is_chromatic(colour: tuple[float, float, float]) -> bool:
    """Return whether an RGB colour (0..1) has a hue worth matching on.

    Parameters
    ----------
    colour : tuple of float
        RGB in 0..1.

    Returns
    -------
    bool
        False for black / grey (traced by darkness instead).
    """
    return max(colour) - min(colour) > CHROMATIC_SPREAD


def hue_mask(hsv: np.ndarray, colour: tuple[float, float, float]) -> np.ndarray:
    """Return the pixels of an OpenCV HSV image that carry a curve colour.

    Hue decides (anti-aliasing lightens a stroke but keeps its hue), with
    floors on saturation and value so paper, grey grid and black text drop
    out. Red wraps around hue 0, so the hue distance is circular.

    Parameters
    ----------
    hsv : numpy.ndarray
        ``(h, w, 3)`` OpenCV HSV (hue 0..180).
    colour : tuple of float
        Target RGB in 0..1.

    Returns
    -------
    numpy.ndarray
        Boolean mask.
    """
    rgb = np.array([[[round(c * 255) for c in colour]]], dtype=np.uint8)
    target = int(cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)[0, 0, 0])
    diff = np.abs(hsv[:, :, 0].astype(int) - target)
    diff = np.minimum(diff, 180 - diff)
    return np.asarray(
        (diff <= HUE_TOLERANCE)
        & (hsv[:, :, 1] >= MIN_CURVE_SATURATION)
        & (hsv[:, :, 2] >= MIN_CURVE_VALUE)
    )
