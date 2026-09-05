desktop.renderer.src.utils.lithoAccept
======================================

.. CG-PAGE source=desktop/src/renderer/src/utils/lithoAccept.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/lithoAccept.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-18

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoAccept.ts
   :language: typescript
   :lines: 1-18
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the imports. This file holds shared builders for the litho-accept flow — turning the segmenter's suggested layers into rows the engine stores. It brings in the accept request and response shapes and the reader for the segmenter preferences.

**Why it is here.** The comment records that four accept handlers (single, accept-all, bulk-one, bulk-all) each hand-rolled the identical accept body and the identical "record the created rows" block — the same logic copied four times. Pulling it into these shared helpers makes the body shape and the preference read single-source, so a new segmenter knob or a change to the unsaved-changes contract is one edit rather than four (CLAUDE.md "extract on the second copy").

.. CG-EXPLANATION-END id=module-header

``interface LithoAcceptTuningParams``
-------------------------------------

.. CG-BLOCK id=interface:LithoAcceptTuningParams lines=19-31

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoAccept.ts
   :language: typescript
   :lines: 19-31
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoAcceptTuningParams

**What this does.** An interface — a declared record shape — for the one segmenter knob every accept call forwards to the engine: ``couple_tolerance_m``.

**Why it is here.** The docstring records that this is the tuning value each accept call passes through; naming the shape once keeps the single-accept body and the batch body in step.

.. CG-EXPLANATION-END id=interface:LithoAcceptTuningParams

``function lithoAcceptTuningParams``
------------------------------------

.. CG-BLOCK id=function:lithoAcceptTuningParams lines=32-50

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoAccept.ts
   :language: typescript
   :lines: 32-50
   :lineno-match:

.. CG-EXPLANATION-START id=function:lithoAcceptTuningParams

**What this does.** Reads the couple-tolerance knob out of a project's saved view-state and returns it under the key the engine's request expects.

**Why it is here.** The docstring records that there is one preferences read per accept site, and its result is spread into both the single-accept body and the batch body — a single source for the tuning value.

.. CG-EXPLANATION-END id=function:lithoAcceptTuningParams

``function buildLithoAcceptBody``
---------------------------------

.. CG-BLOCK id=function:buildLithoAcceptBody lines=51-78

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoAccept.ts
   :language: typescript
   :lines: 51-78
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildLithoAcceptBody

**What this does.** Builds the request body for a single accept call: it picks the ``cpt_id`` or ``borehole_id`` key from the anchor kind, adds the section id (or null), the suggested layers, and the tuning knobs.

**Why it is here.** The docstring records that this is the one place that shapes the accept body, so the four call sites cannot drift apart.

.. CG-EXPLANATION-END id=function:buildLithoAcceptBody

``function recordCreatedRows``
------------------------------

.. CG-BLOCK id=function:recordCreatedRows lines=79-89

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoAccept.ts
   :language: typescript
   :lines: 79-89
   :lineno-match:

.. CG-EXPLANATION-START id=function:recordCreatedRows

**What this does.** Records the formation ids and contact ids that an accept created into the session-imports manifest, adding each kind only when its list is non-empty.

**Why it is here.** The docstring records debt #144: an accept writes to the database at once, but the unsaved-changes flag and the save-into-the-project-file only fire once those created ids are in the manifest; skipping empty lists means a "found only" accept, which created nothing, correctly stays clean.

.. CG-EXPLANATION-END id=function:recordCreatedRows

