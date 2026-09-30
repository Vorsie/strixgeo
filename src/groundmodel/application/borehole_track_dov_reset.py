"""Reset a borehole's DOV tracks to what DOV published (owner 2026-09-30).

The owner, after editing tracks by hand: "there needs to be a per borehole
button to reset to dov defaults though". The reset:

* re-reads the DOV XML the bbox import cached - each interpretation by its
  ``dov_permkey``, the boring by its boornummer (``BoreholeOrm.test_id``) - and
  re-parses it with the import's own parsers;
* rewrites every DOV track from that parse: an observation IN PLACE (same id,
  same ``dov_permkey``, fresh layers and header), the field logs WHOLESALE
  (every non-manual kind is replaced by the parsed rows of that kind - a DOV
  field-log kind the engineer deleted comes back);
* KEEPS every manual track (``source = "manual"``) untouched;
* clears ``edited_manually_at`` on every track it rewrote.

All-or-nothing: the XML of every targeted track is read and parsed BEFORE
anything is written, and a single miss refuses the whole reset
(``BoreholeResetNoDovSourceError``) - a half-reset borehole would be worse
than none. DOV data is written as DOV sent it; the track-editor rules
(``validate_track_intervals``) judge hand edits only.

The function mutates the loaded ORM tree and does no I/O of its own beyond the
``DovTrackSource`` lookups; the use case flushes.
"""

from __future__ import annotations

from collections import defaultdict
from uuid import UUID

from groundmodel.application.borehole_track_helpers import (
    FAMILY_FIELD_LOG,
    build_field_log_rows,
    build_observation_layers,
    field_log_snapshot,
    observation_snapshot,
    parse_track_id,
)
from groundmodel.application.borehole_track_reset_outcome import BoreholeTrackResetOutcome
from groundmodel.application.borehole_track_snapshot import BoreholeTrackSnapshot
from groundmodel.application.dov_track_source import DovTrackSource
from groundmodel.domain.models.borehole.observation import Observation
from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.domain.value_objects.track_interval import TrackInterval
from groundmodel.domain.value_objects.track_source import TrackSource
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.field_log_interval_orm import FieldLogIntervalOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.parsers.borehole.dov.dov_boring_parser import DovBoringParser
from groundmodel.infrastructure.parsers.borehole.dov.dov_interpretation_parser import (
    DovInterpretationParser,
)
from groundmodel.shared.exceptions import (
    BoreholeResetNoDovSourceError,
    NotFoundError,
    ParseError,
)


def reset_tracks_from_dov(
    borehole: BoreholeOrm, source: DovTrackSource, track_id: str | None = None
) -> BoreholeTrackResetOutcome:
    """Rewrite the borehole's DOV tracks (or one of them) from the cached DOV XML.

    Parameters
    ----------
    borehole : BoreholeOrm
        The borehole with ``observations -> layers -> admixtures`` and
        ``field_log_intervals`` loaded; mutated in place.
    source : DovTrackSource
        Where the DOV XML is read from.
    track_id : str | None
        One track to reset (observation UUID or ``"field_log:<kind>"``);
        ``None`` resets every DOV track of the borehole.

    Returns
    -------
    BoreholeTrackResetOutcome
        The rewritten tracks, how many hand edits were discarded, how many
        manual tracks were kept.

    Raises
    ------
    NotFoundError
        ``track_id`` names no track of this borehole.
    BoreholeResetNoDovSourceError
        A targeted track has no DOV XML (not cached, unparseable, a manual
        track), or the borehole has no DOV track at all. Nothing was changed.
    """
    manual_obs = [o for o in borehole.observations if _is_manual(o.source)]
    rows_by_kind = _field_log_rows_by_kind(borehole.field_log_intervals)
    manual_kinds = {
        kind for kind, rows in rows_by_kind.items() if any(_is_manual(r.source) for r in rows)
    }
    dov_kinds = set(rows_by_kind) - manual_kinds

    obs_targets, kind_targets, whole = _targets(borehole, track_id, dov_kinds, manual_kinds)

    # Phase 1 - read and parse everything; write nothing yet.
    missing: list[str] = []
    fresh_obs: dict[UUID, Observation] = {}
    for obs in obs_targets:
        parsed = _parse_interpretation(borehole.id, obs, source)
        if parsed is None:
            missing.append(str(obs.id))
        else:
            fresh_obs[obs.id] = parsed

    fresh_logs: dict[str, list[TrackInterval]] = {}
    if kind_targets or whole:
        fresh_logs = _parse_field_logs(borehole.test_id, source) or {}
    if whole:
        # Wholesale: every non-manual kind DOV published comes back.
        kind_targets = sorted((dov_kinds | set(fresh_logs)) - manual_kinds)
    missing.extend(f"field_log:{kind}" for kind in kind_targets if kind not in fresh_logs)

    if missing:
        raise BoreholeResetNoDovSourceError(
            tuple(missing),
            f"no DOV XML in the cache for {len(missing)} track(s) of borehole "
            f"{borehole.test_id!r} ({', '.join(missing)}); an XML-file import or a "
            "wiped DOV cache cannot be reset",
        )
    if not obs_targets and not kind_targets:
        raise BoreholeResetNoDovSourceError(
            (), f"borehole {borehole.test_id!r} has no DOV track and no cached DOV boring"
        )

    # Phase 2 - write.
    discarded = sum(1 for o in obs_targets if o.edited_manually_at is not None)
    discarded += sum(
        1
        for kind in kind_targets
        if any(r.edited_manually_at is not None for r in rows_by_kind.get(kind, []))
    )
    snapshots: list[BoreholeTrackSnapshot] = []
    for obs in obs_targets:
        _rewrite_observation(obs, fresh_obs[obs.id])
        snapshots.append(observation_snapshot(obs))
    for kind in kind_targets:
        for row in rows_by_kind.get(kind, []):
            borehole.field_log_intervals.remove(row)
        rows = build_field_log_rows(
            borehole.id, kind, fresh_logs[kind], source=TrackSource.DOV.value, edited_at=None
        )
        borehole.field_log_intervals.extend(rows)
        snapshots.append(field_log_snapshot(kind, rows))
    borehole.n_field_log_intervals = len(borehole.field_log_intervals)

    return BoreholeTrackResetOutcome(
        reset=tuple(snapshots),
        discarded_edits=discarded,
        kept_manual=len(manual_obs) + len(manual_kinds),
    )


def _is_manual(source: str | None) -> bool:
    """True for a hand-made track (an unset source reads as an import)."""
    return source == TrackSource.MANUAL.value


def _field_log_rows_by_kind(
    rows: list[FieldLogIntervalOrm],
) -> dict[str, list[FieldLogIntervalOrm]]:
    """Group the borehole's field-log rows by kind."""
    grouped: dict[str, list[FieldLogIntervalOrm]] = defaultdict(list)
    for row in rows:
        grouped[row.kind].append(row)
    return dict(grouped)


def _targets(
    borehole: BoreholeOrm,
    track_id: str | None,
    dov_kinds: set[str],
    manual_kinds: set[str],
) -> tuple[list[ObservationOrm], list[str], bool]:
    """Return (observation targets, field-log kind targets, whole-borehole flag)."""
    if track_id is None:
        obs = [o for o in borehole.observations if not _is_manual(o.source)]
        return obs, sorted(dov_kinds), True

    family, key = parse_track_id(track_id)
    if family == FAMILY_FIELD_LOG:
        kind = str(key)
        if kind in manual_kinds:
            raise BoreholeResetNoDovSourceError(
                (track_id,), f"track {track_id} was made by hand; it has no DOV data"
            )
        if kind not in dov_kinds:
            raise NotFoundError(f"Track {track_id} not found on borehole {borehole.id}")
        return [], [kind], False

    observation = next((o for o in borehole.observations if o.id == key), None)
    if observation is None:
        raise NotFoundError(f"Track {track_id} not found on borehole {borehole.id}")
    if _is_manual(observation.source):
        raise BoreholeResetNoDovSourceError(
            (track_id,), f"track {track_id} was made by hand; it has no DOV data"
        )
    return [observation], [], False


def _parse_interpretation(
    borehole_id: UUID, obs: ObservationOrm, source: DovTrackSource
) -> Observation | None:
    """Parse the cached interpretation XML of ``obs``; None when unusable.

    Unusable = no permkey, not cached, not parseable, an unknown stream type,
    or no layers (the import drops a layer-less interpretation too).
    """
    if not obs.dov_permkey:
        return None
    xml = source.interpretation_xml(obs.dov_permkey)
    if xml is None:
        return None
    try:
        observation_type = ObservationType(obs.observation_type)
        result = DovInterpretationParser().parse(
            xml,
            borehole_id=borehole_id,
            observation_type=observation_type,
            name=obs.dov_permkey,
        )
    except (ParseError, ValueError):
        return None
    return result.observation if result.observation.layers else None


def _parse_field_logs(
    boornummer: str, source: DovTrackSource
) -> dict[str, list[TrackInterval]] | None:
    """Parse the cached boring XML's field log into intervals per kind; None when unusable."""
    if not boornummer:
        return None
    xml = source.boring_xml(boornummer)
    if xml is None:
        return None
    try:
        result = DovBoringParser().parse(xml, name=boornummer)
    except ParseError:
        return None
    grouped: dict[str, list[TrackInterval]] = defaultdict(list)
    for interval in sorted(result.field_log, key=lambda f: (f.top_m, f.base_m)):
        grouped[interval.kind.value].append(
            TrackInterval(top_m=interval.top_m, base_m=interval.base_m, value=interval.value)
        )
    return dict(grouped)


def _rewrite_observation(obs: ObservationOrm, fresh: Observation) -> None:
    """Put DOV's layers and header back on ``obs`` (same row, same id)."""
    ordered = sorted(fresh.layers, key=lambda layer: (layer.layer_index, layer.top_m))
    # delete-orphan on ``layers`` removes the edited rows (and their admixtures).
    obs.layers = build_observation_layers(
        TrackInterval(
            top_m=layer.top_m,
            base_m=layer.base_m,
            description=layer.description,
            color=layer.color,
            main_soil_codes=tuple(layer.main_soil_codes),
            admixtures=tuple(layer.admixtures),
        )
        for layer in ordered
    )
    obs.author = fresh.author
    obs.observation_date = fresh.observation_date
    obs.reliability = fresh.reliability
    obs.score_category = fresh.score_category
    obs.drill_method_score = fresh.drill_method_score
    obs.edited_manually_at = None
