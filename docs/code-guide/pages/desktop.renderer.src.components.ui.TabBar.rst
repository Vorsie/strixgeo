desktop.renderer.src.components.ui.TabBar
=========================================

.. CG-PAGE source=desktop/src/renderer/src/components/ui/TabBar.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/ui/TabBar.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/TabBar.tsx
   :language: tsx
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment and its one import. The comment says this is the shared tab-bar with proper accessibility and keyboard support, names the two screens that use it, and records the keyboard scheme: Left and Right arrows move between tabs, Home and End jump to the first and last. It imports two React hooks, ``useCallback`` and ``useRef``.

**Why it is here.** This is the app's single tab-strip *component*, so tab appearance and keyboard behaviour are decided once and reused, following the shared-primitive pattern introduced on the ``desktop.renderer.src.components.ui.Button`` page. The arrow/Home/End scheme is not invented here — the comment cites the published ARIA Authoring Practices Guide "Tabs" pattern, the recognised standard for how tab strips should respond to the keyboard.

.. CG-EXPLANATION-END id=module-header

``interface TabSpec``
---------------------

.. CG-BLOCK id=interface:TabSpec lines=16-26

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/TabBar.tsx
   :language: tsx
   :lines: 16-26
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TabSpec

**What this does.** Describes one tab: a required ``id`` and ``label``, and optional extras — an ``icon`` to show, a ``hint`` shown on hover, and a test id.

**Why it is here.** Bundling each tab's data into one named shape lets a caller pass the whole strip as a simple list, and the component draws every tab the same way. The optional fields cover the cases some screens need (an icon, a hover hint) without forcing every caller to supply them.

.. CG-EXPLANATION-END id=interface:TabSpec

``interface TabBarProps``
-------------------------

.. CG-BLOCK id=interface:TabBarProps lines=27-96

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/TabBar.tsx
   :language: tsx
   :lines: 27-96
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TabBarProps

**What this does.** Lists the component's inputs: the ordered ``tabs`` list, the ``activeId`` marking which tab is current, an ``onActivate`` handler fired when a tab is chosen, an accessibility label for the strip, a ``layout`` choice (icon beside or above the label), and two optional class-name overrides for the container and for each button.

**Why it is here.** Keeping the active tab (``activeId``) and the choice handler (``onActivate``) as inputs means the calling screen owns which tab is selected and what happens when it changes, while this component owns only the drawing and the keyboard handling. The two class-name overrides let a caller adjust spacing or size for its context without copying the component, and the layout switch covers both a wide toolbar strip and a narrow inspector strip.

.. CG-EXPLANATION-END id=interface:TabBarProps

``function TabBar``
-------------------

.. CG-BLOCK id=function:TabBar lines=97-176

.. literalinclude:: ../../../desktop/src/renderer/src/components/ui/TabBar.tsx
   :language: tsx
   :lines: 97-176
   :lineno-match:

.. CG-EXPLANATION-START id=function:TabBar

**What this does.** The tab-bar component. It keeps a *ref* to the strip element and a cached keyboard handler (via ``useCallback``) that, on an arrow, Home or End key, computes the next tab, activates it, and moves keyboard focus to its button. It then draws the strip as an accessible tab list and, for each tab, a button carrying the selected state, the icon and label, a hover hint, and the focus outline; only the active tab is reachable by a plain Tab press, the rest by the arrow keys.

**Why it is here.** ``useCallback`` (which caches a function so it is not rebuilt on every redraw) keeps the keyboard handler stable between redraws. Making only the active tab plain-Tab-reachable and the others arrow-reachable is exactly the published ARIA "Tabs" behaviour cited in the header, so keyboard users move through a tab strip the way every accessible app trains them to. Each tab is wired to its panel id for screen readers, though the caller supplies the panel itself.

.. CG-EXPLANATION-END id=function:TabBar

