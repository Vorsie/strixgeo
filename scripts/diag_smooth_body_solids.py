"""READ-ONLY: measure the #220 non-blocky smoother against the voxel model it relaxes.

Debt #220 asks for a 3-D model that does not read as a staircase.
:mod:`~groundmodel.domain.services.voxel_litho.smooth_body_solids` is the
prototype answer — a post-process that moves vertices and nothing else.  The
claim it has to survive is not "it looks better"; it is:

* no ground is gained or lost beyond a stated bound (half a voxel per axis);
* every body is still a closed 2-manifold;
* no two bodies interpenetrate;
* an honoured investigation's own contacts do not drift away from its log; and
* the pass is cheap enough to sit on the on-click Build.

This script reproduces a PERSISTED build generation from the database (a
SELECT-only read of ``litho_build_generation``, mirroring
``diag_build_generations.py --reproduce`` step for step so the voxel arm is the
model the app actually built), runs the smoother over the result, and reports
each of those five in turn.  Nothing is written to the database and no
production code path is involved: the smoother is called from here and nowhere
else.

Output: ``blend_viewer/smooth3d_ab.json`` — both arms' meshes plus the metrics,
for the side-by-side viewer at ``blend_viewer/smooth3d_ab.html``.

Run::

    uv run python scripts/diag_smooth_body_solids.py
    uv run python scripts/diag_smooth_body_solids.py --kind geotechnical
    uv run python scripts/diag_smooth_body_solids.py --iterations 20 --raster 20
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np  # noqa: E402
from sqlalchemy import select, text  # noqa: E402

from groundmodel.application.build_voxel_litho_model import (  # noqa: E402
    _apply_aliases_to_columns,
    _investigation_columns_from_picks,
)
from groundmodel.application.load_geo_surfaces import load_geo_surfaces  # noqa: E402
from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (  # noqa: E402
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.extract_body_solids import (  # noqa: E402
    extract_body_solids,
)
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels  # noqa: E402
from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (  # noqa: E402
    apply_body_aliases,
)
from groundmodel.domain.services.voxel_litho.smooth_body_solids import (  # noqa: E402
    boundary_area_m2,
    canonicalise_shared_diagonals,
    signed_volume_m3,
    smooth_body_solids,
)
from groundmodel.domain.services.voxel_litho.true_column_positions import (  # noqa: E402
    apply_true_column_positions,
)
from groundmodel.domain.services.voxel_litho.voxel_types import InvestigationColumn  # noqa: E402
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh  # noqa: E402
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_build_generation_orm import (  # noqa: E402
    LithoBuildGenerationOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.diag_build_generations import _sections_from_payload  # noqa: E402
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402
from tests.unit.domain.services.voxel_litho.strat_invariants import (  # noqa: E402
    TOL,
    assert_closed_manifold,
)

OUT = _REPO_ROOT / "blend_viewer" / "smooth3d_ab.json"

# Same map-plane nudge the shared ray helper uses: a query landing exactly on a
# vertical seam between two abutting bodies grazes both of their coincident
# horizontal faces and reads a touch as an overlap.
_SEAM_NUDGE_M = 1e-9


class TriangleSoup:
    """Every body's triangles in one array, for vectorised vertical ray-casting.

    The shared ``vertical_ray_intervals`` helper walks a mesh's triangles in pure
    Python.  That is right for a hand-built test grid and hopeless here: the real
    model carries half a million triangles and the report needs several hundred
    ray casts per arm.  This class holds the same geometry as flat numpy arrays
    with a per-triangle map-plane bounding box, so a cast filters to the handful
    of candidate triangles first and does the barycentric arithmetic on those.

    The semantics are deliberately identical to the shared helper — edge-inclusive
    containment, planar z interpolation, near-coincident crossing dedup, even-odd
    pairing — because a metric that measures a DIFFERENT model than the gate
    asserts on is worth nothing.
    """

    def __init__(self, meshes: list[Any]) -> None:
        """Flatten a list of body meshes into shared vertex / triangle arrays.

        Parameters
        ----------
        meshes : list of LithoBodyMesh
            The bodies to sample.  Body order is preserved as the soup's body
            index, so a caller can map an interval back to its mesh.
        """
        verts: list[np.ndarray] = []
        tris: list[np.ndarray] = []
        owner: list[np.ndarray] = []
        offset = 0
        for index, mesh in enumerate(meshes):
            v = np.asarray(mesh.vertices, dtype=float).reshape(-1, 3)
            t = np.asarray(mesh.triangles, dtype=np.int64).reshape(-1, 3) + offset
            verts.append(v)
            tris.append(t)
            owner.append(np.full(len(t), index, dtype=np.int64))
            offset += len(v)
        self.vertices = np.vstack(verts)
        self.triangles = np.vstack(tris)
        self.body_of_triangle = np.concatenate(owner)
        self.n_bodies = len(meshes)

        a = self.vertices[self.triangles[:, 0]]
        b = self.vertices[self.triangles[:, 1]]
        c = self.vertices[self.triangles[:, 2]]
        self._ax, self._ay, self._az = a[:, 0], a[:, 1], a[:, 2]
        self._bx, self._by, self._bz = b[:, 0], b[:, 1], b[:, 2]
        self._cx, self._cy, self._cz = c[:, 0], c[:, 1], c[:, 2]
        self._min_x = np.minimum(np.minimum(self._ax, self._bx), self._cx)
        self._max_x = np.maximum(np.maximum(self._ax, self._bx), self._cx)
        self._min_y = np.minimum(np.minimum(self._ay, self._by), self._cy)
        self._max_y = np.maximum(np.maximum(self._ay, self._by), self._cy)

    def intervals_at(self, x: float, y: float) -> dict[int, list[tuple[float, float]]]:
        """Solid ``(base, top)`` intervals of every body along the vertical at ``(x, y)``.

        Parameters
        ----------
        x, y : float
            Map-plane query position in metres (project CRS).

        Returns
        -------
        dict of int to list of (float, float)
            Body index to its solid intervals, base below top.  Bodies the ray
            misses are absent.
        """
        x += _SEAM_NUDGE_M
        y += _SEAM_NUDGE_M
        cand = np.flatnonzero(
            (self._min_x <= x) & (self._max_x >= x) & (self._min_y <= y) & (self._max_y >= y)
        )
        if not len(cand):
            return {}
        ax, ay, az = self._ax[cand], self._ay[cand], self._az[cand]
        bx, by, bz = self._bx[cand], self._by[cand], self._bz[cand]
        cx, cy, cz = self._cx[cand], self._cy[cand], self._cz[cand]
        denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        live = np.abs(denom) >= 1e-15
        if not live.any():
            return {}
        safe = np.where(live, denom, 1.0)
        la = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / safe
        lb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / safe
        lc = 1.0 - la - lb
        eps = 1e-12
        inside = live & (la >= -eps) & (lb >= -eps) & (lc >= -eps)
        if not inside.any():
            return {}
        z = la[inside] * az[inside] + lb[inside] * bz[inside] + lc[inside] * cz[inside]
        bodies = self.body_of_triangle[cand[inside]]

        out: dict[int, list[tuple[float, float]]] = {}
        for body in np.unique(bodies):
            crossings = np.sort(z[bodies == body])
            # An edge shared by two triangles is hit by both; collapsing the
            # near-coincident pair restores the even-odd parity.
            keep = np.concatenate(([True], np.diff(crossings) > TOL))
            deduped = crossings[keep]
            spans = [
                (float(deduped[k]), float(deduped[k + 1]))
                for k in range(0, len(deduped) - 1, 2)
                if deduped[k + 1] - deduped[k] > TOL
            ]
            if spans:
                out[int(body)] = spans
        return out


def _contact_elevations(intervals: dict[int, list[tuple[float, float]]]) -> np.ndarray:
    """Every distinct elevation at which the model changes body along one vertical.

    Parameters
    ----------
    intervals : dict of int to list of (float, float)
        A ray cast's per-body solid intervals.

    Returns
    -------
    numpy.ndarray
        Ascending, deduplicated contact elevations in metres.
    """
    zs = sorted(z for spans in intervals.values() for span in spans for z in span)
    if not zs:
        return np.zeros(0, dtype=float)
    out = [zs[0]]
    for z in zs[1:]:
        if z - out[-1] > TOL:
            out.append(z)
    return np.asarray(out, dtype=float)


def _overlap_metres(intervals: dict[int, list[tuple[float, float]]]) -> float:
    """Longest interpenetration between two DIFFERENT bodies along one vertical.

    Parameters
    ----------
    intervals : dict of int to list of (float, float)
        A ray cast's per-body solid intervals.

    Returns
    -------
    float
        The worst overlap in metres; ``0.0`` when the bodies only touch.
    """
    worst = 0.0
    keys = sorted(intervals)
    for i, left in enumerate(keys):
        for right in keys[i + 1 :]:
            for lb, lt in intervals[left]:
                for rb, rt in intervals[right]:
                    worst = max(worst, min(lt, rt) - max(lb, rb))
    return max(worst, 0.0)


def _watertight_failures(meshes: list[Any]) -> list[str]:
    """Names of the bodies that are not closed 2-manifolds with consistent winding.

    Parameters
    ----------
    meshes : list of LithoBodyMesh
        The solids to check.

    Returns
    -------
    list of str
        One ``"body_id: reason"`` line per failure; empty when all are closed.
    """
    failures: list[str] = []
    for mesh in meshes:
        try:
            assert_closed_manifold(mesh.vertices, mesh.triangles)
        except AssertionError as err:
            failures.append(f"{mesh.body_id}: {str(err)[:160]}")
    return failures


def _volume_table(
    meshes: list[Any], truth_m3: dict[str, float]
) -> tuple[list[tuple[str, float, float, float]], float, float]:
    """Per-body volume against the label grid's own cell count.

    Parameters
    ----------
    meshes : list of LithoBodyMesh
        The arm being measured.
    truth_m3 : dict of str to float
        Body id to labelled-cell volume — the voxel model's ground truth.

    Returns
    -------
    tuple
        ``(rows, median_abs_pct, worst_abs_pct)`` where each row is
        ``(body_id, truth_m3, measured_m3, signed_pct)``.
    """
    rows: list[tuple[str, float, float, float]] = []
    for mesh in meshes:
        truth = truth_m3.get(str(mesh.body_id), 0.0)
        measured = signed_volume_m3(mesh)
        pct = 100.0 * (measured - truth) / truth if truth > 0 else 0.0
        rows.append((str(mesh.body_id), truth, measured, pct))
    deltas = np.abs([r[3] for r in rows]) if rows else np.zeros(1)
    return rows, float(np.median(deltas)), float(deltas.max())


def _column_contact_errors(soup: TriangleSoup, columns: tuple[Any, ...]) -> tuple[np.ndarray, int]:
    """Distance from each honoured column's own logged contacts to the model's nearest.

    An honoured investigation's log is evidence: the labeller writes its own
    stack into its grid column.  This measures how far the extracted surface
    ends up from the contacts that log states, inside the drilled range only —
    below TD the model continues by design and a mismatch there is the feature,
    not an error.

    Parameters
    ----------
    soup : TriangleSoup
        The arm being measured.
    columns : tuple of InvestigationColumn
        The honoured investigations, carrying their true map position and their
        observed interval stack.

    Returns
    -------
    tuple
        ``(errors_m, columns_sampled)`` — one absolute error per authored
        contact, and how many columns contributed.
    """
    errors: list[float] = []
    sampled = 0
    for column in columns:
        if len(column.intervals) < 2:
            continue
        model = _contact_elevations(soup.intervals_at(column.world_x, column.world_y))
        if not len(model):
            continue
        sampled += 1
        tops = [iv[2] for iv in column.intervals]
        bases = [iv[3] for iv in column.intervals]
        drilled_top, drilled_base = max(tops), min(bases)
        # The interior contacts of the log: every base except the deepest one.
        for contact in sorted(bases)[1:]:
            if not (drilled_base - TOL <= contact <= drilled_top + TOL):
                continue
            errors.append(float(np.min(np.abs(model - contact))))
    return np.asarray(errors, dtype=float), sampled


def _describe(values: np.ndarray, unit: str) -> str:
    """One-line median / p90 / max summary of a sample.

    Parameters
    ----------
    values : numpy.ndarray
        The sample; an empty sample reports ``"no samples"``.
    unit : str
        Unit suffix printed after each statistic.

    Returns
    -------
    str
        ``"median X / p90 Y / max Z"``.
    """
    if not len(values):
        return "no samples"
    return (
        f"median {np.median(values):.3f} {unit} / "
        f"p90 {np.percentile(values, 90):.3f} {unit} / "
        f"max {values.max():.3f} {unit}"
    )


async def _load_generation(kind: str, generation: UUID | None) -> dict[str, Any]:
    """SELECT-only read of a persisted build generation and everything it needs.

    Parameters
    ----------
    kind : str
        ``"lithostratigraphic"`` or ``"geotechnical"`` — which model's newest
        generation to reproduce when ``generation`` is not given.
    generation : uuid.UUID or None
        An explicit generation to reproduce; ``None`` takes the newest of ``kind``.

    Returns
    -------
    dict
        Everything the rebuild needs, plus formation metadata for the viewer.

    Raises
    ------
    SystemExit
        When no generation of that kind exists.
    """
    async with AsyncSessionFactory() as session:
        stmt = (
            select(LithoBuildGenerationOrm)
            .join(GeologicalModelOrm, GeologicalModelOrm.id == LithoBuildGenerationOrm.model_id)
            .where(GeologicalModelOrm.kind == kind)
            .order_by(LithoBuildGenerationOrm.created_at.desc())
        )
        if generation is not None:
            stmt = stmt.where(LithoBuildGenerationOrm.id == generation)
        target = (await session.execute(stmt)).scalars().first()
        if target is None:
            raise SystemExit(f"ABORT: no stored {kind} build generation to reproduce.")

        model = await session.get(GeologicalModelOrm, target.model_id)
        picks = await LithoLayerRepository(session).load_body_picks(target.model_id)
        geo_surfaces: tuple = ()
        if model is not None and model.parent_model_id is not None:
            geo_surfaces = await load_geo_surfaces(session, model.parent_model_id)

        formations: dict[str, dict[str, Any]] = {}
        for fid, name, color, nad_class in (
            await session.execute(
                text(
                    "SELECT id::text, name, color, nad_class FROM geological_formation "
                    "WHERE app_project_id = :p"
                ),
                {"p": model.app_project_id if model is not None else None},
            )
        ).all():
            formations[fid] = {"name": name, "color": color, "nad_class": nad_class}

        return {
            "target": target,
            "model_name": getattr(model, "name", "?"),
            "picks": picks,
            "geo_surfaces": geo_surfaces,
            "formations": formations,
        }


def _rebuild(
    loaded: dict[str, Any], *, greedy: bool = True
) -> tuple[Any, list[Any], tuple[Any, ...], float]:
    """Reproduce a stored generation's label grid and solids, exactly as the build does.

    Mirrors ``BuildVoxelLithoModel.execute`` in its own order.  The stored payload
    is AS RECEIVED, so the alias map and the true-position re-seat are re-derived
    here and the footprint hull is framed from the columns AS DRAWN — building it
    from the re-seated payload instead returns a narrower grid.

    Parameters
    ----------
    loaded : dict
        The result of :func:`_load_generation`.

    Returns
    -------
    tuple
        ``(grid, meshes, investigation_columns, seconds)``.
    """
    target = loaded["target"]
    received = _sections_from_payload(target.payload)
    aliases = dict(target.body_aliases or {})
    aliased = apply_body_aliases(received, aliases)
    columns = _apply_aliases_to_columns(_investigation_columns_from_picks(loaded["picks"]), aliases)
    seated, _moved, _shift = apply_true_column_positions(aliased, columns)

    started = time.perf_counter()
    domain = build_domain_from_sections(
        aliased,
        investigation_positions=tuple((c.investigation_id, c.world_x, c.world_y) for c in columns),
    )
    grid = label_voxels(
        domain,
        target.horizontal_spacing_m,
        seated,
        vertical_spacing_m=target.vertical_spacing_m,
        investigation_columns=columns,
        geo_surfaces=loaded["geo_surfaces"],
        litho_snap_tolerance_m=target.litho_snap_tolerance_m,
        honor_radius_m=target.honor_radius_m,
    )
    meshes = [m for m in extract_body_solids(grid, greedy=greedy) if m.vertices and m.triangles]
    return grid, meshes, columns, time.perf_counter() - started


def _arm_report(
    name: str,
    meshes: list[Any],
    soup: TriangleSoup,
    truth_m3: dict[str, float],
    columns: tuple[Any, ...],
    samples: list[tuple[float, float]],
) -> dict[str, Any]:
    """Run the five faithfulness checks over one arm and print them.

    Parameters
    ----------
    name : str
        Arm label for the printout.
    meshes : list of LithoBodyMesh
        The arm's solids.
    soup : TriangleSoup
        The same solids, prepared for ray-casting.
    truth_m3 : dict of str to float
        Body id to labelled-cell volume.
    columns : tuple of InvestigationColumn
        The honoured investigations.
    samples : list of (float, float)
        The raster sweep's map-plane sample positions.

    Returns
    -------
    dict
        The metrics, for the viewer dump.
    """
    print(f"\n  --- {name} ---")
    tris = sum(len(m.triangles) for m in meshes)
    verts = sum(len(m.vertices) for m in meshes)
    area = sum(boundary_area_m2(m) for m in meshes)
    print(f"      {len(meshes)} bodies | {tris:,} triangles | {verts:,} vertices")
    print(f"      boundary area          {area:,.0f} m2")

    failures = _watertight_failures(meshes)
    print(f"      WATERTIGHT             {len(meshes) - len(failures)}/{len(meshes)} closed")
    for line in failures[:3]:
        print(f"          FAIL {line}")

    rows, median_pct, worst_pct = _volume_table(meshes, truth_m3)
    total_truth = sum(r[1] for r in rows)
    total_measured = sum(r[2] for r in rows)
    print(
        f"      VOLUME vs voxel truth  median |{median_pct:.3f}| % / worst "
        f"|{worst_pct:.3f}| % | model total {total_measured:,.0f} of "
        f"{total_truth:,.0f} m3 ({100.0 * (total_measured - total_truth) / total_truth:+.3f} %)"
    )
    worst_rows = sorted(rows, key=lambda r: -abs(r[3]))[:3]
    for body_id, truth, measured, pct in worst_rows:
        print(f"          {body_id[-8:]}  {truth:12,.0f} -> {measured:12,.0f} m3  {pct:+7.3f} %")

    overlaps = np.asarray([_overlap_metres(soup.intervals_at(x, y)) for x, y in samples])
    breaches = int((overlaps > TOL).sum())
    print(
        f"      ZERO-OVERLAP           {len(samples) - breaches}/{len(samples)} clean samples"
        + (f" | worst {overlaps.max():.4f} m" if breaches else "")
    )

    errors, sampled = _column_contact_errors(soup, columns)
    print(f"      HONOURED CONTACTS      {_describe(errors, 'm')}  ({sampled} columns)")

    return {
        "bodies": len(meshes),
        "triangles": tris,
        "vertices": verts,
        "boundary_area_m2": round(area, 1),
        "watertight_failures": failures,
        "volume_median_abs_pct": round(median_pct, 4),
        "volume_worst_abs_pct": round(worst_pct, 4),
        "volume_total_truth_m3": round(total_truth, 1),
        "volume_total_model_m3": round(total_measured, 1),
        "overlap_breaches": breaches,
        "overlap_worst_m": round(float(overlaps.max()), 6) if len(overlaps) else 0.0,
        "contact_error_median_m": round(float(np.median(errors)), 4) if len(errors) else None,
        "contact_error_p90_m": round(float(np.percentile(errors, 90)), 4) if len(errors) else None,
        "contact_error_max_m": round(float(errors.max()), 4) if len(errors) else None,
        "contact_samples": int(len(errors)),
    }


def _raster_samples(meshes: list[Any], n: int) -> list[tuple[float, float]]:
    """Cell-centre sample positions across the model footprint.

    Cell centres, never grid nodes: a sample landing exactly on a shared vertical
    seam reads a contact between two abutting bodies as an overlap.

    Parameters
    ----------
    meshes : list of LithoBodyMesh
        Used only for their combined map-plane extent.
    n : int
        Samples per axis.

    Returns
    -------
    list of (float, float)
        ``n * n`` map-plane positions.
    """
    everything = np.vstack([np.asarray(m.vertices, dtype=float) for m in meshes])
    x_min, y_min = everything[:, 0].min(), everything[:, 1].min()
    x_max, y_max = everything[:, 0].max(), everything[:, 1].max()
    return [
        (
            x_min + (i + 0.5) / n * (x_max - x_min),
            y_min + (j + 0.5) / n * (y_max - y_min),
        )
        for i in range(n)
        for j in range(n)
    ]


def _dump_bodies(meshes: list[Any], formations: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Serialise one arm's meshes for the side-by-side viewer.

    Parameters
    ----------
    meshes : list of LithoBodyMesh
        The arm's solids.
    formations : dict
        Formation id to its name / colour / NAD class.

    Returns
    -------
    list of dict
        One entry per body: identity, colour and the raw mesh.
    """
    out: list[dict[str, Any]] = []
    for mesh in meshes:
        meta = formations.get(str(mesh.formation_id), {})
        out.append(
            {
                "id": str(mesh.body_id),
                "label": f"{meta.get('name') or str(mesh.formation_id)[:8]} · "
                f"{str(mesh.body_id)[-6:]}",
                "formation_name": meta.get("name"),
                "nad_class": meta.get("nad_class"),
                "color": meta.get("color"),
                "vertices": [[round(x, 4), round(y, 4), round(z, 4)] for x, y, z in mesh.vertices],
                "triangles": [list(t) for t in mesh.triangles],
            }
        )
    return out


def _save_voxel_cache(
    stem: Path,
    meshes: list[Any],
    columns: tuple[Any, ...],
    truth_m3: dict[str, float],
    build_s: float,
) -> None:
    """Write the voxel arm to ``<stem>.npz`` + ``<stem>.json`` for parameter sweeps.

    Arrays go to the npz (``allow_pickle`` never enters the picture) and the
    identities / honoured columns to a JSON sidecar, so re-reading the cache
    executes nothing.

    Parameters
    ----------
    stem : pathlib.Path
        Path without extension; two files are written next to it.
    meshes : list of LithoBodyMesh
        The voxel arm.
    columns : tuple of InvestigationColumn
        The honoured investigations.
    truth_m3 : dict of str to float
        Body id to labelled-cell volume.
    build_s : float
        Seconds the rebuild took, carried so a reused run still reports it.
    """
    np.savez_compressed(
        stem.with_suffix(".npz"),
        vertices=np.vstack([np.asarray(m.vertices, dtype=float) for m in meshes]),
        triangles=np.vstack([np.asarray(m.triangles, dtype=np.int64) for m in meshes]),
        vertex_counts=np.asarray([len(m.vertices) for m in meshes], dtype=np.int64),
        triangle_counts=np.asarray([len(m.triangles) for m in meshes], dtype=np.int64),
    )
    stem.with_suffix(".json").write_text(
        json.dumps(
            {
                "build_seconds": build_s,
                "truth_m3": truth_m3,
                "bodies": [
                    {"body_id": str(m.body_id), "formation_id": str(m.formation_id)} for m in meshes
                ],
                "columns": [
                    {
                        "investigation_id": c.investigation_id,
                        "world_x": c.world_x,
                        "world_y": c.world_y,
                        "kind": c.kind,
                        "intervals": [list(iv) for iv in c.intervals],
                    }
                    for c in columns
                ],
            }
        ),
        encoding="utf-8",
    )


def _load_voxel_cache(
    stem: Path,
) -> tuple[list[Any], tuple[Any, ...], dict[str, float], float] | None:
    """Read back a voxel arm written by :func:`_save_voxel_cache`, or ``None``.

    Parameters
    ----------
    stem : pathlib.Path
        Path without extension.

    Returns
    -------
    tuple or None
        ``(meshes, columns, truth_m3, build_seconds)``; ``None`` when either
        half of the cache is missing.
    """
    npz_path, json_path = stem.with_suffix(".npz"), stem.with_suffix(".json")
    if not (npz_path.exists() and json_path.exists()):
        return None
    side = json.loads(json_path.read_text(encoding="utf-8"))
    with np.load(npz_path) as data:
        verts, tris = data["vertices"], data["triangles"]
        v_counts, t_counts = data["vertex_counts"], data["triangle_counts"]
    meshes: list[Any] = []
    v_at = t_at = 0
    for entry, n_v, n_t in zip(side["bodies"], v_counts, t_counts):
        block = verts[v_at : v_at + n_v]
        faces = tris[t_at : t_at + n_t]
        meshes.append(
            LithoBodyMesh(
                body_id=entry["body_id"],
                formation_id=entry["formation_id"],
                vertices=[(float(x), float(y), float(z)) for x, y, z in block],
                triangles=[(int(a), int(b), int(c)) for a, b, c in faces],
                is_flagged=False,
            )
        )
        v_at += int(n_v)
        t_at += int(n_t)
    columns = tuple(
        InvestigationColumn(
            investigation_id=c["investigation_id"],
            world_x=c["world_x"],
            world_y=c["world_y"],
            intervals=tuple(tuple(iv) for iv in c["intervals"]),
            kind=c["kind"],
        )
        for c in side["columns"]
    )
    return meshes, columns, side["truth_m3"], float(side["build_seconds"])


async def main() -> None:
    """Reproduce a persisted build, smooth it, and report the faithfulness table."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--kind", default="lithostratigraphic", choices=["lithostratigraphic", "geotechnical"]
    )
    ap.add_argument("--generation", type=UUID, default=None)
    ap.add_argument("--iterations", type=int, default=12)
    ap.add_argument("--budget", type=float, default=0.5, help="Voxel fraction a vertex may move.")
    ap.add_argument("--pin-radius", type=float, default=0.0, help="Hold honoured columns (m).")
    ap.add_argument("--raster", type=int, default=18, help="Overlap-sweep samples per axis.")
    ap.add_argument("--reuse", action="store_true", help="Reuse a cached voxel arm if present.")
    ap.add_argument(
        "--no-canonical",
        action="store_true",
        help="Skip the shared-diagonal agreement pass, to show what it is worth.",
    )
    ap.add_argument(
        "--unmerged",
        action="store_true",
        help=(
            "Extract one quad per boundary cell face instead of greedy-merging. "
            "Costs triangles, but it is the only extraction whose abutting bodies "
            "share vertices face-for-face, which smoothing needs."
        ),
    )
    ap.add_argument("--no-dump", action="store_true", help="Skip the (large) viewer dump.")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    print("\n=== #220 SMOOTH-SOLID PROTOTYPE (READ-ONLY, nothing persisted) ===\n")
    _confirm_db_target()

    loaded = await _load_generation(args.kind, args.generation)
    target = loaded["target"]
    spacing = (
        float(target.horizontal_spacing_m),
        float(target.horizontal_spacing_m),
        float(target.vertical_spacing_m),
    )
    print(
        f"  generation {target.id}  {target.created_at:%Y-%m-%d %H:%M}\n"
        f"  model      {loaded['model_name']} ({args.kind})\n"
        f"  grid       {target.grid_nx}x{target.grid_ny}x{target.grid_nz} at "
        f"{spacing[0]} m / {spacing[2]} m | honour {target.honor_radius_m} m\n"
        f"  recorded   {target.bodies_built} bodies, {target.triangles:,} tris in "
        f"{target.duration_s:.1f}s"
    )

    # The rebuild is ~90 s of pure CPU and is IDENTICAL for every smoother
    # setting, so a parameter sweep would otherwise spend an hour re-deriving one
    # unchanging input.  The cache is keyed by generation id and holds the VOXEL
    # arm only — never a smoothed result, so a sweep can never read its own
    # previous answer back in as the baseline.
    mode = "unmerged" if args.unmerged else "greedy"
    cache = _REPO_ROOT / "scripts" / f"throwaway_smooth_voxel_{mode}_{target.id}"
    cached = _load_voxel_cache(cache) if args.reuse else None
    if cached is not None:
        voxel, columns, truth_m3, build_s = cached
        print(f"  reused     {len(voxel)} bodies from {cache.name}.* (rebuild was {build_s:.1f}s)")
    else:
        grid, voxel, columns, build_s = _rebuild(loaded, greedy=not args.unmerged)
        labels = np.asarray(grid.labels)
        cell_m3 = spacing[0] * spacing[1] * spacing[2]
        counts = np.bincount(labels[labels >= 0].ravel(), minlength=len(grid.body_id_by_index))
        truth_m3 = {
            str(body_id): float(counts[index]) * cell_m3
            for index, body_id in enumerate(grid.body_id_by_index)
            if index < len(counts)
        }
        print(f"  rebuilt    {len(voxel)} bodies in {build_s:.1f}s")
        _save_voxel_cache(cache, voxel, columns, truth_m3, build_s)

    # Both arms are re-cut, not just the smoothed one: the pass moves no vertex,
    # so the voxel arm's surface is untouched, and measuring one arm against a
    # differently-tessellated baseline would fold the re-cut into the smoother's
    # score.
    canon_s = 0.0
    if not args.no_canonical:
        started = time.perf_counter()
        voxel = canonicalise_shared_diagonals(voxel)
        canon_s = time.perf_counter() - started
        print(f"  agreed     shared-face diagonals across all bodies in {canon_s:.1f}s")

    pins = tuple((c.world_x, c.world_y) for c in columns) if args.pin_radius > 0 else None
    started = time.perf_counter()
    smooth = smooth_body_solids(
        voxel,
        spacing_m=spacing,
        iterations=args.iterations,
        displacement_budget=args.budget,
        pin_columns=pins,
        pin_radius_m=args.pin_radius,
    )
    smooth_s = time.perf_counter() - started
    moved = np.vstack(
        [np.abs(np.asarray(a.vertices) - np.asarray(b.vertices)) for a, b in zip(smooth, voxel)]
    )
    print(
        f"  smoothed   {args.iterations} Taubin pass(es), budget {args.budget} voxel "
        f"in {smooth_s:.1f}s  ({100.0 * smooth_s / build_s:.1f} % of the build)\n"
        f"             displacement max ({moved[:, 0].max():.3f}, {moved[:, 1].max():.3f}, "
        f"{moved[:, 2].max():.3f}) m of a permitted "
        f"({args.budget * spacing[0]:.3f}, {args.budget * spacing[1]:.3f}, "
        f"{args.budget * spacing[2]:.3f}) m"
    )

    samples = _raster_samples(voxel, args.raster)
    voxel_soup, smooth_soup = TriangleSoup(voxel), TriangleSoup(smooth)
    metrics = {
        "voxel": _arm_report("VOXEL (today)", voxel, voxel_soup, truth_m3, columns, samples),
        "smooth": _arm_report("SMOOTH (proto)", smooth, smooth_soup, truth_m3, columns, samples),
    }

    if args.no_dump:
        print("\n  (--no-dump) metrics only; no viewer payload written\n")
        return

    # The viewer's left pane shows the GREEDY voxel arm whenever one has been
    # built, even in an un-merged run.  The two extractions describe the SAME
    # surface — identical boundary area to the square metre — so the comparison
    # stays honest, and the greedy arm is what the app actually ships.  It also
    # keeps the payload loadable: dumping both arms un-merged is a third of a
    # gigabyte of JSON for no extra information.
    left = voxel
    left_note = "un-merged (one quad per boundary cell face)"
    if args.unmerged:
        greedy_cache = _load_voxel_cache(
            _REPO_ROOT / "scripts" / f"throwaway_smooth_voxel_greedy_{target.id}"
        )
        if greedy_cache is not None:
            left = greedy_cache[0]
            left_note = "greedy-merged (what the app ships)"
    print(f"  viewer left pane: {left_note}, {sum(len(m.triangles) for m in left):,} triangles")

    payload = {
        "meta": {
            "generation_id": str(target.id),
            "model_name": loaded["model_name"],
            "kind": args.kind,
            "horizontal_spacing_m": spacing[0],
            "vertical_spacing_m": spacing[2],
            "iterations": args.iterations,
            "displacement_budget": args.budget,
            "pin_radius_m": args.pin_radius,
            "unmerged": bool(args.unmerged),
            "left_tessellation": left_note,
            "build_seconds": round(build_s, 2),
            "smooth_seconds": round(smooth_s, 2),
            "canonical_seconds": round(canon_s, 2),
            "canonical": not args.no_canonical,
            "displacement_max_m": [round(float(moved[:, k].max()), 4) for k in range(3)],
        },
        "metrics": metrics,
        "voxel": _dump_bodies(left, loaded["formations"]),
        "smooth": _dump_bodies(smooth, loaded["formations"]),
    }
    out_path = Path(args.out)
    out_path.write_text(json.dumps(payload), encoding="utf-8")
    print(f"\n  wrote {out_path} ({out_path.stat().st_size / 1e6:.1f} MB)\n")


if __name__ == "__main__":
    asyncio.run(main())
