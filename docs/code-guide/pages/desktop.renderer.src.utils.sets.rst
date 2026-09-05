desktop.renderer.src.utils.sets
===============================

.. CG-PAGE source=desktop/src/renderer/src/utils/sets.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sets.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sets.ts
   :language: typescript
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Two small helpers for working with a *Set* of text ids — a Set is a collection that holds each value at most once — where that Set lives in React state and is mirrored into localStorage. It imports the TypeScript types that describe a React state-updating function.

**Why it is here.** The comment records that these were pulled out of repeated inline copies under the app's ``extract on the second copy`` rule (CLAUDE.md): the add-all shape appeared five or more times across the import handlers and the discard-rollback path, so it earned one shared home.

.. CG-EXPLANATION-END id=module-header

``function addAllToSet``
------------------------

.. CG-BLOCK id=function:addAllToSet lines=12-33

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sets.ts
   :language: typescript
   :lines: 12-33
   :lineno-match:

.. CG-EXPLANATION-START id=function:addAllToSet

**What this does.** Adds a batch of ids to a Set held in React state without changing the original Set. It walks the ids, and the first time it meets one that is genuinely new it makes a copy, adds the new ids to the copy, and returns the copy. If nothing was new it returns the original Set unchanged.

**Why it is here.** The comment records why the no-op path returns the original object: React decides whether to redraw by checking whether the value is a new object, so handing back the same Set when nothing changed lets React skip a pointless redraw, and never mutating the existing Set is what makes a real change show up as a new object.

.. CG-EXPLANATION-END id=function:addAllToSet

``function removeAllFromSet``
-----------------------------

.. CG-BLOCK id=function:removeAllFromSet lines=34-48

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sets.ts
   :language: typescript
   :lines: 34-48
   :lineno-match:

.. CG-EXPLANATION-START id=function:removeAllFromSet

**What this does.** The mirror of ``addAllToSet`` — removes a batch of ids from the Set, again copying only when at least one id was actually present, and returning the original Set unchanged when none were.

**Why it is here.** The comment records its caller: the bridge that clears a created-but-unsaved formation or contact's unsaved-changes signal when it is deleted — the inverse of the add-on-create path — and it skips the no-op redraw the same way its partner does.

.. CG-EXPLANATION-END id=function:removeAllFromSet

