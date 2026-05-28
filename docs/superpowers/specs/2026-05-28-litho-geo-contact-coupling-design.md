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
4. **Split litho at geo boundaries + link (NO geo contact creation).** When
   an accepted litho ghost crosses a geological (stratigraphic) contact and
   there is no litho contact already within tolerance of it, the existing
   **straddle-split** creates a litho contact at that geo boundary depth
   (the "split the sand layer into two units at the stratigraphic boundary"
   behaviour) — and that split-created litho contact is **linked** to the
   geological contact. No geological contact is ever created. The litho
   model splits to honour the geo boundary because a litho unit cannot span
   a geo formation boundary — that is the superposition point.
5. **Auto-rebuild the geo model** after a litho-driven geo-contact *move*
   (the snap-geo→litho case + bidirectional propagation move geo contacts;
   nothing creates geo contacts).

## Corrected understanding (owner clarification 2026-05-28)

An earlier draft read "create a boundary where the geo model intersects" as
"materialise a *geological* contact." **That was wrong.** The owner
clarified: create a **litho** contact at the stratigraphic boundary (via the
existing straddle-split) and link it to the *existing* geological contact.
The geological model is never written-to by *creation* — only the
snap-geo→litho move + bidirectional propagation move existing geo contacts.
This makes coupling a strict superset of the #157 straddle behaviour: the
split already happens; coupling adds the link (and the snap + rebuild).

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

## Auto-link on accept (no geo-contact creation)

The straddle-split already runs in `AcceptLithoSuggestions`: a ghost
crossing a geological boundary is split into litho contacts at the geo
boundary depths. The geo contacts loaded for straddle detection are
extended to carry their **contact id** (today: depth + formation id only),
so each litho contact can find the geo contact it sits on.

After each litho contact is created/found, run a **couple step** for the
contact at depth `D` on investigation `I`:

1. **A straddle-split-created litho contact** sits exactly on a geo
   boundary that came from a geological contact → set
   `parent_geo_contact_id` to that geo contact (already coincident; no
   snap).
2. **A litho contact (e.g. the ghost top) within tolerance** of a geo
   contact on `I` (nearest wins) → set `parent_geo_contact_id`; move the
   **geo** contact's `depth_top_m` to `D` (snap geo→litho — the litho
   boundary the engineer placed is authoritative); mark that geo
   formation's surface stale.
3. **Else** (mid-geo-formation, no geo contact in range) → no link
   (within-formation litho refinement; nothing is created).

No geological contact is ever created. The only geo writes are the snap
moves in case 2.

**Auto-rebuild:** once per accept (and once per batch accept), if any geo
contact was moved (case 2), rebuild the parent geological model's stale
surfaces (`RebuildModelSurfaces`, scoped to the touched formations). A
deliberate exception to the on-click-build rule (CLAUDE.md "On-click
build") — a litho-accept that moved a geo contact must leave the geo model
self-consistent immediately. Scope to touched formations + run once per
(batch) accept to bound cost (cf. the #153/#155 accept-perf work — do NOT
rebuild per-contact). If no geo contact moved, no rebuild.

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

* **Slice 1 (this spec's core):** schema + migration; auto-link (straddle
  contacts + ghost-top within tolerance) + snap geo→litho on accept;
  auto-rebuild on geo move; bidirectional propagation + loop guard; unlink
  action + indicator; bundle restore backfill. Delivers the sync. No geo
  contact creation.
* **Slice 2:** the explicit manual **"Link to geology…"** action for
  non-auto cases (auto-link covers the common path).

## Testing

* **Schema/migration:** column present + nullable + SET NULL on geo delete.
* **Accept couple step (unit):**
  (a) straddle-split-created litho contact on a geo boundary → linked to
  that geo contact, no snap; (b) ghost-top litho contact within tolerance
  of a geo contact → linked + geo snapped to litho depth; (c)
  mid-geo-formation litho contact → no link, nothing created; (d)
  nearest-wins when two geo contacts are in range.
* **Bidirectional propagation (unit):** geo move → linked litho moves;
  litho move → linked geo moves + surface rebuilt; equal-depth → no-op
  (loop guard); unlinked contact → no propagation.
* **Lifecycle:** delete geo contact → linked litho `parent_geo_contact_id`
  becomes NULL (DB SET NULL).
* **Bundle:** save→wipe→restore round-trips the link (second-pass backfill).
* **Frontend:** unlink context-menu item appears only on linked litho
  contacts; the link glyph renders; the handler hits the endpoint.
* **Auto-rebuild:** an accept that moves a geo contact (case 2) leaves the
  geo surface non-stale (rebuilt once, scoped to touched formations); an
  accept that moves nothing triggers no rebuild.

## Risks / consequences

* **Litho stage now MOVES + rebuilds the geological model** (snap-geo→litho
  on link + bidirectional propagation move existing geo contacts; surfaces
  rebuild). It never CREATES geo contacts. Deliberate (owner). Blast radius
  bounded by the 0.20 m tolerance + the unlink valve + linking only where a
  geo contact already exists.
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
