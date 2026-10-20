# Benchmarks Journal

> End-to-end / real-model wall-clock timings and perf journeys. These are
> **documentation, not regression gates** (CLAUDE.md → Testing Strategy).
> Append a dated section when something motivates re-measurement; never edit
> prior sections. In-process CPU-bound regression gates live in
> `tests/benchmarks/` instead.

---

### Performance baseline (2026-05-09, Python 3.11.15, Windows 11)

Re-measured after Phases C1–C4 + the helper-extraction refactor. Numbers
are mean wall-clock per call from `pytest-benchmark`. **Times shifted
~5–7× faster across the board vs. the 2026-05-07 baseline** — explained
by a hardware change: a 32 GB RAM module added in a second slot.
Memory-bound work (Polars frame allocation in the GEF parser, XML
ElementTree parsing for large DOV documents, ndarray scaling in the Ic
series) all benefits from the increased bandwidth + capacity. Same
Python version, same package versions, no code change.

Saved as `pytest-benchmark` named baseline ``baseline`` (run
``uv run pytest tests/benchmarks/ --benchmark-enable --benchmark-compare=baseline``
to detect future regressions against this snapshot).

Previously-flagged Rust candidates (`ic_series` 100k, GEF parse 100k)
now both land well within Python's range; **no active Rust candidates
remain**.

| Benchmark | Mean | Verdict |
|---|---|---|
| `calculate_ic` (1 point) | 284 ns | fine |
| `classify_soil_ic` (1 point) | 58 ns | fine |
| `ic_series` 100 pts | 0.15 ms | fine |
| `ic_series` 1 000 pts | 1.6 ms | fine |
| `ic_series` 10 000 pts | 10.4 ms | fine |
| `ic_series` 100 000 pts | 90 ms | fine (was Rust candidate) |
| GEF parse 100 rows | 0.82 ms | fine |
| GEF parse 1 000 rows | 2.8 ms | fine |
| GEF parse 10 000 rows | 22 ms | fine |
| GEF parse 100 000 rows | 238 ms | borderline (was Rust candidate) |
| Real files (5 DOV GEFs) | 15 ms | fine |
| DOV CPT XML parse 100 rows | 0.86 ms | fine |
| DOV CPT XML parse 1 000 rows | 4.5 ms | fine |
| DOV CPT XML parse 10 000 rows | 42 ms | fine |
| DOV boring parse minimal (1 seg + 1 field-log/kind) | 41 µs | fine |
| DOV boring parse typical (7 seg + 4 field-log/kind) | 86 µs | fine |
| DOV boring parse large (100 seg + 50 field-log/kind) | 0.83 ms | fine |
| DOV grain-size parse minimal (1 curve point) | 32 µs | fine |
| DOV grain-size parse typical (12 points) | 64 µs | fine |
| DOV grain-size parse large (200 points) | 0.59 ms | fine |
| DOV interpretation parse minimal (1 layer) | 29 µs | fine |
| DOV interpretation parse typical (12 layers, 2 admix each) | 141 µs | fine |
| DOV interpretation parse large (200 layers, 3 admix each) | 2.9 ms | fine |
| TIN compute 5 contacts (tiny) | 0.48 ms | fine |
| TIN compute 20 contacts (small) | 0.53 ms | fine |
| TIN compute 100 contacts (medium) | 0.90 ms | fine |
| TIN compute 500 contacts (large) | 2.6 ms | fine — supports drag-to-refresh UX |
| TIN slice 20 contacts (small) | 19 µs | fine |
| TIN slice 100 contacts (medium) | 67 µs | fine |
| TIN slice 500 contacts (large) | 277 µs | fine — slice is essentially free |

### Litho CPT segmenter (2026-05-17, #55, same machine)

`bench_litho_segmentation.py`. The litho segmenter is the only
CPU-bound per-element surface the litho feature added (Robertson-2015
per-point n-convergence + median-smooth + RLE + greedy min-thickness
merge). It runs **per investigation, on user click ("Suggest litho")**
— not per render frame, not auto-batched. A typical CPT ≈ 1 000 rows
(20 m @ 2 cm).

| Benchmark | Mean | Verdict |
|---|---|---|
| `qtn_f_ic_core` 1 000 rows | 8.2 ms | fine — Robertson iterative core |
| `qtn_f_ic_core` 10 000 rows | 49 ms | fine |
| `qtn_f_ic_core` 50 000 rows | 187 ms | fine (stress upper bound) |
| `segment_cpt` 1 000 rows | 10.4 ms | fine — full pipeline, typical CPT |
| `segment_cpt` 10 000 rows | 67 ms | fine — dense / over-sampled log |
| `segment_cpt` 50 000 rows | 280 ms | fine — ~1 km, shape not realism |

Scaling is linear-ish (1k→50k ≈ 27× for 50× rows; no superlinear
blow-up). The Robertson core is ~70 % of `segment_cpt` and is the
only Numba/Rust-shaped candidate — but at the realistic 1 000-row /
~10 ms per click it is nowhere near the escape-hatch threshold. A
500-CPT corridor swept one click at a time stays interactive; a
hypothetical batch-all-500 (not a current UI path) ≈ 5 s of pure
compute — still I/O-dominated by the DOV import that precedes it.
**No active Rust candidate** — consistent with the 2026-05-09
conclusion.

### Litho-3D solid builder (2026-06-10, Python 3.11.15, Windows 11)

`bench_litho_solid_builder.py`. `build_body_solids` is the CPU-bound
per-model surface added by the litho-3D milestone-2 builder: for each body
it fits a TIN via SciPy Delaunay (C-backed) for the top and base contact
surfaces, then assembles top + base + side-wall triangles into a closed
watertight mesh. A per-contact surface cache ensures that adjacent bodies
sharing a contact (base-of-upper == top-of-lower) call `compute_tin` only
once for that contact level. It runs **once per model, on the user-clicked
Build** — not per render frame, not auto-batched.

Synthetic fence: investigations on a staggered 50 m grid (non-collinear),
bodies stacked vertically (adjacent base/top shared → cache exercised). Zero
flagged slabs — all solids are real TIN meshes (sanity-asserted in the bench).

| Benchmark | Mean | Verdict |
|---|---|---|
| `build_body_solids` 10 bodies × 6 inv | 7.1 ms | fine — tiny fence, instantaneous |
| `build_body_solids` 50 bodies × 12 inv | 202 ms | fine — realistic project section |
| `build_body_solids` 200 bodies × 30 inv | 906 ms | fine — stress upper bound; ~1 s on Build click |

Wall time is dominated by `compute_tin` calls per unique contact level (201
unique TIN calls at 200 bodies × 30 investigations, each ~4.5 ms). The shared-
surface cache halves the raw call count vs. no-cache at the shared-contact
levels. Scaling is linear in unique contact levels × Delaunay cost (O(n log n)
in investigation count). **No active Rust/Numba candidate** — the heavy lift
is SciPy's C-backed Delaunay, and even the 200-body / ~1 s case is fine for
an on-click Build (not a per-frame loop). Consistent with the "no active Rust
candidates" conclusion across all previous benchmarks.

**M3 re-measure (2026-06-11, `feat-litho-3d-m3-watertight`, shared-contact
builder + enclosed-lens void):** same synthetic fence + a new lens case
(~5 enclosed lenses per 50-body column, matrix carved as a solid-with-void).
Measured in ONE M3 run: 10×6 = 6.1 ms · 50×12 = 32.8 ms · **50×12 + 5 lenses
= 43.4 ms** · 200×30 = 192.8 ms. The lens case adds ~30 % over the plain
medium (the extra `detect_enclosed_lenses` + `merged_body_extent` +
`build_extent_solid` + `append_void` per matrix-with-void). The mid/large
numbers read lower than the M2 rows above, but that is a CROSS-RUN comparison
(different day/machine state), NOT a head-to-head — treat the apparent speedup
as unverified; the only safe claim is the M3 absolute numbers + the lens
overhead. Still no active Rust/Numba candidate. (M3 = milestone 3: bodies tile
watertight via one shared surface per contact; enclosed lens = matrix body with
an interior void. Tasks 1–9 shipped; Task 10 multi-patch facies stitch deferred
pending dogfeed.)

### Litho-3D watertight LOFT builder (2026-06-13, `feat-litho-3d-watertight-loft`)

The per-body-TIN / facies-prism / disk-marker builder is RETIRED; the 3D litho
model is now LOFTED from the validated 2D section partitions (spec
`docs/superpowers/specs/2026-06-12-watertight-loft-body-builder-design.md`).
`bench_litho_solid_builder.py` re-pointed at `build_loft_meshes` on a synthetic
N-section × N-body field:

| Bench | Mean |
|---|---|
| 2 sections × 10 bodies | 44.8 ms |
| 3 sections × 50 bodies | 226.9 ms |
| 3 × 50 + one-sided lens | 235.9 ms |
| 5 sections × 200 bodies | ~1.96 s |

Cost is dominated by `field.stack_at` per Delaunay node (the alpha-hull grid) +
the per-triangle wedge emission. Still no active Rust/Numba candidate — the heavy
lift is SciPy's C-backed Delaunay + Python wedge assembly, fine for an on-click
Build.

**Real-data eval (`test.strix`, dev DB :5433, litho model 019e934c…):** a full
rebuild of the real model = **11.7 s** (14 sections, 58 on-section tests, 5 geo
bands → 134 watertight meshes, **0 flagged / 0 disk markers**, was 32 markers).
~11 s is the real-fixture Build wall-clock (more grid nodes than the synthetic
bench); interactive-but-not-instant, and the e2e Build waits were bumped to 90 s
to match. Overshoot diagnostic (solid-min-elev vs deepest accepted pick, per
lithology): KLEI/ZAND 0.00, SILT +0.35 (above its pick), **VEEN −1.17 m at 61 of
9350 verts (0.65 %)** — a localised interpolation/pinch edge effect on a thin
peat, NOT the old facies-overshoot class (which is gone for every substantive
lithology). Recorded as a known minor limit for owner visual judgment; crossing-
section visual refinement is Phase-5 out-of-scope per the spec.

### Litho-3D implicit strat-field builder (2026-06-14, `feat-litho-3d-strat-field`)

The watertight loft builder is RETIRED; the 3D litho model is now built from an
**implicit potential field** (cubic RBF via SciPy ``RBFInterpolator``) fit
through accepted litho contacts, assembled as watertight height-field prisms
over a regular grid.  `bench_litho_solid_builder.py` re-pointed at
`build_strat_model` on the `widely_spaced_build_fixture` (7 investigations at
Lambert-72 magnitude, ~680 × 700 m footprint, four-band ZAND/KLEI/ZAND/KLEI
interbedded stack — the real-data-shaped fixture that exposed the coordinate-
spread RBF explosion in Task 8.5).

| Bench (grid spacing) | Mean | Grid nodes (approx) | Verdict |
|---|---|---|---|
| coarse 5 m | 1.51 s | ~19 200 | fine — fast preview quality, blocky tapers |
| medium 2 m | 10.79 s | ~120 000 | fine — realistic field-visit quality |
| fine 1 m (prod default) | 51.95 s | ~476 000 | interactive-but-slow for 7 investigations |

**Cost breakdown:** the hot path is height-field sampling — for every grid node
and every interior horizon the builder finds the monotone z-crossing of the
potential field (a Python + NumPy loop over ~28 control points per evaluation).
Node count ≈ hull_area / spacing², so halving the spacing roughly 4× the cost
(measured: 5→2 m ≈ 7×, 2→1 m ≈ 4.8×; the 5→2 m ratio is higher because the
block bounding rectangle overshoots the hull). The RBF fit itself is
sub-second (28 control points — trivial). Cell-complex boundary assembly is
light (O(N_body × n_cells), < 5 % of wall time at all spacings).

**Real-data eval:** Task 11 will measure the wall-clock for the real
`test.strix` model at 1 m spacing (the new prod default). The 52 s synthetic
number is for 7 investigations over 680 × 700 m; a real project with more
investigations but a tighter corridor may differ significantly.

**No active Rust/Numba candidate** — the heavy lift is SciPy's C-backed
``RBFInterpolator.predict`` at every grid node. The Python height-field
sampling loop *is* vectorisable (the field evaluation is already batched per-
node via NumPy), but at the realistic 1 m spacing / on-click-Build UX model
profiling first is the right gate (CLAUDE.md escape-hatch rule). Consistent
with the "no active Rust candidates" conclusion across all previous benchmarks.

### Litho-3D implicit strat-field LENS CARVE (2026-06-14, `feat-litho-3d-strat-field`)

`bench_lens_carve.py`. `carve_lenses` is the final stage of the geology-bounded
lens-in-lens builder: after the matrix bodies are assembled it carves each
enclosed minority back into its host as a two-prism cavity (host-upper-plus-outer
+ host-lower straddling the lens prism) so a column through the lens reads
HOST / LENS / HOST — the real `test.strix` KLEI/SILT/KLEI over-merge signature.

The carve was the dominant real-data hotspot. Resolving a carved host's
single-valued `(top, base)` height field used to mean an O(grid_nodes × triangles)
vertical RAY-CAST per host (`_prism_height_fields`); on the real `test.strix`
model that carve ran **~410 s** (of a 573 s build). The fast path threads the
per-node `(top, base)` arrays that body assembly already computed
(`build_strat_model_with_fields` / `assemble_bodies_with_fields`) into
`carve_lenses(..., host_height_fields=...)`, so each chosen host is an O(nodes)
dict lookup + copy instead of a ray-cast. Synthetic fixture =
`widely_spaced_enclosed_lens_carve_fixture` (7 investigations at Lambert-72
magnitude over the ~680×700 m `_WIDE_SPECS` footprint, a ZAND/KLEI/SILT/KLEI/ZAND
stack where one `klei_host` brackets a SILT minority → 1 depth-1 enclosed lens).
Saved baseline `.benchmarks/.../0002_strat_lens_carve.json` (gitignored, local).

| Benchmark | Mean | Verdict |
|---|---|---|
| `carve_lenses` threaded @ 20 m | 31.8 ms | fast path, very coarse |
| `carve_lenses` threaded @ 5 m | 618 ms | fine |
| `carve_lenses` threaded @ 2 m | 4.53 s | realistic field-visit quality |
| `carve_lenses` threaded @ 1 m | 45.8 s | prod default; O(cells) emission bound, high variance (24–96 s) |
| `carve_lenses` RAY-CAST fallback @ 20 m | 6.67 s | the removed path |
| end-to-end build+carve @ 2 m | 62.4 s | full on-Build wall-time (field fit + matrix + carve) |

**Headline — threaded vs ray-cast at the SAME 20 m grid: 31.8 ms vs 6.67 s ≈ 210×
faster.** This is the win from threading the height fields (the real-data
~410 s → seconds carve). The geometry is byte-identical to the ray-cast path
(pinned by `test_threaded_host_fields_are_geometrically_identical_to_raycast`);
only the wall-clock differs. The ray-cast tier is run at 20 m + `min_rounds=1`
only — at 5 m with default rounds it exceeded 15 minutes (the O(nodes×triangles)
cost we eliminated), so a single very-coarse sample documents the ratio.

**Remaining cost is NOT the carve's to fix:** the threaded carve still scales
~1/spacing² (node/cell count) because `emit_prism_bodies` (the pure-Python
cell-complex boundary) is O(cells) — the SAME cost the matrix build pays
(`build_strat_model` fine-1m ≈ 52 s above). So at the 1 m production default a
real *fine* build stays heavy (carve ~tens of s + matrix ~tens of s + persist);
the eval + dogfeed use 2 m. If a fine-1m Build ever needs to be interactive, the
lever is vectorising / Numba-ing `emit_prism_bodies` for BOTH the matrix build
and the carve at once — profile first per the CLAUDE.md escape-hatch rule. **No
active Rust/Numba candidate yet** — on-click Build at 2 m is acceptable.

### Litho-3D real-data build wall-time journey (2026-06-15, `test.strix` @ 2 m)

Real `test.strix` (58 investigations, 102 resolver bodies → 6 lenses + 96 matrix
backbone → 664 emitted meshes after band-split + lens carve + body_id merge),
rebuilt via `scripts/eval_strat_builder.py --grid-spacing 2.0`. Always
`built=664 flagged=0 columns_with_overlap=0 max_overlap=0` (watertight). The
build wall-time came down in two stages:

| Build | Total | Matrix | Carve | Persist | What changed |
|---|---|---|---|---|---|
| old loft (retired) | — | — | — | — | 50 m-scale overlaps, didn't build the cycle |
| carve ray-cast | 573 s | ~97 s | ~410 s | ~79 s | the un-optimised lens carve (`_prism_height_fields` per host) |
| carve threaded | 180 s | ~100 s | ~3 s | ~75 s | carve reuses assembly height fields (~137× carve win) |
| profiled opts (A+B+C) | 84 s | 36 s | 1 s | 46 s | persist serialisation + present-cells + ndimage labelling |
| **+ cell-complex vectorise (D)** | **54 s** | **15 s** | **1 s** | **37 s** | **`_build_component_mesh` XOR-mask boundary (the deferred risky one)** |

**The lesson (`feedback_profile_before_optimizing`, the hard way):** a FIRST,
guess-based optimisation round (batch the persist statements + vectorise the
height-field crossing scan) moved the 180 s build by ~0 — because neither was the
real hotspot. cProfile (`scripts/profile_strat_build.py`) on the real model then
showed the truth, and the SECOND, data-backed round got a **2.2× speedup**:
- **Matrix build 100 → 36 s.** `_present_cells` (~21 s incl. its `all(...)` /
  `any(isnan...)` genexprs) → numpy corner-slice mask; `_label_components` (~5 s
  Python BFS) → `scipy.ndimage.label` (4-connected, C, same raster component
  order). Both equivalence-pinned vs the scalar oracle.
- **Persist 75 → 46 s.** The biggest persist cost was NOT the 664 round-trips
  (already batched to 7 chunks) — it was ~39 s of pure-Python `[list(v) for v in
  mesh.vertices]` tuple→list churn over 4.7 M verts + 9.4 M tris to feed the JSONB
  binder. Dropped entirely by passing the `list[tuple]` straight to the binder
  (json serialises tuples as arrays identically; round-trip JSONB byte-identical).
  The remaining 46 s is the actual asyncpg JSONB serialisation + DB write — mostly
  irreducible without changing the storage format.
- The height-field crossing-scan vectorisation (guess round) DID work in
  isolation (`_sample_height_fields` ~97 s→2.7 s in the profile) but was never the
  matrix bottleneck — the cell-emission loops were.

**Remaining at 54 s:** matrix build ~15 s (lean now), carve ~1 s, **persist ~37 s**
— the latter is the actual asyncpg JSONB serialisation + DB write of 4.7 M verts +
9.4 M tris, largely irreducible without changing the storage format (e.g. a binary
geometry column instead of JSONB — a backwards-compat-sensitive change, deferred).
`_build_component_mesh` WAS vectorised (D) via the XOR-mask boundary rule (a face
is boundary iff exactly one adjacent cell is present → pure numpy, no per-cell dict
churn), gated by closed-manifold + same-solid ray-equality on full / pinch-hole /
split fixtures. 54 s at 2 m is a fine one-time on-click Build (checksum short-circuit
skips a rebuild on unchanged picks). The application-level CPU levers are now spent;
the next frontier is the JSONB persist format, which is a storage decision, not a
hot-loop fix.

### DOV import end-to-end (live network)

**⚠ Throughput is payload-size-bound, not request-count-bound — the
single most load-bearing caveat in this section.** A CPT's cost is
dominated by its depth-series XML size + the Polars frame build, NOT
by the HTTP round-trip. The early "500 CPTs in ~5 s" numbers were
measured on a *shallow-CPT* bbox; they do NOT generalise. Always
read these against "how deep are the CPTs in this bbox", never just
"how many".

| Scenario | rate | Notes |
|---|---|---|
| Cold, shallow CPTs, sem=50 + stream + skip-302 | ~100 CPT/s | the old "~5 s / 500" best case — shallow only |
| **Cold, deep CPTs (~1 000–1 600 rows, some 3 000+)** | **~6 CPT/s** | measured 2026-05-17: 316 CPTs cold = **54 s**. Payload + frame-build bound, not throttle |
| Cold borehole family, same run/network | ~40–48 items/s | 168 boreholes 3.5 s · 303 interp 7.6 s · 322 grain-size 7.9 s — tiny payloads, ~7× faster per item than deep CPT |
| Warm cache (any size) | ~0.2–0.5 s | filesystem reads + DB commit, network skipped |

**HTTP/2 is a dead end — PROVEN by live probe 2026-05-17, do not
re-investigate.** A probe with the production client config
(`make_dov_async_client`: `http2=True`, `h2` 4.3.0 installed, ALPN
offered) against the real `xdov/proxy/export/sondering/*` AND the WFS
endpoint returned **`HTTP/1.1` on both, no redirects**
(`Server: Departement Omgeving`). DOV's front end is HTTP/1.1-only;
there is no h2 to negotiate. The original "+HTTP/2 → ~5 s / 500,
12×" row in the table above was **never real on this endpoint** (or
DOV dropped h2 since) — it was almost certainly a shallow-bbox
measurement misattributed to a protocol change. Treat that row as
retired. gzip, by contrast, IS already in effect: the export returns
`Content-Encoding: gzip` (`Vary: accept-encoding`) with httpx's
default `Accept-Encoding` — no win available there, we are already
compressed on the wire.

**Per-CPT payload is the wall: a *typical* CPT export decodes to
~0.5 MB of XML** (probe: 509,650 bytes for sondering 2024-093260).
×316 ≈ ~157 MB to pull (gzipped on the wire) + ElementTree-parse +
Polars-frame. DOV server-side latency is a floor only for shallow
CPTs (~50–100 CPT/s peak, ~10–20/s throttled); for deep CPTs the
floor is DOV's HTTP/1.1 per-IP serving rate for ~0.5 MB documents,
which is why a 316-CPT cold import takes ~54 s and no client-side
tuning closes that gap. Sub-5 s fresh-data import for *deep* bboxes
needs the architectural change (see CLAUDE.md "DOV Import" — a local
mirror would make every query <200 ms regardless of depth); it is
the ONLY lever that breaks the DOV-server-bound ceiling.

**Pre-Phase-3 timing baseline (2026-05-17, profiling instrumentation
added to `ImportCpt.persist()` and existing phase logs in
`ImportCptDov.execute()`):**

Phase timing from a 316-CPT cold import on the measured baseline run:

| Phase | Time | Notes |
|---|---|---|
| Phase 1 — WFS index | ~1 s | recursive bbox-split, a few HTTP calls |
| Phase 2 — download + parse | ~50 s | 316 × ~0.5 MB XML, ElementTree + Polars, sem=50 |
| Phase 3 — batch dedup | ~20 ms | single IN-query for all test_ids |
| Phase 4 — persist (no commit) | ~200 ms | ORM map + session.add × 316, no flush |
| Phase 5 — single commit | ~300 ms | one fsync for all 316 INSERTs |
| **Total cold** | **~54 s** | download/parse is >92% of wall time |

Parse is ~170 ms per CPT on the event loop (ElementTree + Polars frame
build). With `PARSE_OFFLOAD_MIN_BYTES = 50_000` (Phase 3), large XMLs
move to `ProcessPoolExecutor` workers so the event loop stays responsive
during the 50 s download+parse window. Expected win: event loop freed
for `202` response + SSE queue draining during the heavy phase.

**Conclusion (2026-05-09 re-measurement):** Python handles every benchmarked
workload comfortably. The previously-flagged Rust candidates from the
2026-05-07 baseline (`ic_series` 100k @ 582 ms; GEF parse 100k @ 1.35 s) now
land at 90 ms and 238 ms respectively — well within Python's range.
**No active Rust candidates.** The Phase B parsers (DOV boring, grain-size,
interpretation) all run in microseconds-to-low-ms; none is a CPU bottleneck.

Phases 2–4 (data ingest / storage / viz / exports) are I/O- and framework-bound
— Rust wouldn't help. The Rust question becomes a Phase 5 question only if
batch model statistics or 100k+ Ic points become the bottleneck on real
project data; profile then, don't pre-empt.

**Language choice if a Phase 5 hotspot does emerge:** ordered low-cost-
to-high-cost — **Numba** (`@njit(nogil=True, parallel=True)`,
decorator-only, no toolchain, GIL-release inside the JIT'd function)
first, then **Cython / mypyc**, then **Rust + PyO3**, with **Go**
(cgo) or **C# NativeAOT** as fall-backs if PyO3's learning curve is
the blocker. **CUDA is not a candidate** — our biggest plausible
workload (~5 M points run once per project) sits below GPU break-
even, and the BE/NL consulting market is not GPU-rich. Free-threaded
Python 3.14 is tracked-not-adopted: dep-tree wheel coverage + a
measured multi-threaded CPU workload both need to land before
switching from the GIL build. See CLAUDE.md "Performance Escape
Hatches" for the full reasoning.

## 2026-07-28 — voxel build: the spacing/time trade-off, measured

Dev model `019e934c-70fd-7d11-a44a-b2073f4063a2` (58 investigations, 16 sections,
4 geo surfaces), compute only — DB load and persist excluded.

| horizontal | vertical | label | extract | total | grid | bodies | tris |
|---|---|---|---|---|---|---|---|
| 2.0 m | 0.25 m | 32.6 s | 29.7 s | **62.3 s** | 311×326×107 = 10.8 M | 112 | 998 k |
| 2.0 m | 0.5 m | 33.8 s | 17.6 s | **51.3 s** | 311×326×54 = 5.5 M | 111 | 612 k |
| 3.0 m | 0.5 m | 15.2 s | 9.5 s | **24.7 s** | 208×218×54 = 2.4 M | 110 | 386 k |

**The load-bearing observation: `label_voxels` scales with the number of
map-plane COLUMNS, not with the voxel count.** Halving the vertical spacing left
label untouched (32.6 → 33.8 s) and only halved extract; widening the horizontal
spacing 2 → 3 m halved BOTH (2.2× fewer columns). So horizontal spacing is the
dominant lever on build time, and vertical spacing is nearly free on the labelling
side — the opposite of the intuition that finer Z is what costs.

Profiled hotspots at 2.0/0.25 (cProfile, so absolute numbers run ~35 % high):

* extract — `_split_pinched_edges_by_midpoint` **12.9 s tottime** (112 calls, the
  single largest item in the whole build), `triangulate_subdivided_rect` 5.7 s
  (350 k calls), `np.ascontiguousarray` 3.2 s (166 k calls — the per-slice copy
  the Numba mesher needs, deliberate), `_maximal_rectangles_njit` 3.1 s (already
  JIT'd and no longer the bottleneck).
* label — `_project_to_section_fence` 7.5 s cumulative (528 k calls: every
  in-footprint column projects onto every section), `evaluate_tin_at` 3.9 s
  (151 k), `_project_point_to_segment` 3.7 s (2.6 M).

Next candidates, in payoff order: (1) `_split_pinched_edges_by_midpoint`;
(2) a bounding-box lower bound in the per-column section ranking so a column only
projects onto sections that could be in its nearest two — exact, not approximate;
(3) Numba on the labelling loop (the long-standing candidate).

## 2026-08-03 — build responsiveness: the event loop during a build

Why this section exists: the two CPU phases of `BuildVoxelLithoModel` moved to
`asyncio.to_thread`, and the numbers justifying that move lived only in code
comments, with no committed reproducer — unre-measurable after any later change to
the labelling or the mesher. The reproducer now exists:
`scripts/diag_build_event_loop_stall.py` (offline, no database).

**Method.** Run phases 2 (`label_voxels`) and 3 (`extract_body_solids`) both ways —
inline, as the route used to, and through `asyncio.to_thread` — with a 10 ms
`asyncio.sleep` heartbeat task ticking alongside. A dead loop cannot tick, so the
tick count and the longest gap between two ticks measure exactly what the engineer
feels. `to_thread` runs first so the Numba mesh kernel is already JIT-compiled and
the compile time is not charged to the inline row.

Windows 11, Python 3.11, same machine as the 2026-07-28 section.

`scripts/throwaway_v2_voxel_payload.json` — 14 sections, h 2.0 m, v 2.0 m:

| phases | label | extract | total | heartbeat ticks | worst stall |
|---|---|---|---|---|---|
| `asyncio.to_thread` | 4.7 s | 2.5 s | 7.2 s | 211 | 137 ms |
| inline | 4.6 s | 2.4 s | 7.1 s | **1** | **7 067 ms** |

`scripts/throwaway_geotech_voxel_payload.json` — 12 sections, h 2.0 m, v 0.25 m:

| phases | label | extract | total | heartbeat ticks | worst stall |
|---|---|---|---|---|---|
| `asyncio.to_thread` | 6.0 s | 49.2 s | 55.2 s | 2 360 | 84 ms |
| inline | 6.1 s | 49.8 s | 55.8 s | **1** | **55 829 ms** |

Two things to carry forward:

* **Off the loop costs nothing and buys everything.** Total wall clock is
  unchanged either way (within noise); the loop goes from one tick per build to
  ticking throughout, worst stall from the whole build to well under 150 ms.
* **`extract_body_solids` is the expensive half, and it scales with vertical
  spacing** — 2.5 s at v = 2.0 m against 49.2 s at v = 0.25 m, while labelling
  barely moves (4.7 → 6.0 s). Same shape as the 2026-07-28 spacing sweep; the
  mesher is where any future build-time work belongs.

The earlier in-code claim ("12 ticks in 19.2 s inline against 725 ticks, worst
stall 155 ms") shipped without a reproducer and does not correspond to either
captured payload; these rows replace it.

The behaviour — not the numbers — is pinned by
`tests/unit/application/test_build_voxel_litho_model.py::test_another_request_is_served_while_the_labelling_runs`.
A second Build now WAITS on `_BUILD_CPU_LOCK` rather than running alongside the
first, so every figure above describes one build at a time by construction.

## 2026-08-18 — the Discard replace-restore ("Delete backup hogs the app")

Measured on the owner's real `test.strix` (10 MB: 68 CPTs / 258k series
cells, 29 boreholes, 3 models, 640 litho layers, 640 edges, 10,721 body
geometry facts), REPLACE restore against the integration DB, port 8766:

| phase | before | after |
|---|---|---|
| whole REPLACE restore (server) | 13.8 s | **10.3 s** |
| body geometry facts insert (10,721 rows) | 3.5 s | ~0.1 s (bulk insert) |

Remaining server profile (~10.3 s): resolver verification × 2 models ≈ 2.0 s ·
borehole tree inserts ≈ 1.1 s · formations/contacts/surfaces ≈ 1.3 s ·
sections/reviews/layers ≈ 1.0 s · wipe 0.4 s · 10 MB JSON parse/transfer
≈ 0.8 s · the rest spread. The renderer adds its full reload on top.
Candidates if the owner wants more: bulk-insert the remaining phases
(~2 s), skip/thin the post-restore resolver when the bundle carries clean
body stamps (~2 s, needs care — BF1 depends on the reconcile), and a
progress overlay instead of a frozen window (renderer, worktree).


## 2026-10-19 — pick consistency check

`tests/benchmarks/bench_pick_check.py`: `check_formation_picks` (full-refit
leave-one-out, n + 1 REML fits with L-BFGS-B) on a smooth synthetic surface
(seed 7, 0.2 m noise), owner's laptop (i7-13700HX, 24 logical cores), default
BLAS threads, pytest-benchmark means over 5–20 rounds. Budget (spec §8):
≤ 1 s for 50 picks, ≤ 5 s for 200.

"After" = C(h) and ∂C/∂log r from one shared exp(-a)
(`matern32_covariance_and_dlog_range`) + the held-out mask and distance
submatrix built once per pick and shared by refit and kriging. Results are
bit-identical (max |Δz| = 0 on the fixture, the fixture without B16 and all
four bench sets; B16 z = 5.419259601530037, S16 −5.370042041989834,
2025-01415 S4 3.287161709056412 before and after).

| picks | before mean (min) | after mean (min) | after, 1 BLAS thread |
|---|---|---|---|
| 18 | 0.052 s (0.047) | 0.048 s (0.044) | — |
| 50 | 1.07 s (0.42) | 0.38 s (0.37) | 0.14 s |
| 100 | 3.72 s (1.45) | 1.07 s (1.06) | — |
| 200 | 6.84 s (6.55) | **5.68 s** (5.60) | 5.7 s |

The "before" 50/100 means were inflated by machine load (wide min-max); the
200 row is the honest comparison (−17 %). n = 200 is **still over the 5 s
budget**, in every thread setting (4 threads: 5.8–6.1 s).

Profile after (n = 200, 201 fits, 2 263 REML evaluations): `cho_solve` against
I 1.6 s, the shared Matérn pair 1.3 s, `numpy cholesky` 1.2 s, the objective
body 0.6 s, scipy L-BFGS-B overhead ~1 s.

LAPACK `dpotri` for K⁻¹ was tried and rejected: at n = 200 it costs 3.3–3.5 ms
under OpenBLAS's default threading against 0.5 ms for `cho_solve` (n = 200
whole check: 13 s); single-threaded it would win (0.34 vs 0.62 ms). The
default-thread OpenBLAS is pathological on these small matrices in general
(`numpy.linalg.inv` 13.6 ms default vs 0.85 ms single-threaded), and n = 50 is
2.7x faster single-threaded. Next step (Numba only after profiling, spec §8, or
pinning BLAS threads for the worker) is the session main's call.
