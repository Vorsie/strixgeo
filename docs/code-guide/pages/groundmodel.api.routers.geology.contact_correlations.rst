groundmodel.api.routers.geology.contact_correlations
====================================================

.. CG-PAGE source=src/groundmodel/api/routers/geology/contact_correlations.py complete=true

*Source file:* ``src/groundmodel/api/routers/geology/contact_correlations.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-97

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contact_correlations.py
   :language: python
   :lines: 1-97
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring listing the correlation-edge web addresses this file adds and its idempotency contract, then the imports: the router tools, the scope guard, a shared formation-code helper, the many correlation request/response schemas, the application use cases (correlate, uncorrelate, auto-correlate, accept, confirm review, materialise companions, propagate admixtures), the edge database row, the repository, the crossing/cross-body exceptions, and the logger. It makes a bare router and a logger.

**Why it is here.** A *correlation edge* records that two contacts in different investigations are the same boundary, so the engine can connect them into one body across the section. The docstring notes these endpoints are model-level only — they take no section id and never touch a section's seeded set, so the earlier structural trap (debt #57) cannot recur here. Same split-package mounting under the shared geology prefix (debt #133).

.. CG-EXPLANATION-END id=module-header

Function ``async def create_contact_correlation``
-------------------------------------------------

.. CG-BLOCK id=function:create_contact_correlation lines=98-201

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contact_correlations.py
   :language: python
   :lines: 98-201
   :lineno-match:

.. CG-EXPLANATION-START id=function:create_contact_correlation

**What this does.** The handler for ``POST .../contact-correlations`` — record that two contacts are the same boundary. It scope-guards the model, runs the correlate use case (which stores the pair in a fixed order so it is unique either way), and returns the edge, ``201`` for a new one and ``200`` when it already existed. It maps three refusals to ``422``.

**Why it is here.** Idempotent: a repeated call returns the existing edge with ``200`` rather than erroring. A tie is refused ``422`` when it is a self-loop, when a contact is out of scope, when a geotech packing correlation would cross a litho body boundary, or when it would cross a tie already standing in the same gap (owner ruling 2026-08-17) — the message names columns and depths, not ids, because the desktop shows the server's own words. A tie that stands but the litho frame will not band carries a warning for the desktop to toast (owner 2026-08-21).

.. CG-EXPLANATION-END id=function:create_contact_correlation

Function ``async def delete_contact_correlation``
-------------------------------------------------

.. CG-BLOCK id=function:delete_contact_correlation lines=202-258

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contact_correlations.py
   :language: python
   :lines: 202-258
   :lineno-match:

.. CG-EXPLANATION-START id=function:delete_contact_correlation

**What this does.** The handler for ``DELETE .../contact-correlations`` — remove the edge between two contacts. It scope-guards the model and runs the uncorrelate use case, answering ``204 No Content`` whether or not the edge existed.

**Why it is here.** Idempotent, so a repeated delete is safe. The pair is given in either order because the edge is stored unordered.

.. CG-EXPLANATION-END id=function:delete_contact_correlation

Function ``async def list_contact_correlations``
------------------------------------------------

.. CG-BLOCK id=function:list_contact_correlations lines=259-318

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contact_correlations.py
   :language: python
   :lines: 259-318
   :lineno-match:

.. CG-EXPLANATION-START id=function:list_contact_correlations

**What this does.** The handler for ``GET .../contact-correlations`` — return the model's correlation edges, optionally scoped to one section. It scope-guards the model, filters to the section when asked, and returns the edges oldest first.

**Why it is here.** The section canvas draws point-to-point boundary lines between correlated contacts from this list. An edge belongs to the section it was drawn on, so the section filter matches on the authoring section rather than "any section that shows both endpoints" — this keeps each section rendering only its own ties (owner directive 2026-06-08).

.. CG-EXPLANATION-END id=function:list_contact_correlations

Function ``async def auto_correlate_contact``
---------------------------------------------

.. CG-BLOCK id=function:auto_correlate_contact lines=319-398

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contact_correlations.py
   :language: python
   :lines: 319-398
   :lineno-match:

.. CG-EXPLANATION-START id=function:auto_correlate_contact

**What this does.** The handler for ``POST .../contact-correlations/auto`` — run the automatic correlation algorithm to propose edges. It scope-guards the model, builds tuning parameters only when the caller set a depth window, runs the use case, and returns counts of edges created, skipped, and dropped for crossing, plus any crossing pinch-outs. A non-litho model is ``422``.

**Why it is here.** Proposed edges are unapproved — visible to the desktop but not yet part of lens detection — so the engineer reviews them before they take effect via the accept endpoint. The depth window is the Settings knob (debt #163b); leaving it out uses the algorithm's own default.

.. CG-EXPLANATION-END id=function:auto_correlate_contact

Function ``async def delete_auto_contact_correlations``
-------------------------------------------------------

.. CG-BLOCK id=function:delete_auto_contact_correlations lines=399-463

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contact_correlations.py
   :language: python
   :lines: 399-463
   :lineno-match:

.. CG-EXPLANATION-START id=function:delete_auto_contact_correlations

**What this does.** The handler for ``DELETE .../contact-correlations/auto`` — the "Clear suggestions" action. It scope-guards the model and deletes only the unapproved edges, optionally scoped to one section, returning the count. Idempotent.

**Why it is here.** It deletes only unapproved suggestion edges, leaving the engineer's approved manual ties intact. The optional section scope means re-correlating one section cannot wipe a neighbouring section's suggestions (section-scoped correlations, owner directive 2026-06-08, debt #179).

.. CG-EXPLANATION-END id=function:delete_auto_contact_correlations

Function ``async def accept_contact_correlations``
--------------------------------------------------

.. CG-BLOCK id=function:accept_contact_correlations lines=464-534

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contact_correlations.py
   :language: python
   :lines: 464-534
   :lineno-match:

.. CG-EXPLANATION-START id=function:accept_contact_correlations

**What this does.** The handler for ``POST .../contact-correlations/accept`` — approve the in-scope suggestion edges (a section when given, otherwise the whole model). It logs the scope, scope-guards the model, runs the accept use case, and returns counts of edges accepted and ordinal changes.

**Why it is here.** Approving promotes suggestions so they participate in body resolution, and the use case re-runs the ordinal resolver and lens detector in the same transaction to keep the model consistent. The log names the scope on purpose (owner ruling 2026-08-15): "accepted 40 correlations" means something very different for one section than for fourteen, and the terminal is where the owner checks that during a dogfeed.

.. CG-EXPLANATION-END id=function:accept_contact_correlations

Function ``async def accept_single_contact_correlation``
--------------------------------------------------------

.. CG-BLOCK id=function:accept_single_contact_correlation lines=535-591

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contact_correlations.py
   :language: python
   :lines: 535-591
   :lineno-match:

.. CG-EXPLANATION-START id=function:accept_single_contact_correlation

**What this does.** The handler for ``POST .../contact-correlations/{edge_id}/accept`` — approve one edge by id. It scope-guards the model, runs the accept use case for that edge, and returns the counts.

**Why it is here.** It powers the right-click "Accept correlation" menu on a single edge. Idempotent — re-accepting an already-approved edge returns zero without erroring — and it re-runs the resolver and lens detector in the same transaction.

.. CG-EXPLANATION-END id=function:accept_single_contact_correlation

Function ``async def confirm_single_edge_review``
-------------------------------------------------

.. CG-BLOCK id=function:confirm_single_edge_review lines=592-643

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contact_correlations.py
   :language: python
   :lines: 592-643
   :lineno-match:

.. CG-EXPLANATION-START id=function:confirm_single_edge_review

**What this does.** The handler for ``POST .../contact-correlations/{edge_id}/confirm-review`` — clear the review flag on one edge, meaning the engineer confirms the tie is right. It scope-guards the model and runs the confirm use case, returning how many flags were cleared.

**Why it is here.** It powers the right-click "Confirm tie" menu on a flagged edge. A re-subdivide that could not place an accepted tie confidently carries it with a flag rather than deleting it, and the engineer resolves it either by confirming (here) or deleting. It changes no geometry and no approval state, and is idempotent.

.. CG-EXPLANATION-END id=function:confirm_single_edge_review

Function ``async def confirm_all_edge_reviews``
-----------------------------------------------

.. CG-BLOCK id=function:confirm_all_edge_reviews lines=644-686

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contact_correlations.py
   :language: python
   :lines: 644-686
   :lineno-match:

.. CG-EXPLANATION-START id=function:confirm_all_edge_reviews

**What this does.** The handler for ``POST .../contact-correlations/confirm-review`` — clear the review flag on every flagged edge in the model. It scope-guards the model, runs the confirm use case model-wide, and returns the count cleared.

**Why it is here.** It is the bulk counterpart to the single-edge confirm, for when the engineer has looked over all the flagged ties and accepts them as a set.

.. CG-EXPLANATION-END id=function:confirm_all_edge_reviews

Function ``async def materialise_body_companions``
--------------------------------------------------

.. CG-BLOCK id=function:materialise_body_companions lines=687-743

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contact_correlations.py
   :language: python
   :lines: 687-743
   :lineno-match:

.. CG-EXPLANATION-START id=function:materialise_body_companions

**What this does.** The handler for ``POST .../body-companions/materialise`` — auto-create a perpendicular companion section for each lens whose primary section is fully correlated. It scope-guards the model, runs the use case, and returns counts of sections created and lenses skipped or errored.

**Why it is here.** A lens qualifies once every contact on its primary section has at least one approved outbound edge, which is when a perpendicular companion view becomes meaningful. Lenses that already have a companion are skipped, so the action is idempotent (debt #133).

.. CG-EXPLANATION-END id=function:materialise_body_companions

Function ``async def propagate_correlated_admixtures``
------------------------------------------------------

.. CG-BLOCK id=function:propagate_correlated_admixtures lines=744-839

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/contact_correlations.py
   :language: python
   :lines: 744-839
   :lineno-match:

.. CG-EXPLANATION-START id=function:propagate_correlated_admixtures

**What this does.** The handler for ``PATCH .../contact-correlations/admixtures`` — write the same admixture list to every formation connected to a seed formation through the correlation graph. It scope-guards the model, runs the propagate use case (which walks the edge graph from the seed), then enriches and returns the updated formations with the component size.

**Why it is here.** Admixtures describe one soil body, so correlating contacts into one body means they should share the same admixtures; walking the edge graph from the seed writes them to the whole connected component. Only the admixtures are changed — not the soil code or ordinal — so no resolver re-run is needed. A seed with no edges updates only itself; a bad seed or non-litho model is ``422``.

.. CG-EXPLANATION-END id=function:propagate_correlated_admixtures

