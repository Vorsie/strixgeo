desktop.renderer.src.hooks.useUndoStack
=======================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useUndoStack.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useUndoStack.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useUndoStack.ts
   :language: typescript
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file comment and the imports (three React hooks and the shared logger). It describes an undo/redo stack for the geological-model editor built on the *command pattern*: after each successful edit the caller builds a small command object that knows how to reverse and replay itself, and hands it to this hook. Ctrl+Z reverts the most recent command; Ctrl+Y or Ctrl+Shift+Z reapplies the most recently undone one.

**Why it is here.** It cites debt #45 and lists the invariants that shape the whole file: a command is pushed only AFTER its edit succeeds (undoing a never-applied action would confuse redo); a fresh push clears the redo branch (redo only makes sense in a straight line); rapid presses run one at a time on a serial queue; if a revert throws, the local state is now out of step with the server in an unknown way, so the whole history is dropped and an error message shown; and the stack is capped so a long session cannot grow memory without bound.

.. CG-EXPLANATION-END id=module-header

``interface UndoCommand``
-------------------------

.. CG-BLOCK id=interface:UndoCommand lines=38-49

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useUndoStack.ts
   :language: typescript
   :lines: 38-49
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UndoCommand

**What this does.** The shape of one undoable edit: a ``description`` plus two functions, ``revert`` and ``reapply``, each of which does its work over the network and so returns a *Promise* (a stand-in for a result that arrives later).

**Why it is here.** The ``description`` flows into log lines and the future Edit-menu ``Undo X`` / ``Redo X`` labels. ``revert`` must restore BOTH the server state and the caller's on-screen state to what they were before; ``reapply`` replays the action, usually re-capturing the freshly created server ids so the next revert targets the right rows.

.. CG-EXPLANATION-END id=interface:UndoCommand

``interface UseUndoStackOptions``
---------------------------------

.. CG-BLOCK id=interface:UseUndoStackOptions lines=50-59

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useUndoStack.ts
   :language: typescript
   :lines: 50-59
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseUndoStackOptions

**What this does.** The hook's optional settings: a ``capacity`` (how many entries each stack holds, default 100) and an ``onError`` callback.

**Why it is here.** ``onError`` lets the safety-net ``history cleared`` message surface through the same toast UX as every other action; when it is omitted the failure is only logged.

.. CG-EXPLANATION-END id=interface:UseUndoStackOptions

``interface UseUndoStackResult``
--------------------------------

.. CG-BLOCK id=interface:UseUndoStackResult lines=60-80

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useUndoStack.ts
   :language: typescript
   :lines: 60-80
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseUndoStackResult

**What this does.** What the hook hands back: ``push`` (record a command), ``undo``, ``redo`` and ``clear``, plus three flags — ``busy`` (an undo/redo is in flight), ``canUndo`` and ``canRedo``.

**Why it is here.** Naming the return shape documents the whole surface. ``busy`` drives the keyboard handler's re-entry guard and a future disabled state on the Edit menu; ``clear`` is called on project switch or close so undo can never reach across a project boundary.

.. CG-EXPLANATION-END id=interface:UseUndoStackResult

``const DEFAULT_CAPACITY``
--------------------------

.. CG-BLOCK id=const:DEFAULT_CAPACITY lines=81-82

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useUndoStack.ts
   :language: typescript
   :lines: 81-82
   :lineno-match:

.. CG-EXPLANATION-START id=const:DEFAULT_CAPACITY

**What this does.** The default stack cap: 100 entries per direction.

**Why it is here.** Geotechnical sessions are bursty — tens of picks per workflow chunk — so 100 gives ample headroom to walk back without letting memory grow unbounded across a long session.

.. CG-EXPLANATION-END id=const:DEFAULT_CAPACITY

``function useUndoStack``
-------------------------

.. CG-BLOCK id=function:useUndoStack lines=83-225

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useUndoStack.ts
   :language: typescript
   :lines: 83-225
   :lineno-match:

.. CG-EXPLANATION-START id=function:useUndoStack

**What this does.** The hook. It keeps the two stacks both as *refs* (for instant reads) and as *state* (to drive redraws), plus a ``busy`` flag, an ``onError`` ref, a serial-queue Promise, and an in-flight counter. ``push`` appends a command, drops the oldest when over capacity, and clears the redo branch. ``undo`` and ``redo`` each enqueue their work on the serial queue: pop the top command, run its ``revert`` or ``reapply``, and move it to the other stack; on any failure they empty both stacks and fire the error message. ``clear`` empties both stacks.

**Why it is here.** The stacks are refs first and state second because the callbacks need a *synchronous* read for their ``did anything actually happen?`` early return — React's state-update function runs too late in the redraw for that — while the state pair exists only to redraw ``canUndo`` / ``canRedo`` (comment). Rapid Ctrl+Z / Ctrl+Y presses chain onto one Promise so the reverts run strictly one at a time, never in parallel. A thrown revert leaves the on-screen state in an unknown relation to the server, so the safe move is to abandon all pending history rather than risk corrupting more. The error message includes the failed action's ``description`` after a dogfeed (2026-05-31) where an opaque toast hid which undo had actually run.

.. CG-EXPLANATION-END id=function:useUndoStack

