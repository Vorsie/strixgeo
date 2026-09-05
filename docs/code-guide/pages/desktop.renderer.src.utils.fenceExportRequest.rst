desktop.renderer.src.utils.fenceExportRequest
=============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/fenceExportRequest.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/fenceExportRequest.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/fenceExportRequest.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment explaining what this file assembles — the DXF export request for the fence diagram, built from exactly what the 3-D viewer is painting — and the imports it needs (the formation shape, the fence panel shape, and the litho label formatter).

**Why it is here.** The comment records three reasons: the request carries the geometry because the fence walls are built in the renderer from a partition engine that has no server-side twin, so the server cannot rebuild them; it also carries names and colours because both are presentation-boundary values (a litho label is translated from the raw soil code at render time, a geotech colour is the NAD packing colour, neither is stored translated), so the caller passes the same formations array it handed the viewer and what is exported is what was seen; and the coordinates are left untouched because the panels are already in projected project-CRS metres, the space the DXF is written in.

.. CG-EXPLANATION-END id=module-header

``interface FenceExportPanel``
------------------------------

.. CG-BLOCK id=interface:FenceExportPanel lines=26-41

.. literalinclude:: ../../../desktop/src/renderer/src/utils/fenceExportRequest.ts
   :language: typescript
   :lines: 26-41
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FenceExportPanel

**What this does.** Describes one fence wall in the export: its formation and body ids, its vertices as x-y-elevation metres, the triangle indices into those vertices, a display name that becomes the DXF layer name, and a display colour that becomes the layer's colour.

**Why it is here.** The comments record that the vertices are in the project CRS and that the name and colour are the display values, so the DXF layers read the way the screen did.

.. CG-EXPLANATION-END id=interface:FenceExportPanel

``interface FenceExportRequest``
--------------------------------

.. CG-BLOCK id=interface:FenceExportRequest lines=42-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/fenceExportRequest.ts
   :language: typescript
   :lines: 42-46
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FenceExportRequest

**What this does.** Describes the request body: a list of export panels.

**Why it is here.** A thin wrapper naming what the export endpoint receives.

.. CG-EXPLANATION-END id=interface:FenceExportRequest

``const UNKNOWN_FORMATION_COLOR``
---------------------------------

.. CG-BLOCK id=const:UNKNOWN_FORMATION_COLOR lines=47-74

.. literalinclude:: ../../../desktop/src/renderer/src/utils/fenceExportRequest.ts
   :language: typescript
   :lines: 47-74
   :lineno-match:

.. CG-EXPLANATION-START id=const:UNKNOWN_FORMATION_COLOR

**What this does.** A grey colour used when a formation cannot be resolved. The block also shows the function's documentation of how panels are kept or dropped.

**Why it is here.** The comment records it matches the viewer's own fallback grey, so an unresolved formation looks the same in the DXF as it did on screen.

.. CG-EXPLANATION-END id=const:UNKNOWN_FORMATION_COLOR

``function buildFenceExportRequest``
------------------------------------

.. CG-BLOCK id=function:buildFenceExportRequest lines=75-99

.. literalinclude:: ../../../desktop/src/renderer/src/utils/fenceExportRequest.ts
   :language: typescript
   :lines: 75-99
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildFenceExportRequest

**What this does.** Builds the request from the rendered panels. It indexes the formations by id, then for each panel drops it if it has no vertices or triangles, otherwise copies its geometry and attaches the formation's display name and normalised colour (or the fallback grey).

**Why it is here.** The docstring records two deliberate choices: an empty panel is dropped because an empty named CAD layer reads as a unit missing from the model rather than one that was simply not drawn here; but a panel whose formation is unknown is kept, labelled by its raw id, because it carries real geometry and silently omitting it would punch an invisible hole in the deliverable while the raw id makes the anomaly visible in the layer list.

.. CG-EXPLANATION-END id=function:buildFenceExportRequest

``function formationDisplayName``
---------------------------------

.. CG-BLOCK id=function:formationDisplayName lines=100-110

.. literalinclude:: ../../../desktop/src/renderer/src/utils/fenceExportRequest.ts
   :language: typescript
   :lines: 100-110
   :lineno-match:

.. CG-EXPLANATION-START id=function:formationDisplayName

**What this does.** Returns the label for a formation: an "Unknown unit" placeholder when it cannot be resolved, the translated litho name when it has a main soil code, otherwise its stored name.

**Why it is here.** The docstring records that the label is the soil-code-translated legend name, keeping the DXF consistent with the on-screen legend and honouring the translate-at-the-presentation-boundary rule.

.. CG-EXPLANATION-END id=function:formationDisplayName

``function normaliseHex``
-------------------------

.. CG-BLOCK id=function:normaliseHex lines=111-114

.. literalinclude:: ../../../desktop/src/renderer/src/utils/fenceExportRequest.ts
   :language: typescript
   :lines: 111-114
   :lineno-match:

.. CG-EXPLANATION-START id=function:normaliseHex

**What this does.** Ensures a colour string starts with a hash, adding one when it is missing, and returns nothing for an empty colour.

**Why it is here.** The comment records that formation colours arrive with or without the leading hash, so this settles them into one form the DXF writer expects.

.. CG-EXPLANATION-END id=function:normaliseHex

