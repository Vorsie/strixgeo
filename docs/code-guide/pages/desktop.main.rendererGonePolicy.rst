desktop.main.rendererGonePolicy
===============================

.. CG-PAGE source=desktop/src/main/rendererGonePolicy.ts complete=true

*Source file:* ``desktop/src/main/rendererGonePolicy.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/main/rendererGonePolicy.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is the file's opening note (a *docstring*). It decides whether to reload the window after the *renderer* — the sandboxed web page the user actually sees — dies. It explains that a renderer crash used to leave a blank white window with no way back in a packaged build (the View, Reload menu and the Ctrl+R shortcut are absent there), and that reloading once recreates the renderer so the crash-recovery offer on the fresh page can take over. Two guards stop that from becoming an endless loop: a deliberate teardown is left alone, and the reload happens only once. The block also carries the note that leads into the next value.

**Why it is here.** A renderer crash on a shipped build was a dead end for the user, with no built-in way to recover. Reloading rescues it — but only if it does not fight a shutdown that is meant to be happening and does not spin on a crash that recurs immediately. The module is kept pure and Electron-free so the caller owns the actual reload and the guard flag, while this file holds only the yes/no decision, which can then be tested on its own.

.. CG-EXPLANATION-END id=module-header

``const DELIBERATE_EXIT_REASONS``
---------------------------------

.. CG-BLOCK id=const:DELIBERATE_EXIT_REASONS lines=26-44

.. literalinclude:: ../../../desktop/src/main/rendererGonePolicy.ts
   :language: typescript
   :lines: 26-44
   :lineno-match:

.. CG-EXPLANATION-START id=const:DELIBERATE_EXIT_REASONS

**What this does.** The set of Electron's ``render-process-gone`` reason strings that mean the renderer went away on purpose: ``killed`` (reported while the app is quitting, or when a test harness kills the renderer) and ``clean-exit`` (a normal shutdown). The block also carries the note that leads into the next function.

**Why it is here.** Reloading after a deliberate teardown would fight a shutdown that is supposed to be happening, so these two reasons are singled out to be left alone rather than treated as crashes to recover from.

.. CG-EXPLANATION-END id=const:DELIBERATE_EXIT_REASONS

``function shouldReloadRendererAfterGone``
------------------------------------------

.. CG-BLOCK id=function:shouldReloadRendererAfterGone lines=45-48

.. literalinclude:: ../../../desktop/src/main/rendererGonePolicy.ts
   :language: typescript
   :lines: 45-48
   :lineno-match:

.. CG-EXPLANATION-START id=function:shouldReloadRendererAfterGone

**What this does.** Returns true only when the renderer died from a genuine fault that has not already triggered a reload: it returns false if the window was already reloaded, and false for any deliberate-exit reason.

**Why it is here.** This is the whole decision the two guards enforce — reload a real crash once so recovery can take over, but never reload a deliberate teardown and never reload twice, so a crash that recurs before recovery cannot spin the window in a loop.

.. CG-EXPLANATION-END id=function:shouldReloadRendererAfterGone

