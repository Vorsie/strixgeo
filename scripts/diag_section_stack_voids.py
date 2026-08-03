"""Sweep every captured build payload for INTERIOR VOIDS in a section stack.

Debt #268 asks how often the two-section blend has to represent "unknown": a
void inside a single section's vertical stack is the input that makes
``_blend_stacks`` / ``_layout`` collapse the column. This script measures it.

Method — the one #268's "How big it is today" quotes: slice every gap of every
section at 21 evenly spaced fractions, read the stack the labeller itself reads
(:func:`label_voxels._section_stack_at`), and report any elevation range between
two consecutive entries that no entry covers. A separation below one snap cell
is the 2-D engine's millimetre rounding of a flush contact, not an unknown
interval, so it is counted separately (``sub_mm``) and NOT as a void — the same
threshold :func:`label_voxels._column_labels` uses to open its void slot.

Run (read-only; touches no database):

    uv run python scripts/diag_section_stack_voids.py
    uv run python scripts/diag_section_stack_voids.py scripts/other_payload.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from groundmodel.domain.services.voxel_litho.label_voxels import _section_stack_at
from groundmodel.domain.services.voxel_litho.snap_grid import SNAP_GRID_M
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

# The payloads the campaign captured from the owner's real model. Both axes are
# swept, because the litho payload alone was what #268's first measurement saw.
DEFAULT_PAYLOADS = (
    "scripts/throwaway_v2_voxel_payload.json",
    "scripts/throwaway_geotech_voxel_payload.json",
)

FRACTIONS_PER_GAP = 21


def _sections(payload: dict) -> list[SectionPartitionInput]:
    """Rebuild the value objects the labeller consumes from a captured payload."""
    out: list[SectionPartitionInput] = []
    for s in payload["sections"]:
        columns = tuple(
            SectionColumnInput(
                c["investigation_id"],
                along_m=c["along_m"],
                world_x=c["world_x"],
                world_y=c["world_y"],
            )
            for c in s["columns"]
        )
        regions = tuple(
            RegionInput(
                r["formation_id"],
                r["body_id"],
                tuple((float(p[0]), float(p[1])) for p in r["polygon"]),
                r["gap_index"],
                r.get("kind"),
                r.get("overlay_tier"),
            )
            for r in s["regions"]
        )
        out.append(
            SectionPartitionInput(
                start_x=s["start_x"],
                start_y=s["start_y"],
                end_x=s["end_x"],
                end_y=s["end_y"],
                columns=columns,
                regions=regions,
            )
        )
    return out


def sweep(path: str) -> None:
    """Print the void inventory of one captured payload."""
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    sections = _sections(payload)
    stacks = 0
    voids: list[tuple[int, int, float, float]] = []  # (section, gap, fraction, height)
    sub_mm = 0
    for si, section in enumerate(sections):
        for gap in range(max(len(section.columns) - 1, 0)):
            for step in range(FRACTIONS_PER_GAP):
                fraction = step / (FRACTIONS_PER_GAP - 1)
                stack = _section_stack_at(section, gap, fraction)
                if not stack:
                    continue
                stacks += 1
                for upper, lower in zip(stack, stack[1:]):
                    height = upper.base_elev - lower.top_elev
                    if height > SNAP_GRID_M:
                        voids.append((si, gap, fraction, height))
                    elif height > 0.0:
                        sub_mm += 1
    print(f"\n{path}")
    print(f"  sections           {len(sections)}")
    print(f"  non-empty stacks   {stacks}")
    print(f"  interior voids     {len(voids)}")
    print(f"  sub-mm separations {sub_mm}  (snap rounding — not voids)")
    for si, gap, fraction, height in sorted(voids, key=lambda v: -v[3])[:10]:
        print(f"    section {si:>2} gap {gap:>2} fraction {fraction:.2f}  {height:.3f} m")


if __name__ == "__main__":
    for target in sys.argv[1:] or list(DEFAULT_PAYLOADS):
        sweep(target)
