desktop.renderer.src.utils.voxelBuildInputsError
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/voxelBuildInputsError.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/voxelBuildInputsError.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-27

.. literalinclude:: ../../../desktop/src/renderer/src/utils/voxelBuildInputsError.ts
   :language: typescript
   :lines: 1-27
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file defines a dedicated error type that is thrown when the 3-D build's inputs did not all load. The comments record the history behind it and document the class below.

**Why it is here.** The comment cites the audit of 2026-08-02 (Class 1): the build path used to quietly swallow a failed per-section correlation fetch (leaving that section with zero edges) or a failed body-boundary fetch (losing every hand-drawn override) and then save the resulting model behind a green "Built N bodies" toast. The distinguishing property of this error is that its message is written for the engineer, and the build handler shows that message word-for-word instead of the generic connection copy. The comment also notes that no ``Object.setPrototypeOf`` line is needed here because the build targets ES2020, so a native class is emitted and ``instanceof`` checks work as expected.

.. CG-EXPLANATION-END id=module-header

``class VoxelBuildInputsError``
-------------------------------

.. CG-BLOCK id=class:VoxelBuildInputsError lines=28-36

.. literalinclude:: ../../../desktop/src/renderer/src/utils/voxelBuildInputsError.ts
   :language: typescript
   :lines: 28-36
   :lineno-match:

.. CG-EXPLANATION-START id=class:VoxelBuildInputsError

**What this does.** The error class itself. A *class* is a named kind of object; this one *extends* (builds on) the built-in ``Error``, and its constructor passes the message up to ``Error`` and then stamps the object's ``name`` so it can be recognised.

**Why it is here.** The docstring records that the message is user-facing and shown as-is, so it must name what failed and what to do about it (retry); giving the class its own name lets the build handler tell this failure apart from a generic connection error and surface the helpful message.

.. CG-EXPLANATION-END id=class:VoxelBuildInputsError

