desktop.renderer.src.components.sections.__tests__.bodyTestFixtures
===================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/__tests__/bodyTestFixtures.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/__tests__/bodyTestFixtures.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/__tests__/bodyTestFixtures.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of a small test-support file that exports one factory for building a default body list item used across body-related component tests. It imports the body list-item type.

**Why it is here.** The docstring: the two body tests each used to keep a private copy of the default body shape, so this shares one factory to keep them from drifting apart — the project's extract-on-the-second-copy rule.

.. CG-EXPLANATION-END id=module-header

``function makeBody``
---------------------

.. CG-BLOCK id=function:makeBody lines=24-39

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/__tests__/bodyTestFixtures.ts
   :language: typescript
   :lines: 24-39
   :lineno-match:

.. CG-EXPLANATION-START id=function:makeBody

**What this does.** Builds a fully-typed body list item with sensible default fields (a fixed id, project and model ids, ordinal zero, no name, no boundary), letting a test override any field it cares about.

**Why it is here.** A factory with defaults lets each test state only the fields that matter to it, so the tests stay short and every field the type requires is always present.

.. CG-EXPLANATION-END id=function:makeBody

