desktop.renderer.src.shell.stages.sections.geotechJumpLadder
============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/geotechJumpLadder.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/geotechJumpLadder.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/geotechJumpLadder.ts
   :language: typescript
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the pure helpers behind the 'jump to Parameters' feature. Clicking a filled region in a section can deep-link to the matching row in the Parameters stage; this file turns a clicked surface's reported formation and body into the most specific Parameters target it can prove.

**Why it is here.** The overlays report a clicked surface's formation id and (when it knows one) a resolved body; this module turns that into the typed scope the deep link carries. It is pure so the ladder can be pinned by tests without mounting the canvas.

.. CG-EXPLANATION-END id=module-header

``interface LithoLayerRef``
---------------------------

.. CG-BLOCK id=interface:LithoLayerRef lines=13-17

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/geotechJumpLadder.ts
   :language: typescript
   :lines: 13-17
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoLayerRef

**What this does.** The few fields the ladder reads off a litho layer: its id, its formation id, and its body id.

**Why it is here.** A structural subset — the ladder needs only these, so it names only these, keeping it decoupled from the full layer shape.

.. CG-EXPLANATION-END id=interface:LithoLayerRef

``interface GeotechLayerRef``
-----------------------------

.. CG-BLOCK id=interface:GeotechLayerRef lines=18-23

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/geotechJumpLadder.ts
   :language: typescript
   :lines: 18-23
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechLayerRef

**What this does.** The fields the ladder reads off a geotech band: id, formation id, body id, and the id of the litho layer it subdivides (its parent).

**Why it is here.** Same subset idea as the litho reference, plus the parent-litho link — the geotech ladder walks up to the litho parent to find a class row.

.. CG-EXPLANATION-END id=interface:GeotechLayerRef

``interface GeotechFormationRef``
---------------------------------

.. CG-BLOCK id=interface:GeotechFormationRef lines=24-29

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/geotechJumpLadder.ts
   :language: typescript
   :lines: 24-29
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechFormationRef

**What this does.** A geotech formation reduced to its id and its NAD packing class number (which may be null).

**Why it is here.** The class number is what a geotech-class jump target carries, so the ladder needs a formation-to-class lookup.

.. CG-EXPLANATION-END id=interface:GeotechFormationRef

``interface GeotechJumpContext``
--------------------------------

.. CG-BLOCK id=interface:GeotechJumpContext lines=30-43

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/geotechJumpLadder.ts
   :language: typescript
   :lines: 30-43
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechJumpContext

**What this does.** Bundles the three lists the geotech ladder walks: the litho layers, the geotech bands, and the geotech formations.

**Why it is here.** The step that lands on a class row has to resolve a clicked region up through its geotech band to its litho parent body, so it needs all three lists in one context object.

.. CG-EXPLANATION-END id=interface:GeotechJumpContext

``function lithoJumpScope``
---------------------------

.. CG-BLOCK id=function:lithoJumpScope lines=44-67

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/geotechJumpLadder.ts
   :language: typescript
   :lines: 44-67
   :lineno-match:

.. CG-EXPLANATION-START id=function:lithoJumpScope

**What this does.** For a clicked LITHO surface: if the surface named a body, returns a litho-body scope; otherwise a litho-unit scope.

**Why it is here.** This is step 4 of the ladder spec — a litho surface jumps as itself, narrowed to the body when one was resolved and to the pooled unit otherwise. A body only counts as a body when it is geometrically connected (owner body-scope ruling).

.. CG-EXPLANATION-END id=function:lithoJumpScope

``function geotechJumpScope``
-----------------------------

.. CG-BLOCK id=function:geotechJumpScope lines=68-113

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/geotechJumpLadder.ts
   :language: typescript
   :lines: 68-113
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotechJumpScope

**What this does.** For a clicked GEOTECH surface, walks a three-rung fallback: a resolved body jumps to that geotech body (the most specific); otherwise, if the clicked region's bands all share ONE litho parent body and one NAD class, it jumps to that class row; failing both, it falls back to the pooled geotech-unit row. The middle rung builds lookups from the three lists and scans the region's band ids to collect the parent bodies and class.

**Why it is here.** This is the spec's steps 1 to 3 — land on the most specific Parameters node the click can PROVE, and step down one level at a time when it cannot. The class rung requires a UNIQUE parent body so an ambiguous region does not claim a class row it cannot justify.

.. CG-EXPLANATION-END id=function:geotechJumpScope

