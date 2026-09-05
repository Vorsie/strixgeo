desktop.renderer.src.components.sections.sectionFillIdentity
============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/sectionFillIdentity.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/sectionFillIdentity.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-44

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionFillIdentity.ts
   :language: typescript
   :lines: 1-44
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Defines the single identity that the render's two same-neighbour passes compare: the seam-stroke pass (which keeps a hairline only where the neighbour is different) and the dissolve pass (which paints one shape per same-thing body).

**Why it is here.** On the litho axis the formation row IS the identity, so comparing raw formation ids was right there. On the geotech axis it is not: the subdivide keeps one formation row per packing class per litho parent per geological parent, so a single packing class lives under two or three row ids wherever its parent changes. The fill already merges those into one mass (the 2026-08-21 one-mass-one-body ruling, with ``packingClassOf`` as its single translation point), but the two render passes did not, so a mass the engine had welded still drew a seam where its row id changed, which is the vertical line the owner kept seeing on his real CS1. Collapsing on the class cannot lose a colour, because geotech colour is a pure function of the class, so every row of one class already paints the same colour.

.. CG-EXPLANATION-END id=module-header

``function fillIdentityOf``
---------------------------

.. CG-BLOCK id=function:fillIdentityOf lines=45-50

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/sectionFillIdentity.ts
   :language: typescript
   :lines: 45-50
   :lineno-match:

.. CG-EXPLANATION-START id=function:fillIdentityOf

**What this does.** Returns the packing class when the formation is a known geotech row, and the formation id itself otherwise.

**Why it is here.** So the geotech axis compares on the packing class (one mass across parent changes) while the litho axis, which has no geotech lookup, is left completely untouched.

.. CG-EXPLANATION-END id=function:fillIdentityOf

