groundmodel.application.clear_geotech_column
============================================

.. CG-PAGE source=src/groundmodel/application/clear_geotech_column.py complete=true

*Source file:* ``src/groundmodel/application/clear_geotech_column.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../src/groundmodel/application/clear_geotech_column.py
   :language: python
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the clear-column file. It imports the partition lock, the orphan sweep, the instance resolver, and the model and layer rows, and its docstring says it is the rebuild escape hatch for one column.

**Why it is here.** With the pipeline presses importing already-banded columns as-is, the way to redo one column is to clear it here then press the step — only the cleared column rebuilds (owner 2026-08-18). The column's correlation edges die with its rows and NO tombstone is written, because this is rebuild preparation, not judgement, and a tombstone would block the machine from re-proposing the very ties the rebuild is for.

.. CG-EXPLANATION-END id=module-header

Class ``ClearGeotechColumn`` — header
-------------------------------------

.. CG-BLOCK id=class:ClearGeotechColumn lines=33-41

.. literalinclude:: ../../../src/groundmodel/application/clear_geotech_column.py
   :language: python
   :lines: 33-41
   :lineno-match:

.. CG-EXPLANATION-START id=class:ClearGeotechColumn

**What this does.** The use case that deletes one investigation's geotech bands so a pipeline press rebuilds it.

**Why it is here.** It clears exactly one column and commits once.

.. CG-EXPLANATION-END id=class:ClearGeotechColumn

Method ``ClearGeotechColumn``. ``def __init__``
-----------------------------------------------

.. CG-BLOCK id=method:ClearGeotechColumn.__init__ lines=42-46

.. literalinclude:: ../../../src/groundmodel/application/clear_geotech_column.py
   :language: python
   :lines: 42-46
   :lineno-match:

.. CG-EXPLANATION-START id=method:ClearGeotechColumn.__init__

**What this does.** Stores the session and builds the litho-layer repository.

**Why it is here.** The repository is the write gateway sharing the session.

.. CG-EXPLANATION-END id=method:ClearGeotechColumn.__init__

Method ``ClearGeotechColumn``. ``async def execute``
----------------------------------------------------

.. CG-BLOCK id=method:ClearGeotechColumn.execute lines=47-142

.. literalinclude:: ../../../src/groundmodel/application/clear_geotech_column.py
   :language: python
   :lines: 47-142
   :lineno-match:

.. CG-EXPLANATION-START id=method:ClearGeotechColumn.execute

**What this does.** Takes the partition lock, deletes the column's bands (matching either anchor), stales the solids, re-runs the resolver, sweeps orphan formations, drops the column's litho-provenance stamp, and commits, returning the deleted count.

**Why it is here.** The lock is taken before the delete because it races the background recompute (owner dogfeed 2026-08-23: a deadlock on the delete). The provenance stamp is dropped (debt #266) so a column with nothing on it stops counting toward the stale total and pointing the engineer at a re-press with nothing to rebuild; it is reassigned, not mutated in place, because the database does not track in-place changes to a JSON value. A column with no bands is a no-op returning zero, not an error.

.. CG-EXPLANATION-END id=method:ClearGeotechColumn.execute

