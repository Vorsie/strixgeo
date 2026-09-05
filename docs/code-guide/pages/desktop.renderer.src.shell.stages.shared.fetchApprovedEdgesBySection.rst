desktop.renderer.src.shell.stages.shared.fetchApprovedEdgesBySection
====================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/shared/fetchApprovedEdgesBySection.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/shared/fetchApprovedEdgesBySection.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-30

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/fetchApprovedEdgesBySection.ts
   :language: typescript
   :lines: 1-30
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and pulls in the one tool it needs — the API client, the desktop-side wrapper that calls the engine over the network. Its job is to load, for every visible section, the approved correlation edges of a model. A correlation edge is the tie the engineer draws between two layers on a cross-section; 'approved' means he has accepted it.

**Why it is here.** The comment records the governing fact: correlation edges are section-scoped — each edge is stored against one section (owner directive 2026-06-08) — so any consumer that wants the model's edges must ask section by section and keep only the approved ones, because the band/onlap/lens classifier reads approved edges only. This exact fetch-and-filter used to be copied four times across the two 3-D screens and was extracted here. The other rule it states is the load-bearing one: when one section's fetch fails it returns no edges for that section but does NOT hide the failure — the failed section ids are handed back and every caller must act on them, because an empty edge list looks identical to 'this section genuinely has no correlations', so a caller that ignores the failure would quietly build a differently-tied model and never know.

.. CG-EXPLANATION-END id=module-header

``interface ApprovedEdgePair``
------------------------------

.. CG-BLOCK id=interface:ApprovedEdgePair lines=31-42

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/fetchApprovedEdgesBySection.ts
   :language: typescript
   :lines: 31-42
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ApprovedEdgePair

**What this does.** Describes one approved correlation edge (an 'interface' names the exact shape of an object). It carries the contact id on each side of the tie (a and b) and, for each, which contact of that layer the tie joins — its top or its base; when that side is left out it means the top.

**Why it is here.** The comment explains that the top-or-base sides are not decoration: a base-to-base bottom tie is what lets the deepest unit of a column band together, and the partition engine deliberately keeps that signal apart from top-keyed ties. This type carried only the a and b ids until mid-2030, and the missing sides silently downgraded every base tie to a top tie on the build path — which cost a clay three gaps of Cross-section 1 in the 3-D model until the sides were added.

.. CG-EXPLANATION-END id=interface:ApprovedEdgePair

``interface ApprovedEdgesFetchResult``
--------------------------------------

.. CG-BLOCK id=interface:ApprovedEdgesFetchResult lines=43-57

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/fetchApprovedEdgesBySection.ts
   :language: typescript
   :lines: 43-57
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ApprovedEdgesFetchResult

**What this does.** Describes what the fetch hands back: the approved edges keyed by section id (with every requested section present in the map), the list of section ids whose fetch failed, and the total number of approved edges across all sections.

**Why it is here.** The failed-section list is carried so every caller can act on a partial load rather than silently trusting it; the total count is carried for the one-line summary the caller logs.

.. CG-EXPLANATION-END id=interface:ApprovedEdgesFetchResult

``const SUSPENDED_REVIEW_REASONS``
----------------------------------

.. CG-BLOCK id=const:SUSPENDED_REVIEW_REASONS lines=58-60

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/fetchApprovedEdgesBySection.ts
   :language: typescript
   :lines: 58-60
   :lineno-match:

.. CG-EXPLANATION-START id=const:SUSPENDED_REVIEW_REASONS

**What this does.** A fixed list of two review-reason labels — 'class_changed' and 'ambiguous_band' — whose approved ties the body resolver refuses to union across. A constant is a named value fixed once and reused.

**Why it is here.** Owner ruling F31 (2026-08-10): a tie flagged for one of these two reasons stops the body union, while a 'band_absorbed' flag keeps unioning. Any geometry built to decide body identity must drop the same two, or the payload would weld together exactly what the flag is meant to keep apart.

.. CG-EXPLANATION-END id=const:SUSPENDED_REVIEW_REASONS

``interface FetchApprovedEdgesOptions``
---------------------------------------

.. CG-BLOCK id=interface:FetchApprovedEdgesOptions lines=61-89

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/fetchApprovedEdgesBySection.ts
   :language: typescript
   :lines: 61-89
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FetchApprovedEdgesOptions

**What this does.** Describes the fetch's one optional setting: 'dropSuspendedReviewEdges', which when true removes approved ties whose review reason is one of the suspended pair above.

**Why it is here.** It defaults to false so the render and build consumers keep today's behaviour — a flagged tie still draws its band on screen. Only the body-identity recompute passes true, so that the ties it unions across match exactly the ties the resolver unions across.

.. CG-EXPLANATION-END id=interface:FetchApprovedEdgesOptions

``function fetchApprovedEdgesBySection``
----------------------------------------

.. CG-BLOCK id=function:fetchApprovedEdgesBySection lines=90-135

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/shared/fetchApprovedEdgesBySection.ts
   :language: typescript
   :lines: 90-135
   :lineno-match:

.. CG-EXPLANATION-START id=function:fetchApprovedEdgesBySection

**What this does.** The fetch itself. It fires one 'list correlations' request per section, all in parallel, and waits for them all. For each section that succeeds it keeps only the user-approved edges (optionally minus the suspended-reason ones) and reshapes each into the a/b-plus-sides form. For each section that fails it records the section id in the failed list and contributes an empty edge list, so the parallel batch still completes. It returns the per-section map, the failed-section ids, and the total edge count. 'In parallel' and 'await' come from promises — a promise is a value that will arrive later, and awaiting one pauses until it does while other work runs.

**Why it is here.** The requests are fanned out in parallel because each section's edges are independent, so there is no reason to wait for them one at a time. A failed request is caught and turned into a recorded failure rather than an exception, so one dead section cannot abort the whole batch and the caller is left to decide what to do — refuse the build, or warn the engineer.

.. CG-EXPLANATION-END id=function:fetchApprovedEdgesBySection

