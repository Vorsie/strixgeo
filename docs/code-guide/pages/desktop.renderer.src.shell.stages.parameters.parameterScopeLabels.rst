desktop.renderer.src.shell.stages.parameters.parameterScopeLabels
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/parameterScopeLabels.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/parameterScopeLabels.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterScopeLabels.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file that owns how a body or class row READS — its display label — as pure text helpers with no dependency on scopes or bands. It imports the geotech auto-label helper and the shared body-label fallback.

**Why it is here.** This file is split off from ``parameterBodyTree.ts`` so that module stays under the 500-line cap the project holds god-components to (debt #201): the tree owns the structure and the band authority, this file owns only how a row reads. Following the translate-at-the-presentation-boundary rule, the raw tokens ride the tooltips at the render sites while these produce the English display forms, built from the single NAD-class vocabulary and the way the 3-D legend names bodies.

.. CG-EXPLANATION-END id=module-header

``function lithoBodyLabel``
---------------------------

.. CG-BLOCK id=function:lithoBodyLabel lines=22-50

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterScopeLabels.ts
   :language: typescript
   :lines: 22-50
   :lineno-match:

.. CG-EXPLANATION-START id=function:lithoBodyLabel

**What this does.** Returns a litho body's label: the engineer's own name if it has one, otherwise "<unit name> · #<ordinal>" (rendered like "SILT · #3"). If the roster does not yet know the body it falls back to a short id prefix so the label is never blank.

**Why it is here.** A body is IDENTITY, not shape, and the 3-D legend numbers bodies by their ordinal within the unit, so the tree reads the same way the legend does. The three-way fall-through — name, then unit-and-ordinal, then id prefix — means a body whose roster row is still loading or stale never renders as an empty label and never falsely claims to be resolved.

.. CG-EXPLANATION-END id=function:lithoBodyLabel

``function geotechBodyLabel``
-----------------------------

.. CG-BLOCK id=function:geotechBodyLabel lines=51-61

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/parameterScopeLabels.ts
   :language: typescript
   :lines: 51-61
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotechBodyLabel

**What this does.** Returns a geotech body's label: its name if it has one, otherwise the unified auto label "<soil> · <packing> #<ordinal>" (rendered like "SILT · SF #0"), with the same id-prefix fallback when the roster does not know it.

**Why it is here.** The docstring records a dogfeed finding from 2026-09-01: the earlier packing-only form "SF #0" read too much like a litho body's "SILT · #0" and confused which was which. The auto form now carries the soil word too, drawn from the one shared vocabulary helper, so every surface that names a geotech body — this scope header, the Parameters rows, the section body menu — reads it identically and never collides with the litho body's label.

.. CG-EXPLANATION-END id=function:geotechBodyLabel

