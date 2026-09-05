desktop.renderer.src.utils.geotechBuildPreflight
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechBuildPreflight.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechBuildPreflight.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBuildPreflight.ts
   :language: typescript
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file works out whether the geotech "Build model" press needs to ask the engineer anything before it runs. The comment explains the situation it guards against (owner ruling 2026-08-26): a test imported after the packing subdivision was done carries accepted litho but no packing bands, yet it still lands in the litho frame the geotech build is framed on — so it splits a gap the geotech fill has no data for, a hole the engineer never asked for and cannot see coming. This module answers, mechanically, whether the model in front of the press is in that state. It imports the same assembly helpers the real builder uses.

**Why it is here.** The reason is recorded in the comment. It computes nothing of its own: both halves of the question are answered by running the same assembly the builder runs, so the check predicts exactly what the builder will do. The builder's "a section needs two columns to fill between" rule is deliberately never restated here as a number, because a copy of a rule is a copy that can drift, and this check exists precisely to mirror the builder. It is pure — no React, no fetching, no screen coordinates — leaving the dialog to turn the verdict into sentences and the shell to turn a click into a stage switch.

.. CG-EXPLANATION-END id=module-header

``const NO_EDGES``
------------------

.. CG-BLOCK id=const:NO_EDGES lines=35-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBuildPreflight.ts
   :language: typescript
   :lines: 35-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:NO_EDGES

**What this does.** An empty map of correlation edges.

**Why it is here.** Deciding which columns a section assembles does not need any correlation edges, so an empty map is passed rather than gathering the real ones.

.. CG-EXPLANATION-END id=const:NO_EDGES

``interface PreflightSection``
------------------------------

.. CG-BLOCK id=interface:PreflightSection lines=38-45

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBuildPreflight.ts
   :language: typescript
   :lines: 38-45
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PreflightSection

**What this does.** Describes a visible cross-section the pre-flight reasons about: the geometry base type plus a required id and a display name.

**Why it is here.** The base geometry type does not require an id, but a finding must name its section out loud, so this variant makes id and name mandatory.

.. CG-EXPLANATION-END id=interface:PreflightSection

``interface PreflightInvestigation``
------------------------------------

.. CG-BLOCK id=interface:PreflightInvestigation lines=46-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBuildPreflight.ts
   :language: typescript
   :lines: 46-51
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PreflightInvestigation

**What this does.** Describes an investigation (a CPT or borehole) the pre-flight can project and name: its location plus a display name.

**Why it is here.** The pre-flight needs to project each investigation onto the sections and, when it finds a problem, name the test to the engineer.

.. CG-EXPLANATION-END id=interface:PreflightInvestigation

``type PreflightLayer``
-----------------------

.. CG-BLOCK id=type:PreflightLayer lines=52-54

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBuildPreflight.ts
   :language: typescript
   :lines: 52-54
   :lineno-match:

.. CG-EXPLANATION-START id=type:PreflightLayer

**What this does.** Names the layer-row shape the build assembly reads, reused here under a local name.

**Why it is here.** The pre-flight feeds litho and geotech layer rows through the same assembly the builder uses, so it reuses that assembly's own row type rather than declaring a new one.

.. CG-EXPLANATION-END id=type:PreflightLayer

``interface GeotechBuildPreflightInputs``
-----------------------------------------

.. CG-BLOCK id=interface:GeotechBuildPreflightInputs lines=55-66

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBuildPreflight.ts
   :language: typescript
   :lines: 55-66
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechBuildPreflightInputs

**What this does.** Describes everything one press needs to know: the cross-sections the build will project onto in display order, every CPT and borehole in the project, the litho model's layer rows (the frame the build stands on), and the geotech model's packing-band rows.

**Why it is here.** All of this is already available on the shell bus at press time, so the pre-flight takes it as a single bundle and does no fetching of its own.

.. CG-EXPLANATION-END id=interface:GeotechBuildPreflightInputs

``interface DroppedSection``
----------------------------

.. CG-BLOCK id=interface:DroppedSection lines=67-74

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBuildPreflight.ts
   :language: typescript
   :lines: 67-74
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DroppedSection

**What this does.** Describes a cross-section the geotech build will produce nothing for: its id and display name.

**Why it is here.** When a section leaves the build entirely, the dialog needs to name it, so both id and readable name are carried.

.. CG-EXPLANATION-END id=interface:DroppedSection

``interface UnbandedTest``
--------------------------

.. CG-BLOCK id=interface:UnbandedTest lines=75-101

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBuildPreflight.ts
   :language: typescript
   :lines: 75-101
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnbandedTest

**What this does.** Describes a test that is in the model but has no packing bands yet: its id and name, the sections where it is a litho-frame column (in display order), the first of those sections (where a one-click visit lands), and the sections that leave the build entirely while this test has no bands.

**Why it is here.** Each field maps to something the engineer is told or taken to. The reveal section is the first in the engineer's own list order because any of them would do — the divide verb is section-scoped either way — so the tie-break is the one he can predict. The dropped sections are those whose litho frame exists but have fewer than two subdivided columns, so there is no gap for the geotech fill to fill.

.. CG-EXPLANATION-END id=interface:UnbandedTest

``interface GeotechBuildPreflight``
-----------------------------------

.. CG-BLOCK id=interface:GeotechBuildPreflight lines=102-126

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBuildPreflight.ts
   :language: typescript
   :lines: 102-126
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechBuildPreflight

**What this does.** The pre-flight verdict: the list of tests that have accepted litho and zero packing bands, in investigation order. An empty list means the press has nothing to ask.

**Why it is here.** An empty list is the state a finished model is in, and the state the Build button must stay silent in — so emptiness is the explicit "all clear" signal, not a missing result.

.. CG-EXPLANATION-END id=interface:GeotechBuildPreflight

``function geotechBuildPreflight``
----------------------------------

.. CG-BLOCK id=function:geotechBuildPreflight lines=127-198

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechBuildPreflight.ts
   :language: typescript
   :lines: 127-198
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotechBuildPreflight

**What this does.** Decides whether the Build press has something to ask. It assembles the litho inputs and the geotech inputs through the builder's own assembly; works out which sections the litho frame keeps and which the geotech assembly keeps (both under the builder's two-column rule); works out which investigations actually carry bands; then, for each investigation with no bands that is nonetheless a litho-frame column on at least one section, records it as an unbanded test — with its sections, its first section, and the sections that would drop out of the build entirely. It returns the list of such tests.

**Why it is here.** Every step reuses the builder's own assembly so the verdict cannot diverge from what the build really does — the whole point of the module. The comments record two careful choices: "has bands" is read unfiltered by the two-column rule, because a band on a test that happens to sit alone on some section is still a band and calling it missing would send the engineer to subdivide twice; and the sections are listed in the engineer's own display order so that the "first section carrying it" promise means what he expects.

.. CG-EXPLANATION-END id=function:geotechBuildPreflight

