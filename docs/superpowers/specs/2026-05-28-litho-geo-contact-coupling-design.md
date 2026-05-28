# Litho ↔ Geological contact coupling (#162) — design

**Date:** 2026-05-28
**Debt item:** #162 (the structural fix that subsumes #157 slivers)
**Status:** design under review

## Problem

A litho boundary that coincides with a geological formation boundary is the
SAME physical surface (e.g. the top of Boom Klei is both a geo contact and
the top of a litho unit). Today the litho model and the geological model
hold these as independent contacts, so they drift apart (the #157 sliver
symptom) and an engineer must edit the same surface twice. The owner wants
coincident litho/geo contacts **coupled** so that (a) they stay in sync when
either is moved, and (b) the geological model stays consistent with the
litho boundaries the engineer places — without polluting the (coarser)
geological model with within-formation litho detail.

## Owner decisions (locked in brainstorming 2026-05-28)

1. **Link creation = auto + explicit.** Auto-link on accept when coincident;
   plus an explicit manual link AND an explicit **unlink** (the safety valve
   if an auto-link is wrong).
2. **Bidirectional propagation.** Move either endpoint → the other follows.
3. **Snap direction = geo follows litho.** At link time the litho boundary
   the engineer placed is authoritative; the geo contact moves to it (NOT
   litho-to-geo).
4. **Materialize geo contacts where the geo model intersects.** If no geo
   contact is within tolerance but the litho boundary sits at a geological
   formation transition (a geo surface intersects the investigation there),
   create a geo contact at the litho depth and link it. If the litho
   boundary is mid-geo-formation, create nothing (keeps superposition /
   the geo model coarse).
5. **Auto-rebuild the geo model** after litho-driven geo contact
   create/move.

## ⚠ Interpretation to confirm in review

The phrase "create a boundary where the geo model intersects too" is read
here as: **only materialize a geo contact when the litho boundary lands
(within tolerance) on a place where a geological formation SURFACE already
intersects the investigation** — i.e. the litho boundary corresponds to a
real geological formation transition that simply lacked an explicit contact
at this investigation. A litho boundary that falls inside a single geo
formation (no surface transition nearby) does NOT create a geo contact — it
is a within-formation litho refinement, and forcing a geo boundary there
would corrupt the coarser geological model and violate superposition. If
the intent was instead "every litho boundary forces a geo boundary", this
section is wrong — flag it.

## Tolerance

Reuse the existing litho↔geo snap tolerance
`view_state.litho_segmenter.litho_snap_tolerance_m` (default 0.20 m, the
#134 knob) as the coincidence threshold. (Distinct from the #157
`straddle_min_piece_thickness_m`, which governs sliver suppression; the two
defaults happen to match but are independent knobs.)

## Schema

Add to `formation_contact` (`FormationContactOrm`):

```
parent_geo_contact_id: UUID | None
    FK → formation_contact.id, ondelete="SET NULL", nullable, indexed.
```

Semantics: set on a **litho** contact, pointing at the **geological**
contact it is coupled to. `SET NULL` gives the unlink-on-geo-delete
lifecycle for free at the DB layer. One Alembic migration; apply to the dev
DB and the integration DB.

**Validation (link creation, application layer):** the linking contact must
belong to a `lithostratigraphic` model and the target to that model's
parent `geological` model; reject self-links and cross-model links.

## Auto-link + materialize on accept

In `AcceptLithoSuggestions` (and the batch path), after each litho contact
is created/found, run a **couple step** per contact at depth `D` on
investigation `I`:

1. **Existing geo contact within tolerance** of `D` on `I` (nearest wins)
   → set `parent_geo_contact_id`; move the geo contact's `depth_top_m` to
   `D` (snap geo→litho). Mark that geo formation's surface stale.
2. **Else, geo surface transition within tolerance** of `D` on `I` — i.e.
   the TIN/contact-derived geological formation boundary depth at `I` is
   within tolerance of `D` (the straddle machinery already computes these
   boundary depths) → **create a geological contact** at depth `D` on `I`
   for the formation that tops at that transition, in the parent geological
   model; set `parent_geo_contact_id` to the new contact. Mark that geo
   formation's surface stale.
3. **Else** (mid-geo-formation) → no link, no geo contact.

The geo contacts loaded for straddle detection are extended to carry their
**contact id** (not just depth + formation id) so step 1 can link and
step 2 knows the formation.

**Auto-rebuild:** once per accept (and once per batch accept), after the
couple step, rebuild the parent geological model's stale surfaces
(`RebuildModelSurfaces`, scoped to the formations touched). This is a
deliberate exception to the on-click-build rule (CLAUDE.md "On-click
build") — justified because a litho-accept that mutates the geo model must
leave it self-consistent immediately. Scope to touched formations + run
once per (batch) accept to bound the cost (cf. the #153/#155 accept-perf
work — do NOT rebuild per-contact).

## Bidirectional propagation (UpdateFormationContact)

On a depth-only change:

* Updated a **geo** contact → set the depth of every litho contact whose
  `parent_geo_contact_id` points at it.
* Updated a **litho** contact that has a `parent_geo_contact_id` → set the
  linked geo contact's depth, then rebuild that geo formation's surface
  (auto-rebuild).
* **Loop guard:** propagate only when the target depth actually differs;
  equal → stop (so geo→litho→equal terminates). Propagation is a **direct
  repo depth-set** that deliberately bypasses the cross-merge/validation
  path so a synced move never cascade-deletes a peer.

## Unlink / link (explicit)

* Right-click a litho contact → **"Unlink from geology"** when linked (sets
  `parent_geo_contact_id` = NULL) — the safety valve for a wrong auto-link.
* Right-click a litho contact → **"Link to geology…"** when not linked
  (links to the nearest geo contact on the investigation, snapping geo→litho;
  or materializes one per the accept rules). [Slice 2.]
* A small lock/link glyph on linked litho contacts so the coupling is
  visible.

New endpoints: `POST .../contacts/{id}/link-geo` (body: target geo contact
id, or "auto") and `POST .../contacts/{id}/unlink-geo`. Frontend `client.ts`
+ a `useGeologicalModel` handler + the ContactsLayer context menu item.

## Bundle round-trip

`parent_geo_contact_id` rides the bundle automatically (column enumeration,
#47). **Restore ordering:** a litho contact's `parent_geo_contact_id`
references another `formation_contact` row, so restore must insert all
contacts with the link **nulled**, then a **second pass** backfills
`parent_geo_contact_id` from the bundle (avoids FK-ordering failures). Add
this to `restore_project_bundle`.

## Slicing

* **Slice 1 (this spec's core):** schema + migration; auto-link +
  materialize-geo + snap geo→litho on accept; auto-rebuild; bidirectional
  propagation + loop guard; unlink action + indicator; bundle restore
  backfill. Delivers the sync + the superposition-consistent geo model.
* **Slice 2:** the explicit manual **"Link to geology…"** action for
  non-auto cases (auto-link covers the common path).

## Testing

* **Schema/migration:** column present + nullable + SET NULL on geo delete.
* **Accept couple step (unit, `_couple_*` helper, pure where possible):**
  (a) existing geo contact in tolerance → link + geo snapped to litho;
  (b) no geo contact but geo surface transition in tolerance → geo contact
  materialized at litho depth + linked; (c) mid-geo-formation → no link, no
  geo contact; (d) nearest-wins when two geo contacts are in range.
* **Bidirectional propagation (unit):** geo move → linked litho moves;
  litho move → linked geo moves + surface rebuilt; equal-depth → no-op
  (loop guard); unlinked contact → no propagation.
* **Lifecycle:** delete geo contact → linked litho `parent_geo_contact_id`
  becomes NULL (DB SET NULL).
* **Bundle:** save→wipe→restore round-trips the link (second-pass backfill).
* **Frontend:** unlink context-menu item appears only on linked litho
  contacts; the link glyph renders; the handler hits the endpoint.
* **Auto-rebuild:** an accept that materialses/moves a geo contact leaves
  the geo surface non-stale (rebuilt once, scoped to touched formations).

## Risks / consequences

* **Litho stage now writes the geological model** (creates/moves/rebuilds
  geo contacts + surfaces). Deliberate (owner). Blast radius bounded by the
  0.20 m tolerance + the unlink valve + the materialize-only-at-real-geo-
  transition rule.
* **Performance:** auto-rebuild adds geo-TIN recompute to accept. Scope to
  touched formations + once-per-batch (not per-contact) to stay within the
  #153/#155 budget.
* **Bidirectional drag** lets a litho refinement move the geological
  boundary — the chosen trade-off; unlink + loop guard contain it.

## Files (anticipated)

* `infrastructure/db/models/formation_contact_orm.py` + a migration.
* `application/accept_litho_suggestions.py` + `batch_accept_litho_suggestions.py`
  (couple step + carry geo contact ids + auto-rebuild hook).
* `application/update_formation_contact.py` (bidirectional propagation).
* new `application/link_litho_to_geo.py` / `unlink_litho_from_geo.py` use cases.
* `api/routers/geology/contacts.py` (link/unlink endpoints).
* `infrastructure/db/repositories/project_bundle.py` (restore backfill).
* `desktop/.../api/client.ts`, `hooks/useGeologicalModel.ts`,
  `components/sections/ContactsLayer.tsx` (unlink action + glyph).
