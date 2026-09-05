groundmodel.domain.services.detect_body_extents
===============================================

.. CG-PAGE source=src/groundmodel/domain/services/detect_body_extents.py complete=true

*Source file:* ``src/groundmodel/domain/services/detect_body_extents.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../src/groundmodel/domain/services/detect_body_extents.py
   :language: python
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a module that now holds only three shared snapshot types, and imports the dataclass and id tools.

**Why it is here.** The docstring records that the body-extent system was retired in the 2026-06-06 refactor: the detect-body-extents function and its extent primitives are gone, and only these three contact-stack types survive because two other modules (auto-correlate and crossing-pinch-out detection) still reuse them. See the body-model design note for the retirement.

.. CG-EXPLANATION-END id=module-header

Class ``ContactStackEntry``
---------------------------

.. CG-BLOCK id=class:ContactStackEntry lines=15-35

.. literalinclude:: ../../../src/groundmodel/domain/services/detect_body_extents.py
   :language: python
   :lines: 15-35
   :lineno-match:

.. CG-EXPLANATION-START id=class:ContactStackEntry

**What this does.** A frozen data holder for one contact within a column's depth-sorted stack: its id, the formation whose top it marks, and its depth.

**Why it is here.** The Strix convention, stated in the docstring, is that a contact marks the top of the formation that starts there and runs down to the next contact. Callers walk these entries in depth order, so bundling the id, formation, and depth together is the natural unit.

.. CG-EXPLANATION-END id=class:ContactStackEntry

Class ``ContactStack``
----------------------

.. CG-BLOCK id=class:ContactStack lines=36-51

.. literalinclude:: ../../../src/groundmodel/domain/services/detect_body_extents.py
   :language: python
   :lines: 36-51
   :lineno-match:

.. CG-EXPLANATION-START id=class:ContactStack

**What this does.** A frozen data holder for all contacts on one investigation: the investigation id and its depth-sorted entries.

**Why it is here.** Both reusing modules need a column's contacts as one depth-ordered group keyed by investigation, so this bundles the entries with the id they belong to.

.. CG-EXPLANATION-END id=class:ContactStack

Class ``ContactEdge``
---------------------

.. CG-BLOCK id=class:ContactEdge lines=52-65

.. literalinclude:: ../../../src/groundmodel/domain/services/detect_body_extents.py
   :language: python
   :lines: 52-65
   :lineno-match:

.. CG-EXPLANATION-START id=class:ContactEdge

**What this does.** A frozen data holder for one user-approved correlation edge: its two endpoint layer ids.

**Why it is here.** The crossing-pinch-out detector inspects approved correlation edges, so it needs each edge as a slim two-endpoint record independent of how edges are stored.

.. CG-EXPLANATION-END id=class:ContactEdge

