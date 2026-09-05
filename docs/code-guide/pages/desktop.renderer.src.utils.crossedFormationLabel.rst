desktop.renderer.src.utils.crossedFormationLabel
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/crossedFormationLabel.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/crossedFormationLabel.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-12

.. literalinclude:: ../../../desktop/src/renderer/src/utils/crossedFormationLabel.ts
   :language: typescript
   :lines: 1-12
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment introducing a pure leaf helper that builds a body's geological context label — every geological formation the body crosses, joined with a plus sign.

**Why it is here.** The comment records the design rule (R2, debt #278): a body may span geological boundaries, so its attribution is a list, not a single majority stamp. It was extracted as the second copy of the join-with-fallback shape — it first lived inside the body context menu and the Parameters scope header now needs the identical label — so the extract-on-the-second-copy rule applies, and both readers share this one helper.

.. CG-EXPLANATION-END id=module-header

``interface BodyGeoFormationFields``
------------------------------------

.. CG-BLOCK id=interface:BodyGeoFormationFields lines=13-38

.. literalinclude:: ../../../desktop/src/renderer/src/utils/crossedFormationLabel.ts
   :language: typescript
   :lines: 13-38
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodyGeoFormationFields

**What this does.** Describes the two crossed-formation fields a body may carry: the list of formations it crosses (shallowest first), and an older single majority-formation name.

**Why it is here.** The comments record that this is a structural subset of both the body list item and the Parameters roster entry, and that the singular name is the older response shape — kept so a response that predates the list still produces a label, in keeping with the additive-only API contract.

.. CG-EXPLANATION-END id=interface:BodyGeoFormationFields

``function crossedFormationLabel``
----------------------------------

.. CG-BLOCK id=function:crossedFormationLabel lines=39-44

.. literalinclude:: ../../../desktop/src/renderer/src/utils/crossedFormationLabel.ts
   :language: typescript
   :lines: 39-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:crossedFormationLabel

**What this does.** Returns the label: nothing when the body is absent; the crossed formations joined with a plus sign when the list is present; otherwise the older single majority name; otherwise an empty string.

**Why it is here.** The docstring records that callers render nothing when the result is empty, so an old cached row or a body with no geological attribution simply shows no label rather than erroring — and the list is preferred over the singular name so a body that crosses boundaries is fully credited.

.. CG-EXPLANATION-END id=function:crossedFormationLabel

