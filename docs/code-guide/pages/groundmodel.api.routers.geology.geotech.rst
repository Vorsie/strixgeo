groundmodel.api.routers.geology.geotech
=======================================

.. CG-PAGE source=src/groundmodel/api/routers/geology/geotech.py complete=true

*Source file:* ``src/groundmodel/api/routers/geology/geotech.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-120

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 1-120
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A long docstring laying out the four-step geotechnical subdivision pipeline (subdivide CPTs, propose ties, accept ties, divide boreholes) and the extra edit endpoints, then the imports: the router tools, the scope and model-kind guards, the many band-edit and suggestion schemas, the application use cases for each step and edit, the domain plan/error types, the model row, and the logger. It makes a module-level logger and a bare router.

**Why it is here.** The geotech stage assigns each soil interval a NAD packing class (1-31), and the four-step pipeline mirrors the litho stage's suggest-then-accept rhythm (owner ruling 2026-08-04) so nothing the machine worked out reaches the model until the engineer says yes. Each step takes an optional section id and acts on that section alone (owner rulings 2026-08-15). The NAD classification is a characterisation output within MVP scope; the packing classes come from the published Belgian national annex (NBN EN 1997-1 ANB Tabel 2.1). Same split-package mounting under the shared geology prefix.

.. CG-EXPLANATION-END id=module-header

Function ``async def subdivide_all_bodies``
-------------------------------------------

.. CG-BLOCK id=function:subdivide_all_bodies lines=121-207

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 121-207
   :lineno-match:

.. CG-EXPLANATION-START id=function:subdivide_all_bodies

**What this does.** The handler for ``POST .../geotech/subdivide-all-bodies`` — the combined verb kept for compatibility: it runs steps 1 and 2 in one press (subdivide the CPTs into packing bands and propose the packing ties). It scope-guards the litho model, requires it to be lithostratigraphic, checks the body's model id matches the URL, and runs the shared subdivide with edge derivation on.

**Why it is here.** Kept for callers that want both steps at once; every tie it writes is a proposal the engineer accepts later, and the response says so through its derived-edges and proposed-tie counts. It is model-wide and idempotent — the whole geotech model is deleted and rewritten each call — and the geometry is written as litho-layer rows so it renders through the same engine (Option A body-centric flow).

.. CG-EXPLANATION-END id=function:subdivide_all_bodies

Function ``def _require_matching_model_id``
-------------------------------------------

.. CG-BLOCK id=function:_require_matching_model_id lines=208-240

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 208-240
   :lineno-match:

.. CG-EXPLANATION-START id=function:_require_matching_model_id

**What this does.** A private helper that refuses with ``422`` when the request body names a different model than the URL.

**Why it is here.** The body carries the litho model id for forward-compatibility but the URL id is authoritative, so a mismatch is refused rather than silently ignored — a caller that believes otherwise deserves to be told.

.. CG-EXPLANATION-END id=function:_require_matching_model_id

Function ``async def _refuse_while_ties_are_pending``
-----------------------------------------------------

.. CG-BLOCK id=function:_refuse_while_ties_are_pending lines=241-324

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 241-324
   :lineno-match:

.. CG-EXPLANATION-START id=function:_refuse_while_ties_are_pending

**What this does.** A private helper that refuses the divide-boreholes step with ``422`` (``geotech_ties_pending``) when packing ties in scope are still proposals, carrying the pending and accepted counts. It finds the geotech child model, loads the tie status, and counts either the whole model or one section.

**Why it is here.** Step 4 is gated on step 3 being finished (owner ruling 2026-08-04): a pending tie is a correlation the machine guessed but the engineer has not reviewed, and an accepted tie crossing a borehole names the CPTs that borehole's packing is read from, so dividing off unreviewed evidence produces packing he never sanctioned. The gate follows the divide's scope (owner ruling 2026-08-15) so one unreviewed tie does not lock the whole model. It stays silent when there is no geotech child, letting the divide answer that with its own precise message.

.. CG-EXPLANATION-END id=function:_refuse_while_ties_are_pending

Function ``async def _run_subdivide``
-------------------------------------

.. CG-BLOCK id=function:_run_subdivide lines=325-419

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 325-419
   :lineno-match:

.. CG-EXPLANATION-START id=function:_run_subdivide

**What this does.** A private helper that runs the subdivide use case and maps its result onto the response schema, mapping a domain error to ``422``. It logs a detailed outcome line and returns the geotech model id, created formations, and per-phase counts.

**Why it is here.** Shared by the combined verb (edges derived) and the step-1 verb (bands only) so the two can never drift in what they report. The detailed log line is where the owner reads what a subdivide actually did during a dogfeed.

.. CG-EXPLANATION-END id=function:_run_subdivide

Function ``async def subdivide_cpts``
-------------------------------------

.. CG-BLOCK id=function:subdivide_cpts lines=420-499

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 420-499
   :lineno-match:

.. CG-EXPLANATION-START id=function:subdivide_cpts

**What this does.** The handler for ``POST .../geotech/subdivide-cpts`` — step 1: create the CPT packing bands and nothing else. It scope-guards and kind-guards the litho model, checks the body model id, and runs the shared subdivide with edge derivation off.

**Why it is here.** The combined verb did too much at once; this stops after the bands so the engineer sees the packing before anything is correlated — the suggest-then-accept rhythm applied to the geotech axis. It still re-anchors the engineer's already-accepted ties across the rebuild, because carrying his own work is not edge derivation and skipping it would silently destroy accepted correlations.

.. CG-EXPLANATION-END id=function:subdivide_cpts

Function ``async def geotech_litho_staleness``
----------------------------------------------

.. CG-BLOCK id=function:geotech_litho_staleness lines=500-567

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 500-567
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotech_litho_staleness

**What this does.** The handler for ``GET .../geotech/litho-staleness`` — report the geotech columns whose underlying litho was edited after their packing bands were made. It scope-guards and requires a geotech model, runs the staleness check, and returns the stale columns and counts.

**Why it is here.** Packing bands are derived from the litho stack beneath them, and until this shipped nothing linked the two, so an engineer could move a litho contact and the geotech axis would keep drawing the old bands right into a client export (debt #266). It is derived on every read by comparing a stamped digest with today's litho, so re-pressing the named columns clears it with no state to reset. A litho model has nothing beneath it, so a wrong kind is ``422``.

.. CG-EXPLANATION-END id=function:geotech_litho_staleness

Function ``async def geotech_tie_status``
-----------------------------------------

.. CG-BLOCK id=function:geotech_tie_status lines=568-633

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 568-633
   :lineno-match:

.. CG-EXPLANATION-START id=function:geotech_tie_status

**What this does.** The handler for ``GET .../geotech/tie-status`` — report the geotech model's packing ties by approval state, with a per-section breakdown of what is pending. It scope-guards and requires a geotech model, loads the tie status, and returns the counts.

**Why it is here.** It answers the question the divide-boreholes gate would otherwise raise with a refusal, so the desktop can disable the button and say why instead of learning it from a ``422``. A litho model's edge counts are a different question with a different verb, so a wrong kind is ``422``.

.. CG-EXPLANATION-END id=function:geotech_tie_status

Function ``async def divide_boreholes``
---------------------------------------

.. CG-BLOCK id=function:divide_boreholes lines=634-773

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 634-773
   :lineno-match:

.. CG-EXPLANATION-START id=function:divide_boreholes

**What this does.** The handler for ``POST .../geotech/divide-boreholes`` — step 4: materialise packing bands on the borehole columns, borrowing each borehole's packing from the tied CPTs. It scope-guards the litho model, refuses while ties are pending unless overridden, runs the divide use case, and returns the counts; it maps an unexpected failure to ``500``.

**Why it is here.** This is the only gated step, because a borehole carries no cone resistance of its own, so its packing is read from the CPTs an accepted tie connects it to (owner ruling 2026-08-04). It is section-scoped like the rest of the pipeline (owner ruling 2026-08-15). An empty borehole list means "divide none", not "divide all" — only an omitted field means all — so a cleared selection cannot trigger the maximal irreversible rebuild. It is idempotent per scope: a borehole left out keeps the bands and ties it already had.

.. CG-EXPLANATION-END id=function:divide_boreholes

Function ``async def preview_divide_boreholes``
-----------------------------------------------

.. CG-BLOCK id=function:preview_divide_boreholes lines=774-914

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 774-914
   :lineno-match:

.. CG-EXPLANATION-START id=function:preview_divide_boreholes

**What this does.** The handler for ``POST .../geotech/divide-boreholes/preview`` — report what packing each borehole would get, and what a commit would do to its accepted ties, without writing anything. It scope-guards the model, runs the same planner the commit uses, and returns the per-borehole bands and tie-carry counts.

**Why it is here.** Because subdivide leaves the borehole columns empty on the geotech axis, the engineer would otherwise press a destructive rebuild blind; running the exact same planner the commit uses means the ghosts drawn from this response are the rows the button writes (preview equals commit, a standing gate). It is ungated on purpose — a preview writes nothing, so refusing it would only hide information — and it rolls back at the end.

.. CG-EXPLANATION-END id=function:preview_divide_boreholes

Function ``async def auto_correlate_geotech``
---------------------------------------------

.. CG-BLOCK id=function:auto_correlate_geotech lines=915-1031

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 915-1031
   :lineno-match:

.. CG-EXPLANATION-START id=function:auto_correlate_geotech

**What this does.** The handler for ``POST .../geotech/auto-correlate`` — step 2: propose packing ties by aligning the two columns' NAD class sequences inside each correlated litho unit, as unapproved suggestions. It scope-guards the geotech model, runs the correlate use case, maps a bad model to ``422``, and returns the proposed, accepted, and skipped counts.

**Why it is here.** It is the geotech counterpart of the litho auto-correlate verb; proposals insert unapproved so they render as suggestions until the engineer accepts them, and nothing enters the body resolver until then. It adds but never reconciles — every existing correlation is left as is — so it is safe to press mid-session, unlike the combined subdivide which wipes the model first. It is section-scoped: a tie is only derived between columns the section actually draws, and stale off-section machine proposals are swept while accepted and hand-drawn ties are kept.

.. CG-EXPLANATION-END id=function:auto_correlate_geotech

Function ``def _plan_payload``
------------------------------

.. CG-BLOCK id=function:_plan_payload lines=1032-1079

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 1032-1079
   :lineno-match:

.. CG-EXPLANATION-START id=function:_plan_payload

**What this does.** A private helper that maps a domain band-edit plan onto its response schema, copying the statistic, the parent band's extent, each resulting interval (with its representative cone resistance and re-derived class), and the advisory warnings.

**Why it is here.** The wire shape is identical for a preview and a commit so the desktop renders one component for both. The representative cone resistance is sent under two field names: the honest current name plus a deprecated older name kept for older clients (additive-only).

.. CG-EXPLANATION-END id=function:_plan_payload

Function ``def _edit_payload``
------------------------------

.. CG-BLOCK id=function:_edit_payload lines=1080-1106

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 1080-1106
   :lineno-match:

.. CG-EXPLANATION-START id=function:_edit_payload

**What this does.** A private helper that maps a committed band-edit result onto its response schema, carrying the plan plus the created, deleted, flagged, and cleared row and edge ids.

**Why it is here.** It gives the desktop everything it needs to update its local state after an edit in one round-trip — which rows and correlations changed and how.

.. CG-EXPLANATION-END id=function:_edit_payload

Function ``async def _require_geotech_model``
---------------------------------------------

.. CG-BLOCK id=function:_require_geotech_model lines=1107-1130

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 1107-1130
   :lineno-match:

.. CG-EXPLANATION-START id=function:_require_geotech_model

**What this does.** A private helper that scope-guards a model and requires it to be geotechnical, shared by the band-edit endpoints.

**Why it is here.** The four band-edit endpoints all need the same project-scope-plus-kind guard, so it is extracted once (per the don't-repeat rule); the verb name is interpolated into the refusal message.

.. CG-EXPLANATION-END id=function:_require_geotech_model

Function ``def _band_edit_422``
-------------------------------

.. CG-BLOCK id=function:_band_edit_422 lines=1131-1149

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 1131-1149
   :lineno-match:

.. CG-EXPLANATION-START id=function:_band_edit_422

**What this does.** A private helper that turns a domain band-edit rejection into a ``422`` carrying the domain message unchanged.

**Why it is here.** The hierarchy rules the band edits enforce are domain decisions, and the desktop shows the server's own words, so the message is passed through verbatim under a stable code.

.. CG-EXPLANATION-END id=function:_band_edit_422

Function ``async def preview_split_geotech_band``
-------------------------------------------------

.. CG-BLOCK id=function:preview_split_geotech_band lines=1150-1211

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 1150-1211
   :lineno-match:

.. CG-EXPLANATION-START id=function:preview_split_geotech_band

**What this does.** The handler for ``POST .../geotech/bands/preview-split`` — report what splitting a packing band at a depth would do, without writing. It requires a geotech model, runs the preview, and returns the two halves' intervals and warnings.

**Why it is here.** Each half reports its representative (median) cone resistance and re-derived NAD class so the engineer sees the consequence before committing. A half over which the cone resistance cannot answer reports a null class with a reason rather than a guess. A borehole band has no cone resistance so it is refused ``422``, as is a depth outside the band's own litho body (the hierarchy is not overrulable).

.. CG-EXPLANATION-END id=function:preview_split_geotech_band

Function ``async def preview_merge_geotech_bands``
--------------------------------------------------

.. CG-BLOCK id=function:preview_merge_geotech_bands lines=1212-1274

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 1212-1274
   :lineno-match:

.. CG-EXPLANATION-START id=function:preview_merge_geotech_bands

**What this does.** The handler for ``POST .../geotech/bands/preview-merge`` — report what merging two adjacent bands would do, without writing. It requires a geotech model, runs the preview, and returns the merged interval and warnings.

**Why it is here.** The merged class is re-derived over the union of the two extents, so it may differ from both inputs, and the warnings say per input band whether sharing a layer pulls its representative cone resistance up or down. A borehole band or a non-adjacent pair is refused ``422``.

.. CG-EXPLANATION-END id=function:preview_merge_geotech_bands

Function ``async def split_geotech_band``
-----------------------------------------

.. CG-BLOCK id=function:split_geotech_band lines=1275-1340

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 1275-1340
   :lineno-match:

.. CG-EXPLANATION-START id=function:split_geotech_band

**What this does.** The handler for ``POST .../geotech/bands/split`` — commit a hand split, rewriting only the edited column. It requires a geotech model, runs the split use case, maps a rejection to ``422``, and returns the committed result.

**Why it is here.** Both halves are reclassified from the cone resistance over their own extent, and a correlation on the edited band is dropped only where the new class no longer matches its partner. A band thinner than the configured minimum is committed with a warning, because a manual edit overrules that rule. A borehole band is refused (no cone resistance to re-derive from).

.. CG-EXPLANATION-END id=function:split_geotech_band

Function ``async def clear_geotech_column``
-------------------------------------------

.. CG-BLOCK id=function:clear_geotech_column lines=1341-1399

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 1341-1399
   :lineno-match:

.. CG-EXPLANATION-START id=function:clear_geotech_column

**What this does.** The handler for ``POST .../geotech/columns/clear`` — delete one investigation's geotech bands so a later pipeline press rebuilds it. It requires a geotech model, runs the clear use case, and returns the deleted band count.

**Why it is here.** It is the escape hatch of first-subdivision-wins (owner ask 2026-08-18): the pipeline imports already-banded columns as they are, so redoing one column is clear-then-press. The column's ties cascade with its rows and no tombstone is written, because this is rebuild preparation, not a judgement. Idempotent — a column with no bands clears zero.

.. CG-EXPLANATION-END id=function:clear_geotech_column

Function ``async def set_geotech_band_class``
---------------------------------------------

.. CG-BLOCK id=function:set_geotech_band_class lines=1400-1464

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 1400-1464
   :lineno-match:

.. CG-EXPLANATION-START id=function:set_geotech_band_class

**What this does.** The handler for ``POST .../geotech/bands/set-class`` — set a borehole band's NAD class by hand, moving no geometry. It requires a geotech model, runs the use case, maps a rejection to ``422``, and returns the committed change and its correlation consequences.

**Why it is here.** A borehole band's class is extrapolated from donor CPTs, not measured, so the engineer's judgement outranks it (owner ask 2026-08-18); a CPT band is refused because its class comes from its own cone resistance. A class outside the band's soil family is refused, keeping the absolute soil-to-class coupling. Ties on the band are re-judged by the flag-not-drop machinery.

.. CG-EXPLANATION-END id=function:set_geotech_band_class

Function ``async def merge_geotech_bands``
------------------------------------------

.. CG-BLOCK id=function:merge_geotech_bands lines=1465-1531

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 1465-1531
   :lineno-match:

.. CG-EXPLANATION-START id=function:merge_geotech_bands

**What this does.** The handler for ``POST .../geotech/bands/merge`` — commit a hand merge of two adjacent bands, rewriting only the edited column. It requires a geotech model, runs the merge use case, maps a rejection to ``422``, and returns the committed result.

**Why it is here.** The merged class is re-derived from the cone resistance over the union; the absorbed band's correlations go with it, and the survivor keeps the correlations whose partner still carries the merged class. A borehole band, or a merge that would cross a litho or geological contact, is refused ``422`` (the hierarchy holds).

.. CG-EXPLANATION-END id=function:merge_geotech_bands

Function ``async def set_geotech_statistic``
--------------------------------------------

.. CG-BLOCK id=function:set_geotech_statistic lines=1532-1589

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 1532-1589
   :lineno-match:

.. CG-EXPLANATION-START id=function:set_geotech_statistic

**What this does.** The handler for ``POST .../geotech/statistic`` — change which representative cone-resistance statistic the classifier reads. It requires a geotech model, writes the one column, and returns the stored choice, the last build's stamp, and whether the bands are now stale.

**Why it is here.** It writes exactly one column and re-derives nothing (ruling 8): the bands keep their classes until the engineer re-runs subdivide under the new choice, and the returned staleness flag says whether that re-run is now due. The statistic token is validated at the wire by its allowed set.

.. CG-EXPLANATION-END id=function:set_geotech_statistic

Function ``async def preview_move_geotech_boundary``
----------------------------------------------------

.. CG-BLOCK id=function:preview_move_geotech_boundary lines=1590-1651

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 1590-1651
   :lineno-match:

.. CG-EXPLANATION-START id=function:preview_move_geotech_boundary

**What this does.** The handler for ``POST .../geotech/bands/preview-move`` — report what dragging a packing boundary to a depth would do, without writing. It requires a geotech model, runs the preview, and returns both resulting intervals and warnings.

**Why it is here.** Both intervals report their representative cone resistance and re-derived class so the engineer sees the outcome first. A borehole band, a pair that is not a same-parent neighbour pair (that boundary is a contact, handled by the sibling endpoint), or a depth not strictly inside the pair, is refused ``422``.

.. CG-EXPLANATION-END id=function:preview_move_geotech_boundary

Function ``async def move_geotech_boundary``
--------------------------------------------

.. CG-BLOCK id=function:move_geotech_boundary lines=1652-1717

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 1652-1717
   :lineno-match:

.. CG-EXPLANATION-START id=function:move_geotech_boundary

**What this does.** The handler for ``POST .../geotech/bands/move`` — commit the drag of a packing boundary as an atomic two-row write, re-deriving both classes. It requires a geotech model, runs the move use case, maps a rejection to ``422``, and returns the committed result.

**Why it is here.** Both bands re-derive because their extents changed. Ties whose class match breaks are flagged for review (if accepted) or withdrawn (if pending), and a restored match self-heals — the flag-not-drop rule (owner 2026-08-07). It shares the preview's refusals so the two can never disagree.

.. CG-EXPLANATION-END id=function:move_geotech_boundary

Function ``async def move_restated_contact``
--------------------------------------------

.. CG-BLOCK id=function:move_restated_contact lines=1718-1793

.. literalinclude:: ../../../src/groundmodel/api/routers/geology/geotech.py
   :language: python
   :lines: 1718-1793
   :lineno-match:

.. CG-EXPLANATION-START id=function:move_restated_contact

**What this does.** The handler for ``POST .../geotech/contact/move`` — drag the boundary that is a litho contact restated by a packing boundary, moving it in every model that records it. It requires a geotech model, runs the use case, maps a rejection to ``422``, and returns the band outcome plus the litho rows and geological contact carried.

**Why it is here.** It is the sibling of the packing-boundary move for the other kind of boundary: this one drags the contact BETWEEN two units, which is recorded once per model, and moving it in one model but not the others would split one physical boundary into disagreeing records — invisible until a later drag cannot find its own contact. Both bands re-derive their class because the chain runs soil type to cone resistance to NAD class (ruling 3).

.. CG-EXPLANATION-END id=function:move_restated_contact

