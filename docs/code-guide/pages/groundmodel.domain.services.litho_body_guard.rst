groundmodel.domain.services.litho_body_guard
============================================

.. CG-PAGE source=src/groundmodel/domain/services/litho_body_guard.py complete=true

*Source file:* ``src/groundmodel/domain/services/litho_body_guard.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_body_guard.py
   :language: python
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces a pure guard deciding whether two geotech contacts can be tied without merging separate bodies.

**Why it is here.** The docstring records the owner ruling of 2026-08-04: a contact is a SURFACE that touches the band above and below it, so up to two lithostratigraphic bodies. A packing tie is legitimate whenever the two surfaces share at least one body (if one matches it matches). What the guard refuses is a pair whose adjacent-body sets are DISJOINT, so two separate sand bodies never merge into one via this gesture, and any contact whose neighbourhood cannot be resolved.

.. CG-EXPLANATION-END id=module-header

Function ``def shares_litho_body``
----------------------------------

.. CG-BLOCK id=function:shares_litho_body lines=24-55

.. literalinclude:: ../../../src/groundmodel/domain/services/litho_body_guard.py
   :language: python
   :lines: 24-55
   :lineno-match:

.. CG-EXPLANATION-START id=function:shares_litho_body

**What this does.** Returns whether the two contacts touch at least one common litho body, by intersecting their adjacent-body sets. An unmapped contact, or one with an empty set, always blocks the correlation. A set here is an unordered collection with no duplicates.

**Why it is here.** The guard is deliberately conservative: rather than silently permit a possibly cross-body tie, it blocks any contact whose bands could not be resolved to accepted, body-stamped layers. A half-matched tie is still allowed and renders as a line that constrains geometry without merging bodies, exactly like the litho stage's own cross-lithology surface ties.

.. CG-EXPLANATION-END id=function:shares_litho_body

