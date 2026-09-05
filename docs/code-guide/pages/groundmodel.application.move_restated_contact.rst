groundmodel.application.move_restated_contact
=============================================

.. CG-PAGE source=src/groundmodel/application/move_restated_contact.py complete=true

*Source file:* ``src/groundmodel/application/move_restated_contact.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-79

.. literalinclude:: ../../../src/groundmodel/application/move_restated_contact.py
   :language: python
   :lines: 1-79
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the move-restated-contact file. It imports the band-edit helpers, the litho-geo link helpers, the materialiser base, the orphan sweep, the resolver, and the pure restated-move planner, and defines a millimetre rounding and a coincidence tolerance. Its docstring records the gesture and why it exists.

**Why it is here.** The owner asked (2026-08-09) to move a contact from the geotech screen and have the whole three-level chain move with it, because the cone resolves a contact finer than the driller's log grid. It exists as one use case rather than three renderer calls because a contact restated in three models is one boundary, and moving it in one splits it — so it writes the geotech band boundary (both bands re-derived), the litho contact, and the geological contact it is derived from, all in one transaction.

.. CG-EXPLANATION-END id=module-header

Class ``RestatedContactMoveResult``
-----------------------------------

.. CG-BLOCK id=class:RestatedContactMoveResult lines=80-103

.. literalinclude:: ../../../src/groundmodel/application/move_restated_contact.py
   :language: python
   :lines: 80-103
   :lineno-match:

.. CG-EXPLANATION-START id=class:RestatedContactMoveResult

**What this does.** A frozen dataclass carrying the geotech band result, the two resized litho rows, and the geological contact carried along (or the one a merge coupled to).

**Why it is here.** It reports what the move wrote across all three models; the geological contact is nothing when the litho row is not derived from one and the landing coincides with none.

.. CG-EXPLANATION-END id=class:RestatedContactMoveResult

Class ``MoveRestatedContact`` — header
--------------------------------------

.. CG-BLOCK id=class:MoveRestatedContact lines=104-115

.. literalinclude:: ../../../src/groundmodel/application/move_restated_contact.py
   :language: python
   :lines: 104-115
   :lineno-match:

.. CG-EXPLANATION-START id=class:MoveRestatedContact

**What this does.** The use case that moves a restated contact and everything recorded at the same boundary. It extends the borehole-materialiser base.

**Why it is here.** It inherits the find-or-create helpers so a hand edit lands on the same formation rows the build produces.

.. CG-EXPLANATION-END id=class:MoveRestatedContact

Method ``MoveRestatedContact``. ``def __init__``
------------------------------------------------

.. CG-BLOCK id=method:MoveRestatedContact.__init__ lines=116-119

.. literalinclude:: ../../../src/groundmodel/application/move_restated_contact.py
   :language: python
   :lines: 116-119
   :lineno-match:

.. CG-EXPLANATION-START id=method:MoveRestatedContact.__init__

**What this does.** Initialises the base with this module's name and the session.

**Why it is here.** Same base-and-logger setup.

.. CG-EXPLANATION-END id=method:MoveRestatedContact.__init__

Method ``MoveRestatedContact``. ``async def execute``
-----------------------------------------------------

.. CG-BLOCK id=method:MoveRestatedContact.execute lines=120-463

.. literalinclude:: ../../../src/groundmodel/application/move_restated_contact.py
   :language: python
   :lines: 120-463
   :lineno-match:

.. CG-EXPLANATION-START id=method:MoveRestatedContact.execute

**What this does.** Takes both partition locks (litho parent then geotech child), loads a context per band, plans the move (which may be a merge when it lands on a neighbour), resolves the litho pair and the geological contact up front, then writes the band boundary, the two litho rows and the geological contact together, re-validates ties, resolves bodies, sweeps orphans, and commits.

**Why it is here.** Both locks are taken before any write, litho parent first (the one multi-model lock order) so two holders can never deadlock, because this rewrites two body partitions while the background recompute re-stamps the same rows. The litho pair is resolved from the database at the boundary, never handed in, because the old renderer approach broke the moment the band and contact depths stopped coinciding. A merge landing on a geological contact couples to it (owner 2026-08-12), and a severed litho-to-geo link that coincides within the tolerance is healed and re-written (owner 2026-08-11), unless two geological contacts would collide, which is refused.

.. CG-EXPLANATION-END id=method:MoveRestatedContact.execute

Method ``MoveRestatedContact``. ``async def _parent_litho_model_id``
--------------------------------------------------------------------

.. CG-BLOCK id=method:MoveRestatedContact._parent_litho_model_id lines=464-499

.. literalinclude:: ../../../src/groundmodel/application/move_restated_contact.py
   :language: python
   :lines: 464-499
   :lineno-match:

.. CG-EXPLANATION-START id=method:MoveRestatedContact._parent_litho_model_id

**What this does.** Returns the parent litho model this geotech model refines, raising when there is none.

**Why it is here.** Resolved up front because it is the second body partition to lock, and both locks must be taken together before any write; a geotech model with no parent has no litho contact to move.

.. CG-EXPLANATION-END id=method:MoveRestatedContact._parent_litho_model_id

Method ``MoveRestatedContact``. ``async def _litho_pair_at``
------------------------------------------------------------

.. CG-BLOCK id=method:MoveRestatedContact._litho_pair_at lines=500-583

.. literalinclude:: ../../../src/groundmodel/application/move_restated_contact.py
   :language: python
   :lines: 500-583
   :lineno-match:

.. CG-EXPLANATION-START id=method:MoveRestatedContact._litho_pair_at

**What this does.** Finds the two litho rows that share the boundary being moved, taking the nearest match on each side and refusing when none meet or a sliver sits between them.

**Why it is here.** The search is scoped to the parent litho model so it does not match the packing band itself (whose base is the same boundary) and silently move a band twice. It takes the nearest, not the first, because the tolerance exceeds the minimum layer thickness so a sliver could put two rows' edges inside it and an unordered pick would be nondeterministic (audit F18); a true disagreement between the two models is refused rather than guessed.

.. CG-EXPLANATION-END id=method:MoveRestatedContact._litho_pair_at

