desktop.renderer.src.shell.stages.parameters.UnitIdentificationPanels
=====================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/UnitIdentificationPanels.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/UnitIdentificationPanels.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitIdentificationPanels.tsx
   :language: tsx
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file (the identification-test panels for the scoped unit) and describes its plan in the header comment before importing what it needs: React's hooks, the API client and borehole types, the shared axis-scaling helpers, logging, the translation hook, shared state, a shared axis-tick row, a per-sample colour helper, the grain-size panel, and the pure pooling helpers. It draws one scatter plot per lab parameter that has data in the unit: the value across the bottom, elevation in mTAW up the side. A scatter plot marks each measurement as a dot; identification tests are the Dutch "onderkenningsproeven" (OKP) — water content, Atterberg limits, carbonate, and so on.

**Why it is here.** Owner ruling R8 (2026-08-27): "I want a plot with all OKP's in a layer." The header records the rules the file obeys: a parameter with no data draws nothing (the standing no-empty-jars rule); every value axis starts at zero, so a negative lab artefact is excluded and counted rather than clamped; the two Atterberg panels share one value scale so the liquid limit and plastic limit are comparable side by side; and the borehole lab data is fetched in one batch, cached per hole so switching units back and forth does not refetch. Classification values like these are a characterisation output, well within MVP scope.

.. CG-EXPLANATION-END id=module-header

``const PLOT_W``
----------------

.. CG-BLOCK id=const:PLOT_W lines=42-42

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitIdentificationPanels.tsx
   :language: tsx
   :lines: 42-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:PLOT_W

**What this does.** The plot box width in drawing units, 100.

**Why it is here.** The plot is drawn in a fixed 100-wide coordinate space and then stretched to fill the row; keeping the width a named constant lets the drawing maths refer to it in one place.

.. CG-EXPLANATION-END id=const:PLOT_W

``const PLOT_H``
----------------

.. CG-BLOCK id=const:PLOT_H lines=43-43

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitIdentificationPanels.tsx
   :language: tsx
   :lines: 43-43
   :lineno-match:

.. CG-EXPLANATION-START id=const:PLOT_H

**What this does.** The plot box height in drawing units, 48.

**Why it is here.** Same fixed drawing space as the width; a named constant keeps the height in one place for the scatter maths.

.. CG-EXPLANATION-END id=const:PLOT_H

``const GRID``
--------------

.. CG-BLOCK id=const:GRID lines=44-46

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitIdentificationPanels.tsx
   :language: tsx
   :lines: 44-46
   :lineno-match:

.. CG-EXPLANATION-START id=const:GRID

**What this does.** The colour of the gridlines, taken from a theme variable so it follows light and dark mode.

**Why it is here.** Reading the colour from a CSS variable rather than hard-coding it lets the grid adapt to the viewer's theme automatically.

.. CG-EXPLANATION-END id=const:GRID

``const ATTERBERG_KEYS``
------------------------

.. CG-BLOCK id=const:ATTERBERG_KEYS lines=47-48

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitIdentificationPanels.tsx
   :language: tsx
   :lines: 47-48
   :lineno-match:

.. CG-EXPLANATION-START id=const:ATTERBERG_KEYS

**What this does.** The set of two panel keys — liquid limit and plastic limit — that are pinned to share one value scale.

**Why it is here.** Naming exactly these two lets the drawing code force them onto a common axis so the liquid limit and plastic limit read comparably side by side, which is the one case where the default per-panel axis visibly would not fit (ruling IP4).

.. CG-EXPLANATION-END id=const:ATTERBERG_KEYS

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=49-80

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitIdentificationPanels.tsx
   :language: tsx
   :lines: 49-80
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Declares this panel's three inputs: the scoped unit's accepted bands (from the single band authority), the pooling population (the canonical set of investigations that count toward the statistics), and an optional "reveal this sample on a cross-section" callback threaded down to the grain-size panel. An interface names the shape of an object; ``props`` are the inputs a parent hands a component; a callback is a function handed over to be called later.

**Why it is here.** The panel reads the SAME scope bands the statistics do so the lab pool and the number pool can never disagree, and narrows them to the borehole-anchored, member-filtered subset. The reveal callback is optional so that when the caller does not supply it, no right-click menu is offered — the panel never advertises an action nothing can honour. The caller owns resolving the section and showing the honest "on no section" message; this file only forwards the request.

.. CG-EXPLANATION-END id=interface:Props

``function UnitIdentificationPanels``
-------------------------------------

.. CG-BLOCK id=function:UnitIdentificationPanels lines=81-276

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitIdentificationPanels.tsx
   :language: tsx
   :lines: 81-276
   :lineno-match:

.. CG-EXPLANATION-START id=function:UnitIdentificationPanels

**What this does.** The component. It narrows the scope's bands to the borehole-anchored, member-filtered ones; collects the unique borehole ids; and runs an effect that fetches the full borehole trees for any not already cached, in one batch, recording a loading and a retryable error state. From the fetched details it pools two things with the same rule: the per-parameter scatter points (through ``poolIdentificationPanels``) and the grain-size curves (through ``poolUnitPsdCurves``). It offers a fit-to-data toggle, computes one shared maximum across the Atterberg pair, and then renders — an error line with a retry button, a loading line, a quiet "no identification tests" line, or the panels themselves — one ``IdentificationPanelRow`` per parameter, followed by the grain-size overlay panel.

**Why it is here.** The header rules drive it all. The fetch runs only when the unit actually has borehole bands and caches per hole so flipping between units does not refetch (a ref holds the cache so the effect does not loop on its own writes). The fit toggle mirrors the CPT panels' toggle exactly — plain state, no persistence, revert restores the exact default axes (ruling S4). The "no tests" line is gated on BOTH pools (the scatter and the grain-size curves), because a grain-size curve IS an identification test, so a unit with only curves must not claim to have none right above its curves. Errors are shown with a retry rather than swallowed.

.. CG-EXPLANATION-END id=function:UnitIdentificationPanels

``function IdentificationPanelRow``
-----------------------------------

.. CG-BLOCK id=function:IdentificationPanelRow lines=277-489

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitIdentificationPanels.tsx
   :language: tsx
   :lines: 277-489
   :lineno-match:

.. CG-EXPLANATION-START id=function:IdentificationPanelRow

**What this does.** Draws one parameter's scatter panel: value across the bottom, elevation in mTAW up the side. It works out the axis maximum (the panel's own data, rounded up to a tick in fit mode, or a shared Atterberg maximum otherwise), keeps only the points the zero-anchored axis can place and counts the rest as off-axis, spans the elevation axis over just the drawn points, derives labelled ticks on both axes, and renders the gridlines, a border, and one coloured dot per on-axis sample with a tooltip. Each dot is inked by its sample, a header shows the parameter name and the sample count, and off-axis readings are noted below.

**Why it is here.** Elevation runs top-down (higher ground higher on the panel), matching the section convention. Every measured quantity here should be non-negative, so the axis is anchored at zero and a negative lab artefact is excluded and counted rather than clamped onto the zero wall (ruling S2) — and the reported count stays the true sample total. The elevation span covers only what is drawn so an excluded point cannot stretch the axis toward a dot that is not there. Each dot wears its sample's colour so the same sample's grain-size curve below and its dots in every other panel are recognisably the same sample. The raw upstream token rides the label tooltip so a domain expert can check the translation without leaving the screen (the translate-at-the-presentation-boundary rule). Axis titles were added on the owner's "properly label all axes" ask (2026-08-28).

.. CG-EXPLANATION-END id=function:IdentificationPanelRow

