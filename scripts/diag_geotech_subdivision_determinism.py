"""READ-ONLY: does the PURE geotech segmenter reproduce the STORED bands?

Two CPT columns of the owner's project (``GEO-23/125-S17`` and ``GEO-23/125-S9``)
rebuild differently on a re-run of ``SubdivideAllBodies`` while 42 others rebuild
byte-identically.  Three explanations are in play:

A. the subdivision is not deterministic (ordering / float accumulation /
   unstable grouping),
B. the measurement's ``.strix`` bundle round-trip lost an input the segmenter
   reads, so the copy legitimately rebuilt differently,
C. the stored bands were never produced by today's code path.

This script separates them without writing anything.  It reproduces, from the
DEV database, exactly the call ``SubdivideAllBodies`` makes into the pure
:func:`suggest_geotech_subdivision` — the same litho picks, the same geo-bounded
segment window, the same soil + admixtures, the same view-state knobs — and
compares the result band-for-band against what is stored.  It also runs the pure
function twice on identical inputs and compares the outputs bit-exactly, which
settles A on its own.

Read-only guarantees
--------------------
* The dev-DB guard from ``eval_strat_fidelity`` runs first.
* Only SELECTs are issued.  The use case's own read helpers are reused
  (``_load_geo_surfaces_with_formation``, ``_read_min_thickness_m``, ...) so the
  inputs are the real ones, not a re-implementation, but ``execute()`` — the
  half that writes — is never called.
* ``ResolveLithoInstances`` (which the use case runs first, and which writes) is
  deliberately NOT run.  It stamps ``litho_layer.body_id``, which only decides
  the ``(body_id, geo_formation)`` grouping; the emitted bands come from each
  CPT's own splits (``_build_column_plans`` reads ``profile.splits``), so the
  grouping cannot move a boundary.

Usage
-----
    uv run python scripts/diag_geotech_subdivision_determinism.py
    uv run python scripts/diag_geotech_subdivision_determinism.py --name S17
    uv run python scripts/diag_geotech_subdivision_determinism.py --all-columns
    uv run python scripts/diag_geotech_subdivision_determinism.py --json out.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
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
from groundmodel.shared.constants.litho_constants import BASE_LITHOLOGIES  # noqa: E402
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402

#: Columns the puzzle names.  ``--all-columns`` widens this to every CPT.
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


async def _stored_bands(session: Any, geotech_model_id: UUID) -> dict[str, list[dict[str, Any]]]:
    """Read the persisted geotech bands, grouped by CPT id.

    Parameters
    ----------
    session : AsyncSession
        Read session on the dev database.
    geotech_model_id : UUID
        The geotech model whose bands to read.

    Returns
    -------
    dict[str, list[dict[str, Any]]]
        ``cpt_id (str) -> [{top_m, base_m, nad, layer_id, created_at, updated_at,
        source}]`` ordered top-to-base.
    """
    rows = (
        await session.execute(
            select(
                LithoLayerOrm.id,
                LithoLayerOrm.cpt_id,
                LithoLayerOrm.depth_top_m,
                LithoLayerOrm.depth_base_m,
                LithoLayerOrm.source,
                LithoLayerOrm.created_at,
                LithoLayerOrm.updated_at,
                GeologicalFormationOrm.nad_class,
            )
            .join(
                GeologicalFormationOrm,
                LithoLayerOrm.formation_id == GeologicalFormationOrm.id,
            )
            .where(
                LithoLayerOrm.model_id == geotech_model_id,
                LithoLayerOrm.cpt_id.is_not(None),
            )
        )
    ).all()
    out: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        out.setdefault(str(r.cpt_id), []).append(
            {
                "layer_id": str(r.id),
                "top_m": r.depth_top_m,
                "base_m": r.depth_base_m,
                "nad": r.nad_class,
                "source": r.source,
                "created_at": str(r.created_at),
                "updated_at": str(r.updated_at),
            }
        )
    for bands in out.values():
        bands.sort(key=lambda b: b["top_m"])
    return out


def _fmt_bands(bands: list[dict[str, Any]]) -> str:
    """One-line rendering of a band stack for side-by-side printing."""
    return " | ".join(f"{b['top_m']:.3f}-{b['base_m']:.3f} nad={b['nad']}" for b in bands)


async def main() -> None:
    """Reproduce the pure segmenter on dev data and diff against the stored bands."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--name",
        action="append",
        default=None,
        help="CPT name substring to inspect (repeatable). Defaults to the two puzzle columns.",
    )
    parser.add_argument(
        "--all-columns",
        action="store_true",
        help="Inspect every CPT in the model instead of the named ones.",
    )
    parser.add_argument("--json", type=Path, default=None, help="Write the full report as JSON.")
    parser.add_argument(
        "--repeats",
        type=int,
        default=5,
        help="How many times to re-run the pure segmenter for the determinism check.",
    )
    args = parser.parse_args()

    print("\n=== GEOTECH SUBDIVISION — PURE SEGMENTER vs STORED BANDS (READ-ONLY) ===\n")
    _confirm_db_target()

    report: dict[str, Any] = {"columns": {}}

    async with AsyncSessionFactory() as session:
        geotech = await _geotech_model(session)
        project_id = geotech.app_project_id
        litho_model_id = geotech.parent_model_id
        if litho_model_id is None:
            raise SystemExit("ABORT: the geotech model has no lithostratigraphic parent.")
        litho_model = await session.get(GeologicalModelOrm, litho_model_id)
        if litho_model is None:
            raise SystemExit(f"ABORT: litho model {litho_model_id} not found.")
        print(f"  project      : {project_id}")
        print(f"  litho model  : {litho_model_id}")
        print(f"  geotech model: {geotech.id}\n")

        # The use case object is used ONLY for its read helpers; execute() is
        # never called, so nothing is written.
        use_case = SubdivideAllBodies(session)

        # --- the exact knobs the use case reads ---------------------------
        snap_tol = await use_case._read_geotech_snap_tolerance_m(geotech.app_project_id)
        min_thickness_m = await use_case._read_min_thickness_m(geotech.app_project_id)
        gradient_snap, gradient_snap_window_m = await use_case._read_gradient_snap(
            geotech.app_project_id
        )
        print(
            f"  knobs: snap_tol={snap_tol} min_thickness_m={min_thickness_m} "
            f"gradient_snap={gradient_snap} window_m={gradient_snap_window_m}"
        )
        report["knobs"] = {
            "snap_tolerance_m": snap_tol,
            "min_thickness_m": min_thickness_m,
            "gradient_snap": gradient_snap,
            "gradient_snap_window_m": gradient_snap_window_m,
        }

        # --- Phase 2 + 3: picks -> geo-bounded segments -------------------
        picks = await use_case._litho_repo.load_body_picks(litho_model_id)
        geo_surfaces = await use_case._load_geo_surfaces_with_formation(litho_model.parent_model_id)
        boundary_sampler = use_case._make_boundary_sampler(geo_surfaces)
        lowest_sampler = use_case._make_lowest_boundary_sampler(geo_surfaces)
        shallow = mark_and_truncate_shallow_tests(picks, lowest_sampler)
        divided = divide_picks_by_geology(shallow.picks, boundary_sampler, snap_tol)
        print(
            f"  {len(picks)} pick(s) -> {len(divided)} geo-bounded segment(s) "
            f"over {len(geo_surfaces)} geo surface(s)\n"
        )

        # --- CPT identity + series ----------------------------------------
        all_ids = {UUID(s.investigation_id) for s in divided}
        anchor_kind = await use_case._resolve_anchor_kinds(all_ids)
        cpt_ids = {UUID(i) for i, k in anchor_kind.items() if k == "cpt"}
        cpt_series = await use_case._load_cpt_series(cpt_ids)
        cpt_rows = (
            (await session.execute(select(CptOrm).where(CptOrm.id.in_(cpt_ids)))).scalars().all()
        )
        name_by_id = {str(c.id): c.name for c in cpt_rows}

        stored = await _stored_bands(session, geotech.id)

        # --- pick the columns to inspect ----------------------------------
        wanted = args.name or list(_DEFAULT_NAMES)
        if args.all_columns:
            target_ids = sorted(cpt_ids, key=lambda i: name_by_id.get(str(i), ""))
        else:
            target_ids = [
                UUID(cid)
                for cid, nm in sorted(name_by_id.items(), key=lambda kv: kv[1])
                if any(w in nm for w in wanted)
            ]
        if not target_ids:
            raise SystemExit(f"ABORT: no CPT matched {wanted!r}.")

        # --- reproduce, per column ----------------------------------------
        for cpt_uuid in target_ids:
            cid = str(cpt_uuid)
            name = name_by_id.get(cid, cid)
            segs = sorted(
                (s for s in divided if s.investigation_id == cid),
                key=lambda s: s.top_depth_m,
            )
            series = cpt_series.get(cpt_uuid)
            print(f"--- {name} ({cid}) ---")
            print(
                f"  {len(segs)} geo-bounded segment(s); "
                f"series={'yes' if series else 'MISSING'}"
                + (f" n={len(series.depths_m)}" if series else "")
            )

            produced: list[dict[str, Any]] = []
            seg_report: list[dict[str, Any]] = []
            for seg in segs:
                fid = UUID(seg.formation_id)
                soil = await use_case._formation_soil_code(fid)
                admixtures = await use_case._formation_admixtures(fid)
                if series is None or soil is None or soil not in BASE_LITHOLOGIES:
                    seg_report.append(
                        {
                            "top_m": seg.top_depth_m,
                            "base_m": seg.base_depth_m,
                            "soil": soil,
                            "skeleton": True,
                        }
                    )
                    continue
                runs: list[list[tuple[float, float, int | None]]] = []
                for _ in range(max(1, args.repeats)):
                    splits = suggest_geotech_subdivision(
                        soil=soil,
                        admixtures=admixtures,
                        depth_m=series.depths_m,
                        qc_mpa=series.qc_mpa,
                        segment_top_m=seg.top_depth_m,
                        segment_base_m=seg.base_depth_m,
                        min_thickness_m=min_thickness_m,
                        gradient_snap=gradient_snap,
                        gradient_snap_window_m=gradient_snap_window_m,
                    )
                    runs.append([(s.depth_top_m, s.depth_base_m, s.nad_class) for s in splits])
                stable = all(r == runs[0] for r in runs)
                # repr() compares the exact double, not a rounded rendering.
                stable_bits = all(repr(r) == repr(runs[0]) for r in runs)
                for top_m, base_m, nad in runs[0]:
                    top_c = max(top_m, seg.top_depth_m)
                    base_c = min(base_m, seg.base_depth_m)
                    if base_c - top_c > 1e-6:
                        produced.append({"top_m": top_c, "base_m": base_c, "nad": nad})
                seg_report.append(
                    {
                        "top_m": seg.top_depth_m,
                        "base_m": seg.base_depth_m,
                        "soil": soil,
                        "admixtures": [
                            {"soil_code": a.soil_code, "amount": a.amount, "locally": a.locally}
                            for a in admixtures
                        ],
                        "splits": runs[0],
                        "repeat_stable": stable,
                        "repeat_bit_stable": stable_bits,
                    }
                )
                if not (stable and stable_bits):
                    print(
                        f"  !! NON-DETERMINISTIC on segment "
                        f"{seg.top_depth_m:.3f}-{seg.base_depth_m:.3f}: {runs}"
                    )

            produced.sort(key=lambda b: b["top_m"])
            stored_here = stored.get(cid, [])
            same = [(_mm(b["top_m"]), _mm(b["base_m"]), b["nad"]) for b in produced] == [
                (_mm(b["top_m"]), _mm(b["base_m"]), b["nad"]) for b in stored_here
            ]
            print(f"  STORED   ({len(stored_here)}): {_fmt_bands(stored_here)}")
            print(f"  PRODUCED ({len(produced)}): {_fmt_bands(produced)}")
            print(f"  MATCH: {same}")
            if not same:
                n = max(len(stored_here), len(produced))
                for i in range(n):
                    sb = stored_here[i] if i < len(stored_here) else None
                    pb = produced[i] if i < len(produced) else None
                    flag = (
                        "  "
                        if sb
                        and pb
                        and (_mm(sb["top_m"]), _mm(sb["base_m"]), sb["nad"])
                        == (_mm(pb["top_m"]), _mm(pb["base_m"]), pb["nad"])
                        else "!!"
                    )
                    print(
                        f"   {flag} [{i}] stored "
                        + (f"{sb['top_m']:.3f}-{sb['base_m']:.3f} nad={sb['nad']}" if sb else "-")
                        + "   produced "
                        + (f"{pb['top_m']:.3f}-{pb['base_m']:.3f} nad={pb['nad']}" if pb else "-")
                    )
            print()
            report["columns"][name] = {
                "cpt_id": cid,
                "segments": seg_report,
                "stored": stored_here,
                "produced": produced,
                "match": same,
            }

    if args.json:
        args.json.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        print(f"  wrote {args.json}")


if __name__ == "__main__":
    asyncio.run(main())
