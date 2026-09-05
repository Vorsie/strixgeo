desktop.renderer.src.shell.stages.data.DataCanvas
=================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/data/DataCanvas.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/data/DataCanvas.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-40

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataCanvas.tsx
   :language: tsx
   :lines: 1-40
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and pulls in its tools. ``DataCanvas`` is a React *component* — a function that returns a description of a piece of screen, which React draws and redraws. This is the Data stage's central *canvas*: the big main screen in the middle of the window. The imports bring in React's ``useMemo`` and ``useCallback`` *hooks* (functions whose names start with ``use…`` that let a component use a React feature), two icons, the shared shell bus ``useShell``, a loading placeholder, the three sub-view components — the map (``MapView``), the CPT chart (``CptChart``) and the borehole log (``BoreholeLog``) — the DOV import progress panel, a helper that builds the faded depth-context contact lines, and the translation helper. Its docstring states that the canvas draws one of three sub-views depending on what is selected: the map by default, the CPT chart for a selected CPT, or the borehole log for a selected borehole.

**Why it is here.** The app is a left spine of stages (Data, Stratigraphy, Lithology, Geotechnical, Sections, Parameters, Export); each stage supplies a *canvas* (the main screen), a toolbar (the verb row on top) and an optional inspector (the right-hand panel). This file is the Data stage's canvas. It takes no *props* (the inputs a parent hands a component) — it reads everything it needs from the shared *context* bus ``useShell()`` instead (``context`` shares the active project, model and section across all stages), which matches the shell's rule that a canvas component is called with no inputs. The header comment records the boundary with the Sections screen: when a section is selected, this canvas deliberately does nothing special, because a different component (``SectionsCanvas``) owns that branch.

.. CG-EXPLANATION-END id=module-header

``function DataCanvas``
-----------------------

.. CG-BLOCK id=function:DataCanvas lines=41-333

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataCanvas.tsx
   :language: tsx
   :lines: 41-333
   :lineno-match:

.. CG-EXPLANATION-START id=function:DataCanvas

**What this does.** The Data stage's main screen. It unpacks a large bundle of values from the shared shell — the visible CPTs and boreholes, the current selection, the map-or-chart view mode, the map filters and overlays, the section list, and the geology and litho contacts. It computes, with ``useMemo`` (which caches a value so it is not rebuilt on every redraw unless its inputs change), the faded depth-context overlay lines for the selected investigation. Then it draws, top to bottom: a small map/chart tab switcher shown only when something is selected and no section is active; the main area, which is the map when the view is ``map`` or nothing is selected, the borehole log for a selected borehole, the CPT chart for a selected CPT whose plot data has loaded, or a loading placeholder otherwise; and a non-blocking DOV-import status panel pinned to the bottom-centre while an import runs.

**Why it is here.** This is the Data stage canvas — where the engineer sees the map of every test and drills into one test's chart. The inline comments record the load-bearing choices. It feeds the map ``visibleSections`` (the saved-or-drawn set), not the raw database rows, so the map overlay mirrors the right-hand list exactly — feeding raw sections once left unsaved sections stuck on the map after a project close. It projects the project's own coordinate system so a Dutch (28992) project's markers land in the Netherlands rather than being read as Belgian Lambert-72. A click on a section line opens that section (owner 2026-09-04) by selecting it and asking the shell to switch to the Sections stage. The DOV status panel is deliberately NOT a modal dialog — no backdrop, no focus steal — so the engineer can keep panning the map and inspecting other tests while the import streams in the background; and its close button appears only once the import has finished, so a stray click cannot cancel a running import.

.. CG-EXPLANATION-END id=function:DataCanvas

``function ViewTab``
--------------------

.. CG-BLOCK id=function:ViewTab lines=334-363

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/data/DataCanvas.tsx
   :language: tsx
   :lines: 334-363
   :lineno-match:

.. CG-EXPLANATION-START id=function:ViewTab

**What this does.** A small helper component that draws one tab button — an icon plus a label — highlighted when it is the active view, and calling its ``onClick`` when pressed. It is used for the map and chart tabs.

**Why it is here.** The active tab is marked with an accent-coloured border rather than a merely subtle one, so the selected state clears the WCAG 2.2 minimum contrast (3:1) in dark mode — where the surface-on-surface difference alone (about 1.4:1) is too faint to read as a state.

.. CG-EXPLANATION-END id=function:ViewTab

