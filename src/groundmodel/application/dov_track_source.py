"""Port: where a Reset to DOV reads the DOV XML of a borehole's tracks."""

from __future__ import annotations

from typing import Protocol


class DovTrackSource(Protocol):
    """The DOV XML behind a borehole's imported tracks (owner 2026-09-30).

    The shipped implementation reads the on-disk cache the DOV bbox import
    fills (``CachedDovTrackSource``); tests pass a fake. Both lookups answer
    ``None`` when nothing is known - the reset turns that into a refusal, never
    a network call.
    """

    def boring_xml(self, boornummer: str) -> bytes | None:
        """Return the boring XML whose ``<identificatie>`` is ``boornummer``, or None."""
        ...

    def interpretation_xml(self, permkey: str) -> bytes | None:
        """Return the interpretation XML of ``permkey``, or None."""
        ...
