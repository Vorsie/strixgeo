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

### Candidate technologies when a hotspot does emerge

Order roughly by solo-dev ease — pick the lowest one that fits.

1. **Numba** (`@njit`) — **ADOPTED 2026-06-16 (Phase 4).** First real use:
   `voxel_litho/greedy_mesh._maximal_rectangles_njit`, the profiled
   mesh-extraction hotspot (93.6 % of extraction; cProfile pinned it, no
   guessing). Measured 38.6× on the real `test.strix` workload (31.1 s →
   0.81 s over 113,796 captured masks), **byte-identical rectangles** (pinned
   by a 360-mask property test vs the scalar reference + the identical
   317,182-tri build output), `cache=True` so only the first call per session
   pays the ~0.6 s warm-up. Took the on-click voxel Build 67 s → 37.5 s.
   Justified for Phase 4 (not deferred to 5) because the Build must run on
   lower-spec **distribution** machines. Cost: a hard dependency, +119 MB
   (llvmlite bundles LLVM); per-OS wheels + a PyInstaller hook at packaging
   time. Decorator-only; no separate toolchain, releases the GIL inside the
   JIT'd function. Best fit for embarrassingly parallel numeric loops with
   HEAVY per-call work (`maximal_rectangles` does a full greedy raster-scan per
   call). **Labelling — MEASURED, not worth per-function njit (2026-06-16).**
   The now-dominant ~29 s labelling phase is "millions of TINY operations"
   (`_slice_region_intervals` etc. — 19.9 M calls), where Numba's per-call
   dispatch overhead dominates: a spike on its cleanest leaf got only **1.5×**
   (byte-identical), and the heaviest leaves (`_fill_band_voids`,
   `_clip_stack_to_band`) are `_Entry`-dataclass-based and not njit-able at all
   without restructuring. The ONLY path to a big labelling win is rewriting the
   whole per-column kernel to operate on numpy arrays in ONE `@njit` call (no
   per-op dispatch) — a large, byte-identity-risky refactor, deferred until a
   real lower-spec machine proves 37.5 s is too slow. Lesson: njit pays off for
   FEW-heavy calls, not MANY-tiny ones.
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

## Frontend render performance (desktop)

These are the desktop-side responsiveness measures for large projects
(target: ~5000 CPTs). Unlike the backend escape hatches above they are
not profiled hotspots — they are structural render costs that grow
linearly with the marker / row / redraw count.

- **Map markers render on a canvas, not one SVG element each.** The
  Leaflet map is created with `preferCanvas: true` (the streaflet
  `MapContainer` forwards it to `L.map`), so the CPT `CircleMarker`s —
  which live in a custom pane and therefore honour `preferCanvas` via
  Leaflet's `_getPaneRenderer` — paint onto a shared canvas. At thousands
  of markers the per-marker SVG DOM was what made panning stutter. Marker
  tooltips are one shared `L.tooltip` opened on hover (`showMarkerTooltip`
  in `MapView.tsx`) rather than a `bindTooltip` per marker, so no
  per-marker Tooltip object is allocated up front. Ring/size styling is
  `markerRingStyle` in `mapMarkerStyle.ts`.
- **A static 3-D scene stops redrawing.** Every `CesiumWidget` is built
  with `requestRenderMode: true` + `maximumRenderTimeChange: Infinity`
  (`REQUEST_RENDER_WIDGET_OPTIONS` in `sceneRender.ts`). An idle geological
  model then burns no GPU frames. The cost is that every scene mutation
  must explicitly `requestSceneRender(scene)` — done after each primitive
  rebuild (`CesiumViewport`), after the fence-cutout fine-zoom
  (`useViewportZoomTuning`), and, for compare mode, a per-frame render
  pump keeps the FOLLOWER viewport live so it can mirror the leader
  (`useCameraLink`) — the one case where continuous render is still wanted.
- **The Data inspector lists are windowed.** `DataInspector`'s CPT and
  borehole lists render through `react-window` (`dataInspectorVirtualList.tsx`)
  so only the rows in/around the viewport mount, not one DOM row per test.
- **`/cpt/plot-batch` is chunked client-side to the 500-id backend cap.**
  `cptClient.plotBatch` splits a dense corridor into ≤500-id POSTs and
  merges in order (a body over 500 ids is a 422 —
  `CptPlotBatchRequest.ids` carries `max_length=500`).
