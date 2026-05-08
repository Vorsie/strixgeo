"""Primitive CPT corrections — qt = qc + u2(1 - a) and friends.

Distinct from ``cpt_interpretation.py`` (Robertson Ic, soil-behaviour-type), which
is preview engineering scope deferred to Phase 5. The corrections in this module
are basic mechanical-engineering identities used at every CPTU read: not
interpretations, not preview code, just arithmetic on the primitive measurements
we already store.

We persist only the fundamentals (qc, u2, cone_area_ratio); qt is recomputed on
read so the database can never disagree with its own inputs. See CLAUDE.md
"Data Integrity Rules" §1.
"""

from groundmodel.shared.logging.logger_factory import LoggerFactory

logger = LoggerFactory.get_logger(__name__)


def calculate_qt_series(
    qc_mpa: list[float | None],
    u2_mpa: list[float | None] | None,
    cone_area_ratio: float | None,
) -> list[float | None] | None:
    """Compute corrected cone resistance qt = qc + u2(1 - a) for a CPTU series.

    Returns the per-row corrected cone resistance in MPa. Each row is ``None``
    when any of ``qc``, ``u2`` is ``None`` for that row, or when the inputs
    needed for the row are otherwise unavailable.

    Parameters
    ----------
    qc_mpa : list[float | None]
        Cone resistance per row in MPa. Required.
    u2_mpa : list[float | None] | None
        Pore-pressure-at-shoulder per row in MPa. ``None`` (the column itself
        absent) means we have no piezo readings — qt is undefined and the
        function returns ``None``.
    cone_area_ratio : float | None
        Net area ratio (a-value) of the cone, dimensionless, typically 0.55–0.85.
        ``None`` when the source did not report MEASUREMENTVAR 3 — qt is
        undefined and the function returns ``None``. We do NOT invent a default
        because the wrong a corrupts qt and every Robertson normalisation that
        consumes it.

    Returns
    -------
    list[float | None] | None
        Per-row qt in MPa, same length as ``qc_mpa``. Returns ``None`` when
        ``u2_mpa`` or ``cone_area_ratio`` is missing — the caller must handle
        that case rather than receiving silently-fabricated data.
    """
    if u2_mpa is None or cone_area_ratio is None:
        return None

    if len(u2_mpa) != len(qc_mpa):
        logger.warning(
            f"calculate_qt_series: array length mismatch qc={len(qc_mpa)} "
            f"u2={len(u2_mpa)} — returning None"
        )
        return None

    one_minus_a = 1.0 - cone_area_ratio
    out: list[float | None] = []
    for qc, u2 in zip(qc_mpa, u2_mpa, strict=True):
        if qc is None or u2 is None:
            out.append(None)
        else:
            out.append(qc + u2 * one_minus_a)
    return out
