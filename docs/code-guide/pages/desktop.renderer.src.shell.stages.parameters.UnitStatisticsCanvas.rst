desktop.renderer.src.shell.stages.parameters.UnitStatisticsCanvas
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/UnitStatisticsCanvas.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/UnitStatisticsCanvas.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-43

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitStatisticsCanvas.tsx
   :language: tsx
   :lines: 1-43
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file that draws one unit's statistics — the main content of the Parameters stage's per-unit tab. The long comment block records the three contracts the canvas obeys, and the import lines pull in the React tools, the API data types, the shared shell context, the helpers that pick a unit's bands and build its header label, and the child panels the canvas stacks (the distribution box plots, the NAD parameter read-out, the identification tests and the fence cutout). React is the library that builds the screen from small functions; a component is one such function that returns a piece of screen.

**Why it is here.** The comment states the design in the owner's own words. R3 (2026-08-27) put the statistics front and centre — 'the statistics should be the main item, switch statistics and list from pane'. R1 fixes what a scope pools: a geotech scope pools one packing unit's accepted CPT bands, a litho scope pools the whole litho unit's bands across every packing class inside it, and the header names which of the two is shown. R6 fixes the population: only CPTs that are members of the project's sections under the canonical rule (inside the corridor and between the endpoints), and only over the app's visible lists, so project-removed and hidden tests are already out. Gathering the imports and contracts at the top keeps the rules visible before the code.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=44-49

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitStatisticsCanvas.tsx
   :language: tsx
   :lines: 44-49
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** Declares the one input the canvas takes: ``scope``, the typed unit the canvas describes, set either by clicking a row in the inspector list or by following a deep link. props are the inputs a parent hands a component, and an interface names the shape of an object.

**Why it is here.** The scope alone drives everything the canvas shows, so it is the only prop. The comment notes the two ways it is set.

.. CG-EXPLANATION-END id=interface:Props

``function scopeUnitExists``
----------------------------

.. CG-BLOCK id=function:scopeUnitExists lines=50-81

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitStatisticsCanvas.tsx
   :language: tsx
   :lines: 50-81
   :lineno-match:

.. CG-EXPLANATION-START id=function:scopeUnitExists

**What this does.** A small helper that answers one yes/no question: does the formation this scope points at still exist? For a litho scope it looks the id up among the litho formations; for a geotech body, group or unit scope among the geotech formations; and for a geotech-class scope it checks the litho parent id instead.

**Why it is here.** A unit can be deleted or rebuilt out from under a still-open canvas — a body recompute or a fresh subdivide replaces the rows. When that happens the canvas must show a quiet 'no longer exists' message rather than pool bands for a unit that is gone. The switch has one branch per scope kind because each kind stores its home id in a different place.

.. CG-EXPLANATION-END id=function:scopeUnitExists

``function UnitStatisticsCanvas``
---------------------------------

.. CG-BLOCK id=function:UnitStatisticsCanvas lines=82-380

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/UnitStatisticsCanvas.tsx
   :language: tsx
   :lines: 82-380
   :lineno-match:

.. CG-EXPLANATION-START id=function:UnitStatisticsCanvas

**What this does.** The whole per-unit canvas. It reads the shared shell context for the project, the plot cache, the visible CPTs and boreholes, the visible sections, the two models' formations and layers, and the coordinator callbacks. It computes the pooling population (canonical section membership over the visible lists), wires the right-click-a-grain-size-curve action that reveals the sample on a cross-section, fetches the litho and geotech body rosters and the manual groups, expands a selected grouped body to its whole group, resolves the scope's accepted bands through the one band authority ``bandsForScope``, reads the single NAD class and its table row, builds the path-header label and the population line, then either shows a 'unit no longer exists' empty state or lays out the header (with a close button), the distribution panels, the NAD parameter block, the identification tests and the fence cutout.

**Why it is here.** This is the single owner of the per-unit view, so every contract meets here. It leans on hooks — functions whose names start with ``use…`` that let a component remember values and cache work: ``useMemo`` caches a computed value so it is not recomputed on every redraw unless its inputs change, and ``useCallback`` caches a function. Each body roster rides its axis's recompute nonce so the labels follow a body recompute, and ``memberIds`` is threaded into both the header and the statistics hook so the 'pooled across N bodies' claim counts the SAME population the numbers are computed from (audit F7). A grouped body pools the whole group because grouping exists to gather similar things for more data (owner 2026-09-02). Everything downstream reads ``bandsForScope`` and never a per-kind branch, so the statistics, the counts, the NAD read and the cutout can never disagree about which bands the scope owns. The NAD block is a read of the backend-computed table values, never a derivation, and it renders nothing for a litho, mixed-class or unclassified scope; the class it shows is a characterisation output within MVP scope, while design-ready values stay Phase 5.

.. CG-EXPLANATION-END id=function:UnitStatisticsCanvas

