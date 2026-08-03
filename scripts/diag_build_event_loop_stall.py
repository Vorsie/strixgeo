"""Measure whether the event loop survives a 3-D build's two CPU phases.

The desktop app runs exactly ONE uvicorn worker. A synchronous CPU phase inside
an ``async def`` route holds the loop for its whole duration, so every other
request the engineer makes during a build queues behind it and the app looks
hung. ``BuildVoxelLithoModel`` therefore runs phases 2 and 3 through
``asyncio.to_thread``; this script is the reproducer for the numbers that claim
justifies, recorded in ``docs/benchmarks-journal.md`` → "Build responsiveness".

Method: run the two phases both ways — inline (as the route used to) and off the
loop — with a 10 ms heartbeat task ticking alongside. A dead loop cannot tick,
so the tick count and the longest gap between ticks measure exactly what the
engineer feels. Only the two pure phases run; no database, nothing persisted.

Run (read-only, offline):

    uv run python scripts/diag_build_event_loop_stall.py
    uv run python scripts/diag_build_event_loop_stall.py --payload scripts/other.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from pathlib import Path

from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.extract_body_solids import extract_body_solids
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

DEFAULT_PAYLOAD = "scripts/throwaway_v2_voxel_payload.json"
HEARTBEAT_S = 0.010


def _sections(payload: dict) -> list[SectionPartitionInput]:
    """Rebuild the labeller's value objects from a captured build payload."""
    out: list[SectionPartitionInput] = []
    for s in payload["sections"]:
        out.append(
            SectionPartitionInput(
                start_x=s["start_x"],
                start_y=s["start_y"],
                end_x=s["end_x"],
                end_y=s["end_y"],
                columns=tuple(
                    SectionColumnInput(
                        c["investigation_id"],
                        along_m=c["along_m"],
                        world_x=c["world_x"],
                        world_y=c["world_y"],
                    )
                    for c in s["columns"]
                ),
                regions=tuple(
                    RegionInput(
                        r["formation_id"],
                        r["body_id"],
                        tuple((float(p[0]), float(p[1])) for p in r["polygon"]),
                        r["gap_index"],
                        r.get("kind"),
                        r.get("overlay_tier"),
                    )
                    for r in s["regions"]
                ),
            )
        )
    return out


async def _heartbeat(stop: asyncio.Event, ticks: list[float]) -> None:
    """Tick every ``HEARTBEAT_S`` until stopped, recording each tick's timestamp."""
    while not stop.is_set():
        await asyncio.sleep(HEARTBEAT_S)
        ticks.append(time.perf_counter())


async def _run(payload: dict, *, off_the_loop: bool) -> tuple[float, float, list[float]]:
    """Run both phases one way; return ``(label_s, extract_s, heartbeat ticks)``."""
    sections = _sections(payload)
    domain = build_domain_from_sections(sections)
    h = float(payload["horizontal_spacing_m"])
    v = float(payload["vertical_spacing_m"])
    stop = asyncio.Event()
    ticks: list[float] = []
    beat = asyncio.create_task(_heartbeat(stop, ticks))
    await asyncio.sleep(0)  # let the heartbeat take its first turn

    t0 = time.perf_counter()
    if off_the_loop:
        grid = await asyncio.to_thread(label_voxels, domain, h, sections, vertical_spacing_m=v)
    else:
        grid = label_voxels(domain, h, sections, vertical_spacing_m=v)
    t1 = time.perf_counter()
    if off_the_loop:
        await asyncio.to_thread(extract_body_solids, grid)
    else:
        extract_body_solids(grid)
    t2 = time.perf_counter()

    stop.set()
    await beat
    return t1 - t0, t2 - t1, ticks


def _report(name: str, label_s: float, extract_s: float, ticks: list[float]) -> None:
    """Print one run's wall clock, tick count and worst inter-tick stall."""
    total = label_s + extract_s
    gaps = [b - a for a, b in zip(ticks, ticks[1:])]
    worst = max(gaps) if gaps else total
    print(
        f"  {name:<14} label {label_s:6.1f} s  extract {extract_s:6.1f} s  "
        f"total {total:6.1f} s  ticks {len(ticks):>5}  worst stall {worst * 1000:8.1f} ms"
    )


async def main() -> None:
    """Measure the loop both ways on one captured payload."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--payload", default=DEFAULT_PAYLOAD)
    args = ap.parse_args()
    payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
    print(
        f"\n{args.payload}: {len(payload['sections'])} sections, "
        f"h={payload['horizontal_spacing_m']} m, v={payload['vertical_spacing_m']} m, "
        f"heartbeat {HEARTBEAT_S * 1000:.0f} ms\n"
    )
    # Off-the-loop first so the Numba mesh kernel is already JIT-compiled for the
    # inline run — otherwise the compile time would be charged to the wrong row.
    _report("to_thread", *await _run(payload, off_the_loop=True))
    _report("inline", *await _run(payload, off_the_loop=False))


if __name__ == "__main__":
    asyncio.run(main())
