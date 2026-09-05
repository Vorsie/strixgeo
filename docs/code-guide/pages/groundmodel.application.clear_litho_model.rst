groundmodel.application.clear_litho_model
=========================================

.. CG-PAGE source=src/groundmodel/application/clear_litho_model.py complete=true

*Source file:* ``src/groundmodel/application/clear_litho_model.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-69

.. literalinclude:: ../../../src/groundmodel/application/clear_litho_model.py
   :language: python
   :lines: 1-69
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening docstring and imports for the use case that wipes all content out of a lithostratigraphic model while keeping the model itself. The docstring lists the five things it deletes in one transaction — contacts, correlation edges, surfaces, body rows, and orphaned litho soil-unit vocabulary — and a notes section on the foreign-key cascades involved. The imports bring in the partition locks, the orphan-formation sweep, the four database row types being deleted, and the cross-section repository.

**Why it is here.** The docstring records why each delete is explicit rather than left to a cascade. The model row is kept, so deleting it (which would cascade its edges, bodies and surfaces away) is not an option; each collection is deleted directly instead. The order is deliberate: edges are deleted before contacts so the returned edge count is accurate, because a cascade-delete does not add to the outer statement's row count. Body rows must be deleted explicitly because layers reference them with set-null foreign keys, so deleting the layers leaves the bodies behind as stale orphans. After the clear, the model is a clean slate ready for a fresh Suggest-litho pass.

.. CG-EXPLANATION-END id=module-header

Class ``ClearLithoModelResult``
-------------------------------

.. CG-BLOCK id=class:ClearLithoModelResult lines=70-94

.. literalinclude:: ../../../src/groundmodel/application/clear_litho_model.py
   :language: python
   :lines: 70-94
   :lineno-match:

.. CG-EXPLANATION-START id=class:ClearLithoModelResult

**What this does.** A frozen dataclass (an immutable holder — its fields cannot change after it is built) reporting how many rows of each kind were removed: contacts, edges, surfaces, bodies and formations.

**Why it is here.** The counts are the honest report of a destructive operation, so the caller and the log can state exactly what a Clear removed rather than a bare success. The comment on the module header explains why the edge count is captured before the contact delete could cascade it invisibly.

.. CG-EXPLANATION-END id=class:ClearLithoModelResult

Class ``ClearLithoModel`` — header
----------------------------------

.. CG-BLOCK id=class:ClearLithoModel lines=95-103

.. literalinclude:: ../../../src/groundmodel/application/clear_litho_model.py
   :language: python
   :lines: 95-103
   :lineno-match:

.. CG-EXPLANATION-START id=class:ClearLithoModel

**What this does.** The use-case class header, inheriting the logger. Its docstring notes the caller commits.

**Why it is here.** The caller owns the transaction so the wipe can be composed with other work when needed; here it commits at the end of ``execute``.

.. CG-EXPLANATION-END id=class:ClearLithoModel

Method ``ClearLithoModel``. ``def __init__``
--------------------------------------------

.. CG-BLOCK id=method:ClearLithoModel.__init__ lines=104-108

.. literalinclude:: ../../../src/groundmodel/application/clear_litho_model.py
   :language: python
   :lines: 104-108
   :lineno-match:

.. CG-EXPLANATION-START id=method:ClearLithoModel.__init__

**What this does.** The setup step: stores the caller's database session.

**Why it is here.** The session is passed in, not opened, so the whole multi-step wipe lands in one commit.

.. CG-EXPLANATION-END id=method:ClearLithoModel.__init__

Method ``ClearLithoModel``. ``async def execute``
-------------------------------------------------

.. CG-BLOCK id=method:ClearLithoModel.execute lines=109-259

.. literalinclude:: ../../../src/groundmodel/application/clear_litho_model.py
   :language: python
   :lines: 109-259
   :lineno-match:

.. CG-EXPLANATION-START id=method:ClearLithoModel.execute

**What this does.** The entry point. It takes the litho partition lock and every sibling geotech child's lock, then issues the deletes in order: correlation edges, contacts, any remaining pending or rejected layers, surfaces, body rows, then the orphan-formation sweep, then it prunes stale seeded ids off the project's sections, and commits. It returns the five row counts.

**Why it is here.** The comments spell out the ordering, which is dictated by foreign keys and by the wish for accurate counts. Edges go first so their count is not swallowed by a later cascade; the extra layer delete catches pending and rejected layers that have no contact mirror and so survive the contact cascade; body rows go after the layers because the layer delete only nulls the body's anchor links rather than removing the body. The orphan sweep runs LAST because its survivor check must read the post-delete state — a soil unit is orphaned only once its last contact, layer and body are gone — and the shared predicate lives in one place because the geotech verbs need the same rule. The two partition locks are the exact case the lock was built for (audit 2026-08-23): this verb deletes litho layers then bodies while the background resolver walks the same two tables the other way, and pressing Clear inside the debounced recompute window deadlocked; taking both locks up front, litho-parent-first, closes that cross-model deadlock class, and is a no-op when there is no geotech child.

.. CG-EXPLANATION-END id=method:ClearLithoModel.execute

