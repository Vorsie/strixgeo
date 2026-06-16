"""Real-data CPU + SQL profiling harness for the implicit-stratigraphic 3-D builder.

Profiles ONE full build of the ``test.strix`` lithostratigraphic model to find the
TRUE wall-time hotspots before any optimisation work.  Two independent measurement
passes:

1. **CPU profile** (cProfile + pstats) — profiles the synchronous CPU-bound core
   directly:

   * Inputs loaded outside the profiler (ResolveLithoInstances, load_body_picks,
     AssembleStratInputs.assemble) so the profiler captures only the compute kernel.
   * ``build_strat_model_with_fields`` + ``carve_lenses`` + ``merge_meshes_by_body_id``
     profiled together; inputs that are already in memory at that point are profiled
     separately in the overhead section.
   * ``pstats`` output sorted by BOTH ``cumulative`` (call-tree cost) and ``tottime``
     (self time — THIS reveals which function actually does the work, not just which
     orchestrates it).  Top 30 each.

2. **Persist profile** (SQLAlchemy engine listener) — measures DB-bound cost
   separately from CPU:

   * A ``before_cursor_execute`` / ``after_cursor_execute`` listener on the engine's
     ``sync_engine`` times EVERY SQL statement (driver time, not application time).
   * Total statement count, total SQL wall-time, and UPSERT-only breakdown.
   * Python-side payload serialisation (the ``[list(v) for v in mesh.vertices]``
     loops, which convert each mesh's vertices + triangles to JSON-able lists for
     the ORM) is timed SEPARATELY so the SQL-vs-Python split is clean.

3. **Final SUMMARY** — top 5 self-time (tottime) functions + the persist split.

Usage
-----
    uv run python scripts/profile_strat_build.py
    uv run python scripts/profile_strat_build.py --grid-spacing 2.0
    uv run python scripts/profile_strat_build.py --model-id <uuid>

Safety guard: aborts if the DATABASE_URL is not the dev ``groundmodel`` DB.
"""

from __future__ import annotations

import argparse
import asyncio
import cProfile
import io
import pstats
import sys
import time
from pathlib import Path
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np  # noqa: E402
from sqlalchemy import event  # noqa: E402

from groundmodel.application.assemble_strat_inputs import AssembleStratInputs  # noqa: E402
from groundmodel.application.recompute_litho_solids import RecomputeLithoSolids  # noqa: E402
from groundmodel.application.resolve_litho_instances_use_case import (  # noqa: E402
    ResolveLithoInstances,
)
from groundmodel.domain.services.strat_field.body_assembly import build_shared_grid  # noqa: E402
from groundmodel.domain.services.strat_field.lens_carving import (  # noqa: E402
    carve_lenses,
    merge_meshes_by_body_id,
)
from groundmodel.domain.services.strat_field.strat_builder import (  # noqa: E402
    build_strat_model_with_fields,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from groundmodel.shared.config import settings  # noqa: E402

_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")
_DEFAULT_GRID_SPACING_M = 2.0


def _confirm_db_target() -> None:
    """Print the DB DSN and abort if it is not the dev ``groundmodel`` DB.

    Safety gate identical to ``eval_strat_builder.py`` — this script writes
    ``litho_body_solid`` rows via the full ``RecomputeLithoSolids`` in the
    persist pass.

    Raises
    ------
    SystemExit
        If the DSN does not name ``groundmodel`` or names an ``_integration`` /
        ``_test`` sibling.
    """
    url = settings.database_url
    print(f"  DB target: {url}")
    if "groundmodel" not in url:
        raise SystemExit(f"ABORT: DSN does not contain 'groundmodel' — refusing to run ({url!r}).")
    if url.rstrip("/").endswith(("_integration", "_test")):
        raise SystemExit(
            f"ABORT: DSN names an integration/test DB — this profiler must run against "
            f"the dev 'groundmodel' DB only ({url!r})."
        )
    print("  DB target OK (dev groundmodel).")


def _pstats_top(pr: cProfile.Profile, sort_key: str, n: int = 30) -> str:
    """Return the pstats formatted top-N table for one sort key as a string.

    Parameters
    ----------
    pr : cProfile.Profile
        The completed profiler.
    sort_key : str
        ``'cumulative'`` or ``'tottime'``.
    n : int
        Number of rows to return.

    Returns
    -------
    str
        The pstats text output.
    """
    buf = io.StringIO()
    ps = pstats.Stats(pr, stream=buf)
    ps.sort_stats(sort_key)
    ps.print_stats(n)
    return buf.getvalue()


def _profile_cpu_build(
    assembly,  # StratAssembly — already in memory
    grid_spacing_m: float,
) -> tuple[cProfile.Profile, float, list, dict]:
    """Run the CPU-bound build kernel under cProfile and return the profile + results.

    Parameters
    ----------
    assembly : StratAssembly
        Pre-loaded assembly (from ``AssembleStratInputs.assemble``).
    grid_spacing_m : float
        Build-grid spacing.

    Returns
    -------
    (cProfile.Profile, float, list, dict)
        ``(profiler, wall_time_s, meshes, host_height_fields)``
    """
    pr = cProfile.Profile()
    t0 = time.perf_counter()
    pr.enable()

    meshes, host_height_fields = build_strat_model_with_fields(
        assembly.control,
        assembly.domain,
        blocks=[assembly.domain],
        grid_spacing_m=grid_spacing_m,
    )

    if assembly.lens_carve_inputs:
        gx, gy, node_inside = build_shared_grid(assembly.domain, grid_spacing_m)
        meshes = carve_lenses(
            assembly.lens_carve_inputs,
            meshes,
            gx,
            gy,
            node_inside,
            host_height_fields=host_height_fields,
        )

    meshes = merge_meshes_by_body_id(meshes)

    pr.disable()
    wall_s = time.perf_counter() - t0
    return pr, wall_s, meshes, host_height_fields


def _time_serialisation(meshes: list) -> float:
    """Time the Python-side payload serialisation (vertices + triangles → lists).

    This is the ``[list(v) for v in mesh.vertices]`` loop that ``RecomputeLithoSolids``
    runs BEFORE the SQL upsert to build JSON-able payloads.  Isolating it here lets
    the persist profiler separate "time building Python lists" from "time in the driver".

    Parameters
    ----------
    meshes : list of LithoBodyMesh
        The built meshes (same object the upsert path would consume).

    Returns
    -------
    float
        Wall-time in seconds for the serialisation loop.
    """
    t0 = time.perf_counter()
    for mesh in meshes:
        # Mirrors the RecomputeLithoSolids row-building exactly:
        _verts = [list(v) for v in mesh.vertices]
        _tris = [list(t) for t in mesh.triangles]
        _ = (_verts, _tris)  # prevent the loop from being optimised away
    return time.perf_counter() - t0


class _SqlTimer:
    """Collects per-statement execution times from SQLAlchemy engine events.

    Attach via :meth:`install` and detach via :meth:`remove`.  After the
    measured session completes, read :attr:`total_statements`,
    :attr:`total_sql_s`, :attr:`upsert_count`, and :attr:`upsert_sql_s`.

    Parameters
    ----------
    sync_engine : Engine
        The ``async_engine.sync_engine`` (the sync shim under the async engine)
        that SQLAlchemy fires ``before_cursor_execute`` / ``after_cursor_execute``
        on.
    """

    def __init__(self, sync_engine) -> None:
        """Initialise with a sync engine (the async engine's ``.sync_engine`` attribute)."""
        self._engine = sync_engine
        self.total_statements: int = 0
        self.total_sql_s: float = 0.0
        self.upsert_count: int = 0
        self.upsert_sql_s: float = 0.0
        # Per-statement start time stored on the connection's info dict.
        self._installed = False

    def install(self) -> None:
        """Register the before/after cursor execute listeners."""
        event.listen(self._engine, "before_cursor_execute", self._before, retval=False)
        event.listen(self._engine, "after_cursor_execute", self._after)
        self._installed = True

    def remove(self) -> None:
        """Deregister the listeners (must be called after the measurement)."""
        if not self._installed:
            return
        event.remove(self._engine, "before_cursor_execute", self._before)
        event.remove(self._engine, "after_cursor_execute", self._after)
        self._installed = False

    # SQLAlchemy before_cursor_execute signature:
    # (conn, cursor, statement, parameters, context, executemany)
    def _before(self, conn, cursor, statement, parameters, context, executemany):
        """Record start time on the connection info dict."""
        conn.info["_profiler_t0"] = time.perf_counter()

    def _after(self, conn, cursor, statement, parameters, context, executemany):
        """Accumulate elapsed time + classify the statement."""
        t0 = conn.info.pop("_profiler_t0", None)
        if t0 is None:
            return
        elapsed = time.perf_counter() - t0
        self.total_statements += 1
        self.total_sql_s += elapsed
        # Classify: an upsert carries "INSERT" + "ON CONFLICT" (case-insensitive).
        stmt_upper = statement.upper()
        if "INSERT" in stmt_upper and "ON CONFLICT" in stmt_upper:
            self.upsert_count += 1
            self.upsert_sql_s += elapsed


async def _profile_persist(model_id: UUID) -> _SqlTimer:
    """Run the full RecomputeLithoSolids with SQL timing and return the timer.

    Uses a fresh session so the result is independent of the CPU profile pass.
    The build is ``force=True`` so it always rebuilds from scratch.

    Parameters
    ----------
    model_id : UUID
        The lithostratigraphic model to rebuild.

    Returns
    -------
    _SqlTimer
        The populated SQL timer (listeners already removed).
    """
    from groundmodel.infrastructure.db.session import engine as async_engine  # noqa: PLC0415

    timer = _SqlTimer(async_engine.sync_engine)
    timer.install()
    try:
        async with AsyncSessionFactory() as session:
            await RecomputeLithoSolids(session).execute(model_id, force=True)
    finally:
        timer.remove()
    return timer


async def main() -> None:
    """Run the two-pass profiler and print the hotspot report."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument("--grid-spacing", type=float, default=_DEFAULT_GRID_SPACING_M)
    args = ap.parse_args()
    model_id: UUID = args.model_id
    grid_spacing_m: float = args.grid_spacing

    print("\n=== STRAT BUILD PROFILER ===\n")
    _confirm_db_target()
    print(f"  model_id    : {model_id}")
    print(f"  grid_spacing: {grid_spacing_m} m\n")

    # ------------------------------------------------------------------
    # Phase A: load inputs (outside the profiler — these are I/O-bound,
    # not compute-bound, and we want the CPU profile to focus on the math).
    # ------------------------------------------------------------------
    print("--- Phase A: loading inputs ---")
    t_load = time.perf_counter()
    async with AsyncSessionFactory() as session:
        await ResolveLithoInstances(session).execute(model_id=model_id, commit=False)
        picks = await LithoLayerRepository(session).load_body_picks(model_id)
        assembly = AssembleStratInputs(session).assemble(picks, grid_spacing_m=grid_spacing_m)
    load_s = time.perf_counter() - t_load

    if assembly is None:
        raise SystemExit("ABORT: assembly is None (domain unbuildable). Can't profile.")

    n_picks = len(picks)
    n_inv = len({p.investigation_id for p in picks})
    n_bodies = len({p.body_id for p in picks})
    n_ctrl = len(assembly.control.points)
    n_horizons = len(assembly.control.column.horizons)
    n_lenses = len(assembly.lens_carve_inputs)
    print(f"  picks={n_picks}  investigations={n_inv}  bodies={n_bodies}")
    print(f"  control_points={n_ctrl}  horizons={n_horizons}  lenses={n_lenses}")
    print(f"  load wall-time: {load_s:.2f} s\n")

    # ------------------------------------------------------------------
    # Phase B: CPU profile — build_strat_model_with_fields + carve + merge
    # This is the compute kernel; the profiler captures self-time accurately.
    # ------------------------------------------------------------------
    print("--- Phase B: CPU profile (cProfile) ---")
    print(f"  profiling build at grid_spacing={grid_spacing_m} m ...")
    pr, cpu_wall_s, meshes, host_height_fields = _profile_cpu_build(assembly, grid_spacing_m)
    n_meshes = len(meshes)
    total_verts = sum(len(m.vertices) for m in meshes)
    total_tris = sum(len(m.triangles) for m in meshes)
    print(f"  build wall-time (profiled): {cpu_wall_s:.1f} s")
    print(f"  meshes={n_meshes}  total_verts={total_verts}  total_tris={total_tris}\n")

    # Print top-30 sorted by cumulative (call-tree cost — shows orchestration depth).
    print("--- cProfile: top 30 by CUMULATIVE time ---")
    print(_pstats_top(pr, "cumulative", 30))

    # Print top-30 sorted by tottime (self time — shows where CPU actually burns).
    print("--- cProfile: top 30 by TOTTIME (self time) ---")
    print(_pstats_top(pr, "tottime", 30))

    # ------------------------------------------------------------------
    # Phase C: Python serialisation timing (isolated from SQL).
    # ------------------------------------------------------------------
    print("--- Phase C: Python serialisation timing ---")
    ser_s = _time_serialisation(meshes)
    print(f"  [list(v) for v in mesh.vertices/triangles] loop: {ser_s:.3f} s")
    print(f"  ({n_meshes} meshes, {total_verts} verts, {total_tris} tris)\n")

    # ------------------------------------------------------------------
    # Phase D: SQL / persist profile — full RecomputeLithoSolids with
    # engine-level timing.  This builds the meshes internally again, so
    # it is independent of the CPU profile pass.
    # ------------------------------------------------------------------
    print("--- Phase D: SQL / persist profile ---")
    print("  running RecomputeLithoSolids(force=True) with SQL timer ...")
    t_persist = time.perf_counter()
    timer = await _profile_persist(model_id)
    persist_wall_s = time.perf_counter() - t_persist
    print(f"  full persist wall-time (includes build): {persist_wall_s:.1f} s")
    print(f"  SQL statements total : {timer.total_statements}")
    print(f"  SQL wall-time total  : {timer.total_sql_s:.3f} s")
    print(f"  UPSERT statements    : {timer.upsert_count}")
    print(f"  UPSERT SQL wall-time : {timer.upsert_sql_s:.3f} s")
    non_upsert_sql = timer.total_sql_s - timer.upsert_sql_s
    print(f"  non-UPSERT SQL time  : {non_upsert_sql:.3f} s")
    print()

    # ------------------------------------------------------------------
    # SUMMARY — the actionable hotspot table.
    # ------------------------------------------------------------------
    print("=" * 70)
    print("HOTSPOT SUMMARY")
    print("=" * 70)

    # Extract top-5 self-time from the cProfile data.
    stats = pstats.Stats(pr, stream=io.StringIO())
    stats.sort_stats("tottime")
    # pstats internal data: stats.stats[key] = (cc, nc, tt, ct, callers)
    rows = sorted(stats.stats.items(), key=lambda kv: kv[1][2], reverse=True)[:10]

    total_cpu = pr.getstats()[0].totaltime if pr.getstats() else cpu_wall_s  # fallback

    # Use sum of all tottime values as 100 % base.
    all_tt = sum(v[2] for v in stats.stats.values())

    print("\nTop 10 SELF-TIME (tottime) functions:")
    print(f"  {'tottime':>10}  {'%cpu':>6}  {'cumtime':>10}  {'ncalls':>8}  function")
    print(f"  {'-' * 10}  {'-' * 6}  {'-' * 10}  {'-' * 8}  --------")
    for (file, lineno, func), (cc, nc, tt, ct, _callers) in rows:
        pct = (tt / all_tt * 100) if all_tt > 0 else 0.0
        fname = Path(file).name if file else "?"
        print(f"  {tt:10.3f}  {pct:6.1f}%  {ct:10.3f}  {nc:8d}  {func} ({fname}:{lineno})")

    print(f"\nBuild CPU tottime total  : {all_tt:.1f} s (profiled wall: {cpu_wall_s:.1f} s)")
    print(f"Python serialisation     : {ser_s:.3f} s ({n_meshes} meshes)")
    print(
        f"\nSQL persist (total)      : {timer.total_sql_s:.3f} s  ({timer.total_statements} stmts)"
    )
    print(f"  of which UPSERT SQL    : {timer.upsert_sql_s:.3f} s  ({timer.upsert_count} stmts)")
    print(f"  non-UPSERT SQL         : {non_upsert_sql:.3f} s")
    print(f"\nFull persist wall-time   : {persist_wall_s:.1f} s")

    # Infer the CPU fraction of the full persist wall-time.
    # The persist pass also runs the build; the CPU time is approximately
    # cpu_wall_s (from Phase B) + ser_s.  The gap is SQL.
    cpu_est = cpu_wall_s + ser_s
    sql_est = timer.total_sql_s
    print("\nEstimated split (persist pass):")
    print(f"  build CPU (~Phase B)   : {cpu_est:.1f} s")
    print(f"  SQL (driver time)      : {sql_est:.3f} s")
    print(f"  unexplained overhead   : {max(0.0, persist_wall_s - cpu_est - sql_est):.1f} s")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
