desktop.renderer.src.utils.geotechParentFit
===========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechParentFit.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechParentFit.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechParentFit.ts
   :language: typescript
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file decides which columns' packing bands no longer fit the litho units they subdivide. The comment explains the contract: a packing band must lie inside its litho parent, because Subdivide cuts a litho unit into NAD classes; if the engineer then moves the litho contact from the geotech axis, the bands keep the depths they were derived against while the unit shrank, so a moved boundary sits beside an unmoved band and the engineer must be told the bands are out of date. It imports the shared depth tolerance.

**Why it is here.** The reasons are recorded in the comment. Staleness is derived, never stored (owner ruling): the overhang IS the staleness, so if a band pokes out of its parent that column needs re-deriving and if every band fits nothing is stale. Deriving rather than storing it means no migration or write path can forget to record it, it survives a close-and-reopen for free, it cannot go out of date, and it self-clears the moment the contact is dragged back. The comment records that the ruling was made against evidence: an adversarial review had found two bugs caused by caching staleness — flags that outlived the condition they described — and a comparison cannot outlive its operands. This module is the pure rule only.

.. CG-EXPLANATION-END id=module-header

``const PARENT_FIT_TOLERANCE_M``
--------------------------------

.. CG-BLOCK id=const:PARENT_FIT_TOLERANCE_M lines=44-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechParentFit.ts
   :language: typescript
   :lines: 44-46
   :lineno-match:

.. CG-EXPLANATION-START id=const:PARENT_FIT_TOLERANCE_M

**What this does.** How far a band may poke out of its parent and still be judged to fit — set to the shared coincident-depth tolerance.

**Why it is here.** The docstring records that a band top of 2 and a parent top of 2.0004 are the same boundary recorded at two precisions, not a real overhang; comparing exactly would report a fifth of the owner's coincident boundaries as overhanging and send him to Subdivide on columns where nothing has moved every time he opens the section, so the same rounding allowance that answers coincidence answers this.

.. CG-EXPLANATION-END id=const:PARENT_FIT_TOLERANCE_M

``interface BandParent``
------------------------

.. CG-BLOCK id=interface:BandParent lines=47-56

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechParentFit.ts
   :language: typescript
   :lines: 47-56
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BandParent

**What this does.** Describes the litho unit a packing band subdivides: its formation and its top and base depth as they stand now, after any contact drag.

**Why it is here.** The staleness test compares the band's derived depths against the unit's current extent, so the parent carries the up-to-date top and base.

.. CG-EXPLANATION-END id=interface:BandParent

``interface BandFit``
---------------------

.. CG-BLOCK id=interface:BandFit lines=57-83

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechParentFit.ts
   :language: typescript
   :lines: 57-83
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BandFit

**What this does.** Describes one packing band paired with the litho unit it claims to subdivide: the column it sits on, its own top and base as derived, and its parent unit (or nothing when none could be resolved).

**Why it is here.** A null parent is called out as a data-integrity problem rather than a re-derive case, which the counting function treats separately.

.. CG-EXPLANATION-END id=interface:BandFit

``function overhangs``
----------------------

.. CG-BLOCK id=function:overhangs lines=84-109

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechParentFit.ts
   :language: typescript
   :lines: 84-109
   :lineno-match:

.. CG-EXPLANATION-START id=function:overhangs

**What this does.** Returns true when a band pokes out of its parent — above the unit's top or below its base — by more than the rounding allowance.

**Why it is here.** Both directions count because a band above its parent's top now belongs to the unit above and a band below its base to the unit below; either way it describes ground the unit no longer covers, which is exactly what staleness means here.

.. CG-EXPLANATION-END id=function:overhangs

``function columnsNeedingRederive``
-----------------------------------

.. CG-BLOCK id=function:columnsNeedingRederive lines=110-120

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechParentFit.ts
   :language: typescript
   :lines: 110-120
   :lineno-match:

.. CG-EXPLANATION-START id=function:columnsNeedingRederive

**What this does.** Returns the ids of the columns whose bands no longer fit their parents. It walks every band, skips those with no parent and columns already recorded, and records a column's id the first time one of its bands overhangs — returning the stale columns once each, in first-seen order, or an empty list when everything fits.

**Why it is here.** The docstring records that a band with no resolvable parent is not counted, because a deleted formation or unmapped body is a data-integrity problem that re-deriving the column cannot fix — reporting it would send the engineer to a verb that cannot help and would keep saying so after every attempt. Reading nothing from storage and writing nothing is the whole point of the derived-not-stored ruling above.

.. CG-EXPLANATION-END id=function:columnsNeedingRederive

