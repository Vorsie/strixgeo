desktop.renderer.src.hooks.useOnlineStatus
==========================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useOnlineStatus.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useOnlineStatus.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useOnlineStatus.ts
   :language: typescript
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file comment and the two-hook import. The hook reports the browser's online/offline state and redraws the caller whenever that state flips.

**Why it is here.** It is used by the 3D viewer to show an ``Offline — basemap unavailable`` banner (debt #26) so that a black globe reads as a network problem rather than a broken viewer. The comment notes the honest limit: the browser's online flag only means the network interface is up — a captive portal or a blocked map server can still leave it reading online — and the read is guarded so a future server-rendered shell does not crash on import.

.. CG-EXPLANATION-END id=module-header

``function useOnlineStatus``
----------------------------

.. CG-BLOCK id=function:useOnlineStatus lines=33-52

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useOnlineStatus.ts
   :language: typescript
   :lines: 33-52
   :lineno-match:

.. CG-EXPLANATION-START id=function:useOnlineStatus

**What this does.** The hook. It keeps a true/false online flag in *state*, seeded from the browser's online reading (defaulting to true where there is no browser), and an *effect* that listens for the browser's online and offline events, updating the flag on each, and removes those listeners again on cleanup (the hook building-blocks introduced on the ``desktop.renderer.src.hooks.usePersistedJSON`` page).

**Why it is here.** It defaults to true in non-browser environments — tests and the build step — so no false ``offline`` banner appears there. The empty dependency array means the listeners are attached once for the life of the component and cleaned up when it goes away.

.. CG-EXPLANATION-END id=function:useOnlineStatus

