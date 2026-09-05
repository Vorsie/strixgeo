desktop.renderer.src.hooks.usePersistedSet
==========================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/usePersistedSet.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/usePersistedSet.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/usePersistedSet.ts
   :language: typescript
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The imports and the file comment. It brings in two TypeScript type labels and ``usePersistedJSON`` from the neighbouring file. The comment explains this file is a thin wrapper that keeps a ``Set<string>`` — a collection of unique text values, such as a set of hidden investigation ids — in *localStorage*.

**Why it is here.** A Set does not survive being turned into text on its own (``JSON.stringify`` renders it as an empty ``{}``), so this wrapper supplies the list-to-Set conversion the generic hook needs. All of the real behaviour — loading on a key change and skipping the first save — lives in ``usePersistedJSON``, the anchor hook explained on the ``desktop.renderer.src.hooks.usePersistedJSON`` page.

.. CG-EXPLANATION-END id=module-header

``const EMPTY_SET``
-------------------

.. CG-BLOCK id=const:EMPTY_SET lines=12-13

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/usePersistedSet.ts
   :language: typescript
   :lines: 12-13
   :lineno-match:

.. CG-EXPLANATION-START id=const:EMPTY_SET

**What this does.** A shared, read-only empty Set used as the starting point.

**Why it is here.** Named once so the empty default has a single source of truth rather than being written out at each use.

.. CG-EXPLANATION-END id=const:EMPTY_SET

``const parseStringSet``
------------------------

.. CG-BLOCK id=const:parseStringSet lines=14-18

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/usePersistedSet.ts
   :language: typescript
   :lines: 14-18
   :lineno-match:

.. CG-EXPLANATION-START id=const:parseStringSet

**What this does.** Turns raw stored data back into a Set of strings: if the stored value is not a list it returns an empty Set, otherwise it keeps only the text entries and drops anything else.

**Why it is here.** This is the ``parse`` step the generic hook calls. Guarding against a non-list or non-text stored value means a corrupt or hand-edited entry can never crash the read — the same defensive-read discipline used throughout the ``usePersistedJSON`` anchor.

.. CG-EXPLANATION-END id=const:parseStringSet

``const serializeStringSet``
----------------------------

.. CG-BLOCK id=const:serializeStringSet lines=19-20

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/usePersistedSet.ts
   :language: typescript
   :lines: 19-20
   :lineno-match:

.. CG-EXPLANATION-START id=const:serializeStringSet

**What this does.** Turns a Set into a plain list just before it is written to storage.

**Why it is here.** The explicit ``serialize`` the module comment says a Set needs, since a Set would otherwise be written as an empty object and lose its contents.

.. CG-EXPLANATION-END id=const:serializeStringSet

``function usePersistedSet``
----------------------------

.. CG-BLOCK id=function:usePersistedSet lines=21-32

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/usePersistedSet.ts
   :language: typescript
   :lines: 21-32
   :lineno-match:

.. CG-EXPLANATION-START id=function:usePersistedSet

**What this does.** The hook. It takes just a storage key and calls ``usePersistedJSON`` with a fresh empty Set as the default plus the two conversion functions above, handing back the Set and its setter.

**Why it is here.** It wraps the anchor hook (``usePersistedJSON``) so a caller that only needs a persisted set of ids writes a single line. The comment notes the default is a *fresh* Set built per call, so two callers never accidentally share and mutate one another's set.

.. CG-EXPLANATION-END id=function:usePersistedSet

