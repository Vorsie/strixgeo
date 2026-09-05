desktop.renderer.src.utils.partitionFillV2.tileCoherentStackTypes
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/partitionFillV2/tileCoherentStackTypes.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/partitionFillV2/tileCoherentStackTypes.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tileCoherentStackTypes.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A type-only module: it holds two shared geometry shapes for the ruling-8h coherent sweep and its extracted converging-stack tiler. It imports the column and effective-correlation types and the interval-unit type.

**Why it is here.** The docstring records it was extracted so the converging-stack tiler can take the facing geometry without a circular value-import with the module that owns the sweep. Pure module.

.. CG-EXPLANATION-END id=module-header

``interface CorrUnit``
----------------------

.. CG-BLOCK id=interface:CorrUnit lines=22-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tileCoherentStackTypes.ts
   :language: typescript
   :lines: 22-34
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CorrUnit

**What this does.** The shape pairing one matrix unit with its per-gap effective correlation and its index on the owning column.

**Why it is here.** The live lone-stack path keys unit geometry to its effective correlation through this shape; it was moved here from a since-deleted module (audit item 7, session 36).

.. CG-EXPLANATION-END id=interface:CorrUnit

``interface ConvergingSide``
----------------------------

.. CG-BLOCK id=interface:ConvergingSide lines=35-48

.. literalinclude:: ../../../desktop/src/renderer/src/utils/partitionFillV2/tileCoherentStackTypes.ts
   :language: typescript
   :lines: 35-48
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ConvergingSide

**What this does.** The narrow shape the converging-stack tiler needs from one side's geometry: the present column and its x, the facing (converging) column and its x, and the interval's top and base elevation on the facing column (which define the convergence point).

**Why it is here.** It is kept deliberately narrow so the extracted tiler does not depend on the full sweep-internal side geometry.

.. CG-EXPLANATION-END id=interface:ConvergingSide

