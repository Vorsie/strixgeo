desktop.renderer.src.utils.geotechHierarchicalFill.constructive.farBand
=======================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/farBand.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/farBand.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/farBand.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens a tiny shared module holding one tolerance and one far-end read — 'what continues past a line' — extracted from the constructs file when the cover weld became its second consumer. It imports the band and tie types only.

**Why it is here.** The docstring records the reason for extracting it: both the constructs and the cover weld ask the same two questions — is this the same contact, and what lies on my side of it over there — and a second copy of either answer is a place they could drift apart.

.. CG-EXPLANATION-END id=module-header

``const CONTACT_EPS``
---------------------

.. CG-BLOCK id=const:CONTACT_EPS lines=22-42

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/farBand.ts
   :language: typescript
   :lines: 22-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTACT_EPS

**What this does.** A constant, 1e-6 m — the tolerance at which two contacts are treated as the same contact.

**Why it is here.** Float arithmetic never lands two computed elevations on the identical number, so a tiny tolerance is what lets the code decide two contacts coincide; contacts are stored on the millimetre grid, so a micrometre is far below anything real.

.. CG-EXPLANATION-END id=const:CONTACT_EPS

``function farBandOf``
----------------------

.. CG-BLOCK id=function:farBandOf lines=43-58

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/farBand.ts
   :language: typescript
   :lines: 43-58
   :lineno-match:

.. CG-EXPLANATION-START id=function:farBandOf

**What this does.** Returns the mass that continues past a tie, on the SAME side of the contact: a band sitting above its contact continues as whatever sits above the contact over there, and one below continues as whatever is below; it returns nothing when that side is empty over there.

**Why it is here.** The docstring gives the owner's worked example: reading the wrong side reads the neighbouring soil and calls a continuous mass a different one, whereas the sand's tie lands on the facing sand-over-silt contact and 'it is the same litho and packing density'.

.. CG-EXPLANATION-END id=function:farBandOf

