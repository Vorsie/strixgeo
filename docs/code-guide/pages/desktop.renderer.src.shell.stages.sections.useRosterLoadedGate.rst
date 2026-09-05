desktop.renderer.src.shell.stages.sections.useRosterLoadedGate
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useRosterLoadedGate.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useRosterLoadedGate.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useRosterLoadedGate.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the small hook that decides whether the body context-menu may arm. A body recompute rewrites every layer's body-id stamp, so the body roster in hand goes stale the instant the recompute counter bumps; the menu must arm only while the roster is current for the active model.

**Why it is here.** Owner ruling 2026-08-31 ('fix it now', #279). Before the roster is current the statistics menu is the deliberate answer, not a race. The gate stamps the counter the roster was loaded at, so it can drop synchronously during the render where the counter bumps — the menu is not armed for even one frame across the recompute window — and a stale late refetch marks itself with an old counter and cannot falsely re-arm.

.. CG-EXPLANATION-END id=module-header

``interface RosterLoadedGate``
------------------------------

.. CG-BLOCK id=interface:RosterLoadedGate lines=18-41

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useRosterLoadedGate.ts
   :language: typescript
   :lines: 18-41
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RosterLoadedGate

**What this does.** What the hook returns: a ``bodiesLoaded`` flag (true only when the roster is current for the active model at the current counter) and a ``markLoaded`` signal to call after a successful roster fetch.

**Why it is here.** The flag drives the menu gate; ``markLoaded`` is how a fresh fetch re-arms it.

.. CG-EXPLANATION-END id=interface:RosterLoadedGate

``function useRosterLoadedGate``
--------------------------------

.. CG-BLOCK id=function:useRosterLoadedGate lines=42-63

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useRosterLoadedGate.ts
   :language: typescript
   :lines: 42-63
   :lineno-match:

.. CG-EXPLANATION-START id=function:useRosterLoadedGate

**What this does.** Remembers which model and counter the roster was last stamped at, exposes ``markLoaded`` to set that stamp, and derives ``bodiesLoaded`` during render as 'the stamp names the active model AND the live counter'. A roster loaded before the last recompute, or for a model the axis has since left, reads as stale.

**Why it is here.** Computing the flag during render (not in an effect) is what makes a counter bump drop the arming at once, with no one-frame window where the menu is armed on a stale roster.

.. CG-EXPLANATION-END id=function:useRosterLoadedGate

