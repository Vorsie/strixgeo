"""Result returned by the ImportSamplesDov use case (Phase C3)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ImportSamplesDovResult:
    """Outcome of a DOV sample + grain-size bbox import.

    Attributes
    ----------
    samples_attached : int
        Number of ``Sample`` rows queued for persistence and attached to
        a parent borehole. A subset of "all samples in the bbox" — only
        samples whose parent borehole was newly imported (i.e. is in the
        caller's ``permkey_to_borehole_id`` map) get attached.
    samples_skipped_no_borehole : int
        Number of WFS sample rows whose parent borehole permkey didn't
        match a known borehole. Typically samples for boreholes that
        were duplicates (skipped at the C1 borehole-import phase) and
        therefore aren't in the caller's map.
    samples_failed : int
        Per-row sample persist failures (constraint violation, invalid
        depth interval, etc.). Failures are isolated.
    grain_sizes_fetched : int
        Number of grain-size observation XMLs that downloaded + parsed
        successfully (regardless of whether they ended up attached).
    grain_sizes_attached : int
        Number of ``GrainSize`` rows queued for persistence and attached
        to a parent sample. Subset of ``grain_sizes_fetched`` — those
        whose parent sample was just persisted.
    grain_sizes_skipped_no_sample : int
        Grain-size observations whose parent sample permkey wasn't in the
        sample-permkey-to-UUID map. Same skipped-duplicate logic.
    grain_sizes_failed : int
        Per-row grain-size failures (download, parse, persist). Per-row
        failures are isolated.
    """

    samples_attached: int = 0
    samples_skipped_no_borehole: int = 0
    samples_failed: int = 0
    grain_sizes_fetched: int = 0
    grain_sizes_attached: int = 0
    grain_sizes_skipped_no_sample: int = 0
    grain_sizes_failed: int = 0
    # Phase C4 — scalar lab tests. ``_attached`` counts ORM rows queued for
    # commit, ``_failed`` counts per-row mapping failures (null/non-numeric
    # value, range violation, orphan parent sample, etc.).
    atterberg_attached: int = 0
    atterberg_failed: int = 0
    caco3_attached: int = 0
    caco3_failed: int = 0
    organic_attached: int = 0
    organic_failed: int = 0
    water_content_attached: int = 0
    water_content_failed: int = 0
