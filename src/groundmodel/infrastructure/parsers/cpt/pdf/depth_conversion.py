"""Pure helper: convert vertical-axis values of a graph to depth below ground."""

from __future__ import annotations

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration


def to_depth_below_ground(vertical: np.ndarray, calibration: PageCalibration) -> np.ndarray:
    """Return depth below ground for vertical-axis values of a page.

    Parameters
    ----------
    vertical : numpy.ndarray
        Values read on the vertical axis (depth, or elevation in m TAW).
    calibration : PageCalibration
        The page calibration (depth reference and ground level).

    Returns
    -------
    numpy.ndarray
        Depth below ground (m); ``ground_level - elevation`` on an elevation
        axis.

    Raises
    ------
    ValueError
        On an elevation axis without a ground level (the user must supply it).
    """
    if calibration.depth_reference is DepthReference.DEPTH_BELOW_GROUND:
        return np.asarray(vertical, dtype=float)
    if calibration.ground_level_m is None:
        raise ValueError(
            f"page {calibration.page_number}: elevation axis without a ground level; "
            "supply ground_level_m in the calibration"
        )
    return calibration.ground_level_m - np.asarray(vertical, dtype=float)
