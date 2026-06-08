# Classification follows the test — design

**Date:** 2026-06-08
**Status:** approved direction (owner 2026-06-08); spec for review → plan → implement
**Surface:** section render + export; the explicit-content invariant
**Origin:** dogfeed — "drew a new section through tests I already classified; the
boundaries aren't on them. A test could get 2 different geological boundaries.
I don't want to classify a test twice."

---

## Decision

A test's **classification** — its geological formation contacts and its accepted
litho layers — is a property of the **borehole/CPT in the ground model**, not of
any cross-section. Every section whose corridor contains a test must show that
test's full classification **automatically**, with no per-section seeding step.

This **reverses the 2026-05-17 explicit-content directive** ("nothing on a
section without the user clicking a button on that section") **for
classification**. The directive stands conceptually for **correlations** (which
are relational and built per section) — those are explicitly **out of scope**
here and unchanged.

## Why (the problem this closes)

- `formation_contact` / `litho_layer` are already **model-level** (no
  `section_id`). Only the *rendering* is gated, by
  `cross_section.seeded_formation_contact_ids` (the explicit-content filter,
  `SectionsCanvas.tsx:1295` + export `build_section_snapshot.py:149`).
- So a fresh section is intentionally blank. The user, seeing no boundaries,
  re-classifies — and because `formation_contact` is unique only by
  `(model, anchor, depth)`, a second, slightly-different boundary set lands on
  the same test. **Two classifications for one borehole** — a data-integrity
  hole, not just UI friction.
- Auto-showing the existing classification removes the temptation to
  re-classify, so it also closes the duplicate-boundary risk.

## Approach

Replace the **render/export gate** from "contact id ∈ section's
`seeded_formation_contact_ids`" to "contact's investigation ∈ the section's
**in-corridor** investigations" (the projection the section already computes).

- **In-corridor set** = the investigations the section projects within its
  `projection_buffer_m` (minus the excluded ids). The frontend already has this
  (the placed columns); the backend already computes it
  (`build_section_snapshot` / `project_investigations_onto_section`).
- A section then shows **every** geological contact + accepted litho layer for
  each test it displays — classification travels with the test.

### Changes

- **Frontend render** (`SectionsCanvas.tsx`): `sectionContacts` filters
  `axisContacts` by the placed-column investigation set, not
  `seeded_formation_contact_ids`. (Same for any litho-axis equivalent.)
- **Backend export** (`build_section_snapshot.py:149`): drop the
  `seeded_contact_ids` filter; include contacts/litho for the section's
  projected investigations.
- **The seeded set itself** is kept (bundle/backwards-compat, and the accept /
  delete / draw flows may keep maintaining it harmlessly) but **no longer gates
  classification rendering**. Formal removal/repurposing is a follow-up, not
  this change.
- **Correlations**: unchanged. Their ribbons render where their endpoint
  contacts render (which is now "all in-corridor"), but correlation *creation*
  and the auto-correlate adjacency are untouched (the latter already uses the
  projection, not the seeded set).
- **Docs**: update `commercial-direction.md` + the explicit-content notes — the
  invariant now applies to correlations, not classification.

## Ripple to verify during implementation

1. **Correlate-mode gates** (CT7/CT8 in `SectionsToolbar` intersect
   `lithoContacts` with `seeded_formation_contact_ids`): re-point at the
   in-corridor set or they'll wrongly report "no contacts on this section".
2. **Seed-from-stratigraphy / section-aware draw** (`project_section_seed_must_apply_updated_section`
   memory): these create contacts + seed them; with auto-render the seeding is
   redundant for *showing*, but creating contacts must still work. Verify no
   flow relied on the seeded set to decide *what to create*.
3. **`accept_litho_suggestions` / `accept_contact_correlations` / `delete_*`**:
   they add/remove seeded ids. Harmless to keep; confirm none gate behaviour on
   the seeded set being the render source.
4. **Bundle** restore: `seeded_formation_contact_ids` still rides in the bundle;
   ignored for rendering, preserved for compat.
5. **Performance**: a section now renders every in-corridor contact — confirm no
   regression on a dense corridor (the build path already loads model-wide).

## Non-goals

- Correlations behaviour (creation, adjacency, ribbons-as-relational).
- Removing the `seeded_formation_contact_ids` column / the seed flows (follow-up).
- The double-classification *prevention* at the DB layer (auto-show makes it
  unnecessary in practice; a unique-per-(anchor,formation) guard is a separate
  hardening item if wanted).

## Testing

- A section drawn through already-classified tests shows their geological
  contacts + accepted litho **without any seed step** (integration: project a
  section over a test that has contacts; assert the snapshot includes them).
- Export (DXF/PDF) of such a section includes the in-corridor classification.
- Correlate mode still works on the section (the gate reads the in-corridor set).
- Regression: an existing seeded section renders the same content (its seeded
  contacts are a subset of its in-corridor contacts).
