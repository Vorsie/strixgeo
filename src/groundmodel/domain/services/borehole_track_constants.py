"""Constants for hand-edited borehole tracks (owner 2026-09-29)."""

from __future__ import annotations

from typing import Final

from groundmodel.domain.value_objects.field_log_kind import FieldLogKind
from groundmodel.domain.value_objects.observation_type import ObservationType

# Kinds whose rows carry a DOV hoofdnaam main soil code (+ admixtures). The
# two DOV "coded" streams; every other observation kind is text (a free
# description or a stratigraphy unit code in ``description``).
CODED_TRACK_KINDS: Final[frozenset[str]] = frozenset(
    {ObservationType.CODED_LITHOLOGY.value, ObservationType.GEOTECHNICAL_CODING.value}
)

# Observation-family kinds (one ``observation`` row per track, several per
# kind allowed on one borehole).
OBSERVATION_TRACK_KINDS: Final[frozenset[str]] = frozenset(t.value for t in ObservationType)

# Field-log-family kinds (rows of ``field_log_interval``; ONE track per kind
# per borehole, because the table has no track grouping of its own).
FIELD_LOG_TRACK_KINDS: Final[frozenset[str]] = frozenset(k.value for k in FieldLogKind)

# Field-log tracks have no row of their own, so their API id is synthetic:
# ``"field_log:color"``. Observation tracks use the observation's UUID.
FIELD_LOG_TRACK_ID_PREFIX: Final[str] = "field_log:"

# Largest track the API accepts. DOV's densest interpretations carry a few
# hundred layers; the cap stops a malformed payload from writing millions of
# rows (the same defensive role as the bundle's _MAX_OBSERVATION_LAYERS).
MAX_TRACK_INTERVALS: Final[int] = 5000

# Admixtures per interval, same defensive role (the request schema's cap on
# ANY kind; the coded-track rule below is the tighter, owner-set one).
MAX_TRACK_INTERVAL_ADMIXTURES: Final[int] = 20

# Admixtures per interval of a CODED track (coded lithology / geotechnical
# coding). Why 3: DOV's own practice codes at most a handful of bijmengingen
# per layer, and the owner ruled it 2026-09-30 ("i want max 3 admixtures in
# coded lithology"). The editor never offers a fourth row; the validator
# refuses one (``too_many_admixtures``). DOV data written by the import or a
# Reset to DOV is not judged by this rule - it is what DOV sent.
MAX_ADMIXTURES_PER_INTERVAL: Final[int] = 3

# Main soil codes per interval: DOV's <hoofdnaam> repeats for EQUALLY
# dominant soils, in practice one or two.
MAX_TRACK_MAIN_SOIL_CODES: Final[int] = 4
