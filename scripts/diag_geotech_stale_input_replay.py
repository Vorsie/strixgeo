"""READ-ONLY: does TODAY's segmenter reproduce the STORED bands from the OLD windows?

The stale-input diagnosis of the ``GEO-23/125-S17`` / ``GEO-23/125-S9`` band
divergence says: the code did not change, the litho stack under those two
columns did.  That claim makes a hard, falsifiable prediction — if the stored
bands really are today's segmenter run against an earlier litho stack, then
feeding today's segmenter the segment windows the stored bands *imply* must
reproduce the stored bands exactly, class for class and boundary for boundary.

This script runs that replay.  For each CPT it groups the stored geotech bands
by their formation's ``(source_litho_formation_id, source_geo_formation_id)``
pair — the pair identifies the geo-bounded segment the band came out of — takes
each group's ``[min top, max base]`` as the implied window, and calls
:func:`suggest_geotech_subdivision` on that window with the project's live knobs
and the CPT's live qc series.  A match means the stored bands are explained by
the window alone; a mismatch means something other than the window moved.

The current windows are printed alongside so the two can be compared directly.

Read-only guarantees
--------------------
* The dev-DB guard from ``eval_strat_fidelity`` runs first.
* Only SELECTs are issued; no use case ``execute()`` is called.

Usage
-----
    uv run python scripts/diag_geotech_stale_input_replay.py
    uv run python scripts/diag_geotech_stale_input_replay.py --name S9
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Any
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402

from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies  # noqa: E402
from groundmodel.domain.services.geotech_subdivision import (  # noqa: E402
    suggest_geotech_subdivision,
)
from groundmodel.domain.services.litho_geo_bounding import (  # noqa: E402
    divide_picks_by_geology,
    mark_and_truncate_shallow_tests,
)
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm  # noqa: E402
from groundmodel.infrastructure.db.models.geological_formation_orm import (  # noqa: E402
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm  # noqa: E402
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402

#: Columns whose stored bands disagree with a fresh rebuild.
_DEFAULT_NAMES = ("GEO-23/125-S17", "GEO-23/125-S9")


def _mm(x: float) -> int:
    """Millimetre key for a depth — the grain the DB distinguishes intervals at."""
    return int(round(x * 1000.0))


async def _geotech_model(session: Any) -> GeologicalModelOrm:
    """Return the project's single geotechnical model, or abort.

    Parameters
    ----------
    session : AsyncSession
        Read session on the dev database.

    Returns
    -------
    GeologicalModelOrm
        The geotechnical model.

    Raises
    ------
    SystemExit
        When there is not exactly one geotechnical model.
    """
    models = (
        (
            await session.execute(
                select(GeologicalModelOrm).where(GeologicalModelOrm.kind == "geotechnical")
            )
        )
        .scalars()
        .all()
    )
    if len(models) != 1:
        raise SystemExit(f"ABORT: expected exactly one geotechnical model, found {len(models)}.")
    return models[0]


async def main() -> None:
    """Replay today's segmenter on the windows the stored bands imply."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", action="append", default=None, help="CPT name substring.")
    args = parser.parse_args()

    print("\n=== STALE-INPUT REPLAY: today's code x the OLD windows (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        geotech = await _geotech_model(session)
        litho_model_id = geotech.parent_model_id
        if litho_model_id is None:
            raise SystemExit("ABORT: the geotech model has no lithostratigraphic parent.")
        litho_model = await session.get(GeologicalModelOrm, litho_model_id)
        if litho_model is None:
            raise SystemExit(f"ABORT: litho model {litho_model_id} not found.")

        use_case = SubdivideAllBodies(session)
        snap_tol = await use_case._read_geotech_snap_tolerance_m(geotech.app_project_id)
        min_thickness_m = await use_case._read_min_thickness_m(geotech.app_project_id)
        gradient_snap, gradient_snap_window_m = await use_case._read_gradient_snap(
            geotech.app_project_id
        )
        print(
            f"  knobs: snap_tol={snap_tol} min_thickness_m={min_thickness_m} "
            f"gradient_snap={gradient_snap} window_m={gradient_snap_window_m}\n"
        )

        # Current windows, for the side-by-side.
        picks = await use_case._litho_repo.load_body_picks(litho_model_id)
        geo_surfaces = await use_case._load_geo_surfaces_with_formation(litho_model.parent_model_id)
        shallow = mark_and_truncate_shallow_tests(
            picks, use_case._make_lowest_boundary_sampler(geo_surfaces)
        )
        divided = divide_picks_by_geology(
            shallow.picks, use_case._make_boundary_sampler(geo_surfaces), snap_tol
        )

        # Stored bands + the source pair that identifies their segment.
        rows = (
            await session.execute(
                select(
                    LithoLayerOrm.cpt_id,
                    LithoLayerOrm.depth_top_m,
                    LithoLayerOrm.depth_base_m,
                    GeologicalFormationOrm.nad_class,
                    GeologicalFormationOrm.source_litho_formation_id,
                    GeologicalFormationOrm.source_geo_formation_id,
                )
                .join(
                    GeologicalFormationOrm,
                    LithoLayerOrm.formation_id == GeologicalFormationOrm.id,
                )
                .where(
                    LithoLayerOrm.model_id == geotech.id,
                    LithoLayerOrm.cpt_id.is_not(None),
                )
            )
        ).all()

        wanted = args.name or list(_DEFAULT_NAMES)
        cpt_rows = (await session.execute(select(CptOrm))).scalars().all()
        name_by_id = {str(c.id): c.name for c in cpt_rows}
        targets = sorted(
            {str(r.cpt_id) for r in rows if any(w in name_by_id.get(str(r.cpt_id), "") for w in w2)}
            if (w2 := wanted)
            else set(),
            key=lambda i: name_by_id.get(i, ""),
        )
        if not targets:
            raise SystemExit(f"ABORT: no CPT matched {wanted!r}.")

        cpt_series = await use_case._load_cpt_series({UUID(i) for i in targets})

        for cid in targets:
            name = name_by_id.get(cid, cid)
            print(f"--- {name} ---")
            series = cpt_series.get(UUID(cid))
            if series is None:
                print("  no qc series — skipped\n")
                continue

            # Implied OLD windows: one per (source litho formation, source geo formation).
            by_pair: dict[tuple[Any, Any], list[Any]] = {}
            for r in rows:
                if str(r.cpt_id) != cid:
                    continue
                by_pair.setdefault(
                    (r.source_litho_formation_id, r.source_geo_formation_id), []
                ).append(r)

            # One formation pair can occur at several disjoint depths on the same
            # column (a lithology that recurs down the hole), and each occurrence
            # was its own geo-bounded segment.  Split every pair group into
            # contiguous runs — a gap wider than a millimetre between one band's
            # base and the next band's top starts a new window — or the replay
            # would be handed a window that never existed.
            windows: list[tuple[float, float, tuple[Any, Any], list[Any]]] = []
            for pair, bands in by_pair.items():
                run: list[Any] = []
                for b in sorted(bands, key=lambda x: x.depth_top_m):
                    if run and _mm(b.depth_top_m) - _mm(run[-1].depth_base_m) > 1:
                        windows.append((run[0].depth_top_m, run[-1].depth_base_m, pair, run))
                        run = []
                    run.append(b)
                if run:
                    windows.append((run[0].depth_top_m, run[-1].depth_base_m, pair, run))
            windows.sort(key=lambda w: w[0])
            current = [
                (s.top_depth_m, s.base_depth_m)
                for s in sorted(
                    (s for s in divided if s.investigation_id == cid), key=lambda s: s.top_depth_m
                )
            ]
            print(
                "  implied OLD windows: " + " | ".join(f"{t:.6f}-{b:.6f}" for t, b, _, _ in windows)
            )
            print("  current  windows   : " + " | ".join(f"{t:.6f}-{b:.6f}" for t, b in current))

            all_match = True
            for top_m, base_m, pair, run in windows:
                litho_fid, _geo_fid = pair
                soil = await use_case._formation_soil_code(litho_fid) if litho_fid else None
                admixtures = await use_case._formation_admixtures(litho_fid) if litho_fid else ()
                stored_here = sorted(
                    ((b.depth_top_m, b.depth_base_m, b.nad_class) for b in run),
                    key=lambda t: t[0],
                )
                splits = suggest_geotech_subdivision(
                    soil=soil or "",
                    admixtures=admixtures,
                    depth_m=series.depths_m,
                    qc_mpa=series.qc_mpa,
                    segment_top_m=top_m,
                    segment_base_m=base_m,
                    min_thickness_m=min_thickness_m,
                    gradient_snap=gradient_snap,
                    gradient_snap_window_m=gradient_snap_window_m,
                )
                replay = [(s.depth_top_m, s.depth_base_m, s.nad_class) for s in splits]
                same = [(_mm(a), _mm(b), c) for a, b, c in replay] == [
                    (_mm(a), _mm(b), c) for a, b, c in stored_here
                ]
                all_match &= same
                mark = "OK " if same else "!! "
                print(f"  {mark}window {top_m:.6f}-{base_m:.6f} soil={soil}")
                print(
                    "      stored: "
                    + " | ".join(f"{a:.3f}-{b:.3f} nad={c}" for a, b, c in stored_here)
                )
                print(
                    "      replay: " + " | ".join(f"{a:.3f}-{b:.3f} nad={c}" for a, b, c in replay)
                )
            print(f"  ALL WINDOWS REPRODUCE THE STORED BANDS: {all_match}\n")


if __name__ == "__main__":
    asyncio.run(main())
