groundmodel.application.stratigraphy_candidate
==============================================

.. CG-PAGE source=src/groundmodel/application/stratigraphy_candidate.py complete=true

*Source file:* ``src/groundmodel/application/stratigraphy_candidate.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../src/groundmodel/application/stratigraphy_candidate.py
   :language: python
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A one-line docstring and the imports for the candidate value object below.

**Why it is here.** One class per file; this file holds only the discovered-candidate type.

.. CG-EXPLANATION-END id=module-header

Class ``StratigraphyCandidate``
-------------------------------

.. CG-BLOCK id=class:StratigraphyCandidate lines=8-33

.. literalinclude:: ../../../src/groundmodel/application/stratigraphy_candidate.py
   :language: python
   :lines: 8-33
   :lineno-match:

.. CG-EXPLANATION-START id=class:StratigraphyCandidate

**What this does.** A frozen dataclass describing one unique formation found while scanning boreholes: the display name, the formal regional reference (or nothing for informal-only boreholes), the stable cross-borehole key, and how many in-scope boreholes carry that key.

**Why it is here.** The selection filter on the write path is expressed in these stable keys, so the discover endpoint returns them and the dialog passes the same set back on confirm. The borehole count lets the dialog sort the most-common units to the top.

.. CG-EXPLANATION-END id=class:StratigraphyCandidate

