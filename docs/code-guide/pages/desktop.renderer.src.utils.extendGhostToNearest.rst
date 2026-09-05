desktop.renderer.src.utils.extendGhostToNearest
===============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/extendGhostToNearest.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/extendGhostToNearest.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/utils/extendGhostToNearest.ts
   :language: typescript
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment introducing the pure helper behind the right-click "Extend to nearest contacts" gesture on a manual ghost layer, plus the import of the ghost shape. It lays out the rule: the extended layer's top becomes the deepest committed contact above the clicked depth (or the surface), and its base becomes the shallowest contact below (or the investigation's total depth); then it checks the result does not overlap another ghost on the same anchor.

**Why it is here.** The comment records that this is the whole transform and the model hook is only a thin wrapper that feeds it through the ghost-state setter — so the rule lives in one testable place.

.. CG-EXPLANATION-END id=module-header

``interface CommittedContact``
------------------------------

.. CG-BLOCK id=interface:CommittedContact lines=20-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/extendGhostToNearest.ts
   :language: typescript
   :lines: 20-46
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CommittedContact

**What this does.** Describes the one field this helper needs from a committed contact: its top depth. The block also shows the function's documentation of its inputs and its success-or-error return.

**Why it is here.** A thin shape declaring only the depth means the helper can be given any contact source without carrying fields it does not use.

.. CG-EXPLANATION-END id=interface:CommittedContact

``function extendGhostToNearest``
---------------------------------

.. CG-BLOCK id=function:extendGhostToNearest lines=47-126

.. literalinclude:: ../../../desktop/src/renderer/src/utils/extendGhostToNearest.ts
   :language: typescript
   :lines: 47-126
   :lineno-match:

.. CG-EXPLANATION-START id=function:extendGhostToNearest

**What this does.** Extends the ghost layer at a given index to span between its nearest committed neighbours. It bails with an error if there is no layer there; takes the layer's midpoint as the reference depth; sorts the contacts and finds the deepest above (defaulting to the surface) and the shallowest below (defaulting to total depth); refuses with a reason if that range would overlap another ghost on the same anchor; otherwise rewrites just this layer's top and base and clears any prior depth edit on it so the fresh bounds are not overridden.

**Why it is here.** The comments record the choices: the midpoint is used rather than the top because for a freshly created sentinel layer it equals the top while for a partially extended layer it is more natural; the overlap check uses half-open intervals so two layers touching at an exact shared boundary do not count as overlapping; and the prior depth edit is cleared because an old edit would otherwise win over the new raw bounds.

.. CG-EXPLANATION-END id=function:extendGhostToNearest

