"""Read-only dev-viewer dump: persisted voxel litho solids -> ``voxel_viewer/model.json``.

This script serialises the PERSISTED ``litho_body_solid`` rows and the accepted
``litho_layer`` picks of one lithostratigraphic model into the flat JSON shape
the standalone Three.js dev viewer (``voxel_viewer/index.html``) consumes.  It is
purely a development diagnostic -- it lets the owner orbit the built voxel
model and eyeball the authored-vs-model column stacks for the columns the
fidelity oracle flags as ``wrong``.

It is STRICTLY READ-ONLY: it issues only SELECT statements.  A guard at the top
of ``main`` aborts when the DB is not the dev ``groundmodel`` DB and when the DB
is an integration/test sibling -- the same guard as ``eval_strat_fidelity.py``.

Coordinate mapping (world -> three, matching the existing ``model.json``): the
model is centred on the world XY centroid; each world vertex ``(wx, wy, wz)``
maps to three ``[wx - cx, wz, -(wy - cy)]`` (i.e. three_x = wx - cx, three_y =
elevation wz unchanged, three_z = -(wy - cy)).

Usage
-----
    uv run python scripts/dump_voxel_viewer_model.py
    uv run python scripts/dump_voxel_viewer_model.py --model-id <uuid> --out path.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from uuid import UUID

# The strat-invariant ray-cast helpers live under ``tests/`` (single home for
# the solid-interval math).  Bootstrap sys.path before any first-party import.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402

# Reuse the eval oracle's loaders + column math verbatim — the dump must agree
# with the fidelity verdict the owner inspects, so there is one home for it.
from scripts.eval_strat_fidelity import (  # noqa: E402
    _authored_columns,
    _classify_column,
    _compute_model_stack,
    _confirm_db_target,
    _load_formation_names,
    _load_solids,
)

# Owner's known real lithostratigraphic model on the dev DB.
_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")

# Default output path (relative to the repo root) for the dev viewer.
_DEFAULT_OUT = _REPO_ROOT / "voxel_viewer" / "model.json"

# Formation NAME -> display colour.  Keyed by the human-readable formation name
# (KLEI/ZAND/SILT/VEEN); any other formation falls back to neutral grey.
_FORMATION_COLORS: dict[str, str] = {
    "KLEI": "#7d8da0",
    "ZAND": "#f5e0a4",
    "SILT": "#c9b88d",
    "VEEN": "#3d2a18",
}
_DEFAULT_COLOR = "#9aa0a8"


def _color_for(formation_name: str) -> str:
    """Return the viewer colour for a formation NAME (grey fallback).

    Parameters
    ----------
    formation_name : str
        The human-readable formation name (e.g. ``"KLEI"``).

    Returns
    -------
    str
        A ``#rrggbb`` hex colour string.
    """
    return _FORMATION_COLORS.get(formation_name.upper(), _DEFAULT_COLOR)


def _world_centre(
    active_solids: list[tuple[str, str, list, list]],
) -> tuple[float, float]:
    """Return the world XY centroid ``(cx, cy)`` of all active solid vertices.

    The viewer centres on the bounding-box midpoint so the model sits at the
    origin regardless of the Lambert-72 magnitude of the source coordinates.

    Parameters
    ----------
    active_solids : list[tuple[str, str, list, list]]
        ``(body_id, formation_id, vertices, triangles)`` for unflagged solids
        with non-empty geometry.

    Returns
    -------
    tuple[float, float]
        ``(cx, cy)`` — the bounding-box midpoint in world coordinates.  Returns
        ``(0.0, 0.0)`` when there are no vertices.
    """
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    for _bid, _fid, verts, _tris in active_solids:
        for wx, wy, _wz in verts:
            min_x = min(min_x, wx)
            max_x = max(max_x, wx)
            min_y = min(min_y, wy)
            max_y = max(max_y, wy)
    if min_x == float("inf"):
        return 0.0, 0.0
    return (min_x + max_x) / 2.0, (min_y + max_y) / 2.0


def _body_to_viewer(
    formation_id: str,
    verts: list,
    tris: list,
    formation_names: dict[str, str],
    cx: float,
    cy: float,
) -> dict:
    """Convert one solid's geometry into the viewer's flat body dict.

    Parameters
    ----------
    formation_id : str
        The solid's formation id (used to resolve the display name + colour).
    verts : list
        World vertices as ``(wx, wy, wz)`` triples.
    tris : list
        Triangle index triples ``(i, j, k)`` into ``verts``.
    formation_names : dict[str, str]
        ``{formation_id_str: label}`` for the formation NAME.
    cx, cy : float
        The world XY centre to subtract.

    Returns
    -------
    dict
        ``{"formation", "color", "verts", "tris"}`` where ``verts`` is the flat
        ``[x, y, z, ...]`` triple array in three coordinates and ``tris`` the
        flat ``[i, j, k, ...]`` index array.
    """
    name = formation_names.get(formation_id, formation_id[:8])
    flat_verts: list[float] = []
    # World (wx, wy, wz) -> three [wx - cx, wz, -(wy - cy)]: x east-of-centre,
    # y = elevation (unchanged), z = -(north-of-centre) so three's +z points
    # toward the viewer with north-up.
    for wx, wy, wz in verts:
        flat_verts.append(wx - cx)
        flat_verts.append(wz)
        flat_verts.append(-(wy - cy))
    flat_tris: list[int] = []
    for i, j, k in tris:
        flat_tris.append(int(i))
        flat_tris.append(int(j))
        flat_tris.append(int(k))
    return {
        "formation": name,
        "color": _color_for(name),
        "verts": flat_verts,
        "tris": flat_tris,
    }


def _boreholes(
    columns: list[tuple[str, float, float, list]],
    active_solids: list[tuple[str, str, list, list]],
    formation_names: dict[str, str],
    cx: float,
    cy: float,
) -> list[dict]:
    """Build the viewer's borehole list from the authored columns.

    Each authored column yields a borehole entry carrying its authored stack,
    the ray-sampled model stack at the same point, and a ``wrong`` flag from the
    fidelity classifier (the columns the owner inspects).

    Parameters
    ----------
    columns : list[tuple[str, float, float, list]]
        ``(inv_id, x, y, authored_units)`` per investigation, where
        ``authored_units`` is ``(formation_id, top_elev_m, base_elev_m)``.
    active_solids : list[tuple[str, str, list, list]]
        ``(body_id, formation_id, vertices, triangles)`` for unflagged solids.
    formation_names : dict[str, str]
        ``{formation_id_str: label}`` for the formation NAME.
    cx, cy : float
        The world XY centre to subtract.

    Returns
    -------
    list[dict]
        One dict per investigation matching the viewer schema (``inv``, ``x``,
        ``z``, ``top``, ``base``, ``wrong``, ``authored``, ``model``).
    """
    out: list[dict] = []
    for inv_id, x, y, authored_units in columns:
        model_stack = _compute_model_stack(x, y, active_solids)
        verdict = _classify_column(authored_units, model_stack)

        authored = [
            {
                "f": formation_names.get(fid, fid[:8]),
                "top": round(top, 3),
                "base": round(base, 3),
            }
            for fid, top, base in authored_units
        ]
        # _compute_model_stack returns (formation_id, base_elev_m, top_elev_m).
        model = [
            {
                "f": formation_names.get(fid, fid[:8]),
                "top": round(top, 3),
                "base": round(base, 3),
            }
            for fid, base, top in model_stack
        ]

        # Authored column's shallowest top + deepest base (units are top-to-bottom).
        top_elev = authored_units[0][1]
        base_elev = authored_units[-1][2]

        out.append(
            {
                "inv": inv_id,
                "x": round(x - cx, 3),
                "z": round(-(y - cy), 3),
                "top": round(top_elev, 3),
                "base": round(base_elev, 3),
                "wrong": verdict == "wrong",
                "authored": authored,
                "model": model,
            }
        )
    return out


async def main() -> None:
    """Dump the built voxel litho model into the dev-viewer ``model.json``."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument(
        "--out",
        type=Path,
        default=_DEFAULT_OUT,
        help="output JSON path (default: voxel_viewer/model.json)",
    )
    args = ap.parse_args()
    model_id: UUID = args.model_id
    out_path: Path = args.out

    print("\n=== VOXEL VIEWER MODEL DUMP (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        formation_names = await _load_formation_names(session, model_id)
        print(f"  loaded {len(formation_names)} formation name(s)")

        picks = await LithoLayerRepository(session).load_body_picks(model_id)
        n_inv = len({p.investigation_id for p in picks})
        print(f"  loaded {len(picks)} pick(s), {n_inv} investigation(s)")

        solids = await _load_solids(session, model_id)
        print(f"  loaded {len(solids)} solid row(s)")

    # Active solids: unflagged and carrying actual geometry.
    active_solids = [
        (bid, fid, verts, tris)
        for bid, fid, verts, tris, is_flagged, _is_stale in solids
        if not is_flagged and verts and tris
    ]

    cx, cy = _world_centre(active_solids)

    bodies = [
        _body_to_viewer(fid, verts, tris, formation_names, cx, cy)
        for _bid, fid, verts, tris in active_solids
    ]

    columns = _authored_columns(picks)
    boreholes = _boreholes(columns, active_solids, formation_names, cx, cy)

    total_tris = sum(len(b["tris"]) // 3 for b in bodies)
    n_wrong = sum(1 for b in boreholes if b["wrong"])

    # cz is fixed at 0 to match the existing model.json (elevation is unchanged
    # and the viewer derives its own y-centre from the geometry bounds).
    model = {
        "center": [cx, cy, 0.0],
        "bodies": bodies,
        "boreholes": boreholes,
        "stats": {"bodies": len(bodies), "tris": total_tris},
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(model), encoding="utf-8")

    print("\n  --- SUMMARY ---")
    print(f"  bodies written     : {len(bodies)}")
    print(f"  total triangles    : {total_tris:,}")
    print(f"  boreholes          : {len(boreholes)}")
    print(f"  wrong boreholes    : {n_wrong}")
    print(f"  output             : {out_path}")
    print("\n=== DUMP COMPLETE ===\n")


if __name__ == "__main__":
    asyncio.run(main())
