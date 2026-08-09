# Snap a litho contact to a packing boundary — design

**Date:** 2026-08-09
**Status:** APPROVED (owner, 2026-08-09)
**Feeds:** debt #227 (manual packing-band editing) — this is its successor slice.

---

## 1. The problem, as observed

The owner dogfed the #227 hand-edit surface on 2026-08-09 and hit the same wall twice
in ten minutes. Verbatim:

> *"i tried merging a litho, but it was in separate geo bands, so i updated geo bands and
> the litho model i tried to merge the bands, but i couldn't … re-subdivide did the trick
> though"*

and then:

> *"sometimes after merging, i can't grab the contact handles anymore either"*

Both symptoms have one cause, and it is not a defect in the band-edit code.

**Measured on the dev model, CPT `019e932e-7c4a`:** the column carries 18 packing bands,
so 17 internal boundaries. Only **3** of those are packing boundaries — boundaries between
two bands that share a lithostratigraphic parent. The other **14 are litho contacts**,
because the litho column is finely interbedded and the parent unit alternates almost every
band. Ruling 2 correctly forbids dragging a litho contact from the geotech axis, so 14 of
17 boundaries have no handle, by design.

Two consequences follow:

1. **Missing handles read as a broken app.** A litho contact and a packing boundary render
   identically today. The engineer cannot tell "you may not drag this" from "the drag is
   broken".
2. **The gesture the engineer actually wants is the forbidden one.** On ground like this,
   the boundary he wants to adjust usually *is* the litho contact — the CPT resolved it
   better than the driller's log did. He reached for it twice unprompted.

A second measurement bears on the design: **136 of the model's 418 litho layers (33 %) are
coupled to a geological contact** (`litho_layer.parent_geo_contact_id IS NOT NULL`). So a
contact move must be able to carry the geological contact with it roughly one time in three.

## 2. What we are building

On the geotech axis, **litho contacts become draggable, and they snap onto the packing
boundaries of the column being dragged.**

This is the one deliberate exception to the view-only rule of that axis, and it is an
exception the owner ruled for explicitly. It is not a weakening of ruling 2: ruling 2
exists so that a *packing* boundary can never silently cross a contact. Dragging the
contact itself is an explicit, consented edit of the litho model, made from the screen that
happens to show the best evidence for it.

### The gesture

- Grab the litho contact (the heavy line). It snaps to the packing boundaries on that
  column.
- **It clamps at the NEXT packing boundary** in the direction of travel. A single drag can
  never skip a boundary (owner ruling: *"can't skip a boundary right, drag merge first,
  then drag merge second"*). To move two, drag twice.
- Release: **drag down and the layer above grows while the layer below shrinks; drag up
  and the reverse.** Direction alone decides which layer swallows which — there is no menu
  and no above/below choice to make.
- Each drag is one undoable act.

**When there is no packing boundary to snap to.** A litho unit that the qc did not
subdivide has no internal packing boundary, so a contact dragged toward it has no legal
target: the only thing beyond is the *next litho contact*, and snapping onto that would
collapse a unit to zero thickness. In that direction the contact **does not move** — the
drag has nowhere to go. It is shown as a clamp (the line stops and reads amber), not as an
error, because the engineer has done nothing wrong. To adjust a boundary there, subdivide
that unit first or edit it on the litho axis.

An A/B/C menu ("which contact comes to me?") was designed and **rejected** during the
brainstorm: dragging the contact itself removes the ambiguity entirely, because the thing
you grabbed is the thing that moves. Recorded so the idea is not re-proposed.

### Reuse

Both halves of the gesture already exist and are re-used rather than rebuilt:

| Need | Existing machinery |
|---|---|
| Contact drag | `ContactsLayer`'s contact drag (live on the litho axis; withheld on geotech) |
| Snapping to depths | the contact drag's existing snap path; `collectSnapDepths` is the shape to mirror |
| The write | `MoveLithoLayerBoundary` — atomic two-row write, already marks litho solids stale |
| Coupled geo move | `UpdateFormationContact` (the geo path the owner used by hand on 2026-08-09) |

## 3. What gets written

Exactly one fact: the litho contact's depth.

- `MoveLithoLayerBoundary` performs the atomic two-row write (upper base = lower top).
- When the dragged contact carries `parent_geo_contact_id`, the geological contact moves
  with it **in the same transaction**, so the coupling can never be left half-applied.
- **No packing band is rebuilt, re-derived or deleted.** No correlation is touched — a tie
  is between contacts, so it survives the move and simply re-slopes.

## 4. Staleness is DERIVED, never stored

The owner chose derivation over a stored flag or a staleness table.

**The rule:** a packing band's contract is that it lies within its litho parent. After a
contact move, some bands on that column no longer do. *That comparison is the staleness.*

- No migration, no new table, no write path that can forget to record.
- It survives close/reopen for free, because it is not state — it is a consequence of the
  data.
- It cannot lie. If the bands agree with their parents, nothing is stale, whatever any flag
  might have claimed.

This is the same shape as ruling 8 (the qc-statistic tag is derived by comparing two
columns, not stored). It is also chosen in direct response to the 2026-08-08 review, which
found two bugs that were *only* possible because staleness had been cached: a "re-run under
harmonic" tag that could never clear, and a stale `classified_with_statistic` on an emptied
model.

**The interim render is honest, not hidden.** Between the drag and the re-subdivide, the
packing bands on that column genuinely do overhang their parent, and that is what the
section will draw. This is deliberate: the picture shows the real state of the model rather
than a tidied-up fiction, and the Subdivide tag says why. (Whether the overhang should also
be tinted or hatched to read as provisional is a rendering question for the plan, not a
change to this rule.)

**Surfacing:** the Subdivide verb grows a tag naming how many columns need re-deriving
("3 columns need re-deriving"). When the coupled case fires, the geological surfaces are
marked stale by the existing mechanism. **Nothing is rebuilt automatically** — the engineer
chooses when to pay for it. This matters because `subdivide-cpts` is model-wide and begins
by calling `_delete_all_geotech_data`, so an automatic rebuild would destroy every packing
hand-edit on every column as a side effect of fixing one contact.

## 5. Telling the two boundaries apart

Chosen by the owner from three mockups (option 3):

- **Weight carries the meaning.** Litho contact = heavy solid line. Packing boundary =
  thin dashed line.
- **A grip glyph sits beside every draggable packing boundary**, at rest.
- **A padlock appears on a litho contact only on hover** — the moment the snap becomes
  relevant. On an interbedded column, showing padlocks at rest would stack 14 of them down
  one CPT.

The grip and padlock render *beside* the column, never on the boundary itself: anything on
the line becomes another press target, and that surface already has a hit-zone collision.

## 6. Prerequisite: the overlapping hit strips

Each boundary's grab strip is 10 px tall and centred on the line, so two boundaries closer
than 10 px on screen have overlapping strips, and the later-painted (deeper) one wins the
press. At the default 60 m section window this is roughly **13 px per metre**, so any band
thinner than ~0.75 m collides — well above the 0.35 m default minimum band thickness.

`allocateMinHitExpansions` already solves exactly this on the litho axis (debt #158). This
design **requires** reusing it here, because the drag now commits a re-derivation rather
than opening a menu, and grabbing the wrong boundary is a real edit.

(The 13 px/m figure is an estimate for a ~800 px plot; the exact number moves with window
size and vertical exaggeration. The ordering is what matters: at default zoom the collision
threshold sits *above* the default minimum band thickness, so this is the common case, not
an edge case.)

## 7. Refusals

- **Past more than one packing boundary** — clamped, not refused; the drag stops there.
- **On a borehole column** — no qc, therefore no packing boundaries to snap to.
- Refusal copy names the gesture actually made. (The "Merge rejected" text on a *move* was
  fixed 2026-08-09, commit `15e92a5e7`.)

## 8. Out of scope, deliberately

- **Creating a litho contact** (splitting one unit into two). A larger claim that drags in
  formation naming and correlation; a separate feature if ever wanted.
- **Rebuild-all-stale command.** The owner raised it and it is a good idea; it is the
  natural *consumer* of the derived staleness this design builds, and is sequenced as the
  immediate follow-up spec. Building it first would mean inventing this substrate ad hoc.
  When it is built it should cover the existing staleness channels too (litho solids,
  boreholes, geo surfaces, qc statistic), not only this one.
- **Auto re-subdivide after a snap.** Rejected: model-wide and destructive.

## 9. Testing

- **Pure, unit-tested first:** the clamp (never skips a boundary, direction decides the
  swallow) and the snap-target selection (packing boundaries of that column only).
- **Integration:** the contact moved; the coupled geological contact moved with it in the
  same transaction; no packing band was deleted; a borehole column is refused.
- **Staleness:** derives true after a move, false again after a re-subdivide. Negative
  control — sabotage the derivation and the test must go red.
- **Renderer:** a litho contact renders heavy/solid and a packing boundary thin/dashed;
  grips at rest only on draggable boundaries; padlock on hover only.

## 10. The minimum usable line

The **gesture, the clamp, and the stale tag** make this usable.

The **boundary rendering and the hit-strip fix** make it trustworthy; they are separable
if the owner wants to feel the gesture sooner, but should not be skipped before it is
considered done.

---

## Decisions recorded (owner, 2026-08-09)

1. Snapping **never rebuilds** anything — it marks stale and stops.
2. **Geo is marked stale too** when the coupled contact moves.
3. Staleness is **derived, not stored**.
4. Boundary rendering: **weight + grip at rest + padlock on hover**.
5. A drag **cannot skip a boundary**; repeat the drag to go further.
6. Direction decides which layer swallows — **no menu**.
7. Rebuild-all-stale is a **follow-up spec**, not this one.
