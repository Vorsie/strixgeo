groundmodel.application.seed_litho_from_geological_model
========================================================

.. CG-PAGE source=src/groundmodel/application/seed_litho_from_geological_model.py complete=true

*Source file:* ``src/groundmodel/application/seed_litho_from_geological_model.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-81

.. literalinclude:: ../../../src/groundmodel/application/seed_litho_from_geological_model.py
   :language: python
   :lines: 1-81
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring and imports for the use case that copies a parent geological model's contacts down into a lithostratigraphic model. The docstring describes exactly what each copied row keeps, the scope filtering, the idempotency guarantee, and the on-click build contract; the imports pull in the contact and layer row types, the geological-model row type, and the two repositories used.

**Why it is here.** The docstring records several load-bearing decisions. It opens with a note that the frontend verb is orphaned (2026-05-18, debt #60): the editor now loads the geological surfaces as a read-only backdrop instead, so no button calls this use case today, but it is kept working for scripts and future use. Each copied field is justified: same formation id and borehole id (because the soil-unit vocabulary is project-scoped and shared across sibling models, so no new unit is created), depth copied verbatim, a fixed medium confidence (owner decision 2026-05-18), and no observation link (the seed is model-derived). Idempotency is guaranteed by a unique index plus a pre-check that skips any (formation, borehole) pair already present, and nothing is ever deleted. Creating contacts marks the surfaces stale without triggering the interpolation, per the on-click build rule (only the Build button runs it).

.. CG-EXPLANATION-END id=module-header

Class ``SeedLithoOutcome`` — header
-----------------------------------

.. CG-BLOCK id=class:SeedLithoOutcome lines=82-103

.. literalinclude:: ../../../src/groundmodel/application/seed_litho_from_geological_model.py
   :language: python
   :lines: 82-103
   :lineno-match:

.. CG-EXPLANATION-START id=class:SeedLithoOutcome

**What this does.** A small result class holding three fields: the ids of freshly created contacts, the ids of contacts that already existed for the in-scope pairs, and a count of pairs skipped because they already existed.

**Why it is here.** The found ids exist so the endpoint can union created and found and seed a section's explicit-content set with the full set, while the created count and skipped count give the honest report of what the run did. The docstring notes the found ids are used only internally by the endpoint, not surfaced to the desktop, because the front end re-fetches the full contact list after a Seed.

.. CG-EXPLANATION-END id=class:SeedLithoOutcome

Method ``SeedLithoOutcome``. ``def __init__``
---------------------------------------------

.. CG-BLOCK id=method:SeedLithoOutcome.__init__ lines=104-116

.. literalinclude:: ../../../src/groundmodel/application/seed_litho_from_geological_model.py
   :language: python
   :lines: 104-116
   :lineno-match:

.. CG-EXPLANATION-START id=method:SeedLithoOutcome.__init__

**What this does.** The setup step that stores the three outcome fields.

**Why it is here.** The class uses fixed slots and a plain constructor to hold results; keyword-only arguments make the three counts unambiguous at the call site.

.. CG-EXPLANATION-END id=method:SeedLithoOutcome.__init__

Class ``SeedLithoFromGeologicalModel`` — header
-----------------------------------------------

.. CG-BLOCK id=class:SeedLithoFromGeologicalModel lines=117-125

.. literalinclude:: ../../../src/groundmodel/application/seed_litho_from_geological_model.py
   :language: python
   :lines: 117-125
   :lineno-match:

.. CG-EXPLANATION-START id=class:SeedLithoFromGeologicalModel

**What this does.** The use-case class header, inheriting the logger, holding the geology and litho-layer repositories.

**Why it is here.** The docstring states the single job — copy a parent geological model's contacts into a litho model — and the caller supplies the session.

.. CG-EXPLANATION-END id=class:SeedLithoFromGeologicalModel

Method ``SeedLithoFromGeologicalModel``. ``def __init__``
---------------------------------------------------------

.. CG-BLOCK id=method:SeedLithoFromGeologicalModel.__init__ lines=126-132

.. literalinclude:: ../../../src/groundmodel/application/seed_litho_from_geological_model.py
   :language: python
   :lines: 126-132
   :lineno-match:

.. CG-EXPLANATION-START id=method:SeedLithoFromGeologicalModel.__init__

**What this does.** The setup step: stores the session and builds the geology and litho-layer repositories.

**Why it is here.** The session is owned by the caller; the two repositories give the reads and writes this use case needs.

.. CG-EXPLANATION-END id=method:SeedLithoFromGeologicalModel.__init__

Method ``SeedLithoFromGeologicalModel``. ``async def execute``
--------------------------------------------------------------

.. CG-BLOCK id=method:SeedLithoFromGeologicalModel.execute lines=133-412

.. literalinclude:: ../../../src/groundmodel/application/seed_litho_from_geological_model.py
   :language: python
   :lines: 133-412
   :lineno-match:

.. CG-EXPLANATION-START id=method:SeedLithoFromGeologicalModel.execute

**What this does.** The entry point. It loads and validates the litho model (it must be lithostratigraphic and have a parent), builds the effective borehole scope from the caller's set minus the litho model's own exclusions, loads the parent model's borehole-anchored contacts, builds an index of contacts already present for idempotency, then walks the parent contacts one by one — skipping out-of-scope and already-present pairs and creating a new accepted layer for each remaining one — before flushing, marking only the newly-touched formations' surfaces stale, staling the solid cache, and committing.

**Why it is here.** The validation raises a value-error the endpoint maps to 422 for a wrong model kind or a missing parent. The exclusion set is the litho model's OWN list, never the parent's (architect risk 3), because the two models may exclude different columns. New layers are written with a tiny sentinel base depth so the depth-ordered check passes; the mirror triggers then materialise the contact and recompute the real base from the next contact down, giving the same end state as the legacy path. Only formations that actually gained a contact this run are marked stale, so an idempotent re-run that creates nothing does not stale a surface the engineer just built (the on-click build contract). Progress is logged per row with an ``[i/total]`` prefix, the Definition-of-Done rule for bulk loops.

.. CG-EXPLANATION-END id=method:SeedLithoFromGeologicalModel.execute

