groundmodel.api.routers.geology.litho_ops
=========================================

.. CG-PAGE source=src/groundmodel/api/routers/geology/litho_ops.py complete=true

*Source file:* ``src/groundmodel/api/routers/geology/litho_ops.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-96

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_ops.py
   :language: python
   :lines: 1-96
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file (stratigraphy and litho-suggestion operations) and imports the router tools, the scope guard and a shared write-conflict mapper and model-kind guard, the many request/response schemas, the application use cases (auto-populate, discover, dedupe, clear, seed-from-parent, suggest, accept, batch-accept, rebuild surfaces, recompute absences), the domain suggestion type, the model row and cross-section repository, and the logger. It makes a module-level logger and a bare router.

**Why it is here.** Same split-package pattern (mounted under the shared geology prefix). These operations were extracted from the contacts file to keep each module focused (debt #178/#201). They cover the whole assisted flow from suggesting layers to accepting them into the model.

.. CG-EXPLANATION-END id=module-header

Function ``def _to_domain_suggestions``
---------------------------------------

.. CG-BLOCK id=function:_to_domain_suggestions lines=97-133

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_ops.py
   :language: python
   :lines: 97-133
   :lineno-match:

.. CG-EXPLANATION-START id=function:_to_domain_suggestions

**What this does.** A private helper that converts the wire form of layer suggestions (as sent by the desktop) into the domain suggestion objects the accept use cases expect, copying depths, lithology, packing class, mean cone resistance, relative density, confidence, source, and admixtures.

**Why it is here.** Shared by the single-accept and batch-accept handlers (extracted on the second copy) so both decode the same wire shape identically.

.. CG-EXPLANATION-END id=function:_to_domain_suggestions

Function ``def _to_collision_items``
------------------------------------

.. CG-BLOCK id=function:_to_collision_items lines=134-164

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_ops.py
   :language: python
   :lines: 134-164
   :lineno-match:

.. CG-EXPLANATION-START id=function:_to_collision_items

**What this does.** A private helper that maps domain lumping collisions into their API response shape, carrying the borehole, the target formation key and name, the colliding raw names, the kept top depth, and the dropped count.

**Why it is here.** Shared by the auto-populate and discover handlers (extracted on the second copy) so both encode the same wire shape. A collision is where two raw stratigraphy names lump to the same formation at one borehole.

.. CG-EXPLANATION-END id=function:_to_collision_items

Function ``async def auto_populate_from_stratigraphy``
------------------------------------------------------

.. CG-BLOCK id=function:auto_populate_from_stratigraphy lines=165-278

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_ops.py
   :language: python
   :lines: 165-278
   :lineno-match:

.. CG-EXPLANATION-START id=function:auto_populate_from_stratigraphy

**What this does.** The handler for ``POST .../contacts/auto-populate`` — seed the model with contacts read from borehole stratigraphy. It scope-guards the model, computes the formal/informal name bridge once, runs the use case, and (when a section was given) adds the created and found contacts to that section's seeded set, returning created/found/deleted ids and skip counts.

**Why it is here.** For each borehole it prefers the formal stratigraphy stream and falls back to informal only when no formal record exists; layers are idempotent by their observation-layer id, so re-running does nothing. The create-missing-formations flag distinguishes the fill-from-boreholes path (mints a formation for an unmatched layer) from the Seed path (skips it, counted), because Seed never creates formations (explicit-content invariant). The section seeding follows the same invariant: only seeded ids pass the section filter, so the engineer sees exactly what was seeded.

.. CG-EXPLANATION-END id=function:auto_populate_from_stratigraphy

Function ``async def discover_from_stratigraphy``
-------------------------------------------------

.. CG-BLOCK id=function:discover_from_stratigraphy lines=279-356

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_ops.py
   :language: python
   :lines: 279-356
   :lineno-match:

.. CG-EXPLANATION-START id=function:discover_from_stratigraphy

**What this does.** The handler for ``POST .../contacts/discover-from-stratigraphy`` — return the candidate formation names found in the boreholes without writing anything. It logs, scope-guards the model, computes the same name bridge, runs the read-only discover use case, and returns the candidates and any collisions.

**Why it is here.** It runs the identical scan as auto-populate but commits nothing, feeding the dialog where the engineer curates which formations to keep before any change is made. Sharing the same name bridge means the preview and the later write see identical keys. The model scope guard is present for consistency with sibling endpoints even though nothing is written, and it never errors on empty results.

.. CG-EXPLANATION-END id=function:discover_from_stratigraphy

Function ``async def dedupe_existing_contacts``
-----------------------------------------------

.. CG-BLOCK id=function:dedupe_existing_contacts lines=357-410

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_ops.py
   :language: python
   :lines: 357-410
   :lineno-match:

.. CG-EXPLANATION-START id=function:dedupe_existing_contacts

**What this does.** The handler for ``POST .../contacts/dedupe`` — a one-shot cleanup that removes duplicate contacts for the same anchor and formation, keeping the highest-priority survivor. It scope-guards the model, runs the dedupe use case, and returns the inspected and removed counts plus the removed ids.

**Why it is here.** It cleans up duplicates created before a uniqueness rule landed. The survivor rule prefers a manual pick over an auto-derived one, a row with an observation layer over one without, and the most recent otherwise. It is idempotent, so running on a clean model does nothing.

.. CG-EXPLANATION-END id=function:dedupe_existing_contacts

Function ``async def clear_litho_model``
----------------------------------------

.. CG-BLOCK id=function:clear_litho_model lines=411-491

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_ops.py
   :language: python
   :lines: 411-491
   :lineno-match:

.. CG-EXPLANATION-START id=function:clear_litho_model

**What this does.** The handler for ``DELETE .../contacts`` — clear all content from a lithostratigraphic model in one transaction: its contacts, correlation edges, surfaces, and the litho formations that become orphans. It logs, scope-guards the model, runs the clear use case, commits, and returns per-table counts.

**Why it is here.** The earlier partial wipe left orphan units and edges behind with no way to clear them (debt #94); this removes everything the litho model owns in one atomic call, while never touching geological formations, formations shared with a second litho model, or the model row itself. It is irreversible, so the desktop must show a confirmation dialog before calling it; it is idempotent when already empty.

.. CG-EXPLANATION-END id=function:clear_litho_model

Function ``async def seed_litho_from_parent``
---------------------------------------------

.. CG-BLOCK id=function:seed_litho_from_parent lines=492-596

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_ops.py
   :language: python
   :lines: 492-596
   :lineno-match:

.. CG-EXPLANATION-START id=function:seed_litho_from_parent

**What this does.** The handler for ``POST .../layers/seed-from-parent`` — copy the parent geological model's borehole contacts into a lithostratigraphic model. It logs, scope-guards the model, runs the seed use case (requiring a litho model with a parent, else ``422``), and (when a section was given) adds the seeded contacts to the section's set.

**Why it is here.** It is a dormant endpoint (debt #60): the desktop caller was removed but it is kept for scripts or a future automated seed. Only borehole-anchored contacts are copied, stamped with a seed source and medium confidence, and re-running skips existing pairs (idempotent). The empty borehole list is passed through verbatim rather than coerced to "all", because coercing it would silently over-seed the entire parent across every project borehole.

.. CG-EXPLANATION-END id=function:seed_litho_from_parent

Function ``async def suggest_litho_contacts``
---------------------------------------------

.. CG-BLOCK id=function:suggest_litho_contacts lines=597-720

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_ops.py
   :language: python
   :lines: 597-720
   :lineno-match:

.. CG-EXPLANATION-START id=function:suggest_litho_contacts

**What this does.** The handler for ``POST .../contacts/suggest-litho`` — return a ranked list of suggested layer intervals for one CPT or borehole, read-only. It scope-guards the model, runs the segmenter for the given anchor, maps a wrong model kind to ``422`` and a missing investigation to ``404``, and returns the suggested layers.

**Why it is here.** For a CPT the suggestions come from the Robertson 2015/2009 soil-behaviour-type segmentation; for a borehole they come from the DOV main-name to lithology mapping. Nothing is written — the engineer accepts suggestions through the normal flow — and the parent-formation and boundary-straddle fields are left at safe defaults because they are resolved at accept time. Method: Robertson (2009/2010/2015).

.. CG-EXPLANATION-END id=function:suggest_litho_contacts

Function ``async def accept_litho_suggestions``
-----------------------------------------------

.. CG-BLOCK id=function:accept_litho_suggestions lines=721-850

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_ops.py
   :language: python
   :lines: 721-850
   :lineno-match:

.. CG-EXPLANATION-START id=function:accept_litho_suggestions

**What this does.** The handler for ``POST .../layers/accept-litho-suggestions`` — turn accepted suggestions into committed litho formation and contact rows for one anchor. It scope-guards the model, requires a litho model, converts the suggestions to domain objects, runs the accept use case, seeds the section, and rebuilds parent surfaces if the coupling step moved any geological contacts.

**Why it is here.** The operation is bulk and idempotent: re-accepting the same suggestions matches the find-or-create key and returns the existing rows. An overlap with an existing accepted layer on the same column is turned into a clear conflict rather than a raw error. The section seeding follows the explicit-content invariant. The parent-surface rebuild fires only when the coupling snapped a geological contact directly, because that path bypasses the normal build-on-click staling, and it is guarded so ordinary accepts pay nothing extra (debt #162).

.. CG-EXPLANATION-END id=function:accept_litho_suggestions

Function ``async def batch_accept_litho_suggestions``
-----------------------------------------------------

.. CG-BLOCK id=function:batch_accept_litho_suggestions lines=851-1022

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/litho_ops.py
   :language: python
   :lines: 851-1022
   :lineno-match:

.. CG-EXPLANATION-START id=function:batch_accept_litho_suggestions

**What this does.** The handler for ``POST .../layers/batch-accept-litho-suggestions`` — accept many anchors' suggestions in one transaction. It scope-guards and kind-guards the model, accepts every anchor, aggregates the created and found contacts, seeds the section once, runs one incremental inference recompute, rebuilds parent surfaces once, and returns per-anchor results and totals.

**Why it is here.** The single-accept path commits once per anchor, so an "accept all" cost one call and one commit per investigation; this collapses an N-anchor accept into a single call, one section seed, and one inference recompute (debt #153). A bad anchor is reported in its own result while the rest of the batch still commits. The inference recompute is scoped to only the formations this accept touched, turning the per-accept cost from the size of the whole model into the size of the accept (debt #155) — the dominant cost on real projects.

.. CG-EXPLANATION-END id=function:batch_accept_litho_suggestions

