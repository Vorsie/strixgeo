desktop.renderer.src.hooks.useTheme
===================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useTheme.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useTheme.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useTheme.ts
   :language: typescript
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The three-hook import and the strategy comment. It lists the three theme choices — system (the default, follow the operating system), light, and dark — and states that this hook owns the ``dark`` styling class on the page's root element.

**Why it is here.** It cites the UX Conventions in CLAUDE.md. The styling toolkit (Tailwind) flips the whole colour palette when the ``dark`` class is present on the ``<html>`` element, so one place owns that class and every component just reacts to it through ``dark:`` style variants rather than touching it itself.

.. CG-EXPLANATION-END id=module-header

``type ThemeChoice``
--------------------

.. CG-BLOCK id=type:ThemeChoice lines=14-14

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useTheme.ts
   :language: typescript
   :lines: 14-14
   :lineno-match:

.. CG-EXPLANATION-START id=type:ThemeChoice

**What this does.** Names the three values a user is allowed to pick: system, light or dark.

**Why it is here.** A *union* type — a fixed list of allowed values, checked before the app runs — so a stray choice is caught as a mistake rather than accepted.

.. CG-EXPLANATION-END id=type:ThemeChoice

``type ResolvedTheme``
----------------------

.. CG-BLOCK id=type:ResolvedTheme lines=15-16

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useTheme.ts
   :language: typescript
   :lines: 15-16
   :lineno-match:

.. CG-EXPLANATION-START id=type:ResolvedTheme

**What this does.** Names the two values a theme can actually resolve to: light or dark.

**Why it is here.** ``system`` is a preference, not a paint colour; it collapses to whichever scheme the operating system reports, so the theme actually in effect is always one of just two values.

.. CG-EXPLANATION-END id=type:ResolvedTheme

``const STORAGE_KEY``
---------------------

.. CG-BLOCK id=const:STORAGE_KEY lines=17-18

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useTheme.ts
   :language: typescript
   :lines: 17-18
   :lineno-match:

.. CG-EXPLANATION-START id=const:STORAGE_KEY

**What this does.** The *localStorage* slot name under which the saved choice is kept: ``groundmodel.theme``.

**Why it is here.** One name shared by the read and the write so they cannot drift onto different slots — the same single-source-of-truth habit used for the shell's stored preferences.

.. CG-EXPLANATION-END id=const:STORAGE_KEY

``function readStoredChoice``
-----------------------------

.. CG-BLOCK id=function:readStoredChoice lines=19-28

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useTheme.ts
   :language: typescript
   :lines: 19-28
   :lineno-match:

.. CG-EXPLANATION-START id=function:readStoredChoice

**What this does.** Reads the saved choice back, accepting only ``light``, ``dark`` or ``system`` and otherwise falling back to ``system``.

**Why it is here.** A guarded read: localStorage can be unavailable (a private window, a full quota) and a stored value could be stale, so any failure or unrecognised value falls through to the system default.

.. CG-EXPLANATION-END id=function:readStoredChoice

``function writeStoredChoice``
------------------------------

.. CG-BLOCK id=function:writeStoredChoice lines=29-37

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useTheme.ts
   :language: typescript
   :lines: 29-37
   :lineno-match:

.. CG-EXPLANATION-START id=function:writeStoredChoice

**What this does.** Saves the choice: for ``system`` it removes the stored entry, for light or dark it stores the word.

**Why it is here.** System is the default, so it is recorded as the absence of an entry rather than as a value; the write is wrapped so a storage failure is ignored and the app keeps working.

.. CG-EXPLANATION-END id=function:writeStoredChoice

``function systemPrefersDark``
------------------------------

.. CG-BLOCK id=function:systemPrefersDark lines=38-41

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useTheme.ts
   :language: typescript
   :lines: 38-41
   :lineno-match:

.. CG-EXPLANATION-START id=function:systemPrefersDark

**What this does.** Asks the browser whether the operating system currently prefers a dark colour scheme, returning true or false.

**Why it is here.** One place that reads the live OS preference, so both the initial value and the change-listener use the same check.

.. CG-EXPLANATION-END id=function:systemPrefersDark

``function applyResolvedTheme``
-------------------------------

.. CG-BLOCK id=function:applyResolvedTheme lines=42-56

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useTheme.ts
   :language: typescript
   :lines: 42-56
   :lineno-match:

.. CG-EXPLANATION-START id=function:applyResolvedTheme

**What this does.** Adds or removes the ``dark`` styling class on the page's root element to match the resolved theme.

**Why it is here.** This is the single owner of that class promised in the module comment — no component ever toggles it directly.

.. CG-EXPLANATION-END id=function:applyResolvedTheme

``function useTheme``
---------------------

.. CG-BLOCK id=function:useTheme lines=57-92

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useTheme.ts
   :language: typescript
   :lines: 57-92
   :lineno-match:

.. CG-EXPLANATION-START id=function:useTheme

**What this does.** The hook. It keeps the current choice and the resolved theme in two pieces of *state*, each seeded from storage on the first draw (the lazy-initialiser pattern from the ``desktop.renderer.src.hooks.usePersistedJSON`` page). An *effect* applies the class on every change and, while in system mode, listens for OS preference changes so a dark/light switch made outside the app flows in live. ``setChoice`` saves the new choice and updates the state.

**Why it is here.** The effect lists ``choice`` in its dependency array (the trigger-list idea introduced on the ``desktop.renderer.src.hooks.usePersistedJSON`` page) so it re-runs whenever the user switches. The live OS listener is added only in system mode and removed again on cleanup, so an explicit light or dark choice is never overridden by the operating system.

.. CG-EXPLANATION-END id=function:useTheme

``function resolveTheme``
-------------------------

.. CG-BLOCK id=function:resolveTheme lines=93-97

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useTheme.ts
   :language: typescript
   :lines: 93-97
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveTheme

**What this does.** Turns a choice into a concrete theme: light and dark are returned unchanged, while system asks the operating system which to use.

**Why it is here.** One pure rule for collapsing ``system`` into a real colour, shared by both the initial state seed and the effect so they can never disagree.

.. CG-EXPLANATION-END id=function:resolveTheme

