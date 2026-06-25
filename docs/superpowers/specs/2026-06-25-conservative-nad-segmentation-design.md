# Conservative per-threshold NAD segmentation — design

**Date:** 2026-06-25
**Status:** ready for plan
**Owner directive:** brainstormed + visually validated against the owner's hand-placement on real CPT `GEO-22/115-S10` (dev DB litho model `019e934c…`).
**Scope:** the geotech NAD subdivision segmenter only (`suggest_geotech_subdivision`). The litho segmenter (`segment_cpt`) is untouched.

---

## 1. Problem

The geotech A3 segmenter (`suggest_geotech_subdivision`) classifies each CPT sample
to a NAD packing class, **median-smooths the class integers**, run-length-encodes,
then greedy-merges thin runs. On real data this is wrong three ways (all seen on
`GEO-22/115-S10`, rendered in the brainstorm companion):

1. **Over-split (threshold flapping).** Where qc wobbles across a class bound (e.g.
   the klei 1 MPa bound at 8.30 m), classify-per-sample flips and produces a
   spurious boundary that no real qc break supports.
2. **Boundary mis-placement.** Median-of-class lags a gradual transition: the silt
   boundary at 12.06 m sits ~0.4 m below the real qc break.
3. **Under-split / erased band.** The 12.57–16.97 m sand densifies matig → dicht →
   zeer-dicht, but median-of-class collapsed the whole upper half to matig and
   jumped straight to zeer-dicht — the **dicht band was erased**. (Owner: "should
   segment the sand above 10 MPa but does not".)

The owner's mental model when placing a boundary by hand: *key on both a qc break
and a class change, follow the general trend above/below, ignore a small dip or
spike, and be conservative — the weaker (less dense) class should claim a zone
where qc oscillates across a bound.*

## 2. Validated target (the acceptance anchor)

On `GEO-22/115-S10`, the deep sand must segment as:

| band | depth (m) | class |
|---|---|---|
| matig | 12.57 – 14.37 | n6 |
| **dicht** | **14.37 – 15.10** | **n7** |
| zeer-dicht | 15.10 – 16.97 | n8 |

The 15.10 m boundary is the owner's "dicht holds down to where qc reaches back
above 15"; 14.37 m is the conservative matig/dicht boundary. The n8 below 15.10 m
is correct — 90 % of raw qc samples there are ≥ 15 MPa (it is genuinely zeer-dicht,
not a spike artifact; harmonic smoothing was tried and rejected — it over-suppressed
and inserted a false 'los' dip). This spec's implementation MUST reproduce these
three bands at these depths (±0.1 m) on the real CPT.

## 3. Algorithm

`suggest_geotech_subdivision(soil, admixtures, depth_m, qc_mpa, segment_top_m,
segment_base_m, min_thickness_m, *, gradient_snap=True, gradient_snap_window_m=0.5)`
is rewritten. It runs **per geo-bounded litho segment** (one call = one segment),
so it never crosses a geological/lithological boundary — those are separate calls.
The segment top and base are FIXED (litho boundaries); only interior boundaries are
created.

Let `persist = max(1, round(min_thickness_m / median_increment))` samples.

### Step 1 — sustained threshold crossings
Restrict samples to `[segment_top_m, segment_base_m]`. For each **finite** qc upper
bound `T` in `NAD_QC_BANDS[(soil, variant)]` (e.g. clean sand → 4, 10, 15; the
variant is the clean/secondary choice already used by `classify_nad`):

1. `above[i] = qc[i] >= T` (boolean per sample, on **raw** qc).
2. **Persistence filter** `above`: any run (True or False) shorter than `persist`
   samples is flipped to its preceding run's value. This is the "ignore a small
   dip or spike" rule — a brief excursion across `T` does not move a boundary.
3. Every index `j` where the filtered `above[j] != above[j-1]` contributes a
   boundary depth `depth_m[j]`.

Collect all such boundary depths across all thresholds, plus `segment_top_m` and
`segment_base_m`, into a sorted, de-duplicated **cut set**.

### Step 2 — bands classified by median qc
For each interval `[a, b)` between consecutive cuts, the band class is
`classify_nad(soil, admixtures, median(qc in [a, b)))`. Median (not mean, not
harmonic) — robust to spikes without the harmonic over-suppression.

### Step 3 — conservative min-thickness merge
While any band is thinner than `min_thickness_m` and more than one band remains:
absorb the thinnest such band into its **lower-NAD-class-number neighbour**
(extend that neighbour's extent over the thin band, drop the thin band). If the
thin band has only one neighbour, use it. Within one soil family the NAD class
number is ordered loose→dense / weak→firm, so the lower number is always the
**weaker** class — absorbing into it makes the weaker class claim the ambiguous
zone (conservative). This is the change that holds dicht down to 15.10 m: the thin
zeer-dicht excursions above 15.10 m absorb into the dicht band above them.

### Step 4 — same-class weld
Adjacent bands with equal class are welded into one (reuse the
`_merge_adjacent_same_class` weld shipped 2026-06-25). Guarantees one contiguous
band per class run.

### Step 5 — gradient snap (bounded refinement)
Compute `|d(qc)/dz|` on a lightly-smoothed qc (≈ 0.3 m window) and find local-maxima
peaks above the 92nd percentile. For each interior boundary at depth `d`:

- Find the nearest gradient peak within `±gradient_snap_window_m`.
- Snap `d` to that peak **only if** the move does not make the boundary *less
  conservative*: for a densifying boundary (weaker class above, denser below) a
  snap may move `d` deeper or keep it, never shallower than the Step-1 conservative
  crossing; for a softening boundary (denser above, weaker below) a snap may move
  `d` shallower or keep it, never deeper. A sharp real contact sits at the crossing,
  so the guard rarely blocks; it only prevents a spike-peak from undoing
  conservatism.

After snapping, re-run Step 3 + Step 4 (a snap can create a sub-min or same-class
adjacency).

### Edge cases
- **No CPT samples** in the segment (borehole-only column): return a single band
  spanning the segment with the fallback class (`classify_nad(..., 0.0)`),
  unchanged from today. Borehole packing is extrapolated downstream
  (`SubdivideAllBodies` Phase-8b), not here.
- **qc never crosses a threshold** → that threshold contributes no cut; a uniform
  segment yields one band.
- **A single transient excursion** spanning the whole segment is absorbed by the
  persistence filter + Step 3 → one band.

## 4. Settings — new "Geotechnical subdivision" section

A new section in `SettingsDialog.tsx`, reading/writing
`view_state["geotech_subdivision"]` (SEPARATE from the litho `litho_segmenter`
knobs, so tuning one never moves the other), via a new
`utils/geotechSubdivisionPrefs.ts` (mirroring `lithoSegmenterPrefs.ts`):

- **Min layer thickness (m)** — `minimum_layer_thickness_m`, `NumberRow`, default
  **0.35**, range 0.1–3.0, step 0.05. Doubles as the Step-1 persistence length.
  Hint: "The thinnest NAD packing band kept; also the persistence a qc change must
  hold to move a boundary (ignores thinner dips/spikes)."
- **Gradient snap** — `gradient_snap_enabled`, `CheckboxRow`, default **on**. Hint:
  "Snap a boundary to a nearby sharp qc break for precision; never moves it to a
  less-conservative depth."
- **Gradient snap window (m)** — `gradient_snap_window_m`, `NumberRow`, default
  **0.5**, range 0.1–2.0; shown only when gradient snap is on.

These persist in the project bundle like every other `view_state` knob (no schema
migration — `view_state` is free-form JSON).

**Out of this spec (explicit):** the **raw-qc vs normalised (Qtn)** toggle the owner
asked about is a SEPARATE follow-up slice — it needs the overburden-normalisation
port (σ′v from unit weight + water table) and changes the classification basis, not
the segmentation shape. This spec ships raw-qc only (the current default). The
settings section is designed to hold the toggle when that slice lands; we do not
ship a dead/no-op control now.

## 5. Backend wiring

- `suggest_geotech_subdivision` gains the `gradient_snap` + `gradient_snap_window_m`
  keyword params (min thickness already a param). The per-threshold construction,
  persistence filter, conservative merge, and gradient snap are pure helpers in
  `geotech_subdivision.py` (the module already owns `_merge_adjacent_same_class`).
- `SubdivideAllBodies` already reads `minimum_layer_thickness_m` from `view_state`
  (`_read_min_thickness_m`); add a sibling read for `gradient_snap_enabled` +
  `gradient_snap_window_m` and pass them through to every
  `suggest_geotech_subdivision` call.
- `_build_column_plans` (per-CPT segmentation) is unaffected structurally — it still
  consumes `profile.splits`; only the splits' depths/classes change.

## 6. Testing

Pure-domain unit tests in `tests/unit/domain/test_geotech_subdivision.py`:

- **Persistence filter** — a 1-sample spike across a bound produces no boundary; a
  run ≥ persistence does.
- **Conservative merge** — a thin band between a weaker and a denser band absorbs
  into the weaker (lower class number), not the preceding one.
- **Per-threshold construction** — a synthetic densifying ramp (qc rising through
  two bounds with a sustained middle band) yields three bands, middle class present
  (the dicht-recovery case in miniature).
- **Conservative placement** — a synthetic oscillation across one bound places the
  boundary at the sustained re-entry, with the weaker class holding the oscillation.
- **Gradient snap guard** — a snap that would move a densifying boundary shallower
  than the conservative crossing is rejected; a snap deeper toward a sharp peak is
  applied.
- **Edge cases** — no samples → one fallback band; uniform qc → one band; same-class
  weld still holds.

**Real-data acceptance (the arbiter, per the project meta-rule):** a throwaway
eval re-materialises the dev DB geotech model and asserts the `GEO-22/115-S10` deep
sand segments matig 12.57–14.37 / dicht 14.37–15.10 / zeer-dicht 15.10–16.97 (±0.1 m).
The brainstorm prototype `scripts/throwaway_geotech_final.py` already produces this;
its `conservative_bands` is the reference implementation to port into the domain.

Frontend: `geotechSubdivisionPrefs.test.ts` (defaults + clamping, mirroring
`lithoSegmenterPrefs.test.ts`) and a `SettingsDialog` render test for the new rows.

## 7. Out of scope
- Raw-vs-normalised (Qtn) classification toggle — follow-up slice (§4).
- Auto-correlating adjacent CPTs with the same packing sequence (separate roadmap
  item — true litho subdivision).
- Manual editing of NAD boundaries + qc recompute (separate roadmap item).
- Any change to the litho segmenter, the partition fill, or the 3D builder.
