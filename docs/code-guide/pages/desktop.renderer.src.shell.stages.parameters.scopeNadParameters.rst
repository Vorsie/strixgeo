desktop.renderer.src.shell.stages.parameters.scopeNadParameters
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/scopeNadParameters.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/scopeNadParameters.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/scopeNadParameters.ts
   :language: typescript
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file docstring: it provides the scoped unit's NAD packing class and that class's characteristic values as two pure reads, and imports the three response types it works with.

**Why it is here.** The "NAD characteristic values" block shows one general value per body (owner ruling 2026-09-05), so it needs the ONE class a body or group resolves to and the published-table row for that class. The docstring is explicit that neither is computed here: the class is folded from the scope's bands, and the values are read off a geotech formation the engine already populated — the same table row the D-Series exporters read — so the table is never duplicated in the desktop.

.. CG-EXPLANATION-END id=module-header

``function scopeNadClass``
--------------------------

.. CG-BLOCK id=function:scopeNadClass lines=35-59

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/scopeNadParameters.ts
   :language: typescript
   :lines: 35-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:scopeNadClass

**What this does.** Takes the scope's accepted geotech bands and a lookup from formation id to NAD class, collects the distinct classes those bands carry, and returns the single shared class — or ``null`` when the bands carry no class at all or span more than one.

**Why it is here.** A block that shows one value per body needs exactly one class to show it for. A litho scope (whose bands carry no NAD class) and a mixed scope (spanning two or more classes) both have no single value to display, so both return ``null``. A group is valid because joining is same-class by rule — one export class — so its members all share one class and it resolves cleanly.

.. CG-EXPLANATION-END id=function:scopeNadClass

``function nadParametersForClass``
----------------------------------

.. CG-BLOCK id=function:nadParametersForClass lines=60-71

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/scopeNadParameters.ts
   :language: typescript
   :lines: 60-71
   :lineno-match:

.. CG-EXPLANATION-START id=function:nadParametersForClass

**What this does.** Given a NAD class and the geotech model's formations, returns the characteristic-value bundle for that class — read off the first geotech formation that carries the class and has the values populated — or ``null`` when the class is null, no formation carries it, or none carries the values.

**Why it is here.** The characteristic values are a pure function of the class (the published table row), so any geotech formation carrying that class serves as the source; the first populated one is enough. Returning ``null`` rather than a guess when nothing carries the values — for instance an older engine response that predates the field — means the block shows nothing instead of a made-up number.

.. CG-EXPLANATION-END id=function:nadParametersForClass

