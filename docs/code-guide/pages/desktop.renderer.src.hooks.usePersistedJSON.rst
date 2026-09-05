desktop.renderer.src.hooks.usePersistedJSON
===========================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/usePersistedJSON.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/usePersistedJSON.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/usePersistedJSON.ts
   :language: typescript
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The single import line and the file's opening comment. The import brings in three React *hooks* and two TypeScript type labels. A *hook* is a helper function whose name starts with ``use…`` that lets a piece of on-screen interface remember values and run side tasks between redraws; the three here are ``useState`` (remembers a value between redraws), ``useEffect`` (runs a side task after a redraw), and ``useRef`` (holds a value that survives redraws without triggering one). ``Dispatch`` and ``SetStateAction`` are just the type names for the ``set this value`` function React hands back. The long comment describes the whole file: a piece of remembered interface state that is also written to *localStorage* — a small store the browser keeps on this one computer that survives a reload — and that is keyed per project. It spells out the two optional inputs (``parse`` and ``serialize``), the ``undefined`` key case, and the ``skip the first save after a key change`` trick.

**Why it is here.** This is the app's one reusable way to keep a screen preference that must outlive a page reload. *localStorage* is the right home because it holds UI chrome only — screen preferences, never a project decision; every engineering decision persists on the server and is saved into the ``.strix`` project bundle (project memory rule). The comment is the file's own documentation of the two subtle points a caller must know: pass ``undefined`` for the key while the project is still loading, so nothing is written to the wrong slot; and the first save straight after a key change is deliberately skipped, which the hook below explains.

.. CG-EXPLANATION-END id=module-header

``function usePersistedJSON``
-----------------------------

.. CG-BLOCK id=function:usePersistedJSON lines=16-56

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/usePersistedJSON.ts
   :language: typescript
   :lines: 16-56
   :lineno-match:

.. CG-EXPLANATION-START id=function:usePersistedJSON

**What this does.** The hook itself. It is *generic* — written ``usePersistedJSON<T>`` — which means it takes a placeholder type ``T`` that the caller fills in, so this one function works for any value shape (a Set of ids, a list, a small settings object). Its inputs are a storage key (or ``undefined`` when the project is not ready yet), a default value, a ``parse`` function that turns raw stored text back into a validated ``T``, and an optional ``serialize`` function for value shapes that cannot turn into text on their own. First it sets up one piece of *state* with ``useState``, seeded by a *lazy initialiser* — the little ``() => loadInitial(...)`` function, which runs only once on the very first draw to read the stored value, instead of re-reading on every redraw. It keeps one *ref*, ``lastKeyRef``, remembering which key was last seen. The first *effect* (via ``useEffect``) runs whenever the key changes: with no key it resets the value to the default; with a key it reloads that key's stored value. The second effect runs whenever the key, the value, or ``serialize`` changes: it writes the current value back into localStorage as *JSON* text, wrapped so that a storage failure is simply ignored. It returns the value together with its setter as a fixed two-item pair.

**Why it is here.** The three hooks sit at the top of the function and in the same order on every draw, because React has one hard *rule of hooks*: the same hooks must be called in the same order on every redraw, so a hook must never sit below an early ``return``. The *lazy initialiser* is used so the read from storage happens once, not on every redraw. The *ref* and the deliberate first-save skip solve a real trap: when the key changes, the load effect *queues* a new value that has not landed yet; if the save effect fired right away it would still see the OLD value and write it under the NEW key, clobbering that key's real stored value — so ``lastKeyRef`` lets the save effect skip exactly one run right after a key change, until the reloaded value has settled. The ``[storageKey]`` and ``[storageKey, value, serialize]`` at the ends of the two effects are their *dependency arrays* — the list of values that, when any changes, makes the effect run again. The first effect carries an ``eslint-disable`` with a ``// reason:`` comment (the CLAUDE.md rule requires every such suppression to say why the linter is wrong): ``defaultValue`` and ``parse`` are left out of that list on purpose, because callers normally pass an inline literal or a module-level function whose identity looks new on every redraw — listing them would make the effect re-run forever. The whole hook exists so any screen preference gets project-scoped, reload-surviving storage in a single line, without every caller re-writing the same guarded read and write.

.. CG-EXPLANATION-END id=function:usePersistedJSON

``function loadInitial``
------------------------

.. CG-BLOCK id=function:loadInitial lines=57-71

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/usePersistedJSON.ts
   :language: typescript
   :lines: 57-71
   :lineno-match:

.. CG-EXPLANATION-START id=function:loadInitial

**What this does.** A small helper that reads one stored value. With no key it returns the default straight away. Otherwise it reads the raw text out of localStorage; if nothing is stored it returns the default; if text is there it turns it from *JSON* back into a value and hands that to ``parse`` to validate. If anything along the way fails, it falls back to the default.

**Why it is here.** This is the one guarded read used by both the lazy initialiser and the key-change effect above, so the ``read, guard against a missing / corrupt / unreachable store, fall back to the default`` logic lives in exactly one place. localStorage can be unreachable (a private-browsing window, a full quota) and a stored value could be stale or hand-edited, so every failure path lands on the safe default rather than crashing the app.

.. CG-EXPLANATION-END id=function:loadInitial

``function identity``
---------------------

.. CG-BLOCK id=function:identity lines=72-74

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/usePersistedJSON.ts
   :language: typescript
   :lines: 72-74
   :lineno-match:

.. CG-EXPLANATION-START id=function:identity

**What this does.** A three-line default for the ``serialize`` input: it returns its argument unchanged.

**Why it is here.** Most value shapes turn into text through ``JSON.stringify`` on their own, so the default ``serialize`` needs to do nothing. A caller only passes a real ``serialize`` when the value shape — a Set, a Map, a custom class — does not survive that round-trip, as the module comment notes.

.. CG-EXPLANATION-END id=function:identity

