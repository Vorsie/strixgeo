# Data Integrity Rules

> Extracted from `CLAUDE.md` 2026-06-06 to keep the always-loaded file lean. Load this on demand when the pointer in CLAUDE.md says so.

## Data Integrity Rules

These rules govern what we store, what we compute on demand, and how we tag the difference. Their goal is to keep the database honest: a stored value should never silently disagree with the values you'd derive from its inputs.

### 1. Never store a value WE derived from other stored values without tagging its provenance

If our parser computes `Y` from `X1` and `X2`, then storing `Y` next to `X1` and `X2` creates a drift risk: editing `X1` later silently invalidates `Y`. Two acceptable patterns:

- **Compute on read.** Don't store `Y` at all. Implement it as a `@property` on the dataclass (e.g. `AtterbergLimits.plasticity_index_pct`) or recompute in the API endpoint (e.g. `Ic` and CPTU `qt_mpa` in `/cpt/{id}/plot` via `calculate_qt_series`). This is the default — choose it unless query performance forces otherwise. Note that "the source file provided it" is NOT a counter-argument: a source-provided value that is fundamentally `qc + u2(1-a)` (or `(fs/qc)·100` for some Rf cases) is the cone software performing the same arithmetic we'd perform — saving it as if it were a measurement is a category error.
- **Store with provenance.** Persist `Y` alongside a `*_source` column carrying `DerivedValueSource.MEASURED` (the source file gave us `Y` directly — preserve it as-is) or `DerivedValueSource.COMPUTED` (we derived it; safe to recompute and replace). Example: `cpt_series.rf_pct` + `cpt_series.rf_source`. Use this only when (a) the source-provided value carries information beyond a textbook recomputation (instrument-specific corrections, alternative definitions, manufacturer rounding) AND (b) recomputing on every read is too expensive. Rf qualifies because some cones report a slightly-different `Rf` than `(fs/qc)·100` due to internal corrections; CPTU `qt` does NOT qualify because the formula is fixed.

`NULL` provenance means "unknown" — typically a legacy row that pre-dates the flag. UI and consumers must handle the unknown case gracefully.

### 2. Pass-through values are NOT derived

A value the source provides directly — even if conceptually it could have been derived elsewhere — is a measurement, not a derivation. Examples:

- `depth_m` — DOV ships `<diepte>` already inclination-corrected; GEF ships `depth_m` directly. Our parsers never recompute depth from length and inclination, so they never own a derivation. No provenance flag needed.
- `Borehole.drill_method` (the WFS-level summary) — DOV provides it as its own field, not derived from the per-segment `DrillSegment` list.
- `Borehole.total_depth_m` — DOV ships `diepte_tot_m` as a header field.

If we ever start computing one of these from other stored fields, the rule from §1 kicks in and we add a provenance flag.

### 3. Don't auto-convert between independently measured quantities

When two related quantities are measured by different methods and the conversion factor is empirical (i.e. soil-type dependent), keep them as independent fields and refuse to derive one from the other. Examples:

- `OrganicContent.carbon_pct` and `OrganicContent.matter_pct` — Van Bemmelen `OM ≈ 1.724 × OC` is empirical; auto-converting would fabricate data the consumer can't tell from a measurement. Each lab reports either or both, and we store what was reported.
- `pct_passing` vs `pct_larger` for grain size — store the form the source uses (DOV: % larger). Conversion is trivial for the consumer; auto-flipping at ingest would require choosing a canonical direction and discarding source fidelity.

### 4. Denormalised summary columns are an exception, with discipline

A small number of aggregations (`cpt.max_depth_m`, `cpt.n_rows`, future `borehole.n_observations`, `borehole.n_samples`) are stored alongside the full series for cheap list/spatial queries. They will drift if the underlying rows are mutated. The rule:

- They MUST be written atomically with the parent row (same transaction).
- They MUST be recomputable from the persisted data — i.e. they're a query-perf optimisation, not a source of truth.
- They MUST NOT be exposed as separate API resources that consumers can update independently.

### 5. Validation invariants belong in the parse result, not in the domain

Cross-field invariants — e.g. `Borehole.total_depth_m ≈ max(drill_segments.base_m)`, sample/observation depths within `[0, total_depth_m]`, observations contiguous within a stream — are flagged as `ValidationIssue`s emitted by the parser, not enforced by raising in the domain dataclass. Reasoning: the domain has to accept whatever the source gave us (occasionally messy real-world data) so the rest of the pipeline can run; the validator records the problem for the user to see.

### 6. Committed boundaries are an audit point, not a UI-surface barrier

A `formation_contact` row (geological models) or a `litho_layer` row
with `status='accepted'` (litho models) is the *durable* record of a
committed boundary — every depth change must go through the matching
use case (`UpdateFormationContact` for FC; `UpdateLithoLayer` /
`MoveLithoLayerBoundary` / `BatchUpdateLithoLayers` for LL) so it
lands in backend logs, hits schema invariants, and increments
`updated_at`. The audit trail is the rule; *which UI fires the PATCH*
is not.

The litho-suggestion drag surface (`useBoundaryDrag` /
`LithoSuggestionGhostColumns`) is allowed to call the layer update
endpoints directly when a pending drag's mouseup moves a shared
boundary with an accepted neighbour — see
`docs/superpowers/specs/2026-05-30-unified-boundary-drag-design.md`.
Previously the rule was framed as "committed contact is the source
of truth, no propagation past it"; the renaming clarifies that *the
PATCH is the audit point*, not that the UI must avoid touching
committed state.

The functional invariant is preserved: the pending edits Map NEVER
carries a committed-row depth (no parallel writer), and every
committed depth change still flows through one backend endpoint with
full logs.
