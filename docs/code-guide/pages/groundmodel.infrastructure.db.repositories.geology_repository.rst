groundmodel.infrastructure.db.repositories.geology_repository
=============================================================

.. CG-PAGE source=src/groundmodel/infrastructure/db/repositories/geology_repository.py complete=true

*Source file:* ``src/groundmodel/infrastructure/db/repositories/geology_repository.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-46

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 1-46
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A module docstring plus the toolbox: ``Iterable`` / ``Any`` / ``UUID`` types, ``select`` and ``update``, ``AsyncSession``, ``selectinload``, ``uuid7``, the geology validator and its ``ContactDepth`` input shape, the ``GapIssue`` result, the four geology ORM models plus the borehole model, and the logging base.

**Why it is here.** One repository serves all three geology tables (formations, models, contacts) because they are tightly coupled — a contact points at both a formation and a model, and every query is project-scoped — so one class per table would force the API to juggle three sessions in lockstep. It imports the domain validator because the no-gaps check is delegated to pure domain code.

.. CG-EXPLANATION-END id=module-header

Class ``GeologyRepository`` — header
------------------------------------

.. CG-BLOCK id=class:GeologyRepository lines=47-49

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 47-49
   :lineno-match:

.. CG-EXPLANATION-START id=class:GeologyRepository

**What this does.** Opens the ``GeologyRepository`` class — async CRUD plus the no-gaps domain check for the geological-model tree.

**Why it is here.** The same one-session-per-request shape as the other repositories.

.. CG-EXPLANATION-END id=class:GeologyRepository

Method ``GeologyRepository``. ``def __init__``
----------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.__init__ lines=50-58

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 50-58
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.__init__

**What this does.** The set-up method: registers the logger and stores the open session.

**Why it is here.** The shared repository pattern.

.. CG-EXPLANATION-END id=method:GeologyRepository.__init__

Method ``GeologyRepository``. ``async def create_formation``
------------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.create_formation lines=59-138

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 59-138
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.create_formation

**What this does.** Inserts a new formation under a project — its name, colour, order, and the optional litho / geotech fields (lithology, NAD class, parent link, admixtures) — then flushes and logs (id at SUCCESS, name at DEBUG).

**Why it is here.** One wide table serves all three model levels, so this one method creates a plain geological formation or a litho / geotech unit depending on which optional fields are given. The name is kept off the always-on log line because it can echo a client's site code.

.. CG-EXPLANATION-END id=method:GeologyRepository.create_formation

Method ``GeologyRepository``. ``async def list_formations``
-----------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.list_formations lines=139-150

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 139-150
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.list_formations

**What this does.** Returns all of a project's formations, ordered by display order then name.

**Why it is here.** The legend and borelog read formations in stratigraphic order, ties broken by name.

.. CG-EXPLANATION-END id=method:GeologyRepository.list_formations

Method ``GeologyRepository``. ``async def get_formation``
---------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.get_formation lines=151-154

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 151-154
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.get_formation

**What this does.** Looks up one formation by id, or ``None``.

**Why it is here.** A plain fetch by primary key for callers that hold the id.

.. CG-EXPLANATION-END id=method:GeologyRepository.get_formation

Method ``GeologyRepository``. ``async def update_formation``
------------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.update_formation lines=155-167

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 155-167
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.update_formation

**What this does.** Applies a partial update — only the keys present are written — then flushes and returns the row (or ``None``).

**Why it is here.** A partial update changes one field (a colour, an order) without disturbing the others.

.. CG-EXPLANATION-END id=method:GeologyRepository.update_formation

Method ``GeologyRepository``. ``async def delete_formation``
------------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.delete_formation lines=168-185

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 168-185
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.delete_formation

**What this does.** Deletes a formation, returning ``True`` when a row was removed; its contacts go with it through the cascade.

**Why it is here.** The editor is expected to warn the user first, because deleting the formation drops every contact that referenced it.

.. CG-EXPLANATION-END id=method:GeologyRepository.delete_formation

Method ``GeologyRepository``. ``async def create_model``
--------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.create_model lines=186-238

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 186-238
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.create_model

**What this does.** Inserts a new interpretation model under a project. When the new model is created active, it first clears the active flag on every same-project, same-kind sibling, then inserts and flushes.

**Why it is here.** Clearing the siblings enforces 'one active model per kind' on the create path, not just the activate path. Without it two models could both be flagged active, and the desktop's 'find the active model of this kind' would silently pick the alphabetically-first one — hiding the freshly-created model from the dropdown (a real owner dogfeed). The caller is responsible for the parent-kind rule; the repository stores what it is given.

.. CG-EXPLANATION-END id=method:GeologyRepository.create_model

Method ``GeologyRepository``. ``async def list_models``
-------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.list_models lines=239-252

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 239-252
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.list_models

**What this does.** Returns a project's models, active first, then alphabetically.

**Why it is here.** The dropdown wants the active model at the top; sorting the boolean descending puts the active one first.

.. CG-EXPLANATION-END id=method:GeologyRepository.list_models

Method ``GeologyRepository``. ``async def get_model``
-----------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.get_model lines=253-267

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 253-267
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.get_model

**What this does.** Loads one model with its contacts eager-loaded, or ``None``.

**Why it is here.** The editor wants the contacts up front to draw the cross-section without follow-up requests; loading them here is affordable while contact counts stay in the low hundreds per project.

.. CG-EXPLANATION-END id=method:GeologyRepository.get_model

Method ``GeologyRepository``. ``async def update_model``
--------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.update_model lines=268-280

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 268-280
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.update_model

**What this does.** Applies a partial update to a model and returns it (or ``None``).

**Why it is here.** The same one-field-at-a-time update as the formation and contact patches.

.. CG-EXPLANATION-END id=method:GeologyRepository.update_model

Method ``GeologyRepository``. ``async def set_active_model``
------------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.set_active_model lines=281-314

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 281-314
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.set_active_model

**What this does.** Marks one model active and clears the flag on every same-kind sibling in the project. It refuses when the model is missing or belongs to a different project, clears the siblings first, then sets the target.

**Why it is here.** With the three-level hierarchy 'one active per project' became 'one active per kind' — activating a litho model must not deactivate the geological model the section editor references, since each kind has its own active pointer. Clearing the siblings before setting the target avoids a moment inside the flush where nothing is active.

.. CG-EXPLANATION-END id=method:GeologyRepository.set_active_model

Method ``GeologyRepository``. ``async def has_child_models``
------------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.has_child_models lines=315-326

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 315-326
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.has_child_models

**What this does.** Returns whether any model names this one as its parent.

**Why it is here.** The delete endpoint calls it to answer a clear 409 before attempting the delete, rather than letting the parent-protecting foreign key raise a raw database error on commit — a litho model pins its geological parent, a geotech model pins its litho parent.

.. CG-EXPLANATION-END id=method:GeologyRepository.has_child_models

Method ``GeologyRepository``. ``async def delete_model``
--------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.delete_model lines=327-456

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 327-456
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.delete_model

**What this does.** Deletes a model, but removes only the formations it *actually owns*. It works out whether the project has other models, which formations have a contact in this model, and which are referenced elsewhere, then for each formation: delete it if it is exclusively this model's, keep it if another model uses it, and — for unplaced vocabulary with no contacts anywhere — keep it unless this is the project's last model. The model's own contacts and surfaces always cascade away.

**Why it is here.** This is debt #37, a fix for catastrophic data loss: the old code deleted *every* project formation on any model delete, so deleting model A silently destroyed model B's formations. Because formations are shared project vocabulary (no model foreign key, correct by design) and multiple models per project is intended, the delete must be model-aware — only the exclusively-owned formations go, shared ones survive, and the clean-slate behaviour is preserved only for the last model.

.. CG-EXPLANATION-END id=method:GeologyRepository.delete_model

Method ``GeologyRepository``. ``async def create_contact``
----------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.create_contact lines=457-499

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 457-499
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.create_contact

**What this does.** Inserts a new formation contact — a formation top at an investigation — after checking that exactly one of borehole or CPT is set, then flushes and logs.

**Why it is here.** The exactly-one-anchor rule is also a database check constraint, but raising a clear ``ValueError`` here gives the caller a legible error instead of an opaque SQL failure at flush time.

.. CG-EXPLANATION-END id=method:GeologyRepository.create_contact

Method ``GeologyRepository``. ``async def list_contacts``
---------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.list_contacts lines=500-522

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 500-522
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.list_contacts

**What this does.** Lists a model's contacts, optionally filtered by borehole or formation, sorted shallowest-first.

**Why it is here.** Depth order matches how the editor renders them top-to-bottom.

.. CG-EXPLANATION-END id=method:GeologyRepository.list_contacts

Method ``GeologyRepository``. ``async def update_contact``
----------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.update_contact lines=523-535

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 523-535
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.update_contact

**What this does.** Applies a partial update to one contact and returns it (or ``None``).

**Why it is here.** The same partial-update pattern as the formation and model patches.

.. CG-EXPLANATION-END id=method:GeologyRepository.update_contact

Method ``GeologyRepository``. ``async def list_contacts_by_ids``
----------------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.list_contacts_by_ids lines=536-548

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 536-548
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.list_contacts_by_ids

**What this does.** Loads many contacts by id in one query, in arbitrary order.

**Why it is here.** The batch-update use case needs them all at once for its all-or-nothing scope check; it matches results by id, not by position.

.. CG-EXPLANATION-END id=method:GeologyRepository.list_contacts_by_ids

Method ``GeologyRepository``. ``async def list_surfaces``
---------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.list_surfaces lines=549-558

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 549-558
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.list_surfaces

**What this does.** Lists every cached TIN surface for a model.

**Why it is here.** The section view fetches all the slice-ready geometry in one round-trip and indexes it by formation.

.. CG-EXPLANATION-END id=method:GeologyRepository.list_surfaces

Method ``GeologyRepository``. ``async def mark_surfaces_stale``
---------------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.mark_surfaces_stale lines=559-612

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 559-612
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.mark_surfaces_stale

**What this does.** Flips the ``is_stale`` flag to true on the listed (model, formation) surfaces, grouping the update by model so it stays a handful of queries, and returns how many rows it touched. Surfaces that do not exist are silently ignored.

**Why it is here.** This is the cheap path in the on-click build pivot: a contact edit marks the affected surface stale rather than re-running the expensive triangulation, and the user clicks Build to materialise it. A formation with no built surface simply cannot go stale, so it is a legal no-op.

.. CG-EXPLANATION-END id=method:GeologyRepository.mark_surfaces_stale

Method ``GeologyRepository``. ``async def stale_surfaces_for_investigation``
----------------------------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.stale_surfaces_for_investigation lines=613-666

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 613-666
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.stale_surfaces_for_investigation

**What this does.** Marks every surface that has a contact anchored at a given investigation as stale, by finding the affected (model, formation) pairs and reusing the bulk stale helper.

**Why it is here.** This closes debt #34: a contact's absolute elevation is the investigation's elevation minus its depth, so editing an investigation's elevation silently invalidates every cached surface with a contact there — yet the old elevation-edit path never flipped the stale flag, so the viewer kept drawing stale geometry as if fresh. It runs across all models because the elevation URL is project-scoped.

.. CG-EXPLANATION-END id=method:GeologyRepository.stale_surfaces_for_investigation

Method ``GeologyRepository``. ``async def contact_scope_for_investigation``
---------------------------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.contact_scope_for_investigation lines=667-721

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 667-721
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.contact_scope_for_investigation

**What this does.** Returns the distinct (model, formation) pairs that have a contact anchored at a given investigation, after checking that exactly one anchor id was supplied.

**Why it is here.** This is the *blast radius* of an elevation edit — which models and formations must invalidate their caches. It runs across geological, litho and geotech models alike, because an accepted litho layer mirrors into the contact table too. Supplying neither or both anchor ids is a programming error, so it raises rather than guessing.

.. CG-EXPLANATION-END id=method:GeologyRepository.contact_scope_for_investigation

Method ``GeologyRepository``. ``async def delete_contact``
----------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.delete_contact lines=722-735

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 722-735
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.delete_contact

**What this does.** Deletes one contact, returning ``True`` when a row was removed.

**Why it is here.** A contact is a leaf — it has no children to cascade — so this is a plain delete.

.. CG-EXPLANATION-END id=method:GeologyRepository.delete_contact

Method ``GeologyRepository``. ``async def validate_no_gaps``
------------------------------------------------------------

.. CG-BLOCK id=method:GeologyRepository.validate_no_gaps lines=736-752

.. literalinclude:: ../../../src/groundmodel/infrastructure/db/repositories/geology_repository.py
   :language: python
   :lines: 736-752
   :lineno-match:

.. CG-EXPLANATION-START id=method:GeologyRepository.validate_no_gaps

**What this does.** Loads a borehole's contacts and its total depth, projects them into the validator's narrow input shape, and delegates to the pure ``GeologyValidator`` to return a list of ``GapIssue`` findings.

**Why it is here.** The no-gaps rule (a borehole's contacts must cover it continuously from surface to test depth) is domain knowledge, so the check itself lives in a pure domain service with zero infrastructure dependency; this method is only the loader that feeds it the rows. Keeping it on the repository lets the single validate endpoint stay a simple read rather than a use-case-plus-repository dance.

.. CG-EXPLANATION-END id=method:GeologyRepository.validate_no_gaps

