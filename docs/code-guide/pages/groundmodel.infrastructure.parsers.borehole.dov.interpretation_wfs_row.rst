groundmodel.infrastructure.parsers.borehole.dov.interpretation_wfs_row
======================================================================

.. CG-PAGE source=src/groundmodel/infrastructure/parsers/borehole/dov/interpretation_wfs_row.py complete=true

*Source file:* ``src/groundmodel/infrastructure/parsers/borehole/dov/interpretation_wfs_row.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/interpretation_wfs_row.py
   :language: python
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring, then the imports for the interpretation summary row — the dataclass helper and the observation-kind enum.

**Why it is here.** Each interpretation shows up first as a WFS row that identifies it and points at its detail XML; this file's type holds that identity so the client and the orchestrator can both use it.

.. CG-EXPLANATION-END id=module-header

Class ``InterpretationWfsRow``
------------------------------

.. CG-BLOCK id=class:InterpretationWfsRow lines=19-67

.. literalinclude:: ../../../src/groundmodel/infrastructure/parsers/borehole/dov/interpretation_wfs_row.py
   :language: python
   :lines: 19-67
   :lineno-match:

.. CG-EXPLANATION-START id=class:InterpretationWfsRow

**What this does.** An unchangeable data-holder for one interpretation row from the WFS: its permkey, its parent borehole number, its stream kind, and the record URLs.

**Why it is here.** The stream kind is set by the client from which layer the row came, because the feature itself does not repeat it. It deliberately holds no parsed content — author, date, reliability live in the detail XML and are filled by the parser — so that WFS-row facts and XML-parsed facts never mix and drift apart, per the data-integrity rules.

.. CG-EXPLANATION-END id=class:InterpretationWfsRow

