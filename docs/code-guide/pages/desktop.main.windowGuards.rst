desktop.main.windowGuards
=========================

.. CG-PAGE source=desktop/src/main/windowGuards.ts complete=true

*Source file:* ``desktop/src/main/windowGuards.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/main/windowGuards.ts
   :language: typescript
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The docstring explains this file holds the navigation and window-open guards attached to every window in the app's main process — the part of the desktop app with full computer access, as opposed to the renderer, the sandboxed web page the user sees. Navigation guards block the page from wandering off to arbitrary web addresses, and the window-open guard refuses the page's attempts to pop new windows. The one import pulls the actual yes/no decisions from the neighbouring ``security`` file.

**Why it is here.** The main window always denied page-triggered ``window.open`` (a browser call that asks to open a new window) and pinned navigation to its own page; but the hidden sheet-printing window renders project content and had neither guard. Routing both windows through this one helper means both get identical protection and there is a single place to reason about it. The decision logic lives in ``security`` (already tested); this file is only the wiring, kept free of Electron so a fake window can drive it in tests.

.. CG-EXPLANATION-END id=module-header

``interface NavigationGuardConfig``
-----------------------------------

.. CG-BLOCK id=interface:NavigationGuardConfig lines=21-34

.. literalinclude:: ../../../desktop/src/main/windowGuards.ts
   :language: typescript
   :lines: 21-34
   :lineno-match:

.. CG-EXPLANATION-START id=interface:NavigationGuardConfig

**What this does.** Describes the settings the guards need: ``rendererBase`` (the dev page's web address, or nothing in a shipped build), ``rendererFileBase`` (the shipped page's on-disk location prefix, or nothing in dev), and ``openExternal`` (a function that hands a trusted link to the operating system's real web browser).

**Why it is here.** The guards must know which addresses count as 'our own page' (allowed) versus 'somewhere else' (blocked), and where to send a link the user genuinely meant to follow; passing these in keeps the file from having to reach into Electron for them.

.. CG-EXPLANATION-END id=interface:NavigationGuardConfig

``interface GuardableWebContents``
----------------------------------

.. CG-BLOCK id=interface:GuardableWebContents lines=35-49

.. literalinclude:: ../../../desktop/src/main/windowGuards.ts
   :language: typescript
   :lines: 35-49
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GuardableWebContents

**What this does.** Describes the smallest slice of an Electron window's ``webContents`` (the object that represents the page inside a window) that these guards actually touch — just the two methods for setting a window-open handler and listening for a navigation attempt.

**Why it is here.** Naming only the two methods it needs means a tiny fake object satisfies it in tests, while a real Electron window still fits — so the wiring can be unit-tested without launching Electron.

.. CG-EXPLANATION-END id=interface:GuardableWebContents

``function applyWindowGuards``
------------------------------

.. CG-BLOCK id=function:applyWindowGuards lines=50-68

.. literalinclude:: ../../../desktop/src/main/windowGuards.ts
   :language: typescript
   :lines: 50-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:applyWindowGuards

**What this does.** Attaches the two guards to a window's page. First, a deny-by-default handler for every ``window.open``: if the requested address is a trusted web or email link it is handed to the OS browser, but a new in-app window is never opened. Second, a navigation listener: if the page tries to move to anything other than its own known address the move is cancelled, and if that address looks like a genuine external link it is opened in the OS browser instead.

**Why it is here.** This is a security boundary. Renderer content — including untrusted ``.strix`` project data — must never be able to open a fresh Electron window (which would carry full app powers) or steer the app to an arbitrary local file or website. The rule is strict: keep every window pinned to the app's own page, and let only recognised external links escape, and only out to the safe OS browser.

.. CG-EXPLANATION-END id=function:applyWindowGuards

