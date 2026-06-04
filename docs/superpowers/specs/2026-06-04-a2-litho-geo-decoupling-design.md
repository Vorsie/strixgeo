# A2 — Lithostratigraphic ↔ Geological decoupling (design)

**Owner directive 2026-06-04.** Supersedes the same-day "one-geological-formation
invariant". Status: backend + frontend display shipped; residual cleanup (column
drop, flat inspector, dead Settings knob) in progress.

## The decision

The three model levels (geological / lithostratigraphic / geotechnical) are
**independent axes**, not a strict nesting. A lithology body is a sand body; the
geological boundary (Holoceen / Pleistoceen) is a *chronostratigraphic* horizon.
Forcing a litho unit to split at a chrono boundary it doesn't physically respect
is geologically artificial — and was the root of a documented bug family
(#157 slivers, #76 straddle-toast, part of #149 double-units).

**A2 rule:** split by the property the consumer needs *where it changes*, not by
age. The geotech stage subdivides by Dr/packing; the litho stage must not
pre-impose a chrono cut. So:

1. **Litho units are geologically agnostic** — identity is `(lithology,
   admixture)` only. Accept writes `parent_formation_id = None`.
2. **No straddle-split.** A layer crossing a geo boundary stays ONE layer. The
   `_compute_straddle_splits` / TIN-extrapolation / sliver-guard machinery is
   removed.
3. **Bodies may span geo boundaries.** `resolve_litho_instances` drops a
   correlation edge ONLY on a different `litho_main_soil_code`; the geological
   parent is no longer a filter. A sand correlated across the boundary is ONE
   body.
4. **The geological name is a derived, body-level label** — `GET /bodies`
   computes each body's `geo_formation_id` / `geo_formation_name` by
   thickness-weighted majority of its member layers vs the parent geological
   model's contacts (`domain/services/body_geo_label.py`), **computed fresh on
   every read** so it stays correct as bodies merge/split *or* the geological
   surfaces are edited. Never stored.
5. **Merging stays edge-driven and user-controlled.** Same-lithology layers
   merge ONLY when the engineer correlates them. The Boom-Klei-under-Quaternary-
   clay case (both KLEI, a real unconformity) stays two bodies because the
   engineer does not correlate across it.
6. **Naming.** Body auto-labels drop the geo-parent prefix → `Sa1` / `Sa2`
   (lithology abbreviation + depth rank). The geological name shows as separate
   context (e.g. in the body context-menu header), not baked into the name.

## Why not the alternatives

- **Majority-with-forced-split (Option A as a split):** rejected — splitting is
  the friction + bug source we're removing.
- **Per-test "split here / move the geo boundary" prompt (Option B):** the
  "move the geo boundary to the litho contact" half is valuable and already
  exists as the opt-in #134/#162 snap gesture — but as a *forced per-test prompt
  during bulk accept* it's a friction trap (a dozen+ prompts on one accept-all).
  Kept as a manual, opt-in tool only.

## What shipped

| Layer | Change |
|---|---|
| `domain/services/resolve_litho_instances.py` | Removed the `parent_formation_id` edge-drop; naming groups key on lithology alone. |
| `application/accept_litho_suggestions.py` | Removed straddle machinery; one layer per suggestion; key `(lithology, admixture)`; `parent_formation_id=None`. VULN-10 scope guard preserved via `_verify_investigation_scope`. |
| `domain/services/body_geo_label.py` (new) | Pure thickness-majority derivation. |
| `api/routers/geology/bodies.py` | `GET /bodies` + `claim_body_extent` derive `geo_formation_id` / `geo_formation_name`. |
| `BodyListItem` schema + `client.ts` | Nullable `geo_formation_id` / `geo_formation_name`. |
| `utils/lensLabel.ts` + `SectionPanel.tsx` | Body labels → `Sa1`/`Sa2` (geo-parent prefix dropped). |
| `BodyContextMenu.tsx` | Body menu header shows the derived geological name. |

Retired: #157 (slivers), #76 (straddle toast). Note on #149: the straddle-split
root cause is removed; a suspected admixture-sig-drift path is to be re-verified
post-A2 dogfeed.

## Residual cleanup (planned)

- **Drop the `parent_formation_id` column** + `parent_formation_name` (#67) +
  `parent_extrapolated`. The column is already always-null under A2. Deferred
  because it touches the `.gmproj` bundle shape — a separate, careful migration.
- **Flat litho inspector** — stop grouping by `parent_formation_id`.
- **Remove the dead "Sliver guard" Settings knob** + the ignored
  `straddle_min_piece_thickness_m` param (request schema / router / `execute`).
- **Explicit body-drop on `ClearLithoModel`** — bodies + extents, for a fully
  clean slate (currently self-heal on the next resolve).
- **Editable geo-label override** — the derived label is read-only; pinning a
  manual override is a later debt.

## Dogfeed bring-up (clean slate)

The existing dogfeed data was created under the old geo-parented key, so it is
cleared rather than migrated: restart backend → `ClearLithoModel` (drops layers
+ correlations; bodies self-heal) → re-segment + accept fresh under A2.
