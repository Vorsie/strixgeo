desktop.renderer.src.i18n.languageSelect
========================================

.. CG-PAGE source=desktop/src/renderer/src/i18n/languageSelect.ts complete=true

*Source file:* ``desktop/src/renderer/src/i18n/languageSelect.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/languageSelect.ts
   :language: typescript
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment explaining the file, the tools it borrows, and the collection that powers it. This is the ONE place the interface language is read and written. It imports React's ``useSyncExternalStore``, the language constants, and the app's logger, and it keeps a ``subscribers`` collection — a list of "tell me when it changes" callbacks. (A callback is simply a function handed in now to be run later when something happens.)

**Why it is here.** The comment records two decisions. First, scope: the language is device-local — it follows the person, not the file — so it lives in localStorage (a small per-computer store) and never in the ``.gmproj`` bundle, which carries engineering decisions rather than per-user chrome. Second, shape: it deliberately uses a module-level subscriber list plus ``useSyncExternalStore`` (React's tool for reading a value that lives outside React and redrawing when it changes) rather than a React context, for the three reasons the comment lists — no provider wiring is needed in ``App``, non-component callers can read the current language directly, and it matches the pattern already used for a device preference that applies at once with no Save step (the theme and engine toggles beside it in Settings).

.. CG-EXPLANATION-END id=module-header

``const subscribers``
---------------------

.. CG-BLOCK id=const:subscribers lines=30-44

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/languageSelect.ts
   :language: typescript
   :lines: 30-44
   :lineno-match:

.. CG-EXPLANATION-START id=const:subscribers

**What this does.** Declares ``subscribers`` — an empty collection that will hold the "notify me" callbacks. (A set is a collection that holds each item just once.) The comment above it introduces it, and the comment block below is the lead-in to the next helper.

**Why it is here.** The docstring says it feeds ``useSyncExternalStore`` so that when the language flips, every mounted piece of interface redraws on the same beat as the toggle rather than lagging behind it.

.. CG-EXPLANATION-END id=const:subscribers

``function asLanguage``
-----------------------

.. CG-BLOCK id=function:asLanguage lines=45-71

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/languageSelect.ts
   :language: typescript
   :lines: 45-71
   :lineno-match:

.. CG-EXPLANATION-START id=function:asLanguage

**What this does.** A guard that takes any value at all and returns it only if it is one of the shipped language codes, otherwise ``null`` (nothing). The two comment blocks below it are the manuals for the two reader functions that follow.

**Why it is here.** Values arriving from storage or from the operating system are untrusted text; narrowing them to a known language here means a hand-edited or since-removed code becomes a clean "nothing" the callers can fall back from, instead of a bad value flowing onward into the interface.

.. CG-EXPLANATION-END id=function:asLanguage

``function systemLanguage``
---------------------------

.. CG-BLOCK id=function:systemLanguage lines=72-78

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/languageSelect.ts
   :language: typescript
   :lines: 72-78
   :lineno-match:

.. CG-EXPLANATION-START id=function:systemLanguage

**What this does.** Reports the language the operating system is set to, but only when it is one the app actually ships. It reads the computer's language tag (like ``nl-BE``), takes just the first part (``nl``), and runs it through the guard; anything unsupported or unknown comes back as ``null``.

**Why it is here.** The docstring cites the owner ruling of 3 September 2026 — "default to the system language, fall back to English" — so a fresh install opens in Dutch on a Dutch machine without the user having to change anything.

.. CG-EXPLANATION-END id=function:systemLanguage

``function getLanguage``
------------------------

.. CG-BLOCK id=function:getLanguage lines=79-101

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/languageSelect.ts
   :language: typescript
   :lines: 79-101
   :lineno-match:

.. CG-EXPLANATION-START id=function:getLanguage

**What this does.** Works out the current language. It prefers the choice saved on this computer; if there is none — or if storage cannot be read at all — it falls back to the system language, and finally to English. The comment block below leads into the setter.

**Why it is here.** The docstring stresses this is best-effort and never fails loudly: a missing key, an unknown value, or an unavailable store (privacy mode, or a context with no browser storage) all resolve to a real language, because a storage hiccup must never be what decides whether the app draws anything.

.. CG-EXPLANATION-END id=function:getLanguage

``function setLanguage``
------------------------

.. CG-BLOCK id=function:setLanguage lines=102-132

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/languageSelect.ts
   :language: typescript
   :lines: 102-132
   :lineno-match:

.. CG-EXPLANATION-START id=function:setLanguage

**What this does.** Changes the interface language. It first checks the new value is one we ship — ignoring and logging anything else — then saves it to this computer's store, and finally runs every subscriber callback so the whole interface redraws in the new language. The comment block below is the note for the subscribe helper.

**Why it is here.** The docstring says this is reversible interface chrome, so it applies immediately with no Save step — the same contract as the theme toggle (docs/ux.md §Reversible vs irreversible actions). The save is wrapped so that a full or blocked store still updates the live session even when it cannot be written to disk, and an unsupported value degrades to "nothing happened" rather than to a blank interface.

.. CG-EXPLANATION-END id=function:setLanguage

``function subscribe``
----------------------

.. CG-BLOCK id=function:subscribe lines=133-148

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/languageSelect.ts
   :language: typescript
   :lines: 133-148
   :lineno-match:

.. CG-EXPLANATION-START id=function:subscribe

**What this does.** Registers one "notify me" callback and hands back a function that removes it again. The comment block below is the manual for the hook. (A hook is a helper whose name starts with ``use…`` that lets a component remember state or react to changes.)

**Why it is here.** The docstring says it is consumed by ``useSyncExternalStore`` and never called directly — it is how React learns to re-run a component when the language flips, and the returned remover is how React tidies up when that component goes away.

.. CG-EXPLANATION-END id=function:subscribe

``function useLanguage``
------------------------

.. CG-BLOCK id=function:useLanguage lines=149-153

.. literalinclude:: ../../../desktop/src/renderer/src/i18n/languageSelect.ts
   :language: typescript
   :lines: 149-153
   :lineno-match:

.. CG-EXPLANATION-START id=function:useLanguage

**What this does.** The hook a component uses to read the current language and be redrawn automatically whenever the Settings toggle changes it. It wires the subscribe helper and the reader together through ``useSyncExternalStore``. (A render is one pass of drawing the interface from the current data.)

**Why it is here.** The comment explains why the same reader is passed twice: the value is derived from localStorage, which is stable within a single render pass, so the ordinary snapshot and the server snapshot need no different reader.

.. CG-EXPLANATION-END id=function:useLanguage

