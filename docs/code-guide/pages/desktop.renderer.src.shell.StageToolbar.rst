desktop.renderer.src.shell.StageToolbar
=======================================

.. CG-PAGE source=desktop/src/renderer/src/shell/StageToolbar.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/StageToolbar.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageToolbar.tsx
   :language: tsx
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file draws the thin bar across the top of the screen. The comments lay out its two halves: on the left, the active stage's own verb buttons (import, new section, build model, and so on); on the right, a fixed cluster of controls that show on every stage — the project name with an unsaved marker, a Save button, a light/dark theme toggle, a Close-project button, and a button that shows or hides the right inspector. The imports bring in a handful of icons, the shared bus, the stage registry, the theme hook, the small dirty-marker component, and the translation hook.

**Why it is here.** The comment records why the project name, unsaved marker and close control were moved here: they used to live in an old sidebar header that was removed, and putting them in the top bar means every stage now carries the same global chrome. As elsewhere, only the shell's own frame uses the app's named theme tokens; the existing leaf pieces keep their own styling.

.. CG-EXPLANATION-END id=module-header

``interface StageToolbarProps``
-------------------------------

.. CG-BLOCK id=interface:StageToolbarProps lines=30-59

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageToolbar.tsx
   :language: tsx
   :lines: 30-59
   :lineno-match:

.. CG-EXPLANATION-START id=interface:StageToolbarProps

**What this does.** Describes the three inputs the bar needs: the ``activeStageId`` (so it can fetch that stage's verb buttons), whether the inspector is currently open, and the function to call to toggle it.

**Why it is here.** The bar's own inputs are kept small — which stage, and the inspector's open state plus its toggle. Everything else it shows on the right (the project, the unsaved flag, the save and close actions) it reads for itself from the shared bus, so the shell above it does not have to pass those down.

.. CG-EXPLANATION-END id=interface:StageToolbarProps

``function StageToolbar``
-------------------------

.. CG-BLOCK id=function:StageToolbar lines=60-208

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageToolbar.tsx
   :language: tsx
   :lines: 60-208
   :lineno-match:

.. CG-EXPLANATION-START id=function:StageToolbar

**What this does.** Draws the bar. It looks up the active stage's toolbar component and reads the project plus its lifecycle actions from the shared bus. On the left it renders that stage's verb component inside a zone allowed to shrink. On the right it draws the fixed cluster: the project name (clicking it opens the project's settings dialog, with the file path shown as a tooltip) followed by an amber unsaved marker when there are unsaved changes; a Save button that turns amber while there is something to save; the theme toggle; a Close-project button; a divider; and the show/hide-inspector button drawn as a small two-column icon.

**Why it is here.** The comments record the layout rules. The left zone is marked to shrink to whatever space the right cluster leaves, and a thin horizontal scrollbar is kept as a last resort so a stage's verbs are never silently clipped — this is the project's "responsive, never clipped" toolbar rule, under which a stage that adopts the responsive row measures its space and folds low-priority verbs into a "⋯ More" menu rather than cutting a label mid-word. The amber marker follows the app's rule that unsaved always shows amber, never red. The Close button only signals intent — the code it calls decides whether to raise a save-or-discard dialog first — which is the app's rule that an irreversible action (closing and possibly losing unsaved work) must pass through a confirmation, not happen on the bare click. The project-name button also carries a stable test id used as a tutorial anchor pointing at where the project's coordinate-system settings live.

.. CG-EXPLANATION-END id=function:StageToolbar

``const THEME_CYCLE``
---------------------

.. CG-BLOCK id=const:THEME_CYCLE lines=209-216

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageToolbar.tsx
   :language: tsx
   :lines: 209-216
   :lineno-match:

.. CG-EXPLANATION-START id=const:THEME_CYCLE

**What this does.** A tiny table naming what the theme toggle should switch to next: from ``system`` it goes to ``light``, from ``light`` to ``dark``, and from ``dark`` back to ``system``.

**Why it is here.** Writing the cycle down as a single table keeps the toggle's behaviour in one obvious place, so the "what comes next" rule cannot drift from the icon the button shows. The three choices matter because the app is theme-aware: "system" follows whatever the computer is set to, while "light" and "dark" are the user's explicit override.

.. CG-EXPLANATION-END id=const:THEME_CYCLE

``const THEME_LABEL_KEYS``
--------------------------

.. CG-BLOCK id=const:THEME_LABEL_KEYS lines=217-222

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageToolbar.tsx
   :language: tsx
   :lines: 217-222
   :lineno-match:

.. CG-EXPLANATION-START id=const:THEME_LABEL_KEYS

**What this does.** A table turning each theme choice into its catalogue key (``shell.themeSystem``, ``shell.themeLight``, ``shell.themeDark``) so the toggle's tooltip can be shown in the active language.

**Why it is here.** Same translate-at-display rule as elsewhere: the words "System", "Light" and "Dark" are not written into the component but looked up per language. The comment notes the ``as const`` marker keeps each value recognised as a real catalogue key, so the translation function accepts it directly.

.. CG-EXPLANATION-END id=const:THEME_LABEL_KEYS

``function ThemeToggle``
------------------------

.. CG-BLOCK id=function:ThemeToggle lines=223-246

.. literalinclude:: ../../../desktop/src/renderer/src/shell/StageToolbar.tsx
   :language: tsx
   :lines: 223-246
   :lineno-match:

.. CG-EXPLANATION-START id=function:ThemeToggle

**What this does.** Draws the single theme button. It reads the current theme choice, works out the next one from the cycle table, and shows the icon that matches the *current* choice — a sun for light, a moon for dark, a laptop for system. Clicking it advances to the next choice; its tooltip says what it is now and what a click will switch to.

**Why it is here.** The comment records the deliberate choice to show the icon of the *current* setting, not the next one, so the user can see at a glance what they last picked. Spelling the next-choice and the label lookups out in the two small tables above keeps this control tiny and its behaviour easy to follow.

.. CG-EXPLANATION-END id=function:ThemeToggle

