groundmodel.application.update_formation_contact
================================================

.. CG-PAGE source=src/groundmodel/application/update_formation_contact.py complete=true

*Source file:* ``src/groundmodel/application/update_formation_contact.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-65

.. literalinclude:: ../../../src/groundmodel/application/update_formation_contact.py
   :language: python
   :lines: 1-65
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for the update-one-contact use case. The docstring explains that the anchor is updatable (the drag-to-re-anchor flow moves a contact to a different borehole or CPT), and it spells out the cross-merge rule for a depth-only drag: dragging UP the dragger survives and crossed peers are deleted; dragging DOWN the formation above absorbs the dragger and the crossed peers plus the dragger itself are deleted.

**Why it is here.** Cross-merge only fires on the geological axis for a depth-only change; a re-anchor or a formation swap has different meaning and is skipped. Litho contacts skip cross-merge entirely (owner directive 2026-05-27): once a lithology is accepted the engineer must add/remove via explicit right-click, not by dragging one boundary over another. When a litho cross-merge does delete rows, the instance resolver is re-run before commit; body detection is deliberately not fired here (owner directive 2026-05-31).

.. CG-EXPLANATION-END id=module-header

Class ``UpdateFormationContact`` — header
-----------------------------------------

.. CG-BLOCK id=class:UpdateFormationContact lines=66-75

.. literalinclude:: ../../../src/groundmodel/application/update_formation_contact.py
   :language: python
   :lines: 66-75
   :lineno-match:

.. CG-EXPLANATION-START id=class:UpdateFormationContact

**What this does.** The use-case class, plus a half-millimetre depth tolerance constant used later as a loop guard when a coupled geo/litho pair is kept in sync.

**Why it is here.** An exact equality check would be defeated by a single rounding wobble on the depth, risking an endless propagation loop or a missed stop (debt #218); the half-millimetre band treats depths equal in intent as equal while a genuinely different depth differs by far more.

.. CG-EXPLANATION-END id=class:UpdateFormationContact

Method ``UpdateFormationContact``. ``def __init__``
---------------------------------------------------

.. CG-BLOCK id=method:UpdateFormationContact.__init__ lines=76-81

.. literalinclude:: ../../../src/groundmodel/application/update_formation_contact.py
   :language: python
   :lines: 76-81
   :lineno-match:

.. CG-EXPLANATION-START id=method:UpdateFormationContact.__init__

**What this does.** Stores the session and builds a geology repository over it.

**Why it is here.** The caller owns the session; the use case commits once.

.. CG-EXPLANATION-END id=method:UpdateFormationContact.__init__

Method ``UpdateFormationContact``. ``async def execute``
--------------------------------------------------------

.. CG-BLOCK id=method:UpdateFormationContact.execute lines=82-355

.. literalinclude:: ../../../src/groundmodel/application/update_formation_contact.py
   :language: python
   :lines: 82-355
   :lineno-match:

.. CG-EXPLANATION-START id=method:UpdateFormationContact.execute

**What this does.** Applies a partial patch to one contact. It loads the pre-update row (returning nothing if it vanished), takes the body-partition lock, fetches the model to learn if it is lithostratigraphic, and — for a depth-only drag on a non-litho model — finds peer contacts on the same column and deletes the ones the drag crossed, absorbing and deleting the dragger itself on a downward cross. If any rows were deleted on a litho model it re-runs the instance resolver in the same transaction. On the absorbed path it marks surfaces stale, commits, and returns nothing. Otherwise it writes the patch through the repository, propagates a coupled depth change to the partner contact, marks the affected surfaces stale (both the new and, on a formation swap, the old formation), commits, refreshes, and returns the snapshot.

**Why it is here.** The lock is taken before the first write, at the earliest point the model id is known, because every write here mirrors into the litho layer table through a trigger and the cross-merge deletes plus the resolver would otherwise race the background body recompute stamping the same rows in a different order — the deadlock the owner hit on 2026-08-23. The lock is re-entrant per session so the resolver's later acquisition stays free. It is the litho-parent-first lock order that avoids the deadlock. Two different reasons produce a nothing return — a row that vanished (a race, mapped to not-found) versus a deliberate absorption (mapped to success) — so an ``absorbed`` flag on the instance tells the caller which. Marking stale rather than rebuilding is the on-click-build contract.

.. CG-EXPLANATION-END id=method:UpdateFormationContact.execute

Method ``UpdateFormationContact``. ``async def _propagate_coupled_depth``
-------------------------------------------------------------------------

.. CG-BLOCK id=method:UpdateFormationContact._propagate_coupled_depth lines=356-457

.. literalinclude:: ../../../src/groundmodel/application/update_formation_contact.py
   :language: python
   :lines: 356-457
   :lineno-match:

.. CG-EXPLANATION-START id=method:UpdateFormationContact._propagate_coupled_depth

**What this does.** Keeps a coupled geological/lithostratigraphic contact pair at the same depth: if the just-moved contact has a geo parent it moves that parent to the new depth; if it is a geo contact it moves every litho child that points at it. It writes the partner directly and only when the partner's depth actually differs from the new depth.

**Why it is here.** Moving either end must move the other (#162). It writes directly rather than re-entering the public update, to avoid triggering cross-merge and re-propagation. The "only write when different" rule is the loop guard that terminates the cycle: once the partner is already at the target depth its own update sees no change and stops. The geo→litho lookup can be scoped to the project as defence-in-depth (debt #211-c).

.. CG-EXPLANATION-END id=method:UpdateFormationContact._propagate_coupled_depth

