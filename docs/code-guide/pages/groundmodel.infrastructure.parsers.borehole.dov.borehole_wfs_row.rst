groundmodel.infrastructure.parsers.borehole.dov.borehole_wfs_row
================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/borehole/dov/borehole_wfs_row.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/borehole/dov/borehole_wfs_row.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/borehole_wfs_row.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the dataclass helper for the borehole-summary row below.

**Why it is here.** The next block is a plain data-holder, so the dataclass helper is all it needs.

.. CG-EXPLANATION-END id=module-header

Class ``BoreholeWfsRow``
------------------------

.. CG-BLOCK id=class:BoreholeWfsRow lines=8-65

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/borehole_wfs_row.py
   :language: python
   :lines: 8-65
   :lineno-match:

.. CG-EXPLANATION-START id=class:BoreholeWfsRow

**What this does.** An unchangeable data-holder for the borehole summary that comes from the WFS reply rather than the borehole's own XML: its permkey and test number, the record URLs, its position, the drilling method, some header text, the total depth, and eight yes/no flags saying which kinds of interpretation exist for it.

**Why it is here.** Some facts about a borehole live only in the WFS reply, not in its detail XML, so this row carries them across to the step that merges them into the parsed borehole. Its position may be blank, because DOV could in theory ship a feature with no coordinates — but the save step refuses a borehole that ends up with no position, since it could not be placed on the map. The eight flags let the orchestrator decide which interpretation streams are worth fetching for this borehole.

.. CG-EXPLANATION-END id=class:BoreholeWfsRow

