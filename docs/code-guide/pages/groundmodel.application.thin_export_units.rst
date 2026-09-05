groundmodel.application.thin_export_units
=========================================

.. CG-PAGE source=src/groundmodel/application/thin_export_units.py complete=true

*Source file:* ``src/groundmodel/application/thin_export_units.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-70

.. literalinclude:: ../../../src/groundmodel/application/thin_export_units.py
   :language: python
   :lines: 1-70
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the export-thinning use case. It imports the dataclass-replace helper, the id type, the section snapshot value objects, the shared unit-identifier function and the logger, and its long docstring defines exactly what "adjacent" means.

**Why it is here.** The docstring records the owner ruling (2026-08-26): thin the units in DXF and PDF, keep Plaxis exact, and let the shallower parent's name win. Duplicate units of the same NAD class arise when two different litho or geological parents carry the same class — a real geological boundary that carries no NAD meaning and reads as two materials where the engineer has one. Plaxis is left exact because its single global layer stack cannot express the same layer appearing twice in a column. Two units merge only when they share an identifier, share at least one column, and the deeper is the shallower's immediate successor at every shared column with consistent roles — the interleave case is left alone because it is exactly what Plaxis could not express either.

.. CG-EXPLANATION-END id=module-header

Class ``ThinExportUnits`` — header
----------------------------------

.. CG-BLOCK id=class:ThinExportUnits lines=71-73

.. literalinclude:: ../../../src/groundmodel/application/thin_export_units.py
   :language: python
   :lines: 71-73
   :lineno-match:

.. CG-EXPLANATION-START id=class:ThinExportUnits

**What this does.** Declares the use-case class that collapses adjacent units sharing a NAD class and soil.

**Why it is here.** Why: recorded in the class + module docstrings.

.. CG-EXPLANATION-END id=class:ThinExportUnits

Method ``ThinExportUnits``. ``def __init__``
--------------------------------------------

.. CG-BLOCK id=method:ThinExportUnits.__init__ lines=74-77

.. literalinclude:: ../../../src/groundmodel/application/thin_export_units.py
   :language: python
   :lines: 74-77
   :lineno-match:

.. CG-EXPLANATION-START id=method:ThinExportUnits.__init__

**What this does.** Names the logger after this module.

**Why it is here.** This use case works entirely on the in-memory snapshot value object, so it needs no session — unusually for the application layer, it touches no database.

.. CG-EXPLANATION-END id=method:ThinExportUnits.__init__

Method ``ThinExportUnits``. ``def execute``
-------------------------------------------

.. CG-BLOCK id=method:ThinExportUnits.execute lines=78-144

.. literalinclude:: ../../../src/groundmodel/application/thin_export_units.py
   :language: python
   :lines: 78-144
   :lineno-match:

.. CG-EXPLANATION-START id=method:ThinExportUnits.execute

**What this does.** Returns a snapshot with adjacent same-identifier units merged. It repeatedly finds the first mergeable pair, records the absorbed unit's name (and any names it had itself absorbed) against the survivor, drops the absorbed unit's formation and contacts, and stops when no pair remains; it then stamps the absorbed names onto the survivors and returns a new snapshot, or the original object unchanged when nothing merged.

**Why it is here.** It runs to a fixpoint so a stack of three same-class units collapses to one, not two: absorbing the middle one leaves the top directly on the bottom, a newly mergeable pair. The input snapshot is never mutated because it is a frozen value object the caller may still need unthinned — the Plaxis path uses the exact one. Returning the same object when nothing merges means the geological and litho paths, which have no NAD identifier to thin on, pay nothing.

.. CG-EXPLANATION-END id=method:ThinExportUnits.execute

Method ``ThinExportUnits``. ``def _first_mergeable_pair``
---------------------------------------------------------

.. CG-BLOCK id=method:ThinExportUnits._first_mergeable_pair lines=145-180

.. literalinclude:: ../../../src/groundmodel/application/thin_export_units.py
   :language: python
   :lines: 145-180
   :lineno-match:

.. CG-EXPLANATION-START id=method:ThinExportUnits._first_mergeable_pair

**What this does.** Finds one (survivor, absorbed) pair or nothing. It builds each column's successor map, then for each unit with a real identifier checks every unit seen directly beneath it: if that lower unit shares the identifier and sits directly below at every shared column, it returns the pair.

**Why it is here.** It returns the first pair in snapshot order so the result is deterministic across runs, and the caller re-scans after each merge. The merge is a pure deletion — dropping the deeper unit's contacts and formation — so the survivor's extent automatically runs down to whatever lay below, because that is how every consumer derives a unit's extent; nothing is recomputed, so nothing can drift (module docstring).

.. CG-EXPLANATION-END id=method:ThinExportUnits._first_mergeable_pair

Function ``def _successor_by_column``
-------------------------------------

.. CG-BLOCK id=function:_successor_by_column lines=181-201

.. literalinclude:: ../../../src/groundmodel/application/thin_export_units.py
   :language: python
   :lines: 181-201
   :lineno-match:

.. CG-EXPLANATION-START id=function:_successor_by_column

**What this does.** Builds a mapping from each investigation to, per formation, the formation directly beneath it, by sorting that column's contacts by depth.

**Why it is here.** The snapshot carries no polygons, so a column's contacts sorted by depth are its only statement of vertical order; this map is the basis for the "directly below" test. It is rebuilt once per scan.

.. CG-EXPLANATION-END id=function:_successor_by_column

Function ``def _candidates_below``
----------------------------------

.. CG-BLOCK id=function:_candidates_below lines=202-211

.. literalinclude:: ../../../src/groundmodel/application/thin_export_units.py
   :language: python
   :lines: 202-211
   :lineno-match:

.. CG-EXPLANATION-START id=function:_candidates_below

**What this does.** Returns every formation seen directly beneath a given formation at any column.

**Why it is here.** It narrows the merge search to units that are actually adjacent somewhere, rather than checking every pair.

.. CG-EXPLANATION-END id=function:_candidates_below

Function ``def _adjacent_everywhere``
-------------------------------------

.. CG-BLOCK id=function:_adjacent_everywhere lines=212-231

.. literalinclude:: ../../../src/groundmodel/application/thin_export_units.py
   :language: python
   :lines: 212-231
   :lineno-match:

.. CG-EXPLANATION-START id=function:_adjacent_everywhere

**What this does.** Returns true when the deeper unit sits directly under the shallower one at every column where both appear, and at least one column has both.

**Why it is here.** A single column with a third unit wedged between them returns false — that is the interleave case the ruling leaves alone, because merging there would be geologically wrong and inexpressible in Plaxis.

.. CG-EXPLANATION-END id=function:_adjacent_everywhere

