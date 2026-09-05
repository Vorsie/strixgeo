desktop.renderer.src.components.sections.useSectionData
=======================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/useSectionData.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/useSectionData.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-59

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useSectionData.ts
   :language: typescript
   :lines: 1-59
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The cross-section data hook: it projects the project's investigations onto the section line, fetches the DEM ground-surface samples and the CPT plot batch, and exposes the persisted CPT and borehole channel toggles.

**Why it is here.** It was pulled out of the section panel so the panel becomes a thin orchestrator of viewport state and coordinate transforms; the geological-model editor consumes the same hook output as props, which is the whole reason for the split. It owns the DEM samples, the CPT plot batch, the projected investigation lists, and the channel toggles; it does NOT own viewport state (pan, zoom, exaggeration) or the collision-nudged placed columns, because those depend on the viewport and so are computed in the panel.

.. CG-EXPLANATION-END id=module-header

``interface SectionData``
-------------------------

.. CG-BLOCK id=interface:SectionData lines=60-133

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useSectionData.ts
   :language: typescript
   :lines: 60-133
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionData

**What this does.** The shape the hook returns: the CPT and borehole channel toggles and their setters, the column-spacing multiplier and its setter, the snap-to-stratigraphy flag and its setter, the DEM samples, the CPT plots map, the projected CPT and borehole lists, and the borehole detail map.

**Why it is here.** Each toggle updates in memory optimistically so the section re-renders instantly, and the caller wires a separate patch so the choice rides the project bundle on the next save. On the fetched maps, null while a request is in flight versus a filled map once it resolves lets the renderer tell loading from loaded and simply skip a track or line that has not arrived.

.. CG-EXPLANATION-END id=interface:SectionData

``function useSectionData``
---------------------------

.. CG-BLOCK id=function:useSectionData lines=134-407

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/useSectionData.ts
   :language: typescript
   :lines: 134-407
   :lineno-match:

.. CG-EXPLANATION-START id=function:useSectionData

**What this does.** Reads the toggles out of the section's view-state (re-syncing them only when the section identity changes), fetches the DEM samples when the endpoints or coordinate system change (skipping a degenerate or implausible section), projects the CPTs and boreholes onto the line honouring the excluded-id lists, and fetches the CPT plot batch and the borehole detail batch keyed on a content-stable string.

**Why it is here.** Several load-bearing guards live here. Re-syncing on the section id alone avoids flickering the toggles when the server echoes back a slightly different view-state after the hook's own patch. The degenerate-length and implausible-coordinate guards stop a section that transiently reads (0,0) from hammering the DEM endpoint until it runs out of memory (dogfeed 2026-05-23). Joining the id lists into a single string for the effect keys collapses reference churn into a value comparison, which stops an infinite render loop when default empty arrays create a new array every render. The borehole batch asks for exactly the three lab families the sample-marker hover shows, grain size plus both homes of the organic-content line (owner 2026-08-15), and project scope is enforced server-side.

.. CG-EXPLANATION-END id=function:useSectionData

