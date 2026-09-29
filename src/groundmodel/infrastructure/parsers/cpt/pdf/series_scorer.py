"""SeriesScorer: compare a digitised series against a reference on one grid."""

from __future__ import annotations

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    DEFAULT_RESAMPLE_STEP_M,
    SCORE_MAX_GAP_STEPS,
)
from groundmodel.infrastructure.parsers.cpt.pdf.series_resampling import (
    depth_grid,
    monotonic_depth,
    nearest_flag,
    resample,
)
from groundmodel.infrastructure.parsers.cpt.pdf.series_score import SeriesScore
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class SeriesScorer(GroundModelLogger):
    """Score a digitised series against a reference series.

    Both are resampled to one regular depth grid; the error is taken where
    both exist. A depth offset search then shifts the digitised depths to
    expose a systematic depth-calibration error.
    """

    def __init__(self) -> None:
        super().__init__(__name__)

    def score(
        self,
        ref_depth: np.ndarray,
        ref_value: np.ndarray,
        test_depth: np.ndarray,
        test_value: np.ndarray,
        exclude: np.ndarray | None = None,
        step_m: float = DEFAULT_RESAMPLE_STEP_M,
        max_offset_m: float = 0.5,
    ) -> SeriesScore:
        """Return the error statistics of ``test`` against ``ref``.

        Parameters
        ----------
        ref_depth, ref_value : numpy.ndarray
            The reference (GEF) series.
        test_depth, test_value : numpy.ndarray
            The digitised series.
        exclude : numpy.ndarray or None
            Boolean per test vertex; True vertices do not count (clipped).
        step_m : float
            Grid step for the comparison and the offset search.
        max_offset_m : float
            The offset search covers ``[-max_offset_m, +max_offset_m]``.

        Returns
        -------
        SeriesScore
            The statistics.

        Raises
        ------
        ValueError
            When the two series share no depth range.
        """
        rd, rv, _ = monotonic_depth(ref_depth, ref_value)
        td, tv, tx = monotonic_depth(test_depth, test_value, exclude)
        grid = depth_grid(max(rd[0], td[0]), min(rd[-1], td[-1]), step_m)
        if len(grid) < 2:
            raise ValueError("reference and digitised series share no depth range")
        # A grid point inside a gap of either series (rods added, a "K" on
        # the sheet) was not measured: it is left out instead of scoring the
        # straight line drawn across the gap.
        max_gap = SCORE_MAX_GAP_STEPS * step_m
        ref_on_grid = resample(rd, rv, grid, max_gap)

        def errors(shift: float) -> tuple[np.ndarray, int]:
            shifted = td + shift
            test_on_grid = resample(shifted, tv, grid, max_gap)
            bad = nearest_flag(shifted, tx, grid)
            ok = np.isfinite(test_on_grid) & np.isfinite(ref_on_grid) & ~bad
            return (test_on_grid - ref_on_grid)[ok], int(bad.sum())

        err0, excluded = errors(0.0)
        rms0 = float(np.sqrt(np.mean(err0**2))) if len(err0) else float("nan")
        best_shift, best_rms = 0.0, rms0
        # Half-step resolution: a depth error of 1 cm on a 2 cm grid shows.
        half = step_m / 2.0
        n_steps = int(round(max_offset_m / half))
        for k in range(-n_steps, n_steps + 1):
            shift = k * half
            err, _ = errors(shift)
            if len(err) < len(err0) * 0.8:
                continue
            rms = float(np.sqrt(np.mean(err**2)))
            if rms < best_rms - 1e-12:
                best_shift, best_rms = shift, rms
        result = SeriesScore(
            n=len(err0),
            rms=rms0,
            max_abs=float(np.max(np.abs(err0))) if len(err0) else float("nan"),
            best_offset_m=best_shift,
            rms_at_best_offset=best_rms,
            excluded=excluded,
        )
        self.info(
            "score: n=%d rms=%.4f max=%.4f best offset %.3f m -> rms %.4f (%d excluded)",
            result.n,
            result.rms,
            result.max_abs,
            result.best_offset_m,
            result.rms_at_best_offset,
            result.excluded,
        )
        return result
