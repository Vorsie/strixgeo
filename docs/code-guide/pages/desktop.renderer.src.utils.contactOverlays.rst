desktop.renderer.src.utils.contactOverlays
==========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/contactOverlays.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/contactOverlays.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/utils/contactOverlays.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment describing what this pure helper produces — the horizontal lines to draw across a CPT or borehole detail chart marking the formation tops and litho-unit tops, so the engineer keeps depth context while reading the trace — plus the import of the two response shapes it needs.

**Why it is here.** The comment records that it is kept pure (no React, no side effects, no API) and lives in the utils folder so both the CPT chart and the borehole log can share the same overlay shape rather than each building its own.

.. CG-EXPLANATION-END id=module-header

``interface ContactOverlay``
----------------------------

.. CG-BLOCK id=interface:ContactOverlay lines=27-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/contactOverlays.ts
   :language: typescript
   :lines: 27-37
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ContactOverlay

**What this does.** Describes one horizontal contact line: its depth below the surface, the formation's colour, the label, whether it came from the geological or the litho model, and a stable key.

**Why it is here.** The comments record that the depth is positive-downward to match the chart's axis, the colour is the formation's stored colour used verbatim, and the key is composed of the source plus the row id so the same database row keeps the same key whether it is read from the geology list or the litho list — which lets React track it reliably across redraws.

.. CG-EXPLANATION-END id=interface:ContactOverlay

``type InvestigationKind``
--------------------------

.. CG-BLOCK id=type:InvestigationKind lines=38-56

.. literalinclude:: ../../../desktop/src/renderer/src/utils/contactOverlays.ts
   :language: typescript
   :lines: 38-56
   :lineno-match:

.. CG-EXPLANATION-START id=type:InvestigationKind

**What this does.** Names the two kinds of investigation a chart can be for: a CPT or a borehole.

**Why it is here.** The helper must match contacts on the right anchor column (the CPT id versus the borehole id), so it takes this kind to know which column to compare.

.. CG-EXPLANATION-END id=type:InvestigationKind

``function buildContactOverlays``
---------------------------------

.. CG-BLOCK id=function:buildContactOverlays lines=57-107

.. literalinclude:: ../../../desktop/src/renderer/src/utils/contactOverlays.ts
   :language: typescript
   :lines: 57-107
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildContactOverlays

**What this does.** Builds the overlay list for one investigation across both models. It indexes the formations by id, then walks the geology contacts and the litho contacts, keeping each one anchored to this investigation whose formation can still be resolved, turning it into an overlay with the formation's depth, colour, name and source, and finally sorts the whole list by depth.

**Why it is here.** The docstring and comments record two decisions: a contact whose formation cannot be resolved (a deleted formation or a dangling row) is skipped silently because the chart is informative only and must not crash on stale state; and synthetic pinch-out contacts, which are bound to no single investigation, never appear here because they match no anchor column.

.. CG-EXPLANATION-END id=function:buildContactOverlays

