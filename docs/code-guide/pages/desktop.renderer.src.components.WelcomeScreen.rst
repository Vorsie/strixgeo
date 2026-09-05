desktop.renderer.src.components.WelcomeScreen
=============================================

.. CG-PAGE source=desktop/src/renderer/src/components/WelcomeScreen.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/WelcomeScreen.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-8

.. literalinclude:: ../../../desktop/src/renderer/src/components/WelcomeScreen.tsx
   :language: tsx
   :lines: 1-8
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The imports for the welcome screen: three React hooks (``useCallback``, ``useEffect``, ``useState``), a few icons, the shared ``Button``, a helper that phrases how long ago a recovery file was written, a helper that parses a recovery snapshot, the logger, and the translator.

**Why it is here.** This is the start screen the app shows when no project is open — where the engineer creates a project, opens one, reopens a recent one, or picks up work a crashed session left behind. The recovery helpers are imported because the screen also surfaces those left-behind sessions (design: ``docs/design/autosave-recovery.md``).

.. CG-EXPLANATION-END id=module-header

``interface RecentEntry``
-------------------------

.. CG-BLOCK id=interface:RecentEntry lines=9-23

.. literalinclude:: ../../../desktop/src/renderer/src/components/WelcomeScreen.tsx
   :language: tsx
   :lines: 9-23
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecentEntry

**What this does.** The shape of one recent-projects row: the file path, the project name, and when it was last opened. The comment that follows introduces the separate recovered-work entry and states an important rule — the start screen only ROUTES, it never restores.

**Why it is here.** The recent list is a simple record of files the engineer opened before, so it carries just enough to show a row and reopen the file. The comment records why recovery is different: restoring needs the opened project's live state to reconcile against, so clicking a recovered entry merely opens the project and the restore prompt then appears over it (``docs/design/autosave-recovery.md`` §4).

.. CG-EXPLANATION-END id=interface:RecentEntry

``interface RecoveredEntry``
----------------------------

.. CG-BLOCK id=interface:RecoveredEntry lines=24-43

.. literalinclude:: ../../../desktop/src/renderer/src/components/WelcomeScreen.tsx
   :language: tsx
   :lines: 24-43
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecoveredEntry

**What this does.** The shape of one recovered-work row: the project's id and name, when the recovery file was written, the path of the ``.strix`` the crashed session was editing (or none), and whether the user already chose to open it without restoring.

**Why it is here.** The file path can be missing (per the comment) when the project was never saved to a file or the recovery payload cannot be read — either way there is nothing to click, so the row is shown but disabled. The already-declined flag is kept because a second sighting of a row the user deliberately passed on would otherwise read as "it crashed again" unless the row says which one it is (``docs/design/autosave-recovery.md``).

.. CG-EXPLANATION-END id=interface:RecoveredEntry

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=44-71

.. literalinclude:: ../../../desktop/src/renderer/src/components/WelcomeScreen.tsx
   :language: tsx
   :lines: 44-71
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The screen's inputs: a create-project callback (given a name), an open callback that reports whether the open succeeded, was cancelled, or failed, and a recent-open callback that reports opened, missing, or failed. The failure outcomes can carry a specific reason message.

**Why it is here.** The comments explain the tri-state outcomes: distinguishing a real failure from a plain cancel means the "couldn't open" banner shows only when an open actually failed, not when the engineer closed the file picker. A recent open separates "the file is no longer where it was saved" (moved or renamed) from "the file is there but could not be read" because the two need different banners, and the entry is kept in the list either way so the user can put the file back. The specific decode reason is threaded through so a file damaged mid-save — the memory-corruption case on this machine — reads loud and names the problem instead of blaming the connection.

.. CG-EXPLANATION-END id=interface:Props

``function WelcomeScreen``
--------------------------

.. CG-BLOCK id=function:WelcomeScreen lines=72-378

.. literalinclude:: ../../../desktop/src/renderer/src/components/WelcomeScreen.tsx
   :language: tsx
   :lines: 72-378
   :lineno-match:

.. CG-EXPLANATION-START id=function:WelcomeScreen

**What this does.** The screen component. It remembers the typed name, a busy flag, the recent list, the recovered list, and any open-error message. On first display it loads the recent projects and, separately, reads any recovery files (reading each one's payload to find the project's file path). It defines handlers to create, open, open a recent file, and open a recovered entry — each guarding against double-clicks with the busy flag and setting the right banner on failure. It draws a centred layout: an optional amber error banner, a create/open card on the left, and, only when non-empty, a right column with recovered work above recent projects.

**Why it is here.** The recent list is loaded fire-and-forget because an empty or failed load simply hides the section — the New and Open buttons always work. The recovery read is wrapped in a try/catch rather than a promise-catch (per the comment) because an older preload without the recovery channel throws immediately on the call, and a start screen that cannot start is far worse than a missing banner. The recovered-work card is deliberately quiet — the same muted card as the recent list, no amber alarm — because the engineer has just had a crash and the screen's job is to offer the work back, not to editorialise; the copy says "unsaved work" because the project itself was never at risk (the database outlives the window). The error banner is amber, matching the app's rule that amber, never red, marks a soft state (memory), and a specific decode reason always wins over the generic wording.

.. CG-EXPLANATION-END id=function:WelcomeScreen

