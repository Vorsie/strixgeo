desktop.renderer.src.utils.admixtureNadChoice
=============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/admixtureNadChoice.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/admixtureNadChoice.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../desktop/src/renderer/src/utils/admixtureNadChoice.ts
   :language: typescript
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment explains what this file decides and why, then imports three data shapes from the geology API-client types. Its job is to work out which accepted litho units the geotech stage must ask the engineer about before it subdivides them: a unit is *admixture-ambiguous* when the NAD packing table could classify it either as a pure soil or as a with-admixture soil, so the answer is a genuine fork that only the engineer can settle.

**Why it is here.** The comment records the owner's ruling (2026-09-04) that the admixture prompt appears on subdivide, and states the discipline this file follows: the code sets below are ported verbatim from the backend classifier constants and must stay in sync (a test pins the resulting pairs), while the NAD class thresholds themselves are never copied here — only which admixture forks which soil. This is the desktop mirror of the backend detection, keeping classification (a characterisation output under the MVP scope) and its presentation aligned.

.. CG-EXPLANATION-END id=module-header

``const SAND_ADMIXTURE_CODES``
------------------------------

.. CG-BLOCK id=const:SAND_ADMIXTURE_CODES lines=29-35

.. literalinclude:: ../../../desktop/src/renderer/src/utils/admixtureNadChoice.ts
   :language: typescript
   :lines: 29-35
   :lineno-match:

.. CG-EXPLANATION-START id=const:SAND_ADMIXTURE_CODES

**What this does.** A fixed set of the sand-admixture codes (``XZ``, ``ZN``, ``Z``, ``FZ``, ``MZ``, ``GZ``) whose presence makes a fine soil (silt or clay) count as sand-bearing.

**Why it is here.** The comment records that these are ported from the backend's ``_SAND_ADMIXTURE_CODES`` list so the two sides agree on which admixtures matter. The raw Dutch/GEF tokens are kept as-is, in line with the translate-at-the-presentation-boundary rule; translation to display text happens elsewhere.

.. CG-EXPLANATION-END id=const:SAND_ADMIXTURE_CODES

``const SILT_CLAY_ADMIXTURE_CODES``
-----------------------------------

.. CG-BLOCK id=const:SILT_CLAY_ADMIXTURE_CODES lines=36-43

.. literalinclude:: ../../../desktop/src/renderer/src/utils/admixtureNadChoice.ts
   :language: typescript
   :lines: 36-43
   :lineno-match:

.. CG-EXPLANATION-START id=const:SILT_CLAY_ADMIXTURE_CODES

**What this does.** A fixed set of the silt/clay-admixture codes (``SI``, ``KL``, ``LE``, ``SL``) whose presence makes a coarse soil (sand or gravel) count as silt- or clay-bearing.

**Why it is here.** The comment records that this is ported from the backend's ``_SILT_CLAY_ADMIXTURE_CODES`` and notes two owner decisions folded in: ``SL`` (slib) counts as silt, and ``LE`` (leem) is silt for geotech purposes.

.. CG-EXPLANATION-END id=const:SILT_CLAY_ADMIXTURE_CODES

``const SECONDARY_ADMIXTURE_CODES``
-----------------------------------

.. CG-BLOCK id=const:SECONDARY_ADMIXTURE_CODES lines=44-61

.. literalinclude:: ../../../desktop/src/renderer/src/utils/admixtureNadChoice.ts
   :language: typescript
   :lines: 44-61
   :lineno-match:

.. CG-EXPLANATION-START id=const:SECONDARY_ADMIXTURE_CODES

**What this does.** A lookup that maps each main soil token to the admixture set that forks it into the with-admixture NAD column: gravel and sand fork on silt/clay admixtures, silt and clay fork on sand admixtures.

**Why it is here.** The comment records that this is ported from the backend's ``_SECONDARY_ADMIXTURE_CODES`` and, importantly, that peat (VEEN) is deliberately left out because its with-admixture NAD column is identical to its clean one — there is no fork, so it is never prompted.

.. CG-EXPLANATION-END id=const:SECONDARY_ADMIXTURE_CODES

``function unitAdmixtureIsAmbiguous``
-------------------------------------

.. CG-BLOCK id=function:unitAdmixtureIsAmbiguous lines=62-82

.. literalinclude:: ../../../desktop/src/renderer/src/utils/admixtureNadChoice.ts
   :language: typescript
   :lines: 62-82
   :lineno-match:

.. CG-EXPLANATION-START id=function:unitAdmixtureIsAmbiguous

**What this does.** Answers, for one unit, whether the pure-versus-with-admixture NAD choice is a real fork: it simply asks whether the unit has any forking admixtures (the helper below) and reports true when at least one exists.

**Why it is here.** The docstring records the exact condition — the soil must have a distinct with-admixture NAD column and the unit must carry an admixture in that soil's forking set — so the prompt only ever asks about units where the answer actually changes the classification.

.. CG-EXPLANATION-END id=function:unitAdmixtureIsAmbiguous

``function forkingAdmixtures``
------------------------------

.. CG-BLOCK id=function:forkingAdmixtures lines=83-93

.. literalinclude:: ../../../desktop/src/renderer/src/utils/admixtureNadChoice.ts
   :language: typescript
   :lines: 83-93
   :lineno-match:

.. CG-EXPLANATION-START id=function:forkingAdmixtures

**What this does.** Returns the subset of a unit's admixtures that actually fork it: it looks up the soil's forking set, then keeps only the unit's admixtures whose code is in that set, in their original order. A null soil, an unknown soil, or a soil with no fork column (peat) yields an empty list.

**Why it is here.** The docstring records the owner's 2026-09-05 ruling that the prompt must name which admixture is at issue, so the prompt needs this exact list; and it explains that a non-forking admixture (for example gravel on sand) is dropped because it does not change the class, so the unit classifies as the plain soil.

.. CG-EXPLANATION-END id=function:forkingAdmixtures

``interface AdmixtureUnit``
---------------------------

.. CG-BLOCK id=interface:AdmixtureUnit lines=94-119

.. literalinclude:: ../../../desktop/src/renderer/src/utils/admixtureNadChoice.ts
   :language: typescript
   :lines: 94-119
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AdmixtureUnit

**What this does.** Describes one admixture-ambiguous unit as the dialog needs it: the litho formation id (the update target), the display name, the main soil token, the admixtures that forked it, and the engineer's stored answer (or null when unanswered).

**Why it is here.** The field comments record that the soil token is kept raw for the dialog to translate, that the matched admixtures are named in the prompt (owner 2026-09-05) and are never empty for a listed unit, and that the choice is null until the engineer answers — the shape carries everything the prompt shows and nothing it does not.

.. CG-EXPLANATION-END id=interface:AdmixtureUnit

``function ambiguousAdmixtureUnits``
------------------------------------

.. CG-BLOCK id=function:ambiguousAdmixtureUnits lines=120-149

.. literalinclude:: ../../../desktop/src/renderer/src/utils/admixtureNadChoice.ts
   :language: typescript
   :lines: 120-149
   :lineno-match:

.. CG-EXPLANATION-START id=function:ambiguousAdmixtureUnits

**What this does.** Builds the list of admixture-ambiguous units within the subdivide scope: it keeps the project formations whose id is in scope, that have a main soil, and that are ambiguous; turns each into the dialog shape above (attaching its forking admixtures and stored choice); and sorts them by name.

**Why it is here.** The docstring records that the scope is exactly the formation ids the subdivide will classify, so the list matches precisely the units the classifier will see; sorting by name gives the dialog a stable, predictable order.

.. CG-EXPLANATION-END id=function:ambiguousAdmixtureUnits

``function hasUnansweredAdmixtureUnits``
----------------------------------------

.. CG-BLOCK id=function:hasUnansweredAdmixtureUnits lines=150-152

.. literalinclude:: ../../../desktop/src/renderer/src/utils/admixtureNadChoice.ts
   :language: typescript
   :lines: 150-152
   :lineno-match:

.. CG-EXPLANATION-START id=function:hasUnansweredAdmixtureUnits

**What this does.** Reports whether any unit in the list still has no stored answer.

**Why it is here.** The docstring records that this is the gate for auto-opening the prompt: the build press only asks when there is something left to decide, so a fully-answered model builds straight through without interruption.

.. CG-EXPLANATION-END id=function:hasUnansweredAdmixtureUnits

