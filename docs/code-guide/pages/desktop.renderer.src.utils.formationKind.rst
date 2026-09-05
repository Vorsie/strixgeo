desktop.renderer.src.utils.formationKind
========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/formationKind.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/formationKind.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-77

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationKind.ts
   :language: typescript
   :lines: 1-77
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file tells apart the three kinds of formation that arrive mixed together in one list: pure geological formations, litho-builder units, and geotechnical units. The comment explains the situation — the API that lists formations is project-scoped, so it returns every formation row in the project regardless of which model it belongs to, and each stage's screen must sift this single stream so its legend and inspector show only the right vocabulary. It documents the correct field to sort on (``source_litho_formation_id``, a link stamped on every geotech row and absent on all others), a table of which attributes each of the four formation kinds carries, and the history of two earlier discriminators that were retired because they mis-sorted rows.

**Why it is here.** The comment records exactly why the earlier tests were wrong and this one is right, and the reason matters for correctness: a geotech formation inherits its soil code from its source litho unit, so testing on the soil code alone leaked geotech rows into the litho list; and a borehole-only skeleton geotech unit has no packing class yet, so testing on the presence of a class silently dropped it from the geotech list. The link stamped by the geotech backend on every geotech row — and on nothing else — is the one field that makes the three tests mutually exclusive and complete across all four kinds.

.. CG-EXPLANATION-END id=module-header

``function isGeologicalFormation``
----------------------------------

.. CG-BLOCK id=function:isGeologicalFormation lines=78-102

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationKind.ts
   :language: typescript
   :lines: 78-102
   :lineno-match:

.. CG-EXPLANATION-START id=function:isGeologicalFormation

**What this does.** Returns true when the formation is a pure geological formation — one that carries neither a litho soil code nor a NAD packing class.

**Why it is here.** Geological formations carry none of the derived attributes, so the two-null check identifies them; the comment notes the two-null form is kept (rather than testing the geotech link) for backwards compatibility with older saved bundles that may not include the newer link field. It is used by the Geology stage's Layers panel and the Sections inspector to keep their lists geological-only.

.. CG-EXPLANATION-END id=function:isGeologicalFormation

``function isLithoUnit``
------------------------

.. CG-BLOCK id=function:isLithoUnit lines=103-130

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationKind.ts
   :language: typescript
   :lines: 103-130
   :lineno-match:

.. CG-EXPLANATION-START id=function:isLithoUnit

**What this does.** Returns true when the formation is a litho-builder unit: it carries a litho soil code but has no geotech source link.

**Why it is here.** The ``source_litho_formation_id === null`` guard is the load-bearing part and carries a ``// reason:`` comment: because geotech formations inherit the soil code from their source litho unit, soil code alone is not enough to tell them apart, so without this guard geotech derivatives would leak into the litho list. The geotech link is set only on geotech rows, so requiring it to be absent keeps them out.

.. CG-EXPLANATION-END id=function:isLithoUnit

``function isGeotechUnit``
--------------------------

.. CG-BLOCK id=function:isGeotechUnit lines=131-137

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationKind.ts
   :language: typescript
   :lines: 131-137
   :lineno-match:

.. CG-EXPLANATION-START id=function:isGeotechUnit

**What this does.** Returns true when the formation is a geotechnical unit — whether it is classified with a packing class or is still a borehole-only skeleton with no class yet — by testing that the geotech source link is present.

**Why it is here.** The ``// reason:`` comment records that a borehole-only skeleton geotech unit has no packing class (there is no CPT cone resistance available to assign one), so testing on the class would silently omit it; the source link is set on both classified and skeleton geotech rows, making it the authoritative single test for a geotech unit.

.. CG-EXPLANATION-END id=function:isGeotechUnit

