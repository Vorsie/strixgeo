"""READ-ONLY: open up the blend at ONE map-plane point and show its arithmetic.

``diag_blend_between_columns.py`` shows THAT the model invents lithology between
two columns. This script shows WHY, at a single point, by re-running the
PRODUCTION column-stack path (``_column_stack_geo`` — the band-scoped one
``label_voxels`` actually calls, not the un-banded ``_stack_at``) and printing
every intermediate:

* the sections ranked by the perpendicular distance the blend uses (to the
  column-WORLD fence, not the smoothed start→end line),
* per geological band: which sections REACH it, their weights, their clipped
  stacks, and which bodies matched across the two nearest,
* the resulting column stack, and
* the PERSISTED model stack at the same point.

The last two are the point. **The harness proves itself against the persisted
build before anything is concluded from it** — if the reconstructed stack does
not reproduce the persisted one to within a voxel, stop and fix the harness.

Body ids are printed at 13 characters, not 8: these are UUIDv7s minted in the
same millisecond, so several distinct bodies share the first 8 characters and an
8-char label makes unrelated bodies look identical (docs/lessons-learned.md —
never trust a truncated UUID).

Nothing is written. Reads only, behind the usual dev-DB guard.

Usage
-----
    uv run python scripts/diag_blend_mechanism_at_point.py \\
        --between GEO-23/125-S9 GEO-23/125-S8 --fraction 0.4
"""

from __future__ import annotations

import argparse
import asyncio
import math
import sys
from collections import defaultdict
from pathlib import Path
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np  # noqa: E402
from sqlalchemy import select  # noqa: E402

from groundmodel.application.build_voxel_litho_model import (  # noqa: E402
    _investigation_columns_from_picks,
)
from groundmodel.application.load_geo_surfaces import load_geo_surfaces  # noqa: E402
from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (  # noqa: E402
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.geo_bands import (  # noqa: E402
    band_extent_from_elevs,
    section_reaches_band_from_elevs,
)
from groundmodel.domain.services.voxel_litho.label_voxels import (  # noqa: E402
    _clip_stack_to_band,
    _column_stack_geo,
    _project_to_section_fence,
    _section_stack_at,
    _th,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm  # noqa: E402
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm  # noqa: E402
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.repositories.project_repository import (  # noqa: E402
    ProjectRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.diag_voxel_label_columns import _load_payload  # noqa: E402
from scripts.eval_strat_fidelity import (  # noqa: E402
    _compute_model_stack,
    _confirm_db_target,
    _load_formation_names,
    _load_solids,
)

_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")
_DEFAULT_PAYLOAD = _REPO_ROOT / "scripts" / "throwaway_v2_voxel_payload.json"

#: Body ids are same-millisecond UUIDv7s — 8 chars collide, 13 disambiguates.
_ID_CHARS = 13


def _fmt(entries: list, names: dict[str, str], indent: str = "      ") -> str:
    """Render a stack as one aligned line per interval."""
    if not entries:
        return f"{indent}(empty)"
    return "\n".join(
        f"{indent}{names.get(e.formation_id, e.formation_id[:6]):<6} "
        f"{e.top_elev:>8.3f} / {e.base_elev:<8.3f}  th={_th(e):>6.3f}  "
        f"body={(e.body_id or '-')[:_ID_CHARS]}"
        for e in entries
    )


async def main() -> None:
    """Print the full blend arithmetic at one point between two investigations."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument("--between", nargs=2, metavar=("FROM", "TO"), required=True)
    ap.add_argument(
        "--fraction", type=float, default=0.5, help="position along the leg, 0 = FROM, 1 = TO"
    )
    ap.add_argument("--payload", type=Path, default=_DEFAULT_PAYLOAD)
    args = ap.parse_args()

    print("\n=== BLEND MECHANISM AT ONE POINT (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        model = await session.get(GeologicalModelOrm, args.model_id)
        if model is None:
            raise SystemExit(f"ABORT: model {args.model_id} not found.")
        project_id = model.app_project_id

        pos: dict[str, tuple[float, float]] = {}
        for r in (
            await session.execute(
                select(CptOrm.name, CptOrm.location_x, CptOrm.location_y).where(
                    CptOrm.app_project_id == project_id
                )
            )
        ).all():
            pos[r.name] = (float(r.location_x), float(r.location_y))
        for r in (
            await session.execute(
                select(BoreholeOrm.name, BoreholeOrm.location_x, BoreholeOrm.location_y).where(
                    BoreholeOrm.app_project_id == project_id
                )
            )
        ).all():
            pos[r.name] = (float(r.location_x), float(r.location_y))

        from_name, to_name = args.between
        for name in (from_name, to_name):
            if name not in pos:
                raise SystemExit(f"ABORT: investigation {name!r} not found.")

        names = await _load_formation_names(session, args.model_id)
        inv_names: dict[str, str] = {}
        for r in (
            await session.execute(
                select(CptOrm.id, CptOrm.name).where(CptOrm.app_project_id == project_id)
            )
        ).all():
            inv_names[str(r.id)] = r.name
        for r in (
            await session.execute(
                select(BoreholeOrm.id, BoreholeOrm.name).where(
                    BoreholeOrm.app_project_id == project_id
                )
            )
        ).all():
            inv_names[str(r.id)] = r.name
        solids = await _load_solids(session, args.model_id)

        # The same inputs BuildVoxelLithoModel reads — geo surfaces, snap
        # tolerance and grid spacings all change the band arithmetic.
        picks = await LithoLayerRepository(session).load_body_picks(args.model_id)
        geo_surfaces: tuple = ()
        if model.parent_model_id is not None:
            geo_surfaces = await load_geo_surfaces(session, model.parent_model_id)
        project = await ProjectRepository(session).get_by_id(project_id)
        seg = (project.view_state or {}).get("litho_segmenter") or {}
        snap_tol = float(seg.get("litho_snap_tolerance_m") or 0.20)

    ax, ay = pos[from_name]
    bx, by = pos[to_name]
    x = ax + (bx - ax) * args.fraction
    y = ay + (by - ay) * args.fraction
    leg = math.hypot(bx - ax, by - ay)
    print(
        f"  point at fraction {args.fraction:.2f} of the {leg:.2f} m "
        f"{from_name} -> {to_name} leg: ({x:.2f}, {y:.2f})"
    )
    print(f"  geo surfaces: {len(geo_surfaces)}   snap tolerance: {snap_tol} m\n")

    sections, _payload_h, payload_v = _load_payload(args.payload)
    vertical = float(seg.get("voxel_vertical_spacing_m") or payload_v or 0.25)
    inv_columns = _investigation_columns_from_picks(picks)
    positions = tuple((c.investigation_id, c.world_x, c.world_y) for c in inv_columns)
    domain = build_domain_from_sections(sections, investigation_positions=positions)

    # gz_min / gz_max exactly as label_voxels frames them: the elevation range of
    # the section region polygons, then the same np.arange grid — so the band
    # arithmetic below runs over the production column range, not an invented one.
    zmin, zmax = math.inf, -math.inf
    for sec in sections:
        for region in sec.regions:
            for _frac, elev in region.polygon:
                zmin = min(zmin, elev)
                zmax = max(zmax, elev)
    gz = np.arange(zmin, zmax + vertical / 2.0, vertical)
    gz_min, gz_max = float(gz[0]), float(gz[-1])
    print(
        f"  partition z: {zmin:.3f} .. {zmax:.3f}   grid z: {gz_min:.3f} .. {gz_max:.3f}"
        f"   vertical spacing {vertical} m   in footprint={domain.contains(x, y)}\n"
    )

    # Section ranking — the ordering the blend uses.
    projs = [(s, *_project_to_section_fence(s, x, y)) for s in sections]
    projs.sort(key=lambda p: p[3])

    def _col_desc(col: object) -> str:
        """Name a payload column and how far it sits from the query point."""
        if col is None:
            return "-"
        name = inv_names.get(col.investigation_id, col.investigation_id[:8])  # type: ignore[attr-defined]
        dist = math.hypot(col.world_x - x, col.world_y - y)  # type: ignore[attr-defined]
        return f"{name} ({dist:.1f} m)"

    # WHICH GAP a section contributes is the load-bearing detail: the projection
    # is onto the column-WORLD fence, so on a section whose columns zigzag the
    # nearest gap segment can be between two columns nowhere near the query
    # point — and then the blend imports THAT gap's lithology.
    print("  sections ranked by fence distance, with the gap each one contributes:")
    for s, gap, frac, dist, _px, _py in projs[:5]:
        left = s.columns[gap] if gap < len(s.columns) else None
        right = s.columns[gap + 1] if gap + 1 < len(s.columns) else None
        print(
            f"      {dist:>8.2f} m  {len(s.columns):>3} columns  gap={gap:<3} frac={frac:<6.3f}"
            f"  between {_col_desc(left)} and {_col_desc(right)}"
        )
    print()

    # Per-band detail, mirroring _stack_at_band's reach filter + blend.
    surf_elevs = tuple(sb.evaluate(x, y) for sb in geo_surfaces)
    n_bands = len(surf_elevs) + 1
    for band in range(n_bands):
        band_base, band_top = band_extent_from_elevs(surf_elevs, band)
        reaching = []
        for s, gap, frac, dist, px, py in projs:
            full = _section_stack_at(s, gap, frac)
            reach = tuple((e.body_id or "", e.formation_id, e.top_elev, e.base_elev) for e in full)
            if not section_reaches_band_from_elevs(reach, surf_elevs, band):
                continue
            clipped = _clip_stack_to_band(full, band_base, band_top, snap_tol)
            if clipped:
                reaching.append((dist, px, py, clipped, len(s.columns)))
        bb = "open" if band_base is None else f"{band_base:.3f}"
        bt = "open" if band_top is None else f"{band_top:.3f}"
        print(f"  --- BAND {band}  extent {bt} .. {bb}   reaching sections: {len(reaching)}")
        if len(reaching) < 2:
            if reaching:
                print(f"      only section at {reaching[0][0]:.2f} m ({reaching[0][4]} columns)")
            print()
            continue

        d1, _px1, _py1, c1, n1 = reaching[0]
        d2, _px2, _py2, c2, n2 = reaching[1]
        w1 = 0.5 if (d1 + d2) < 1e-9 else d2 / (d1 + d2)
        print(f"      nearest {d1:.2f} m ({n1} columns) weight {w1:.3f}")
        print(_fmt(c1, names, "          "))
        print(f"      second  {d2:.2f} m ({n2} columns) weight {1 - w1:.3f}")
        print(_fmt(c2, names, "          "))

        g1: dict[str, list] = defaultdict(list)
        g2: dict[str, list] = defaultdict(list)
        for e in c1:
            if e.body_id is not None:
                g1[e.body_id].append(e)
        for e in c2:
            if e.body_id is not None:
                g2[e.body_id].append(e)
        matched = set(g1) & set(g2)
        pinch1 = max(0.0, 2 * w1 - 1)
        pinch2 = max(0.0, 2 * (1 - w1) - 1)
        print(
            f"      matched bodies: {len(matched)}   "
            f"unmatched pinch factor: nearest {pinch1:.3f} / second {pinch2:.3f}"
        )
        for body in sorted(matched):
            label = names.get(g1[body][0].formation_id, "?")
            print(f"          MATCHED {body[:_ID_CHARS]} ({label}) blends thickness")
        for body in sorted(set(g1) - matched):
            label = names.get(g1[body][0].formation_id, "?")
            th = sum(_th(e) for e in g1[body])
            print(
                f"          one-sided(near) {body[:_ID_CHARS]} ({label}) "
                f"{th:.3f} m -> {th * pinch1:.3f} m"
            )
        for body in sorted(set(g2) - matched):
            label = names.get(g2[body][0].formation_id, "?")
            th = sum(_th(e) for e in g2[body])
            print(
                f"          one-sided(far)  {body[:_ID_CHARS]} ({label}) "
                f"{th:.3f} m -> {th * pinch2:.3f} m"
            )
        print()

    # The production column stack, and the persisted arm to check it against.
    rebuilt = _column_stack_geo(sections, x, y, gz_min, gz_max, geo_surfaces, snap_tol)
    print("  REBUILT column stack (_column_stack_geo — the production path):")
    print(_fmt(rebuilt, names))

    active = [(b, f, v, t) for b, f, v, t, flagged, _s in solids if v and t and not flagged]
    persisted = _compute_model_stack(x, y, active)
    print("\n  PERSISTED model stack at the same point:")
    for fid, base, top in persisted:
        print(
            f"      {names.get(fid, fid[:6]):<6} {top:>8.3f} / {base:<8.3f}  th={top - base:>6.3f}"
        )

    # -----------------------------------------------------------------------
    # Harness self-check.
    #
    # The offline stack is compared to the persisted one the way the voxel grid
    # actually samples it: intervals thinner than one voxel cannot be
    # represented at all, and consecutive same-formation intervals collapse
    # (``_compute_model_stack`` already collapses the persisted side). Comparing
    # the RAW offline stack would report a false mismatch purely from sub-voxel
    # slivers, which is exactly the kind of misleading metric this campaign is
    # under orders not to produce.
    # -----------------------------------------------------------------------
    def _sample(seq: list[tuple[str, float, float]]) -> list[str]:
        """Label every ``gz`` node from the stack, then collapse equal runs.

        This is the labeller's own test — an interval shows up in the model iff a
        grid node falls inside it — rather than a thickness threshold. A 0.236 m
        interval on a 0.25 m grid usually DOES catch a node, so a
        "thinner than one voxel" filter would drop layers the build kept and
        report a false mismatch.
        """
        out: list[str] = []
        for node in gz:
            hit = next((lab for lab, top, base in seq if base - 1e-9 <= node < top - 1e-9), None)
            if hit is None:
                continue
            if not out or out[-1] != hit:
                out.append(hit)
        return out

    rebuilt_seq = _sample(
        [(names.get(e.formation_id, e.formation_id[:6]), e.top_elev, e.base_elev) for e in rebuilt]
    )
    persisted_seq = _sample([(names.get(f, f[:6]), t, b) for f, b, t in persisted])
    matches = rebuilt_seq == persisted_seq
    verdict = "REPRODUCES" if matches else "DOES NOT REPRODUCE"
    print(f"\n  HARNESS SELF-CHECK ({vertical} m voxel): offline {verdict} the persisted stack.")
    print(f"      offline:   {' '.join(rebuilt_seq)}")
    print(f"      persisted: {' '.join(persisted_seq)}")
    if not matches:
        print("      -> STOP. Do not conclude anything from the arithmetic above.")
    print()


if __name__ == "__main__":
    asyncio.run(main())
