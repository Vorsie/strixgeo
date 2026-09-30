"""RasterDeskewer: measure and remove the rotation of a scanned page."""

from __future__ import annotations

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.optional_engines import require_cv2
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    LINE_INK_THRESHOLD,
    SKEW_COARSE_STEP_DEG,
    SKEW_FINE_STEP_DEG,
    SKEW_SEARCH_MAX_DEG,
    SKEW_WORK_MAX_SIDE_PX,
)
from groundmodel.infrastructure.parsers.cpt.pdf.raster_image_helpers import to_gray
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class RasterDeskewer(GroundModelLogger):
    """Find the skew angle from the page's long straight lines.

    A CPT sheet is full of long horizontal and vertical lines (frame, grid).
    When the page is turned exactly upright, the ink projects onto a few rows
    and columns, so the squared row and column sums peak. The angle is found
    by a coarse sweep then a fine sweep of that projection score on a
    downscaled ink mask.
    """

    def __init__(self) -> None:
        super().__init__(__name__)

    def estimate_skew_deg(self, image: np.ndarray) -> float:
        """Return the content's rotation in degrees (counter-clockwise positive).

        Parameters
        ----------
        image : numpy.ndarray
            RGB or grey page image.

        Returns
        -------
        float
            The skew; rotating the image by minus this value straightens it.
        """
        ink = (to_gray(image) < LINE_INK_THRESHOLD).astype(np.float32)
        cv2 = require_cv2()
        scale = min(1.0, SKEW_WORK_MAX_SIDE_PX / max(ink.shape))
        if scale < 1.0:
            ink = np.asarray(
                cv2.resize(ink, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA),
                dtype=np.float32,
            )

        def score(angle: float) -> float:
            h, w = ink.shape
            m = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), angle, 1.0)
            r = cv2.warpAffine(ink, m, (w, h), flags=cv2.INTER_LINEAR, borderValue=0.0)
            return float(np.sum(r.sum(axis=0) ** 2) + np.sum(r.sum(axis=1) ** 2))

        coarse = np.arange(-SKEW_SEARCH_MAX_DEG, SKEW_SEARCH_MAX_DEG + 1e-9, SKEW_COARSE_STEP_DEG)
        best = max(coarse, key=score)
        fine = np.arange(
            best - SKEW_COARSE_STEP_DEG, best + SKEW_COARSE_STEP_DEG + 1e-9, SKEW_FINE_STEP_DEG
        )
        best = max(fine, key=score)
        # ``best`` straightens the page, so the content was rotated by -best.
        skew = float(-best)
        self.debug("skew estimate %.3f deg", skew)
        return skew

    def deskew(self, image: np.ndarray) -> tuple[np.ndarray, float]:
        """Return the straightened image and the skew that was removed.

        Parameters
        ----------
        image : numpy.ndarray
            RGB or grey page image.

        Returns
        -------
        tuple
            ``(straight_image, skew_deg)``; the border is filled white.
        """
        skew = self.estimate_skew_deg(image)
        if abs(skew) < SKEW_FINE_STEP_DEG / 2:
            return image, 0.0
        h, w = image.shape[:2]
        cv2 = require_cv2()
        m = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), -skew, 1.0)
        border = (255, 255, 255) if image.ndim == 3 else 255
        straight = cv2.warpAffine(image, m, (w, h), flags=cv2.INTER_LINEAR, borderValue=border)
        self.info("deskewed by %.3f deg", skew)
        return straight, skew
