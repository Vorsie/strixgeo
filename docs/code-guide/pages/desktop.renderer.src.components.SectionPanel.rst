desktop.renderer.src.components.SectionPanel
============================================

.. CG-PAGE source=desktop/src/renderer/src/components/SectionPanel.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/SectionPanel.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-176

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionPanel.tsx
   :language: tsx
   :lines: 1-176
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's docstring and its long import list. The docstring says this is the cross-section panel: it owns the viewport state, the coordinate transforms and the SVG composition, while sub-components in ``components/sections/`` handle the header, scrub bar, columns and DEM line, and the ``useSectionData`` hook does the data fetching. The imports bring in the React building blocks, the many section sub-components and overlays, the API-client types, the coordinate, fill and projection helpers, the store hooks for the various fill and overlay toggles, and the translation helper.

**Why it is here.** This is the on-screen editing surface for all three model levels — geological, litho and geotech. It draws with *SVG* (vector) rather than *canvas* (pixels), matching the CptChart and BoreholeLog, because SVG keeps DOM inspection, hover tooltips and accessibility easy at the ~1000+ elements a section reaches (docstring). It is a very large file — the god-component tracked as debt #201 — and its block comments are the map that keeps it readable until it is split up. As everywhere, the panel reads its data and writes its edits only through the API: the data arrives via ``useSectionData`` and every change goes out through a handler prop.

.. CG-EXPLANATION-END id=module-header

``const EMPTY_LENS_BOUNDARIES``
-------------------------------

.. CG-BLOCK id=const:EMPTY_LENS_BOUNDARIES lines=177-187

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionPanel.tsx
   :language: tsx
   :lines: 177-187
   :lineno-match:

.. CG-EXPLANATION-START id=const:EMPTY_LENS_BOUNDARIES

**What this does.** A single shared empty map, plus the opening of the minimum-thickness constant's documentation.

**Why it is here.** It is reused as a stable stand-in so the fill overlay's boundary prop keeps the same identity between redraws instead of receiving a freshly-built empty map each time — which would make the overlay think its input changed and redraw needlessly (docstring).

.. CG-EXPLANATION-END id=const:EMPTY_LENS_BOUNDARIES

``const CONTACT_DRAG_MIN_THICKNESS_M``
--------------------------------------

.. CG-BLOCK id=const:CONTACT_DRAG_MIN_THICKNESS_M lines=188-225

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionPanel.tsx
   :language: tsx
   :lines: 188-225
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTACT_DRAG_MIN_THICKNESS_M

**What this does.** The thinnest layer a contact drag may leave behind, 0.1 metre. It also carries the litho free-draw master-switch comment and the remaining imports.

**Why it is here.** One value serves both axes so they cannot disagree about how thin a layer may become: on the litho axis it is the floor a drag keeps from its neighbouring contacts, and on the geotech axis it is how far short of a restated litho contact a dragged line stops — so reaching the wall can never delete the unit between the two contacts (docstring).

.. CG-EXPLANATION-END id=const:CONTACT_DRAG_MIN_THICKNESS_M

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=226-770

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionPanel.tsx
   :language: tsx
   :lines: 226-770
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The section panel's large contract. Besides the ``section`` row it takes: an ``onPatch`` handler that saves the buffer width, vertical exaggeration and channel settings server-side; a close handler and double-click-to-open handlers; a focused-column callback and a column-reveal slot; the contact create / update / delete handlers; the geotech band edits (split, set class, clear a column, merge, move a boundary, absorb a lens); litho unit create and existing-unit pick; formation create; the DXF export and seed-from-stratigraphy actions; the DOV overlay picker callbacks; the litho-suggestion ghost state and the bulk multi-anchor ghost state; the correlation-edge handlers; and the body join / disjoin / name / dissolve handlers with the standing unions.

**Why it is here.** The same props pattern as the ``desktop.renderer.src.components.CptChart`` page, at scale: nearly every handler is optional so the test-render path and any read-only context can mount the panel without a network seam, and so an axis that is meant to be view-only simply omits its editing handlers — withholding a geotech edit handler, for instance, keeps that axis exactly as view-only as before (docstrings). The settings ``onPatch`` saves ride the .gmproj bundle so they survive reopening the project. The comments record two disciplines worth noting: a raw position or column index must never cross the column-reveal boundary the wrong way, and the multi-select marquee is a read-only highlight deliberately decoupled from any mutation handler. Irreversible edits such as deleting a contact or dissolving a body are taken through a confirmation dialog.

.. CG-EXPLANATION-END id=interface:Props

``function SectionPanel``
-------------------------

.. CG-BLOCK id=function:SectionPanel lines=771-4421

.. literalinclude:: ../../../desktop/src/renderer/src/components/SectionPanel.tsx
   :language: tsx
   :lines: 771-4421
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionPanel

**What this does.** The orchestrator component. It holds the viewport state — the visible along-section range, the level range and the vertical exaggeration — builds the transforms that convert an along-section position and a level into screen pixels and back (kept as cached callbacks), and handles the pan, wheel-zoom, scrub-bar and zoom-button interactions. It computes the collision-handled column layout (each column's screen X comes from the along-to-screen transform), pulls the DEM samples, CPT plots and projected investigations from the data hook, and composes it all into one large SVG scene: the grid, the DEM surface line, the investigation columns, the contact and correlation overlays, the partition- and model-fill overlays, the geotech and litho ghost overlays, the context menus, and the formation and composition picker dialogs.

**Why it is here.** The transforms are cached with the viewport in their dependency list, so a redraw that does not actually change the view hands the sub-components the same transform functions and avoids a cascade of needless redraws (docstring). Because every column's screen X flows through the along-to-screen transform, the collision layout lives here rather than in the data hook — and every drawn overlay must use that post-layout screen X, never a raw projected position, so an overlay stays glued to its column when the spacing changes. The wheel-zoom is wired through a native, non-passive listener (the section-canvas gesture hooks) for the same reason as the CptChart wheel-zoom — React's own wheel handler is passive. Irreversible edits are gated behind a confirmation dialog. The file is the acknowledged god-component (debt #201); its section comments keep it navigable until it is broken up.

.. CG-EXPLANATION-END id=function:SectionPanel

