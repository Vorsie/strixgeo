"""Match an imported lab test to a project borehole and sample (pure rules).

Owner rules (2026-09-29):

* Borehole: the lab names job ``GEO-25/022`` and borehole ``B17``; DOV names
  the borehole ``GEO-25/022-B17``, sometimes with a prefix
  (``1411-GEO-24/159-B2``). A project borehole whose name ENDS WITH
  ``<job>-<borehole>`` (case- and space-insensitive) matches. The file name is
  never used. When the export names no borehole (the newer oedometer module),
  every borehole of the job is a candidate and none is picked.
* Sample: "overlapping depths, yes same sample" — an existing sample on the
  borehole whose interval overlaps the lab's sampling interval is the sample;
  with two overlaps, the larger overlap. Without an interval, a sample that
  carries the lab's sample number. Otherwise none: the preview proposes a new
  sample and the user confirms.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

from groundmodel.domain.value_objects.lab_sample_candidate import SampleCandidate

__all__ = ["SampleCandidate", "borehole_name_ends_with", "match_borehole_ids", "match_sample"]


def _norm(text: str) -> str:
    """Case-fold and drop every space (``GEO-25/022 - B17`` → ``geo-25/022-b17``)."""
    return "".join(text.split()).casefold()


def borehole_name_ends_with(name: str, suffix: str) -> bool:
    """True when ``name`` ends with ``suffix``, case- and space-insensitive.

    Parameters
    ----------
    name : str
        A borehole name as stored (``1411-GEO-24/159-B2``).
    suffix : str
        The lab's ``<job>-<borehole>`` (``GEO-24/159-B2``).

    Returns
    -------
    bool
        Whether the name ends with the suffix (an empty suffix never matches).
    """
    wanted = _norm(suffix)
    return bool(wanted) and _norm(name).endswith(wanted)


def match_borehole_ids(
    job_number: str | None,
    borehole_name: str | None,
    boreholes: Iterable[tuple[str, str]],
) -> list[str]:
    """Return the ids of the project boreholes that match the lab's identity.

    Parameters
    ----------
    job_number : str or None
        The lab job ("Opdrachtnummer" / "Dossiernummer"), e.g. ``GEO-25/022``.
    borehole_name : str or None
        The borehole as the lab writes it (``B17``); ``None`` when the export
        names none.
    boreholes : Iterable[tuple[str, str]]
        ``(id, name)`` of every borehole in the project, in list order.

    Returns
    -------
    list[str]
        Matching ids in input order: exactly one = a sure match; zero or
        several = the user picks.
    """
    if not job_number or not _norm(job_number):
        return []
    job = _norm(job_number)
    if borehole_name and _norm(borehole_name):
        suffix = f"{job}-{_norm(borehole_name)}"
        return [bid for bid, name in boreholes if borehole_name_ends_with(name, suffix)]
    return [bid for bid, name in boreholes if f"{job}-" in _norm(name)]


def match_sample(
    depth_top_m: float | None,
    depth_base_m: float | None,
    lab_sample_number: str | None,
    samples: Sequence[SampleCandidate],
) -> tuple[str | None, str]:
    """Pick the existing sample a lab test belongs to.

    Parameters
    ----------
    depth_top_m, depth_base_m : float or None
        The lab's sampling interval, m below ground.
    lab_sample_number : str or None
        The lab's sample number (``20/0568``).
    samples : Sequence[SampleCandidate]
        The samples on the chosen borehole.

    Returns
    -------
    tuple[str or None, str]
        ``(sample_id, "overlap")``, ``(sample_id, "sample_number")`` or
        ``(None, "none")``.
    """
    if depth_top_m is not None and depth_base_m is not None:
        best: tuple[float, str] | None = None
        for s in samples:
            shared = min(depth_base_m, s.depth_base_m) - max(depth_top_m, s.depth_top_m)
            # Strictly positive: two intervals that only touch share no material.
            if shared > 0 and (best is None or shared > best[0]):
                best = (shared, s.sample_id)
        if best is not None:
            return best[1], "overlap"
    if lab_sample_number and _norm(lab_sample_number):
        wanted = _norm(lab_sample_number)
        for s in samples:
            if s.sample_number and _norm(s.sample_number) == wanted:
                return s.sample_id, "sample_number"
    return None, "none"
