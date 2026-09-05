desktop.renderer.src.utils.partitionFillV2.tieContacts
======================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/tieContacts.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/tieContacts.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tieContacts.ts
   :language: typescript
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module holds two helpers that let the enclosed-lens extraction recognise an interbed whose own contact rides a tie. The imports bring in the edge and column types, the unit geometry type, and the two-sided-terminations flag.

**Why it is here.** Ruling 8a / 8l(b): a tie sits on a unit's contact, and that contact is physically shared with the adjacent unit whose contact coincides, so a tie on the shared surface ties BOTH units. An enclosed interbed whose own contact rides such a tie is effectively tied (corr 1) and must stay a real un-merged unit that bands emergently, NOT collapse into a lens. These helpers are flag-gated so the flag-off engine stays byte-identical. Pure module.

.. CG-EXPLANATION-END id=module-header

``const TIE_CONTACT_SNAP_M``
----------------------------

.. CG-BLOCK id=const:TIE_CONTACT_SNAP_M lines=25-44

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tieContacts.ts
   :language: typescript
   :lines: 25-44
   :lineno-match:

.. CG-EXPLANATION-START id=const:TIE_CONTACT_SNAP_M

**What this does.** The 1e-6 metres tolerance for matching an interbed contact to a tie-endpoint elevation.

**Why it is here.** A shared contact is meant to be the same surface, so only a near-exact elevation match counts as riding the tie.

.. CG-EXPLANATION-END id=const:TIE_CONTACT_SNAP_M

``function interbedContactTied``
--------------------------------

.. CG-BLOCK id=function:interbedContactTied lines=45-75

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tieContacts.ts
   :language: typescript
   :lines: 45-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:interbedContactTied

**What this does.** Returns whether an interbed's own top or base contact coincides (within tolerance) with any tie-endpoint elevation on its column; when the elevation set is absent (flag off) it always returns false.

**Why it is here.** It is how the extraction decides an interbed is 8a-tied and must not be pulled out as a lens. Absent flag-off, so the guard is a no-op there.

.. CG-EXPLANATION-END id=function:interbedContactTied

``function buildTieContactElevs``
---------------------------------

.. CG-BLOCK id=function:buildTieContactElevs lines=76-109

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tieContacts.ts
   :language: typescript
   :lines: 76-109
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildTieContactElevs

**What this does.** Builds, per original column index, the set of contact elevations that carry a tie endpoint: it locates every unit by layer id and records each edge endpoint's top or base elevation on the right column. It returns an empty map when the two-sided flag is off.

**Why it is here.** The enclosed-lens extraction consults this to keep an 8a-tied interbed un-merged. It is flag-gated so flag-off extraction is byte-identical — the guard has nothing to fire on.

.. CG-EXPLANATION-END id=function:buildTieContactElevs

