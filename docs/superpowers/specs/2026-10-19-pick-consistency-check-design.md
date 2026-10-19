# Pick consistency check (uncertainty slice A0) — design

Date: 2026-10-19. Status: approved in the design interview (owner, 2026-10-19); this file records it.

## 1. Problem

A geological model is only as good as its picks. A wrong pick (a contact placed at the wrong depth at one test) does two kinds of damage:

1. The model bends through the wrong value at that test.
2. Every later uncertainty estimate learns "how much do picks scatter?" from all picks together, so one wrong pick makes the uncertainty bands **wider everywhere**. On the worked example (Cross-section 1, top of Egem) the P5–P95 band is 1.9 m wide with one wrong pick and 1.3 m without it.

Real case that motivated this slice: borehole GEO-02/146-B16 and CPT GEO-02/145-S16 stand 0.4 m apart. Their top of Egem differs by 1.7 m (9.7 m vs 11.4 m depth). Owner ruling: the clean sand 9.9–11.4 m (Rf < 1 %) is Quaternary, so the DOV interpretation in B16 (Egem from 9.7 m) is too high.

The check finds such picks automatically and tells the engineer. It is the first slice of the uncertainty work (A: contact uncertainty → B: realisations → C: parameter spread); the statistics built here are reused by A and B.

## 2. What it does / does not do

Does:

- For every formation of a **geological** model, check every pick against its neighbours and flag picks that do not fit.
- Run **always, in the background**, after any pick change; never block the user.
- Show a badge on the Stratigraphy stage ("⚠ 2 picks to check"); a click opens the list.

Does not:

- Change, move or hide any pick. The engineer decides.
- Use absences, or "deeper than end depth" information from tests that stop above a contact (these come with slice A, the envelope).
- Check litho or geotech models (later slices).
- Write to the database or the project file (no migration, no bundle change, no backwards-compatibility risk).
- Persist dismissals (see §10, open item).

## 3. The method in plain steps

For one formation, for each test in turn:

1. **Cover up the test.** Pretend it was never done.
2. **Guess its pick from the neighbours.** Each neighbour gets a vote; close neighbours get a big vote. (Worked example: S16, 0.4 m from B16, gets 96 % of the vote.)
3. **Compare.** The guess comes with a "give or take" (σ). z = (real pick − guess) / σ says how many times further off than normal the pick is. (B16: guess −4.13 ± 0.29 m TAW, pick −2.45 m → z = 5.7.)
4. **Flag** when |z| > 3. By chance alone this happens about 1 time in 370.

What is "normal" is learned from the data: for every pair of tests, how far apart they are and how much their picks differ. The fitted curve through those pairs (the variogram) sets the votes and the σ.

## 4. The math

### 4.1 Data

For formation *f* of geological model *m*: every `formation_contact` with a known investigation location (x, y) and ground elevation. Pick elevation z = ground elevation − `depth_top_m` (m TAW). One value per investigation; a CPT and a borehole at the same spot are two observations.

Fewer than `MIN_PICKS = 6` picks → status `too_few_picks`, no computation.

### 4.2 Model

z(x) = μ + Y(x) + ε, with μ an unknown constant (ordinary kriging), Y a zero-mean Gaussian field with Matérn-3/2 covariance

C(h) = s · (1 + √3·h/r) · exp(−√3·h/r)

and ε independent pick noise with variance

τᵢ² = floorᵢ² + n

where *n* ≥ 0 is the fitted extra nugget and floorᵢ is the source floor (owner ruling 2026-10-19). The sum is smooth for the optimiser and still guarantees that a pick is never treated as more accurate than its floor:

| Pick source | floor |
| --- | --- |
| CPT (`manual_pick` on a CPT) | 0.10 m |
| borehole (`borehole_observation`, or `manual_pick` on a borehole) | 0.25 m |

Semivariogram (the "green curve"): γ(h) = n + s·[1 − (1 + √3·h/r)·exp(−√3·h/r)]. Expected absolute difference between two picks h apart: √(2γ(h))·√(2/π).

### 4.3 Fitting (s, r, n)

Restricted maximum likelihood (REML, the constant mean integrated out), parameters on log scale, bounded:

- r ∈ [20 m, 5 000 m], s ∈ [1e-4, 1e4] m², n ∈ [1e-4, 1e2] m².

Optimiser: L-BFGS-B with **analytic gradients** of the REML objective. Start from a data-driven guess (s = sample variance, r = median nearest-neighbour distance × 3, n = 0.1²); one extra start at r × 10 if the first lands on a bound.

### 4.4 Leave-one-out with refit (anti-masking)

A single fit on all picks can **mask** a wrong pick: the wrong pick inflates the fitted nugget, which then makes the same pick look normal (worked example: B16 z = 1.9 masked, z = 5.7 with refit). Therefore each held-out test *i* is judged by a model **refit without it**:

1. Fit (s, r, n) on all picks → θ̂.
2. For each *i*: refit on all picks except *i*, warm-started at θ̂ (L-BFGS-B, max 30 iterations) → θ̂₋ᵢ.
3. Ordinary-kriging prediction at *i* with θ̂₋ᵢ: weights w solve [K 1; 1ᵀ 0]·[w; λ] = [k; 1]; guess ẑᵢ = wᵀz₋ᵢ; σᵢ² = s + τᵢ² − wᵀk − λ (kriging variance plus the held-out pick's own noise).
4. zᵢ = (zᵢ − ẑᵢ)/σᵢ; flag if |zᵢ| > `Z_FLAG = 3.0`.

Performance devices, see §8. Required: analytic gradients, warm start from θ̂, and recomputing only the formations whose picks changed. Optional, only if the benchmark needs it: obtain the first factorisation of K₋ᵢ from the full Cholesky factor by a rank-one downdate (O(n²) instead of O(n³)).

Self-check reported per formation: the share of picks whose real value falls inside their own 90 % band (|z| ≤ 1.645). Expected ≈ 90 %; far lower means the model is too confident.

### 4.5 Easy-terms version (goes in the manual)

- Votes: kriging, not inverse-distance weighting. IDW gives votes by distance only and no σ; kriging takes votes from the fitted curve, shares the vote between neighbours that stand together, and gives a σ.
- "Give or take" for B16: the guess is almost only S16. S16's pick has noise ±0.21 m and B16's pick has noise ±0.21 m; over 0.4 m the ground hardly changes; two independent 0.21 m errors give √(0.21² + 0.21²) ≈ 0.30 m (exact: 0.29 m).

## 5. Architecture

Backend (Python; domain pure, numpy/scipy only):

```
src/groundmodel/domain/services/geostat/
  matern_covariance.py          # C(h), γ(h), expected |diff|
  reml_objective.py             # REML value + analytic gradient (ordinary kriging)
  fit_covariance_model.py       # bounded L-BFGS-B fit, warm start → CovarianceModelFit
  ordinary_kriging.py           # weights, prediction, kriging variance
  leave_one_out_check.py        # refit-LOO loop, z, flags, coverage
  pick_noise_floor.py           # source → floor
  geostat_constants.py          # MIN_PICKS, Z_FLAG, bounds, floors, max iterations
src/groundmodel/domain/models/  # frozen dataclasses: PickObservation, CovarianceModelFit,
                                # PickCheckResult, PickFlag, FormationPickCheck
src/groundmodel/application/check_contact_consistency.py      # use case (loads picks, runs domain, logs)
src/groundmodel/application/contact_consistency_cache.py      # in-process cache keyed by (model, formation, picks digest)
src/groundmodel/api/routers/geology/contact_consistency.py    # GET endpoint
src/groundmodel/api/schemas/geology/contact_consistency.py
```

One class per file, constants in `geostat_constants.py`, `GroundModelLogger` on the use case and cache, numpy docstrings throughout.

API (read-only, additive):

`GET /projects/{project_id}/geology/models/{model_id}/contact-consistency`

```json
{
  "status": "ready" | "computing",
  "formations": [
    {
      "formation_id": "…", "formation_name": "Formatie van Tielt - Lid van Egem",
      "status": "checked" | "too_few_picks",
      "n_picks": 17,
      "fit": {"range_m": 209.0, "sill_sd_m": 3.44, "nugget_sd_m": 0.21},
      "coverage_90": 0.82,
      "flags": [
        {"investigation_id": "…", "investigation_kind": "borehole", "investigation_name": "GEO-02/146-B16",
         "contact_id": "…", "pick_elevation_m": -2.45, "predicted_elevation_m": -4.13, "sigma_m": 0.29, "z": 5.7,
         "nearest": {"investigation_name": "GEO-02/145-S16", "distance_m": 0.4, "pick_elevation_m": -4.15}}
      ]
    }
  ]
}
```

Background behaviour: the endpoint returns cached results at once. A formation whose picks digest changed is recomputed in a worker thread (numpy releases the GIL) and reported as `computing` until done; the desktop refetches. The cache lives in the engine process (lost on restart, recomputed on first request). No database write.

Desktop:

- `api/clients/geology.ts`: `getContactConsistency`.
- `hooks/useContactConsistency.ts`: fetch on Stratigraphy-stage mount and after every contact mutation (debounced 2 s); poll every 2 s while `computing`; project/model guard as in PR #90 (no request for a closed project's model).
- `shell/stages/geology/PickCheckBadge.tsx` beside the existing crossings banner: "⚠ N picks to check" / spinner while computing / nothing when clean.
- `shell/stages/geology/PickCheckPanel.tsx`: list grouped by formation. Row: test, pick, expected ± σ, "6× further off than normal" (z in words), nearest test with distance and its pick. Action **Show** selects the test (global selection). Footer per formation: fitted range, pick uncertainty, self-check %.
- Strings in EN and NL; numbers formatted by locale.

## 6. Error handling

- Missing elevation or location → the pick is skipped and counted (`skipped_no_elevation`), logged with the investigation names.
- Optimiser failure or non-positive-definite matrix → formation status `fit_failed` with the reason; never a 500 for the whole response. Jitter 1e-8 on the diagonal before giving up.
- All picks identical → s on its lower bound, no flags; logged.

## 7. Tests (red first)

Domain (unit, no DB):

- Hand-worked 3-point ordinary kriging example (weights, prediction, variance) computed on paper in the test docstring — the project rule for every correlation.
- γ(h) and C(h) values at h = 0, r, 10r.
- REML analytic gradient equals central finite differences (rtol 1e-5).
- Closed-form fixed-parameter LOO equals brute-force LOO.
- **Masking test:** a synthetic field with a co-located pair 1.7 m apart → naive single-fit LOO does not flag (documents the trap), refit LOO flags both.
- Floors: a co-located borehole/CPT pair 0.41 m apart is not flagged with the floors and is flagged without them.
- `too_few_picks` below 6; `fit_failed` path.
- Worked-example fixture (public DOV tests, top Egem, 17 picks) → flags B16 and S16 on the stored picks, does not flag B12/S12. The result for 2025-01415 S4 (prototype z ≈ 3.2, the test on the 13 m high ground) is recorded in the test output, not asserted: it is an owner call whether that pick is wrong.

Application/API: cache hit/miss on picks digest; `computing` → `ready`; integration test of the endpoint on the integration DB; project scoping (foreign model id → 404).

Desktop (Vitest): badge states; panel rendering and **Show**; refetch after a contact mutation; no request after a project switch.

Benchmark: `tests/benchmarks/bench_pick_check.py` for n = 18, 50, 100, 200 picks.

## 8. Performance budget

Measured on the prototype (naive Nelder–Mead, 12 starts, no gradients): one fit 0.16 s (18 picks) to 108 s (200 picks); full refit-LOO ~3 s (18) to ~6 h (200). The guess step itself is milliseconds; the cost is the fitting.

Budget per formation on the owner's laptop: **≤ 1 s for 50 picks, ≤ 5 s for 200 picks**, full refit-LOO included. The linear algebra already runs in compiled LAPACK; the budget is met by the algorithm (gradients, warm start, downdates, per-formation caching), not by a language change. If the benchmark misses the budget after that, the next step follows `docs/performance.md`: profile, then Numba on the proven hotspot.

Measured on the worked-example fixture with L-BFGS-B (numerical gradients, floors added to the noise): 17 refits in 0.13 s; flags B16 (+5.4), S16 (−5.4), 2025-01415 S4 (+3.3); B12/S12 not flagged.

## 9. Documentation (owner standard, 2026-10-19)

A manual page `docs/manual/chapters/methods/pick-consistency-check.rst` (linked from `03-methods.rst`) at explainer depth:

1. plain steps on the worked example (B16);
2. the math (§4);
3. the math in easy terms (§4.5, kriging vs IDW);
4. figures generated by `scripts/manual_figures/pick_check_figures.py` from the worked-example fixture: map with votes, number line guess vs pick, variogram dots + fitted curve, Cross-section 1 band with vs without the wrong pick;
5. why it matters (bands widen everywhere);
6. limits (§2 "does not").

Figures are regenerated by the script, never hand-made. The study guide links to this page.

## 10. Open item

Dismissal ("checked, this pick is right") needs persistence (an additive column or table + bundle field). Not in A0: a flag stays until the pick changes. Decide before slice A when a real dismissed-flag need shows up (trigger: the owner or a tester asks for it).
