desktop.renderer.src.components.sections.geotechBoundaryKinds
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/geotechBoundaryKinds.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/geotechBoundaryKinds.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBoundaryKinds.ts
   :language: typescript
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file: it decides which drawn boundaries on the geotech axis are locked litho contacts. It imports the layer type and two helpers from the band-edit module.

**Why it is here.** The docstring records the two kinds of horizontal line the geotech axis stacks: a boundary between two packing bands that share a litho parent is the engineer's own subdivision and can be dragged freely, while a boundary whose bands sit in different litho units restates a lithostratigraphic contact, which ruling 2 forbids moving as a packing boundary. Drawn identically, a correct refusal reads as a broken app — on the owner's model one column carries 17 internal boundaries of which only 3 are the draggable kind, and he reached for the locked ones twice in ten minutes — so the renderer needs one flat answer per drawn contact.

.. CG-EXPLANATION-END id=module-header

``type LayerRow``
-----------------

.. CG-BLOCK id=type:LayerRow lines=23-49

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBoundaryKinds.ts
   :language: typescript
   :lines: 23-49
   :lineno-match:

.. CG-EXPLANATION-START id=type:LayerRow

**What this does.** Describes the subset of layer fields this module reads — id, formation, the two anchor ids, and the top and base depth — shared by the geotech rows and the litho rows.

**Why it is here.** A narrow pick of just the fields the boundary check needs, common to both row kinds.

.. CG-EXPLANATION-END id=type:LayerRow

``function restatingContactIds``
--------------------------------

.. CG-BLOCK id=function:restatingContactIds lines=50-75

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/geotechBoundaryKinds.ts
   :language: typescript
   :lines: 50-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:restatingContactIds

**What this does.** Collects the ids of the geotech bands whose top boundary restates a lithostratigraphic contact, judging each column against its own litho stack.

**Why it is here.** The docstring records it keys the result by the band BELOW the boundary, because that is what a contact is — the top of the band beneath it — which keeps it in step with the ids the drag hit-strip already uses; each column is judged against its own stack because two columns can carry bands at identical depths and disagree about whether a boundary crosses a litho unit; and the shallowest band on a column is never included because its top is where the sounding starts, not a boundary between two bands.

.. CG-EXPLANATION-END id=function:restatingContactIds

