# Performance Escape Hatches

> Extracted from `CLAUDE.md` 2026-06-06 to keep the always-loaded file lean. Load this on demand when the pointer in CLAUDE.md says so.

## Performance Escape Hatches

| Phase | Approach |
|---|---|
| 1–4 | Pure Python + Polars (data ingest, storage, viz, exports — all I/O- or framework-bound, native code wouldn't help) |
| 5 (final) | Profile first, then replace genuine hotspots: batch Ic across a project, batch statistics across the geological model, spatial interpolation for formation surfaces |

Native code does not help: API routing, DB queries, HTTP downloads —
anything I/O-bound. asyncio + httpx + asyncpg already release the GIL
during I/O. Bench results in `CLAUDE.local.md` show current Python
performance is fine for typical project scopes; the escape hatch gets
used only when benchmarks prove Python is the bottleneck for a
real Phase 5 workload (the 2026-05-09 baseline retired all previously-
flagged candidates).

### Candidate technologies when a Phase 5 hotspot does emerge

Order roughly by solo-dev ease — pick the lowest one that fits.

1. **Numba** (`@njit(nogil=True, parallel=True)` + `prange`).
   Decorator-only; no separate toolchain, ships as a wheel, releases
   the GIL inside the JIT'd function. Best fit for embarrassingly
   parallel numeric loops: per-row Ic across all CPTs in a project,
   batch statistics. As of 2026-05 Numba 0.63 supports Python 3.14
   and ships experimental free-threading.
2. **Cython / mypyc**. Static compilation of Python-shaped code.
   Useful when the hot path is mostly Python control flow, not
   numeric loops. Adds a build step.
3. **Rust + PyO3**. Highest performance ceiling and the best
   Python-interop story of the native-language options. Cost: a
   parallel toolchain, a parallel test surface, and a parallel
   release flow. Reach for it only when Numba+Cython have both
   been measured and found wanting.
4. **Go (cgo / shared lib via ctypes)** or **C# (NativeAOT)** —
   viable fall-backs if the Rust learning curve is the blocker.
   Worse Python-interop than PyO3, better than nothing.

**CUDA is NOT on the list.** Two reasons: (a) our biggest plausible
workload is ~500 CPTs × ~10 k rows ≈ 5 M points run once per project
— GPU transfer + JIT overhead dwarfs the compute at that scale; (b)
BE/NL consulting laptops are not GPU-rich, and requiring NVIDIA
hardware is a customer-loss bet for this niche.

### Free-threaded Python (no-GIL) — tracking, not adopting

Python 3.14 (released Oct 2025) ships an officially supported
free-threaded build (PEP 779, Phase II) — no longer experimental,
but not yet the default. **We stay on the GIL build for now.**

Three conditions gate switching:

1. **Every Strix dep ships free-threaded wheels.** Today's gap:
   compatibility for psycopg / asyncpg / pyproj / shapely / ezdxf /
   defusedxml is in flux; check
   https://py-free-threading.github.io/tracking/ before any move.
2. **A measured CPU-bound multi-threaded workload exists in the
   codebase that pays for the migration.** The current bottleneck
   is I/O (DOV throttling, fsync) — free-threading helps neither.
3. **Phase III lands** (free-threaded becomes default) — at that
   point the question becomes "stay on legacy GIL or follow the
   ecosystem", not "is it worth the risk."

When (1) + (2) align before (3), revisit. Until then it's a watch
item, not an action.
