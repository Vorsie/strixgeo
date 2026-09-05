desktop.renderer.src.utils.sourceLithoNames
===========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sourceLithoNames.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sourceLithoNames.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sourceLithoNames.ts
   :language: typescript
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file builds a lookup from each litho unit's id to its English display name, so every geotech surface can say which ground a geotech unit subdivides. It imports the formation response type and the litho label formatter, then documents the builder.

**Why it is here.** The comment records why the lookup is needed at all: a geotech formation's stored ``name`` is a raw token ("KLEI (geotech)", "Diest (NAD 7)") and its ``parent_formation_name`` is always empty because the server resolves that from ``parent_formation_id``, which the geotech materialiser never sets. A geotech unit points at its source litho unit through ``source_litho_formation_id`` instead, so its ground's name has to be looked up through that id from the litho roster the shell already holds. It was pulled out of the geotech roster when the Parameters stage needed the same map (CLAUDE.md: extract on the second copy). The comment also warns that getting it wrong is silent, not loud — the affected column just reads "—" and same-soil units become indistinguishable, the exact defect the pane's disambiguation rule exists to prevent.

.. CG-EXPLANATION-END id=module-header

``function buildSourceLithoNameMap``
------------------------------------

.. CG-BLOCK id=function:buildSourceLithoNameMap lines=39-75

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sourceLithoNames.ts
   :language: typescript
   :lines: 39-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildSourceLithoNameMap

**What this does.** Builds the map. For each litho formation it stores the id against a name: the formatted lithology plus admixtures when the unit has a soil code, otherwise the stored raw name as a fallback. It then documents ``sourceLithoNameOf`` below.

**Why it is here.** The docstring records that the name is formatted in English (debt #96 — the roster reads in English, not in the stored Dutch token) with the raw name as a fallback for a unit that carries no soil code. This is the translate-at-the-presentation-boundary rule: the engine keeps the raw tokens, and the desktop turns them into a readable label here, at the point of display.

.. CG-EXPLANATION-END id=function:buildSourceLithoNameMap

``function sourceLithoNameOf``
------------------------------

.. CG-BLOCK id=function:sourceLithoNameOf lines=76-83

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sourceLithoNames.ts
   :language: typescript
   :lines: 76-83
   :lineno-match:

.. CG-EXPLANATION-START id=function:sourceLithoNameOf

**What this does.** Looks up one geotech unit's source litho name from the map, returning nothing (``null``) when the unit has no source id or the map holds no entry for it.

**Why it is here.** The docstring records that both cases mean "nothing to name", which is exactly what the geotech unit label wants for its optional disambiguating parenthetical — no name, no parenthetical.

.. CG-EXPLANATION-END id=function:sourceLithoNameOf

