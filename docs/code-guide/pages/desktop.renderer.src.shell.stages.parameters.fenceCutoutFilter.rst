desktop.renderer.src.shell.stages.parameters.fenceCutoutFilter
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/fenceCutoutFilter.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/fenceCutoutFilter.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/fenceCutoutFilter.ts
   :language: typescript
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file that decides which fence walls the cutout keeps for a given unit, and imports the fence-panel type and the scope type it works with. A fence panel is one wall of the fence; the scope is the unit the engineer has selected.

**Why it is here.** The filter is kept pure — free of CesiumJS — so this one visual decision (which walls survive) can be tested without a 3-D globe. The comment records the exact complaint that drove it (owner, 2026-08-27): the cutout was showing a disconnected body he had not selected, and his rule is "a body is only a body if it is geometrically connected or if the user says this body is the same as that body." A wall belongs to a body only if its SOURCE LAYERS say so — the panel's own body LABEL is never trusted, because that label dropped mid-run segments of one continuous body on the CS1 test project. A class row keeps every wall belonging to ANY of its bodies, because a wall welded across a boundary carries layers of both sides and dropping it would recreate the gap.

.. CG-EXPLANATION-END id=module-header

``type CutoutFilter``
---------------------

.. CG-BLOCK id=type:CutoutFilter lines=28-51

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/fenceCutoutFilter.ts
   :language: typescript
   :lines: 28-51
   :lineno-match:

.. CG-EXPLANATION-START id=type:CutoutFilter

**What this does.** Defines the ``CutoutFilter`` type: it is EITHER a formation filter (an aggregate unit keeps all of its formation's walls) OR a body-set filter (anything narrower keeps the walls of a specific set of bodies). The documentation below it describes the next function, which chooses which of the two a scope wants. A type is just a note about what kind of value is expected.

**Why it is here.** Two filter shapes exist because a pooled whole unit and a narrower body/class scope answer "which walls" differently: the unit wants every panel of its formation, including unstamped paint, while a body or class wants only the panels traced to particular resolver bodies.

.. CG-EXPLANATION-END id=type:CutoutFilter

``function cutoutFilterForScope``
---------------------------------

.. CG-BLOCK id=function:cutoutFilterForScope lines=52-83

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/fenceCutoutFilter.ts
   :language: typescript
   :lines: 52-83
   :lineno-match:

.. CG-EXPLANATION-START id=function:cutoutFilterForScope

**What this does.** Turns a scope into the filter it wants. A pooled unit (a whole lithology or geotech unit) returns a formation filter carrying its formation id. Anything narrower — a body, or a class row — returns a body-set filter: it walks the scope's own bands and collects the set of resolver bodies they belong to. The documentation that follows describes the next function, which applies such a filter to the walls.

**Why it is here.** The body set is read from the scope's bands, which come from ``bandsForScope`` — the single authority that also drives the pools and counts — so the cutout can never disagree with the statistics beside it about which bodies belong to the scope. A leaf gives one body; a class row gives the union of its bodies' bodies.

.. CG-EXPLANATION-END id=function:cutoutFilterForScope

``function fenceCutoutPanels``
------------------------------

.. CG-BLOCK id=function:fenceCutoutPanels lines=84-100

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/fenceCutoutFilter.ts
   :language: typescript
   :lines: 84-100
   :lineno-match:

.. CG-EXPLANATION-START id=function:fenceCutoutPanels

**What this does.** Applies a filter to the whole-project wall panels and returns the survivors. A formation filter keeps every panel of that formation. A body-set filter keeps a panel when ANY of its source layers resolves (through the layer-to-body map) to a body in the set. If the panels have not been assembled yet it passes the "not ready" state straight through so loading stays loading.

**Why it is here.** Resolving membership through the layer-to-body map — the same label-independent authority the rest of the app uses — rather than the panel's own body label is the whole fix for the owner's complaint about a stray disconnected body. The ANY-layer rule (a wall welded across a boundary belongs to both sides) is deliberate: it is looser than the jump ladder's exactly-one rule, because dropping a shared wall would tear a visible gap in the cutout.

.. CG-EXPLANATION-END id=function:fenceCutoutPanels

