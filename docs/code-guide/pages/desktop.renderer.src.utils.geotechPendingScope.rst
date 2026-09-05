desktop.renderer.src.utils.geotechPendingScope
==============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechPendingScope.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechPendingScope.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPendingScope.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file holds the sentences the geotech toolbar uses to talk about pending packing ties, now that the correlate/accept/divide steps act on the open section rather than the whole model. The comment records the owner ruling (2026-08-15) that made steps 2, 3 and 4 section-scoped, and the decision that the model-wide total does not vanish but moves to the chip's tooltip as context rather than a blocker. It imports the translator type.

**Why it is here.** The reasons are the owner rulings recorded in the comment: he did not want the count to be model-wide when the actions are per-section, but a bare "5 pending here" would hide that the whole model is unfinished, so the model total becomes tooltip context. These are kept as pure functions so the wording is testable without mounting the 2000-line toolbar.

.. CG-EXPLANATION-END id=module-header

``interface PendingTieCounts``
------------------------------

.. CG-BLOCK id=interface:PendingTieCounts lines=22-42

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPendingScope.ts
   :language: typescript
   :lines: 22-42
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PendingTieCounts

**What this does.** Describes the raw counts a summary is built from: the pending-tie total across the whole model, the per-section breakdown (which may be absent), the id of the open section (or nothing), and optional section names so the tooltip can name the other sections carrying pending ties.

**Why it is here.** Each field's comment records a careful distinction, chiefly that an absent breakdown is "unknown" and must never be treated as "no section is pending". The section names were added (owner 2026-09-04) because a chip that says "elsewhere" without saying where reads as a flag with no reason.

.. CG-EXPLANATION-END id=interface:PendingTieCounts

``interface PendingTieScope``
-----------------------------

.. CG-BLOCK id=interface:PendingTieScope lines=43-67

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPendingScope.ts
   :language: typescript
   :lines: 43-67
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PendingTieScope

**What this does.** Describes the three-plus numbers every sentence is phrased from: the model total, the pending count on the open section (or nothing when not knowable), how many sections carry any pending tie (or nothing), and the names of the other sections with pending ties (or nothing).

**Why it is here.** The comments stress that "not knowable" is distinct from zero — every caller must fall back to the model total rather than print a confident zero — so these fields are nullable on purpose.

.. CG-EXPLANATION-END id=interface:PendingTieScope

``function summarisePendingTies``
---------------------------------

.. CG-BLOCK id=function:summarisePendingTies lines=68-90

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPendingScope.ts
   :language: typescript
   :lines: 68-90
   :lineno-match:

.. CG-EXPLANATION-START id=function:summarisePendingTies

**What this does.** Folds the raw tie-status counts into that scope summary. When there is no per-section breakdown it returns the model total with every section field marked not-knowable; otherwise it counts the sections with pending ties, lists the names of the other pending sections (when names were supplied), and reports the open section's own pending count.

**Why it is here.** The docstring records why the unknown case is handled first: claiming "0 sections pending" next to a disabled button would read as "nothing is blocking you", which would be a lie when the breakdown simply has not arrived.

.. CG-EXPLANATION-END id=function:summarisePendingTies

``function sectionsPhrase``
---------------------------

.. CG-BLOCK id=function:sectionsPhrase lines=91-97

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPendingScope.ts
   :language: typescript
   :lines: 91-97
   :lineno-match:

.. CG-EXPLANATION-START id=function:sectionsPhrase

**What this does.** Builds the phrase "1 section" or "3 sections" via the translator, choosing the singular or plural key by the count.

**Why it is here.** A small shared helper so the singular/plural choice is made in one place and reads correctly in the active language.

.. CG-EXPLANATION-END id=function:sectionsPhrase

``function tiesPhrase``
-----------------------

.. CG-BLOCK id=function:tiesPhrase lines=98-108

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPendingScope.ts
   :language: typescript
   :lines: 98-108
   :lineno-match:

.. CG-EXPLANATION-START id=function:tiesPhrase

**What this does.** Builds the phrase "1 packing tie" or "4 packing ties" via the translator, choosing singular or plural by the count.

**Why it is here.** The same shared singular/plural helper for ties, kept next to its sibling.

.. CG-EXPLANATION-END id=function:tiesPhrase

``function pendingChipLabel``
-----------------------------

.. CG-BLOCK id=function:pendingChipLabel lines=109-122

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPendingScope.ts
   :language: typescript
   :lines: 109-122
   :lineno-match:

.. CG-EXPLANATION-START id=function:pendingChipLabel

**What this does.** Produces the amber chip's text: the open section's pending count when that is knowable, otherwise the model total.

**Why it is here.** The chip should speak about the section the engineer is working on, but when no section scope is available it falls back to the model total rather than showing a misleading zero.

.. CG-EXPLANATION-END id=function:pendingChipLabel

``function pendingChipTitle``
-----------------------------

.. CG-BLOCK id=function:pendingChipTitle lines=123-170

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPendingScope.ts
   :language: typescript
   :lines: 123-170
   :lineno-match:

.. CG-EXPLANATION-START id=function:pendingChipTitle

**What this does.** Produces the chip's tooltip sentence, which carries the model total and the neighbours. When the section scope is unknown it states the model total and the accepted count; otherwise it states the open section's pending count, the model total, the accepted count, and a clause naming the other pending sections (or saying there are none elsewhere).

**Why it is here.** This is where the model-wide context lives, per the module decision — the tooltip explains the whole picture without blocking. The other sections are named when the caller supplied names (owner 2026-09-04), with the count phrase as the fallback.

.. CG-EXPLANATION-END id=function:pendingChipTitle

``function dividePendingTag``
-----------------------------

.. CG-BLOCK id=function:dividePendingTag lines=171-183

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPendingScope.ts
   :language: typescript
   :lines: 171-183
   :lineno-match:

.. CG-EXPLANATION-START id=function:dividePendingTag

**What this does.** Produces the short visible tag pill on the disabled "4 · Divide boreholes" item: the open section's pending count when knowable, otherwise the model total.

**Why it is here.** The docstring records that a disabled menu item fires no mouse events in the browser engine, so the gate's reason has to be shown on a pill rather than hidden in a hover. It counts the open section because the press divides this section's boreholes, so this section's proposals are the only evidence it could throw away.

.. CG-EXPLANATION-END id=function:dividePendingTag

``function dividePendingTitle``
-------------------------------

.. CG-BLOCK id=function:dividePendingTitle lines=184-191

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPendingScope.ts
   :language: typescript
   :lines: 184-191
   :lineno-match:

.. CG-EXPLANATION-START id=function:dividePendingTitle

**What this does.** Produces the full sentence explaining what is holding this section's divide shut: the model total when the section scope is unknown, otherwise the open section's pending-tie count.

**Why it is here.** This is the hover title for the disabled item, phrasing the gate's reason in the active language for the section actually being divided.

.. CG-EXPLANATION-END id=function:dividePendingTitle

