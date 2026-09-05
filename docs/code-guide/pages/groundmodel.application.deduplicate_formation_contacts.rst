groundmodel.application.deduplicate_formation_contacts
======================================================

.. CG-PAGE source=src/groundmodel/application/deduplicate_formation_contacts.py complete=true

*Source file:* ``src/groundmodel/application/deduplicate_formation_contacts.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../src/groundmodel/application/deduplicate_formation_contacts.py
   :language: python
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring and imports for a one-shot cleanup that removes legacy duplicate contacts. The docstring gives the survivor rule in priority order: a manual pick beats an auto-derived row; then a row with a link back to a DOV layer; then the most recently created.

**Why it is here.** The one-top-per-investigation uniqueness rule landed after some early auto-populate runs had already created duplicates (several "Boom clay at 0 m" on one borehole). This walks each duplicate group, keeps the single best survivor, and deletes the rest. Running it on a clean model does nothing (idempotent).

.. CG-EXPLANATION-END id=module-header

Class ``DedupeOutcome``
-----------------------

.. CG-BLOCK id=class:DedupeOutcome lines=41-49

.. literalinclude:: ../../../src/groundmodel/application/deduplicate_formation_contacts.py
   :language: python
   :lines: 41-49
   :lineno-match:

.. CG-EXPLANATION-START id=class:DedupeOutcome

**What this does.** A frozen dataclass summarising one dedupe pass: how many groups were inspected, how many duplicates were removed, and the ids of the removed rows.

**Why it is here.** The ids let the web response toast a meaningful number and would let a future undo re-create the rows.

.. CG-EXPLANATION-END id=class:DedupeOutcome

Class ``DeduplicateFormationContacts`` — header
-----------------------------------------------

.. CG-BLOCK id=class:DeduplicateFormationContacts lines=50-52

.. literalinclude:: ../../../src/groundmodel/application/deduplicate_formation_contacts.py
   :language: python
   :lines: 50-52
   :lineno-match:

.. CG-EXPLANATION-START id=class:DeduplicateFormationContacts

**What this does.** The use-case class: drop duplicate model/anchor/formation contacts.

**Why it is here.** One class per unit of work; it inherits the shared logger.

.. CG-EXPLANATION-END id=class:DeduplicateFormationContacts

Method ``DeduplicateFormationContacts``. ``def __init__``
---------------------------------------------------------

.. CG-BLOCK id=method:DeduplicateFormationContacts.__init__ lines=53-57

.. literalinclude:: ../../../src/groundmodel/application/deduplicate_formation_contacts.py
   :language: python
   :lines: 53-57
   :lineno-match:

.. CG-EXPLANATION-START id=method:DeduplicateFormationContacts.__init__

**What this does.** Stores the session.

**Why it is here.** The caller owns the session; the use case commits once, and only when it actually removes something.

.. CG-EXPLANATION-END id=method:DeduplicateFormationContacts.__init__

Method ``DeduplicateFormationContacts``. ``async def execute``
--------------------------------------------------------------

.. CG-BLOCK id=method:DeduplicateFormationContacts.execute lines=58-137

.. literalinclude:: ../../../src/groundmodel/application/deduplicate_formation_contacts.py
   :language: python
   :lines: 58-137
   :lineno-match:

.. CG-EXPLANATION-START id=method:DeduplicateFormationContacts.execute

**What this does.** Loads every contact in the model, groups them by (anchor, formation), and for each group of more than one sorts by the survivor priority, keeps the first, and marks the rest for removal. If any were removed it deletes them, refreshes the affected formation surfaces, and commits; if nothing was duplicated it does not commit at all. It returns the inspected-group count, the removed count, and the removed ids.

**Why it is here.** Grouping on the populated anchor (borehole or CPT, whichever is set) matches the one-top-per-investigation rule. Skipping the commit when nothing changed avoids an empty transaction. Refreshing the surfaces keeps the section view's slice query landing on current geometry.

.. CG-EXPLANATION-END id=method:DeduplicateFormationContacts.execute

Function ``def _survivor_priority``
-----------------------------------

.. CG-BLOCK id=function:_survivor_priority lines=138-176

.. literalinclude:: ../../../src/groundmodel/application/deduplicate_formation_contacts.py
   :language: python
   :lines: 138-176
   :lineno-match:

.. CG-EXPLANATION-START id=function:_survivor_priority

**What this does.** The sort key that decides which contact in a duplicate group survives. It returns a tuple ranked lowest-wins on three levels: source rank (manual pick beats interpolated beats borehole observation, with the synthetic pinch-out and model-seed sources ranked after the real-data trio), then rows that have a link back to a DOV layer, then the most recent creation time.

**Why it is here.** The source ranking preserves the original debt #38 contract: the auto-regenerable borehole-observation source ranks lowest of the three so a deliberate hand artefact survives an auto-populate re-run. The provenance tier keeps re-runs idempotent, and most-recent-wins breaks ties within a rank. The synthetic sources are slotted after the trio so they never silently evict a manual pick or a real observation.

.. CG-EXPLANATION-END id=function:_survivor_priority

