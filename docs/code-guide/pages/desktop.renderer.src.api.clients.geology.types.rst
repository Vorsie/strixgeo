desktop.renderer.src.api.clients.geology.types
==============================================

.. CG-PAGE source=desktop/src/renderer/src/api/clients/geology.types.ts complete=true

*Source file:* ``desktop/src/renderer/src/api/clients/geology.types.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-60

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1-60
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment, its imports, and a set of re-exports. The comment states the file's job: it holds the request and response shapes for every geological-model, litho, body, and geotechnical-unit endpoint. It imports ``CrossSectionResponse`` from the neighbouring section module (several responses below embed an ``updated_section`` field) and ``GaplessBuildReport`` into local scope, then re-exports the voxel-build request type and the seven gapless-gate types so a caller reaches them all from the one geology client.

**Why it is here.** This is the API-boundary catalogue for geology. The desktop never touches the database or the Python engine directly: every read and write is a call over the local web connection, and each reply is given a declared TypeScript shape so the rest of the app knows its fields (CLAUDE.md; ``docs/api.md``). A TypeScript **interface** or **type** is only a note listing which fields a value carries; it is checked before the app runs and then vanishes. These shapes are **additive-only** — new fields arrive optional or nullable and nothing is removed or repurposed without a deprecation cycle, so a newer engine's reply and an older ``.strix`` project still line up (backwards-compat). The file was split out of ``clients/geology.ts`` (debt #201, round 2) so the type catalogue and the client code read separately; the client re-exports everything here, so callers keep their existing import path (a **barrel re-export** — a file that only forwards names so callers keep one import path).

.. CG-EXPLANATION-END id=module-header

``type NadAdmixtureChoice``
---------------------------

.. CG-BLOCK id=type:NadAdmixtureChoice lines=61-69

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 61-69
   :lineno-match:

.. CG-EXPLANATION-START id=type:NadAdmixtureChoice

**What this does.** A **union** — a type whose value must be one text from a fixed list — allowing only ``'pure'`` or ``'with_admixture'``. It records the engineer's answer for a litho unit whose admixtures make its NAD family ambiguous: ``'pure'`` files it into the clean NAD column, ``'with_admixture'`` into the secondary (f)/(s) column; absent or null means unanswered and the classifier decides from the admixtures.

**Why it is here.** Owner ruling 2026-09-04, quoted in the docstring: the engineer's persisted answer to an admixture-ambiguity question, so a named choice rather than free text is what travels on the wire and the classifier reads.

.. CG-EXPLANATION-END id=type:NadAdmixtureChoice

``interface NadCharacteristicValues``
-------------------------------------

.. CG-BLOCK id=interface:NadCharacteristicValues lines=70-82

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 70-82
   :lineno-match:

.. CG-EXPLANATION-START id=interface:NadCharacteristicValues

**What this does.** An **interface** — a note listing the named fields a value carries — for the NAD table's characteristic values of one packing class: two unit weights (``gamma_unsat_kn_m3`` dry above the water table, ``gamma_sat_kn_m3`` saturated below), the effective friction angle φ′, effective cohesion c′, and undrained shear strength cu, which is null on the granular classes where the table shows a dash.

**Why it is here.** Owner ruling 2026-09-05: a read-only mirror of the backend response, transcribed straight from NBN EN 1997-1 ANB Tabel 2.1 (the Belgian national annex). The docstring is explicit that these are published table values, not design values and not a Strix-computed correlation — a characterisation output the engineer still verifies.

.. CG-EXPLANATION-END id=interface:NadCharacteristicValues

``interface GeologicalFormationResponse``
-----------------------------------------

.. CG-BLOCK id=interface:GeologicalFormationResponse lines=83-159

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 83-159
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeologicalFormationResponse

**What this does.** The per-project formation-vocabulary row, the largest shape in the file. It carries identity (``id``, ``app_project_id``), display data (``name``, the machine-default ``color`` and the engineer-picked ``color_override``, ``code``, ``display_order`` and the ``pinned_order`` flag, ``regional_ref``, ``description``), the three-level hierarchy attributes (``lithology``, ``nad_class``), the litho-builder fields (parent formation id/name/code, main soil code, an ``litho_admixtures`` list, the ``nad_admixture_choice``, and the instance ordinal plus its lock), the geotech dual-reference columns (``source_litho_formation_id`` and ``source_geo_formation_id``), the ``parent_extrapolated`` flag, a read-only ``nad_parameters`` block, and the created/updated timestamps.

**Why it is here.** One additive shape shared by all three model kinds: most fields are null on a plain geological formation and only set on a litho or geotech unit. A trailing ``?`` marks a field that may be absent from the reply; ``| null`` marks one that may be present but empty — several fields here are optional purely so pre-change test fixtures still typecheck while the live API always sends them (the comments say so). The comments record the load-bearing choices: ``color_override`` is separate from ``color`` because ``color`` is a machine default that says nothing about intent, and ``source_litho_formation_id`` / ``source_geo_formation_id`` are the correct discriminators for a unit's kind. Bundle-persisted via ``project_bundle.geological_formations``.

.. CG-EXPLANATION-END id=interface:GeologicalFormationResponse

``interface GeologicalFormationCreatePayload``
----------------------------------------------

.. CG-BLOCK id=interface:GeologicalFormationCreatePayload lines=160-178

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 160-178
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeologicalFormationCreatePayload

**What this does.** The request body for creating a formation (``POST .../geology/formations``): ``name`` is required, everything else optional, and it includes the litho-unit fields (parent id, main soil code, admixtures) for creating a lithostratigraphic child without a contact.

**Why it is here.** The additive create shape for a formation; per the comment, the litho-unit fields are supplied only for the Add-new-unit ghost flow (Bug 2 dogfeed 2026-05-26) and omitted for a plain geological formation.

.. CG-EXPLANATION-END id=interface:GeologicalFormationCreatePayload

``interface GeologicalFormationUpdatePayload``
----------------------------------------------

.. CG-BLOCK id=interface:GeologicalFormationUpdatePayload lines=179-218

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 179-218
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeologicalFormationUpdatePayload

**What this does.** The PATCH body for a formation: every field is optional so the caller sends only what changed. ``color_override`` is three-way — a hex string sets the engineer's colour, an explicit null resets to the automatic colour, and omitting the key leaves his choice alone; it also carries the ``parent_extrapolated`` clear and the ``nad_admixture_choice`` answer.

**Why it is here.** The additive PATCH shape. The backend PATCH is ``exclude_unset``, which is what makes the set / reset / leave-alone trichotomy meaningful; the comments note that ``instance_ordinal_locked`` is kept only for backward compatibility (the resolver no longer reads it) and that the UI never sends ``parent_extrapolated`` true.

.. CG-EXPLANATION-END id=interface:GeologicalFormationUpdatePayload

``type ModelKind``
------------------

.. CG-BLOCK id=type:ModelKind lines=219-221

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 219-221
   :lineno-match:

.. CG-EXPLANATION-START id=type:ModelKind

**What this does.** A union naming the three interpretation levels: ``'geological'``, ``'lithostratigraphic'`` or ``'geotechnical'``.

**Why it is here.** The discriminator for the three-level modelling hierarchy; the docstring notes ``is_active`` is scoped per kind on the backend, so callers select a model by kind rather than by the-first-active.

.. CG-EXPLANATION-END id=type:ModelKind

``interface GeologicalModelResponse``
-------------------------------------

.. CG-BLOCK id=interface:GeologicalModelResponse lines=222-244

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 222-244
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeologicalModelResponse

**What this does.** One interpretation model: id and project id, ``name`` and ``description``, the ``is_active`` flag, the ``excluded_borehole_ids`` list, its ``kind``, the ``parent_model_id``, the geotech-only representative/classified statistic pair, and timestamps.

**Why it is here.** The additive shape for a model row. A project can hold several models; the comments record that ``parent_model_id`` is mandatory for litho and geotech (each refines the level above) and null only for geological, and that the two statistic fields are meaningful for a geotechnical model only (rulings 7+8, derived and never stored).

.. CG-EXPLANATION-END id=interface:GeologicalModelResponse

``interface GeologicalModelCreatePayload``
------------------------------------------

.. CG-BLOCK id=interface:GeologicalModelCreatePayload lines=245-254

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 245-254
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeologicalModelCreatePayload

**What this does.** The request body for creating a model (``POST .../geology/models``): ``name`` required, and optional description, active flag, excluded-borehole list, kind, and parent model id.

**Why it is here.** The additive create shape for a model — the same request pattern as the formation create above.

.. CG-EXPLANATION-END id=interface:GeologicalModelCreatePayload

``interface GeologicalModelUpdatePayload``
------------------------------------------

.. CG-BLOCK id=interface:GeologicalModelUpdatePayload lines=255-265

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 255-265
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeologicalModelUpdatePayload

**What this does.** The PATCH body for a model — only ``name``, ``description`` and ``excluded_borehole_ids`` may change, all optional.

**Why it is here.** The additive PATCH shape for a model; a deliberately narrow surface, since kind and parent are fixed once the model exists.

.. CG-EXPLANATION-END id=interface:GeologicalModelUpdatePayload

``type ContactSource``
----------------------

.. CG-BLOCK id=type:ContactSource lines=266-277

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 266-277
   :lineno-match:

.. CG-EXPLANATION-START id=type:ContactSource

**What this does.** A union of provenance tags saying where a formation-contact pick came from: a borehole observation, a manual pick, an interpolated value, a seed from the parent geological model, or a synthetic pinch-out extrapolation.

**Why it is here.** Provenance travels with every contact (Data Integrity Rule 1); the comments note that a ``pinch_out_extrapolation`` contact has no borehole or CPT anchor and instead carries synthetic coordinates.

.. CG-EXPLANATION-END id=type:ContactSource

``type ContactConfidence``
--------------------------

.. CG-BLOCK id=type:ContactConfidence lines=278-285

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 278-285
   :lineno-match:

.. CG-EXPLANATION-START id=type:ContactConfidence

**What this does.** A union of the three confidence levels a contact can carry: ``'high'``, ``'medium'`` or ``'low'``.

**Why it is here.** The engineer's confidence in the pick is recorded alongside it, so downstream display and validation can weight it.

.. CG-EXPLANATION-END id=type:ContactConfidence

``interface FormationContactResponse``
--------------------------------------

.. CG-BLOCK id=interface:FormationContactResponse lines=286-311

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 286-311
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FormationContactResponse

**What this does.** One boundary pick — a single formation top at one investigation. It carries its ids, a polymorphic anchor (``borehole_id`` XOR ``cpt_id`` — exactly one is set), the synthetic x/y/elevation used only on pinch-out contacts, the ``depth_top_m``, its source and confidence, optional observation links, the ``parent_geo_contact_id`` litho-to-geo coupling, notes, and timestamps.

**Why it is here.** The additive response shape for a formation contact. The docstring records that the anchor is one-of-two (v1 ships borehole-only; the ``cpt_id`` slot is reserved for Phase-5 Robertson-Ic auto-picks) and that ``parent_geo_contact_id`` points a litho contact at the geological contact it is the same physical surface as (#162).

.. CG-EXPLANATION-END id=interface:FormationContactResponse

``interface FormationContactCreatePayload``
-------------------------------------------

.. CG-BLOCK id=interface:FormationContactCreatePayload lines=312-331

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 312-331
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FormationContactCreatePayload

**What this does.** The request body for creating a contact: the required ``formation_id`` and ``depth_top_m``, an optional anchor, source, confidence, observation links, notes, and an optional ``section_id``.

**Why it is here.** The additive create shape; the docstring ties ``section_id`` to the explicit-content invariant (owner directive 2026-05-17) — pass the section id when drawing a contact on a section so the router appends it to that section's seeded contact list, omit it from the Geology stage.

.. CG-EXPLANATION-END id=interface:FormationContactCreatePayload

``interface FormationContactUpdatePayload``
-------------------------------------------

.. CG-BLOCK id=interface:FormationContactUpdatePayload lines=332-345

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 332-345
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FormationContactUpdatePayload

**What this does.** The PATCH body for a contact — every field optional, including an anchor re-pick where both ``borehole_id`` and ``cpt_id`` must be present together (one of them null).

**Why it is here.** The additive PATCH shape; the comment records that the backend's XOR validator rejects a half-anchor update with a 422, so both anchor fields travel together on a re-pick.

.. CG-EXPLANATION-END id=interface:FormationContactUpdatePayload

``interface FormationContactBatchUpdateEntry``
----------------------------------------------

.. CG-BLOCK id=interface:FormationContactBatchUpdateEntry lines=346-350

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 346-350
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FormationContactBatchUpdateEntry

**What this does.** One row of a batch contact update: it extends the single-contact update payload and adds the ``contact_id`` that names which row this patch targets.

**Why it is here.** Lets one request carry many contact patches at once; ``extends`` reuses the update shape so the per-row fields never drift from the single-update contract.

.. CG-EXPLANATION-END id=interface:FormationContactBatchUpdateEntry

``interface FormationContactBatchUpdateResponse``
-------------------------------------------------

.. CG-BLOCK id=interface:FormationContactBatchUpdateResponse lines=351-355

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 351-355
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FormationContactBatchUpdateResponse

**What this does.** The reply to a batch contact update — a list of the updated ``FormationContactResponse`` rows.

**Why it is here.** Returns the fresh rows so the caller can update its cache in one round-trip rather than re-fetching.

.. CG-EXPLANATION-END id=interface:FormationContactBatchUpdateResponse

``class DuplicateContactError``
-------------------------------

.. CG-BLOCK id=class:DuplicateContactError lines=356-369

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 356-369
   :lineno-match:

.. CG-EXPLANATION-START id=class:DuplicateContactError

**What this does.** A small **class** (a named object type with behaviour) that extends the built-in ``Error``. It is thrown when creating a contact would break the one-contact-per (model, anchor, formation) rule, and it carries the ``existingContactId`` so the caller knows which row already holds that slot.

**Why it is here.** A typed error the client can catch and act on — showing or selecting the existing contact — instead of parsing a generic message string; it turns the backend's uniqueness clash into a first-class value in the app.

.. CG-EXPLANATION-END id=class:DuplicateContactError

``type LithoLayerStatus``
-------------------------

.. CG-BLOCK id=type:LithoLayerStatus lines=370-372

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 370-372
   :lineno-match:

.. CG-EXPLANATION-START id=type:LithoLayerStatus

**What this does.** A union of a litho layer's state in the accept flow: ``'pending'``, ``'accepted'`` or ``'rejected'``.

**Why it is here.** The assisted-manual segmenter proposes layers the engineer accepts or rejects one by one; the status records where each stands, so nothing is auto-committed.

.. CG-EXPLANATION-END id=type:LithoLayerStatus

``type LithoLayerSource``
-------------------------

.. CG-BLOCK id=type:LithoLayerSource lines=373-379

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 373-379
   :lineno-match:

.. CG-EXPLANATION-START id=type:LithoLayerSource

**What this does.** A union of how a litho layer was created: from the CPT ``'segmenter'``, a ``'manual'`` draw, an ``'observation_layer'``, or an ``'observation_interpretation'``.

**Why it is here.** Provenance for the layer — the same record-where-it-came-from discipline as the contact source above.

.. CG-EXPLANATION-END id=type:LithoLayerSource

``type LithoLayerConfidence``
-----------------------------

.. CG-BLOCK id=type:LithoLayerConfidence lines=380-389

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 380-389
   :lineno-match:

.. CG-EXPLANATION-START id=type:LithoLayerConfidence

**What this does.** A union of the litho layer's confidence level: ``'low'``, ``'medium'`` or ``'high'``.

**Why it is here.** Carries the engineer's or segmenter's confidence with the layer, mirroring the contact-confidence union.

.. CG-EXPLANATION-END id=type:LithoLayerConfidence

``interface LithoLayerResponse``
--------------------------------

.. CG-BLOCK id=interface:LithoLayerResponse lines=390-419

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 390-419
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoLayerResponse

**What this does.** One litho-layer row (Shape A): ids, the anchor (``borehole_id`` XOR ``cpt_id``), the explicit ``depth_top_m`` and ``depth_base_m``, its status, source and confidence, observation links, the ``parent_geo_contact_id`` coupling, the ``body_id`` the resolver assigns, the optional ``parent_litho_layer_id`` a geotech band hangs off, notes, and timestamps.

**Why it is here.** The additive shape for the layer-centric litho model. The docstring records that the layer row is the source of truth and a defensive trigger pair keeps a ``formation_contact`` mirror in sync for legacy readers; ``body_id`` is null until the resolver runs, and ``parent_litho_layer_id`` lets the Parameters tree derive a geotech band's litho body live.

.. CG-EXPLANATION-END id=interface:LithoLayerResponse

``interface LithoLayerUpdatePayload``
-------------------------------------

.. CG-BLOCK id=interface:LithoLayerUpdatePayload lines=420-437

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 420-437
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoLayerUpdatePayload

**What this does.** The PATCH body for one litho layer — formation, depths, status, source, confidence, anchor, observation links, coupling and notes, all optional.

**Why it is here.** The additive PATCH shape; the comment notes ``source`` can change on a drag commit (snapped becomes ``observation_layer``, unsnapped becomes ``manual``), which the earlier schema had omitted.

.. CG-EXPLANATION-END id=interface:LithoLayerUpdatePayload

``interface LithoLayerCreateItem``
----------------------------------

.. CG-BLOCK id=interface:LithoLayerCreateItem lines=438-453

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 438-453
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoLayerCreateItem

**What this does.** One layer inside a bulk-create request (``POST .../layers``): required formation and top/base depths, with optional status, source, confidence, anchor, observation links, coupling and notes.

**Why it is here.** The additive create shape for a layer; packaged as an item so many layers post together in one call.

.. CG-EXPLANATION-END id=interface:LithoLayerCreateItem

``interface LithoLayerBoundaryMovePayload``
-------------------------------------------

.. CG-BLOCK id=interface:LithoLayerBoundaryMovePayload lines=454-460

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 454-460
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoLayerBoundaryMovePayload

**What this does.** The request for dragging the boundary between two touching layers: the ``upper_layer_id``, the ``lower_layer_id``, and the ``new_depth_m`` where the shared boundary should sit.

**Why it is here.** The additive shape for the boundary-move gesture; moving one boundary changes two rows, so both are named in the single request.

.. CG-EXPLANATION-END id=interface:LithoLayerBoundaryMovePayload

``interface LithoLayerBoundaryMoveResponse``
--------------------------------------------

.. CG-BLOCK id=interface:LithoLayerBoundaryMoveResponse lines=461-466

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 461-466
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoLayerBoundaryMoveResponse

**What this does.** The reply to a boundary move — the two refreshed rows, ``upper`` and ``lower``.

**Why it is here.** Returns both changed layers so the section redraws the moved boundary from server truth in one round-trip.

.. CG-EXPLANATION-END id=interface:LithoLayerBoundaryMoveResponse

``interface LithoLayerBatchUpdateItem``
---------------------------------------

.. CG-BLOCK id=interface:LithoLayerBatchUpdateItem lines=467-483

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 467-483
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoLayerBatchUpdateItem

**What this does.** One per-row patch inside a layer batch update: the ``layer_id`` plus the same optional fields as a single update, including the both-or-neither anchor pair.

**Why it is here.** The additive batch-item shape (A4 slice 4b); the comment records the anchor XOR rule — if either anchor is sent both must appear with exactly one non-null, or the schema returns a 422.

.. CG-EXPLANATION-END id=interface:LithoLayerBatchUpdateItem

``interface LithoLayerBatchUpdateResponse``
-------------------------------------------

.. CG-BLOCK id=interface:LithoLayerBatchUpdateResponse lines=484-493

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 484-493
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoLayerBatchUpdateResponse

**What this does.** The reply to a layer batch update — an ``updated_count`` and the list of refreshed ``layers``.

**Why it is here.** Returns the count and the fresh rows so the caller confirms how many changed and re-syncs its cache in one call.

.. CG-EXPLANATION-END id=interface:LithoLayerBatchUpdateResponse

``type LithoSuggestionConfidence``
----------------------------------

.. CG-BLOCK id=type:LithoSuggestionConfidence lines=494-496

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 494-496
   :lineno-match:

.. CG-EXPLANATION-START id=type:LithoSuggestionConfidence

**What this does.** A union of the confidence a litho suggestion carries: ``'high'``, ``'medium'`` or ``'low'``.

**Why it is here.** The segmenter attaches a confidence to each proposed layer, mirroring the accepted-layer confidence union.

.. CG-EXPLANATION-END id=type:LithoSuggestionConfidence

``interface AdmixtureItem``
---------------------------

.. CG-BLOCK id=interface:AdmixtureItem lines=497-509

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 497-509
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AdmixtureItem

**What this does.** One secondary soil component within a layer: its ``soil_code``, an ``amount`` (the DOV amount step), and a ``locally`` flag.

**Why it is here.** The shape of one entry in the admixtures list; the raw DOV tokens are stored verbatim and translated only at the presentation boundary (Data Integrity Rule 2; CLAUDE.md).

.. CG-EXPLANATION-END id=interface:AdmixtureItem

``interface LithoLayerSuggestion``
----------------------------------

.. CG-BLOCK id=interface:LithoLayerSuggestion lines=510-536

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 510-536
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoLayerSuggestion

**What this does.** One read-only proposed layer: its top/base depths, the suggested lithology and NAD class, the mean qc and Dr, a confidence, a source string, a ``suggested_admixtures`` list, the parent geological formation id, a ``spans_boundary`` flag, and an optional ``nad_class_range`` (a **tuple** — a fixed-length pair written ``[min, max]``).

**Why it is here.** The additive shape for a proposal from the Robertson-2015/2010 CPT segmenter or the borehole observation-layer mapping. The docstring stresses these are proposals the engineer accepts to turn into real layers (assisted-manual, never auto-committed); ``spans_boundary`` is true when the interval crosses a geological boundary (the frontend renders an amber border), and ``nad_class_range`` is optional so bundles pre-dating the merge pass stay compatible (debt #119).

.. CG-EXPLANATION-END id=interface:LithoLayerSuggestion

``interface LithoSuggestionResponse``
-------------------------------------

.. CG-BLOCK id=interface:LithoSuggestionResponse lines=537-543

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 537-543
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoSuggestionResponse

**What this does.** The reply from suggest-litho: the ``investigation_type`` (cpt or borehole), the ``minimum_layer_thickness_m`` used, and the list of ``layers``.

**Why it is here.** The additive response shape carrying the segmenter's proposed layers plus the thickness setting they were computed under.

.. CG-EXPLANATION-END id=interface:LithoSuggestionResponse

``interface LithoSuggestionRequest``
------------------------------------

.. CG-BLOCK id=interface:LithoSuggestionRequest lines=544-564

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 544-564
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoSuggestionRequest

**What this does.** The request for suggest-litho: an optional cpt or borehole id, the minimum layer thickness, the unsaturated and water unit weights, a Dr compression factor, a ``merge_same_lithology`` flag and a ``use_normalised_qc`` flag.

**Why it is here.** The additive request shape. The comments record two owner/method choices: adjacent same-lithology CPT segments are merged by default (owner directive 2026-05-25), and clearing ``use_normalised_qc`` selects the non-normalised Robertson 2010 I_SBT classifier, in which Dr and NAD are left blank.

.. CG-EXPLANATION-END id=interface:LithoSuggestionRequest

``interface AcceptLithoSuggestionsRequest``
-------------------------------------------

.. CG-BLOCK id=interface:AcceptLithoSuggestionsRequest lines=565-580

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 565-580
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AcceptLithoSuggestionsRequest

**What this does.** The request to accept suggestions for one investigation: the anchor (cpt XOR borehole), an optional ``section_id``, the list of ``suggestions`` to commit, a ``defer_inference`` flag, and a ``couple_tolerance_m``.

**Why it is here.** The additive accept shape. The comments tie ``section_id`` to the explicit-content invariant (#57) — accepted contact ids are unioned into that section's seeded list — and ``couple_tolerance_m`` to the litho-to-geo coupling (#162).

.. CG-EXPLANATION-END id=interface:AcceptLithoSuggestionsRequest

``interface AcceptLithoSuggestionsResponse``
--------------------------------------------

.. CG-BLOCK id=interface:AcceptLithoSuggestionsResponse lines=581-589

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 581-589
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AcceptLithoSuggestionsResponse

**What this does.** The reply to a single-investigation accept: which formation ids were created versus found, which contact ids were created versus found, and the ``updated_section`` (or null).

**Why it is here.** The additive response shape; it reports created-vs-found so the caller knows what was new, and returns the patched section so the explicit-content list is refreshed in one round-trip.

.. CG-EXPLANATION-END id=interface:AcceptLithoSuggestionsResponse

``interface BatchAcceptLithoAnchor``
------------------------------------

.. CG-BLOCK id=interface:BatchAcceptLithoAnchor lines=590-596

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 590-596
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BatchAcceptLithoAnchor

**What this does.** One anchor entry in a batch accept: its cpt or borehole id and the ``suggestions`` to commit on it.

**Why it is here.** The per-anchor request item, so accepting across many investigations travels in one batch call.

.. CG-EXPLANATION-END id=interface:BatchAcceptLithoAnchor

``interface BatchAcceptLithoSuggestionsRequest``
------------------------------------------------

.. CG-BLOCK id=interface:BatchAcceptLithoSuggestionsRequest lines=597-604

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 597-604
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BatchAcceptLithoSuggestionsRequest

**What this does.** The batch-accept request: the list of ``anchors``, an optional ``section_id``, a ``run_inference`` flag and a ``couple_tolerance_m``.

**Why it is here.** The additive batch shape — the same accept contract as the single-investigation one, extended across many anchors at once.

.. CG-EXPLANATION-END id=interface:BatchAcceptLithoSuggestionsRequest

``interface BatchAcceptLithoAnchorResult``
------------------------------------------

.. CG-BLOCK id=interface:BatchAcceptLithoAnchorResult lines=605-615

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 605-615
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BatchAcceptLithoAnchorResult

**What this does.** The per-anchor result inside a batch-accept reply: the anchor ids, the created-versus-found formation and contact ids, and an ``error`` string that is null on success.

**Why it is here.** Reports each anchor's outcome independently so one failed anchor does not hide the successes of the rest.

.. CG-EXPLANATION-END id=interface:BatchAcceptLithoAnchorResult

``interface BatchAcceptLithoSuggestionsResponse``
-------------------------------------------------

.. CG-BLOCK id=interface:BatchAcceptLithoSuggestionsResponse lines=616-635

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 616-635
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BatchAcceptLithoSuggestionsResponse

**What this does.** The batch-accept reply: the per-anchor ``anchors`` results, model-wide totals (created/found contacts, created formations, failed-anchor count), an ``inference_ran`` flag, and the ``updated_section`` (or null).

**Why it is here.** The additive response shape; the totals and failed-anchor count summarise the batch while the per-anchor list carries the detail.

.. CG-EXPLANATION-END id=interface:BatchAcceptLithoSuggestionsResponse

``type AutoPopulateMode``
-------------------------

.. CG-BLOCK id=type:AutoPopulateMode lines=636-638

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 636-638
   :lineno-match:

.. CG-EXPLANATION-START id=type:AutoPopulateMode

**What this does.** A union naming what auto-populate does to formations the caller did not select: ``'add'`` creates or updates only the selected keys and deletes nothing, ``'overwrite'`` makes the model exactly the selection.

**Why it is here.** The docstring records the 2026-08-03 data-loss ruling: both the server and every client default to ``'add'`` because sending selected keys is a statement about what to create, never consent to delete.

.. CG-EXPLANATION-END id=type:AutoPopulateMode

``interface AutoPopulateFromStratigraphyResponse``
--------------------------------------------------

.. CG-BLOCK id=interface:AutoPopulateFromStratigraphyResponse lines=639-672

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 639-672
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AutoPopulateFromStratigraphyResponse

**What this does.** The reply from auto-populate: the created contact and formation ids, any server-deleted formation ids and their display names, the mode actually run, several skip counters (existing, unmatched, no-stratigraphy, not-in-model), any lumping ``collisions``, and the ``updated_section`` (or null).

**Why it is here.** The additive response shape; the docstring notes ``deleted_formation_ids`` is populated only in overwrite mode, ``deleted_formation_names`` is toast material, and ``updated_section`` is non-null only on the Seed-from-stratigraphy path where the seeded contact list was patched.

.. CG-EXPLANATION-END id=interface:AutoPopulateFromStratigraphyResponse

``interface FormationCandidateItem``
------------------------------------

.. CG-BLOCK id=interface:FormationCandidateItem lines=673-693

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 673-693
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FormationCandidateItem

**What this does.** One candidate formation from discover-from-stratigraphy: a working display ``name``, a formal ``regional_ref`` (null for informal boreholes), a stable cross-borehole ``key``, and the ``borehole_count`` carrying it.

**Why it is here.** The docstring records that ``key`` is the stable identity used to group the same formation across boreholes (its regional_ref when present, else the name), so discovery can offer one candidate per real formation.

.. CG-EXPLANATION-END id=interface:FormationCandidateItem

``interface LumpingCollisionItem``
----------------------------------

.. CG-BLOCK id=interface:LumpingCollisionItem lines=694-703

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 694-703
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LumpingCollisionItem

**What this does.** One lumping collision: the borehole id, the target formation key and name, the colliding raw layer names, the kept top depth, and how many were dropped.

**Why it is here.** The docstring records this occurs when several primary layers in one borehole resolve to the same formation key after the manual map is applied; reporting it lets the engineer see which raw names were merged and which layer was kept.

.. CG-EXPLANATION-END id=interface:LumpingCollisionItem

``interface DiscoverFromStratigraphyResponse``
----------------------------------------------

.. CG-BLOCK id=interface:DiscoverFromStratigraphyResponse lines=704-709

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 704-709
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DiscoverFromStratigraphyResponse

**What this does.** The reply from discover-from-stratigraphy: the list of ``candidates`` and any ``collisions``.

**Why it is here.** The additive response shape pairing the discovered candidate formations with the lumping collisions found while discovering them.

.. CG-EXPLANATION-END id=interface:DiscoverFromStratigraphyResponse

``interface DeduplicateContactsResponse``
-----------------------------------------

.. CG-BLOCK id=interface:DeduplicateContactsResponse lines=710-727

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 710-727
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DeduplicateContactsResponse

**What this does.** The reply from the contacts dedupe endpoint: the number of groups inspected, how many duplicates were removed, and the ``removed_contact_ids``.

**Why it is here.** Reports what the cleanup did, including the exact ids removed, so the caller can update its cache and the engineer can see the effect.

.. CG-EXPLANATION-END id=interface:DeduplicateContactsResponse

``interface LithoBodySolidResponse``
------------------------------------

.. CG-BLOCK id=interface:LithoBodySolidResponse lines=728-755

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 728-755
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoBodySolidResponse

**What this does.** One cached watertight 3-D solid for a (model, body): ids, the ``body_ordinal``, the build ``method``, the ``vertices`` (``[x, y, z]`` triples in the project CRS) and ``triangles`` (vertex-index triples), stale and flagged flags, an optional per-body ``display_color``, and timestamps.

**Why it is here.** The additive shape for a litho body solid built by the LithoSolidBuilder; the docstring notes ``display_color`` comes from the body row and overrides the lithology colour in the 3-D viewer, and vertices/triangles are empty for a flagged best-effort slab. (A **CRS** is the coordinate system the x/y are measured in; distances are metres only in a projected metric CRS.)

.. CG-EXPLANATION-END id=interface:LithoBodySolidResponse

``interface RecomputeBodiesResponse``
-------------------------------------

.. CG-BLOCK id=interface:RecomputeBodiesResponse lines=756-777

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 756-777
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RecomputeBodiesResponse

**What this does.** The reply from the body-identity recompute: how many geometry-fact rows were written and how many stale ones dropped, how many bodies merged and how many split, and the names of bodies whose display name was displaced.

**Why it is here.** The docstring records that this recompute consumes the frontend's per-section partitions and layer-id groups (label-independent evidence, because body-id evidence oscillated in production), rewrites the geometry facts, and re-resolves body identity — the counts report what changed.

.. CG-EXPLANATION-END id=interface:RecomputeBodiesResponse

``interface RebuildLithoSolidsResponse``
----------------------------------------

.. CG-BLOCK id=interface:RebuildLithoSolidsResponse lines=778-824

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 778-824
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RebuildLithoSolidsResponse

**What this does.** The reply from the voxel build: counts (bodies considered, built, skipped by checksum, flagged, orphans deleted), the full ``solids`` list after the rebuild, the ``uncovered_test_ids`` left with no 3-D model, an ``empty_reason`` when no bodies were built, and the optional seven-clause ``gapless_report``.

**Why it is here.** The additive response shape; the docstring makes three points load-bearing: ``uncovered_test_ids`` means the build succeeded but is INCOMPLETE (the toast must not read as a plain success), ``empty_reason`` stops the client reporting a green built-zero over a model that was actually erased, and ``gapless_report`` fails the report never the build — a tripped clause still writes solids and returns 200. Optional fields are absent from an older backend so the reply still parses.

.. CG-EXPLANATION-END id=interface:RebuildLithoSolidsResponse

``interface UpdateBodyColorResponse``
-------------------------------------

.. CG-BLOCK id=interface:UpdateBodyColorResponse lines=825-830

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 825-830
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UpdateBodyColorResponse

**What this does.** The reply from setting a body's colour (``PATCH .../bodies/{id}/color``): the ``body_id`` and the persisted ``display_color`` (or null).

**Why it is here.** Returns the stored colour after the update so the viewer paints from server truth rather than its optimistic guess.

.. CG-EXPLANATION-END id=interface:UpdateBodyColorResponse

``interface RebuildSurfacesResponse``
-------------------------------------

.. CG-BLOCK id=interface:RebuildSurfacesResponse lines=831-837

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 831-837
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RebuildSurfacesResponse

**What this does.** The reply from the geological TIN surface rebuild: how many formations were considered, how many rebuilt, and optionally how many were reordered.

**Why it is here.** Reports what the surface rebuild touched; ``formations_reordered`` is optional so an older backend that did not reorder simply omits it.

.. CG-EXPLANATION-END id=interface:RebuildSurfacesResponse

``interface FormationSurfaceResponse``
--------------------------------------

.. CG-BLOCK id=interface:FormationSurfaceResponse lines=838-854

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 838-854
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FormationSurfaceResponse

**What this does.** One cached TIN surface for a (model, formation): ids, the build ``method``, a stale flag, the ``vertices`` (``[x, y, elevation]`` triples in the horizontal CRS) and ``triangles`` (vertex-index triples), the source contact count, and timestamps.

**Why it is here.** The additive shape for the geological surface cache — the geological counterpart of the litho body solid above; ``is_stale`` marks a TIN that no longer reflects the current contacts.

.. CG-EXPLANATION-END id=interface:FormationSurfaceResponse

``interface GapIssueResponse``
------------------------------

.. CG-BLOCK id=interface:GapIssueResponse lines=855-864

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 855-864
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GapIssueResponse

**What this does.** One validation issue: a ``kind``, a plain-text ``detail``, an optional ``depth_m``, the ``contact_ids`` involved, and the ``formation_ids`` populated for a formation-crossing.

**Why it is here.** The shared shape for both the gap validator and the crossing validator, so one issue type describes any structural problem the model check finds.

.. CG-EXPLANATION-END id=interface:GapIssueResponse

``interface CrossingValidationResponse``
----------------------------------------

.. CG-BLOCK id=interface:CrossingValidationResponse lines=865-870

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 865-870
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CrossingValidationResponse

**What this does.** The reply from the crossings validator: the ``model_id`` and the list of ``issues``.

**Why it is here.** The additive response shape reporting every crossing issue found, each as a ``GapIssueResponse``.

.. CG-EXPLANATION-END id=interface:CrossingValidationResponse

``interface GroundSurfaceBuildResponse``
----------------------------------------

.. CG-BLOCK id=interface:GroundSurfaceBuildResponse lines=871-884

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 871-884
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GroundSurfaceBuildResponse

**What this does.** The reply from the ground-surface build: the ``vertices`` and ``triangles`` of the ground TIN, the ``provider_id``, a ``from_cache`` flag, and any ``issues``.

**Why it is here.** The additive shape for the built ground surface; ``from_cache`` tells the caller whether the surface was freshly built or served from the cache, and the issues list carries any gaps found.

.. CG-EXPLANATION-END id=interface:GroundSurfaceBuildResponse

``interface LithoContactCorrelationEdge``
-----------------------------------------

.. CG-BLOCK id=interface:LithoContactCorrelationEdge lines=885-917

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 885-917
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoContactCorrelationEdge

**What this does.** One correlation edge joining two layers across a section: its id, the two layer ids and which side of each (``'top'`` or ``'base'``), the model and section ids, a source, a ``user_approved`` flag, an optional ``review_reason``, and a created timestamp.

**Why it is here.** The additive shape for a section-scoped correlation edge (#133 Phase 1). The docstring records that a base-to-base pair is a bottom-tie so the deepest unit can band (bottom-tie spec 2026-06-17), and that ``review_reason`` flags an edge a re-subdivide could not re-place — the tie is carried and flagged rather than deleted, because an accepted edge never disappears without the engineer deleting it.

.. CG-EXPLANATION-END id=interface:LithoContactCorrelationEdge

``interface ResolveInstancesResponse``
--------------------------------------

.. CG-BLOCK id=interface:ResolveInstancesResponse lines=918-926

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 918-926
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ResolveInstancesResponse

**What this does.** The reply from the correlation resolve: an ``updated`` list of ``{ formation_id, new_ordinal }`` pairs.

**Why it is here.** Reports which formations got a new instance ordinal after the resolve, so the caller can re-rank its instances from server truth.

.. CG-EXPLANATION-END id=interface:ResolveInstancesResponse

``interface CrossingPinchOut``
------------------------------

.. CG-BLOCK id=interface:CrossingPinchOut lines=927-934

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 927-934
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CrossingPinchOut

**What this does.** One pinch-out lens candidate inferred from a correlation crossing: the source investigation, the above and below contact ids, and the neighbour investigation.

**Why it is here.** The docstring records it is rendered as an amber lens-candidate marker on the section after Correlate — a suggestion the engineer confirms, not an auto-commit.

.. CG-EXPLANATION-END id=interface:CrossingPinchOut

``interface DeleteAutoCorrelationsResult``
------------------------------------------

.. CG-BLOCK id=interface:DeleteAutoCorrelationsResult lines=935-943

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 935-943
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DeleteAutoCorrelationsResult

**What this does.** The reply from deleting auto-generated correlations: a single ``deleted`` count.

**Why it is here.** Reports how many machine-made edges were removed so the caller can update its count and toast.

.. CG-EXPLANATION-END id=interface:DeleteAutoCorrelationsResult

``interface NameBodyRequest``
-----------------------------

.. CG-BLOCK id=interface:NameBodyRequest lines=944-951

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 944-951
   :lineno-match:

.. CG-EXPLANATION-START id=interface:NameBodyRequest

**What this does.** The request to name a body (``PATCH .../bodies/{id}``): the formation id, the body ordinal, the ``name``, and an optional primary section id.

**Why it is here.** The additive shape for naming a body (slice 5); the ordinal plus formation identify which body within its naming group the name attaches to.

.. CG-EXPLANATION-END id=interface:NameBodyRequest

``interface NameBodyResponse``
------------------------------

.. CG-BLOCK id=interface:NameBodyResponse lines=952-958

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 952-958
   :lineno-match:

.. CG-EXPLANATION-START id=interface:NameBodyResponse

**What this does.** The reply from naming a body: the ``body_id`` and a ``was_created`` flag.

**Why it is here.** The additive response shape; the comment notes the backend field is ``body_id`` (audit #3), and ``was_created`` distinguishes a fresh body row from a rename of an existing one.

.. CG-EXPLANATION-END id=interface:NameBodyResponse

``interface FormationAbsenceItem``
----------------------------------

.. CG-BLOCK id=interface:FormationAbsenceItem lines=959-970

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 959-970
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FormationAbsenceItem

**What this does.** One formation-absence record: its id, the formation id, the investigation id and kind (borehole or cpt), a source (inferred, manual or observed), and timestamps.

**Why it is here.** The shape for the explicit statement that a formation is absent at an investigation — a positive record, so the model can distinguish absence from not-yet-picked.

.. CG-EXPLANATION-END id=interface:FormationAbsenceItem

``interface UpsertFormationAbsenceRequest``
-------------------------------------------

.. CG-BLOCK id=interface:UpsertFormationAbsenceRequest lines=971-977

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 971-977
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UpsertFormationAbsenceRequest

**What this does.** The request to record an absence (``POST .../formations/{fid}/absences``): the investigation id and kind, and a source of ``'manual'`` or ``'observed'``.

**Why it is here.** The additive create shape for an absence; the source is limited to the two the engineer can assert (inferred is server-derived, not requested).

.. CG-EXPLANATION-END id=interface:UpsertFormationAbsenceRequest

``interface UpsertFormationAbsenceResponse``
--------------------------------------------

.. CG-BLOCK id=interface:UpsertFormationAbsenceResponse lines=978-987

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 978-987
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UpsertFormationAbsenceResponse

**What this does.** The reply from recording an absence: the ``absence_id`` and a ``was_created`` flag.

**Why it is here.** The additive response shape; ``was_created`` distinguishes a new absence from an idempotent re-assertion of an existing one.

.. CG-EXPLANATION-END id=interface:UpsertFormationAbsenceResponse

``interface BodyListItem``
--------------------------

.. CG-BLOCK id=interface:BodyListItem lines=988-1023

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 988-1023
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodyListItem

**What this does.** The full metadata for one body (formerly lens) in a litho model: ids, the ``body_ordinal``, the source investigation, an optional user ``name`` and primary section, the majority geological attribution (``geo_formation_id``/name) plus the full ``geo_formations`` list of everything it crosses, the ``parent_litho_body_id``, timestamps, and a ``content_key`` identity hash.

**Why it is here.** The additive shape returned by GET bodies. The comments record two debt #278 additions: ``geo_formations`` is a LIST because a body may span geological boundaries (R2), and ``parent_litho_body_id`` is the litho mass a geotech packing body was carved out of (D1) — the middle level of the geotech units pane's soil / litho body / packing body grouping. Both are optional and read as null on an old cached response.

.. CG-EXPLANATION-END id=interface:BodyListItem

``interface BodyBoundaryNode``
------------------------------

.. CG-BLOCK id=interface:BodyBoundaryNode lines=1024-1029

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1024-1029
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodyBoundaryNode

**What this does.** One control node on a body boundary, section-local: an ``along_m`` distance along the section and an ``elevation_m``.

**Why it is here.** The shape of a single hand-drawn boundary point; positions are along-section and elevation because a boundary is drawn on the section canvas.

.. CG-EXPLANATION-END id=interface:BodyBoundaryNode

``type BodyRenderStyle``
------------------------

.. CG-BLOCK id=type:BodyRenderStyle lines=1030-1032

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1030-1032
   :lineno-match:

.. CG-EXPLANATION-START id=type:BodyRenderStyle

**What this does.** A union naming how a body boundary is drawn: ``'straight'``, ``'blocky'`` or ``'rounded'``.

**Why it is here.** Lets the engineer pick the boundary's visual style, carried on the boundary shape so the section redraws it the chosen way.

.. CG-EXPLANATION-END id=type:BodyRenderStyle

``interface BodyBoundaryResponse``
----------------------------------

.. CG-BLOCK id=interface:BodyBoundaryResponse lines=1033-1043

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1033-1043
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodyBoundaryResponse

**What this does.** The reply for a body's boundary (``GET/PUT .../bodies/{id}/boundary``): the ``body_id``, its ``content_key``, the ``render_style``, the primary section id, and the ``upper_nodes`` and ``lower_nodes`` arrays.

**Why it is here.** The additive shape for a hand-shaped body boundary; the comment notes the backend field is ``body_id`` (audit #3), and the two node arrays hold the upper and lower boundary polylines the engineer drew.

.. CG-EXPLANATION-END id=interface:BodyBoundaryResponse

``interface ClearBoundariesResponse``
-------------------------------------

.. CG-BLOCK id=interface:ClearBoundariesResponse lines=1044-1061

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1044-1061
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ClearBoundariesResponse

**What this does.** The reply from Reset manual points (``DELETE .../models/{mid}/boundaries``): the number of hand-drawn boundary shapes removed.

**Why it is here.** Reports how many hand-shaped bodies were reset so the toast can name the count; one shape is removed per hand-shaped body.

.. CG-EXPLANATION-END id=interface:ClearBoundariesResponse

``interface BodySeparationResponse``
------------------------------------

.. CG-BLOCK id=interface:BodySeparationResponse lines=1062-1084

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1062-1084
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodySeparationResponse

**What this does.** The reply from the Separate verb (``POST .../body-separations``): the ``separation_id``, the model id, the canonically-ordered anchor pair, a ``was_created`` flag, a ``bodies_changed`` count, and the ``renamed`` list.

**Why it is here.** The docstring records a separation is a cannot-link constraint in layer-id space: the resolver drops any union that would merge the two anchors, so the bodies stay apart until an explicit Rejoin. Because the verb is reversible a duplicate is a 200 with the existing row (``was_created`` false), never a 409 (reversible-vs-irreversible rule).

.. CG-EXPLANATION-END id=interface:BodySeparationResponse

``interface BodySeparationAnchorInfo``
--------------------------------------

.. CG-BLOCK id=interface:BodySeparationAnchorInfo lines=1085-1102

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1085-1102
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodySeparationAnchorInfo

**What this does.** The server-resolved display info for one anchor of a separation: its layer id, the body it currently belongs to (or null), the body's name and ordinal (or null), and its formation id.

**Why it is here.** The docstring records the frontend labels the Rejoin item without owning a resolution map — the server reports each anchor's CURRENT body at request time, so the label always reflects the live partition.

.. CG-EXPLANATION-END id=interface:BodySeparationAnchorInfo

``interface BodySeparationListItem``
------------------------------------

.. CG-BLOCK id=interface:BodySeparationListItem lines=1103-1119

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1103-1119
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodySeparationListItem

**What this does.** One separation from the list endpoint: its id, the model id, the two layer anchors, both anchors' current-body display info, and a created timestamp.

**Why it is here.** The additive list shape; it carries both anchors' resolved info so the frontend can label the Rejoin-with item without resolving bodies itself.

.. CG-EXPLANATION-END id=interface:BodySeparationListItem

``interface BodySeparationRejoinResponse``
------------------------------------------

.. CG-BLOCK id=interface:BodySeparationRejoinResponse lines=1120-1139

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1120-1139
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodySeparationRejoinResponse

**What this does.** The reply from Rejoin (``DELETE .../body-separations/{sep_id}``): a ``bodies_changed`` count and the ``renamed`` list.

**Why it is here.** The docstring records that lifting the cannot-link lets the two anchors re-union if ties or geometry still connect them; the resolver re-runs in the same request, and the counts report what changed.

.. CG-EXPLANATION-END id=interface:BodySeparationRejoinResponse

``interface BodyUnionResponse``
-------------------------------

.. CG-BLOCK id=interface:BodyUnionResponse lines=1140-1177

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1140-1177
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodyUnionResponse

**What this does.** The reply from the Join-with verb (``POST .../body-unions``): the ``union_id``, the model id, the ordered anchor pair, a ``was_created`` flag, a ``bodies_changed`` count, the ``renamed`` list, and ``suppressed`` and ``inert`` flags.

**Why it is here.** The docstring records a union is a must-link constraint in layer-id space — the additive counterpart of Separate — so the engineer can state two bodies are the same even with no edge between them. It is reversible, so a duplicate answers 200 with ``was_created`` false. ``suppressed`` is true when a standing separation overruled the join (cannot-link wins) and ``inert`` when the anchors re-derive to different masses, so the toast can explain a written row that changed nothing.

.. CG-EXPLANATION-END id=interface:BodyUnionResponse

``interface BodyUnionAnchorInfo``
---------------------------------

.. CG-BLOCK id=interface:BodyUnionAnchorInfo lines=1178-1195

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1178-1195
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodyUnionAnchorInfo

**What this does.** The server-resolved display info for one anchor of a union: its layer id, the current body (or null), the body's name and ordinal (or null), and its formation id.

**Why it is here.** The docstring records it is structurally identical to the separation anchor info — the server reports each anchor's current body so the frontend can label the Disjoin item without a resolution map.

.. CG-EXPLANATION-END id=interface:BodyUnionAnchorInfo

``interface BodyUnionListItem``
-------------------------------

.. CG-BLOCK id=interface:BodyUnionListItem lines=1196-1213

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1196-1213
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodyUnionListItem

**What this does.** One union from the list endpoint: its id, the model id, the two layer anchors, both anchors' current-body display info, and a created timestamp.

**Why it is here.** The additive list shape carrying both anchors' resolved info so the frontend labels the Disjoin-with item without resolving bodies itself.

.. CG-EXPLANATION-END id=interface:BodyUnionListItem

``interface BodyUnionDisjoinResponse``
--------------------------------------

.. CG-BLOCK id=interface:BodyUnionDisjoinResponse lines=1214-1236

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1214-1236
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodyUnionDisjoinResponse

**What this does.** The reply from Disjoin (``DELETE .../body-unions/{union_id}``): a ``bodies_changed`` count, the ``renamed`` list, and counts of OTHER unions still ``suppressed_unions`` or ``inert_unions`` after the lift.

**Why it is here.** The docstring records that lifting the must-link lets the anchors fall back to whatever ties or geometry connect them (splitting where none do); the two extra counts report the state of the remaining unions after the resolve re-ran.

.. CG-EXPLANATION-END id=interface:BodyUnionDisjoinResponse

``interface SubdivideAllBodiesResponse``
----------------------------------------

.. CG-BLOCK id=interface:SubdivideAllBodiesResponse lines=1237-1325

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1237-1325
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SubdivideAllBodiesResponse

**What this does.** The large reply from geotech subdivide-all-bodies: the geotech model id, the created formation ids, layer/body counts, split-body and one-class and borehole-only counts, the section count, tie bookkeeping (reanchored, lost, and per-reason breakdowns with human-readable ``lost_tie_labels``, review reasons), an ``edges_derived`` flag with proposed-tie count, and the off-section skip count and labels.

**Why it is here.** The additive response shape for the model-wide subdivision. The comments record the design in detail: a rebuilt tie is re-created only when investigation, depth interval and NAD class all match (owner ruling 2026-08-01); ``lost_tie_labels`` names both investigations and their depth ranges because a count alone does not tell the engineer where to redraw (audit 2026-08-02); and the off-section pair stays on the wire as an audit trail but is deliberately NOT shown to the engineer (owner, 2026-08-15). Every added field is optional so an older backend parses.

.. CG-EXPLANATION-END id=interface:SubdivideAllBodiesResponse

``interface GeotechTieStatusResponse``
--------------------------------------

.. CG-BLOCK id=interface:GeotechTieStatusResponse lines=1326-1347

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1326-1347
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechTieStatusResponse

**What this does.** The reply from geotech tie-status: the geotech model id, the pending / accepted / flagged tie counts, and an optional ``pending_by_section`` map.

**Why it is here.** The docstring records this answers is there correlation work outstanding before the divide-boreholes gate returns a 422, so the toolbar can disable step 4 and say how much is left. ``pending_by_section`` is optional so an older backend degrades to the bare model total rather than a false zero (added 2026-08-15 with the section-scoped steps).

.. CG-EXPLANATION-END id=interface:GeotechTieStatusResponse

``interface StaleGeotechColumn``
--------------------------------

.. CG-BLOCK id=interface:StaleGeotechColumn lines=1348-1366

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1348-1366
   :lineno-match:

.. CG-EXPLANATION-START id=interface:StaleGeotechColumn

**What this does.** One column whose litho stack moved after its packing bands were made: the ``investigation_id`` and its display ``label``.

**Why it is here.** The small shape the staleness chip and toast name a stale column by, so the engineer knows exactly which CPT or borehole to re-press.

.. CG-EXPLANATION-END id=interface:StaleGeotechColumn

``interface GeotechLithoStalenessResponse``
-------------------------------------------

.. CG-BLOCK id=interface:GeotechLithoStalenessResponse lines=1367-1396

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1367-1396
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechLithoStalenessResponse

**What this does.** The reply from geotech litho-staleness: the geotech model id, its parent litho model id, the ``stale_columns`` list sorted by label, the stale count, the banded-column count, and the unstamped-column count.

**Why it is here.** The docstring records this is debt #266 — packing bands are derived from the litho stack and nothing used to link the two, so a dragged litho contact left the geotech axis drawing stale bands right into an export. It is derived on every read and clears itself when the named columns are re-pressed; ``unstamped_column_count`` is kept separate because unknown provenance is not evidence the ground moved, and an export guard must tell verified-current from cannot-say.

.. CG-EXPLANATION-END id=interface:GeotechLithoStalenessResponse

``interface DivideBoreholeResponse``
------------------------------------

.. CG-BLOCK id=interface:DivideBoreholeResponse lines=1397-1459

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1397-1459
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DivideBoreholeResponse

**What this does.** The reply from geotech divide-boreholes: the geotech model id, the divided and single-band borehole counts, the borehole layer count, the created formation ids, and the full tie bookkeeping (reanchored, review reasons, lost, superseded jump ties, deleted crossing spans).

**Why it is here.** The additive response shape; the docstring records DivideBoreholes is a standalone step after SubdivideAllBodies that materialises borehole bands via TIN interpolation. The comments explain the tie fields: re-dividing deletes every borehole band so a hand-drawn tie would vanish without re-anchoring, a borehole-mediated chain supersedes a CPT-to-CPT jump tie (owner ruling 2026-08-14), and a crossing tie with no possible hop is auto-deleted (owner ruling 2026-08-24). Fields are optional so a pre-field backend still parses.

.. CG-EXPLANATION-END id=interface:DivideBoreholeResponse

``interface DivideBoreholePreviewDonor``
----------------------------------------

.. CG-BLOCK id=interface:DivideBoreholePreviewDonor lines=1460-1470

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1460-1470
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DivideBoreholePreviewDonor

**What this does.** One CPT a previewed band's packing was read from: its ``name``, the ``side`` on the section (left/right, or nearest in the map-distance fallback), the along-section distance (or null), and the straight-line map distance.

**Why it is here.** The tooltip-provenance shape so the preview can show the engineer which CPT and how far away each planned band's class came from.

.. CG-EXPLANATION-END id=interface:DivideBoreholePreviewDonor

``interface DivideBoreholePreviewBand``
---------------------------------------

.. CG-BLOCK id=interface:DivideBoreholePreviewBand lines=1471-1494

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1471-1494
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DivideBoreholePreviewBand

**What this does.** One packing band the Divide-boreholes commit would write: its top and base depths below the collar, the NAD class 1-31, a source, a confidence, an optional ``mode`` naming which arm of the flanking-donor rule spoke, the ``donors`` list, and the section name.

**Why it is here.** The docstring records this comes from the same planner the commit runs, so a ghost drawn from it is a promise the button keeps; there is deliberately no ``body_id`` because body identity is re-resolved after the borehole edges exist. The class is labelled via ``nadClassName`` at the render boundary (translate-at-presentation rule).

.. CG-EXPLANATION-END id=interface:DivideBoreholePreviewBand

``interface DivideBoreholePreviewColumn``
-----------------------------------------

.. CG-BLOCK id=interface:DivideBoreholePreviewColumn lines=1495-1511

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1495-1511
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DivideBoreholePreviewColumn

**What this does.** Every planned band on one borehole column, top to bottom: the ``borehole_id``, its display ``name``, and the ``bands`` sorted by top depth.

**Why it is here.** Groups a borehole's previewed bands so the section can draw one column's worth of ghosts together.

.. CG-EXPLANATION-END id=interface:DivideBoreholePreviewColumn

``interface DivideBoreholePreviewResponse``
-------------------------------------------

.. CG-BLOCK id=interface:DivideBoreholePreviewResponse lines=1512-1543

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1512-1543
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DivideBoreholePreviewResponse

**What this does.** The reply from the divide-boreholes preview — a dry run that writes nothing: the geotech model id, the per-borehole ``columns``, the borehole count, the would-divide and single-band counts, the layer count, the carried-tie count, and the review and lost tie reason maps.

**Why it is here.** The docstring records the endpoint exists because Subdivide-all-bodies leaves every borehole column empty, so without a preview the engineer would have to press an idempotent-but-destructive rebuild blind to see what packing the boreholes get. Nothing is written.

.. CG-EXPLANATION-END id=interface:DivideBoreholePreviewResponse

``interface AutoCorrelateGeotechResponse``
------------------------------------------

.. CG-BLOCK id=interface:AutoCorrelateGeotechResponse lines=1544-1567

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1544-1567
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AutoCorrelateGeotechResponse

**What this does.** The reply from geotech auto-correlate: the number of ties proposed, optionally the number born accepted, the number skipped because an edge already existed, the sections processed, and the skip counts for no-shared-class and empty-stack.

**Why it is here.** The docstring records this is the standalone geotech counterpart of the litho auto-correlate — it proposes unapproved ties and never touches an existing correlation, so it is safe to press part-way through a manual session, unlike subdivide-all-bodies which rewrites the whole model. Restated litho ties are born accepted (owner refinement 2026-08-06).

.. CG-EXPLANATION-END id=interface:AutoCorrelateGeotechResponse

``interface GeotechBandIntervalItem``
-------------------------------------

.. CG-BLOCK id=interface:GeotechBandIntervalItem lines=1568-1603

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1568-1603
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechBandIntervalItem

**What this does.** One interval a hand split or merge would produce: its top and base depths, the deprecated ``median_qc_mpa``, the ``representative_qc_mpa`` under the model's chosen statistic, the re-derived ``nad_class``, the ``previous_nad_class``, a ``class_changed`` flag, and an ``unclassifiable_reason``.

**Why it is here.** The docstring records the class is DERIVED never carried (owner ruling 3, debt #227): after an edit each interval's NAD class is recomputed from the CPT qc over that interval, so it may differ from before and from both inputs of a merge. The comments require the UI to label the value representative qc rather than average qc, because a number computed with any other statistic would promise a reclassification that never happens (ruling 6).

.. CG-EXPLANATION-END id=interface:GeotechBandIntervalItem

``interface GeotechBandWarningItem``
------------------------------------

.. CG-BLOCK id=interface:GeotechBandWarningItem lines=1604-1617

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1604-1617
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechBandWarningItem

**What this does.** One advisory consequence of a hand edit: a ``code`` the UI switches on, a plain-language ``message`` authored server-side, the top and base depths it names, and the band id it names (or null).

**Why it is here.** The docstring records these are advisory and never blocking (owner ruling 5 — manual override always wins); the known codes describe things like qc being pulled up or down between layers, qc unavailable, or a below-minimum thickness.

.. CG-EXPLANATION-END id=interface:GeotechBandWarningItem

``interface GeotechBandEditPlanResponse``
-----------------------------------------

.. CG-BLOCK id=interface:GeotechBandEditPlanResponse lines=1618-1633

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1618-1633
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechBandEditPlanResponse

**What this does.** The preview of a proposed split, merge or move — no write: the ``kind``, the statistic every number used, the enclosing litho body's top and base as hard walls, the resulting ``intervals``, and the advisory ``warnings``.

**Why it is here.** The additive shape for a band-edit dry run; the parent top and base are the hard walls a hand edit cannot cross, and the intervals plus warnings let the engineer see the outcome before committing.

.. CG-EXPLANATION-END id=interface:GeotechBandEditPlanResponse

``interface GeotechBandEditResponse``
-------------------------------------

.. CG-BLOCK id=interface:GeotechBandEditResponse lines=1634-1671

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1634-1671
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechBandEditResponse

**What this does.** The result of a committed hand split, merge or move: the geotech model id, the single changed ``investigation_id``, the committed ``plan``, the resulting and created and deleted layer ids, the deleted edge ids and the accepted subset, the flagged edge ids, and the cleared edge ids.

**Why it is here.** The additive response shape; the comment records recalculation is local to one column (owner ruling 4). Since flag-not-drop (2026-08-07) accepted ties are never silently removed — a mismatch survives in ``flagged_edge_ids`` (violet badge) rather than being deleted, and ``cleared_edge_ids`` names ties a restored class match self-healed.

.. CG-EXPLANATION-END id=interface:GeotechBandEditResponse

``interface RestatedContactMoveResponse``
-----------------------------------------

.. CG-BLOCK id=interface:RestatedContactMoveResponse lines=1672-1695

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1672-1695
   :lineno-match:

.. CG-EXPLANATION-START id=interface:RestatedContactMoveResponse

**What this does.** The reply from a geotech contact move: it extends the band-edit response and adds the litho layer above and below whose boundary moved, and the geological contact carried with it (or null).

**Why it is here.** The docstring records the geotech half of the gesture IS a band move, so it reuses that response; what it adds is the answer to what else did I change — a restated contact is one boundary recorded in two or three models, and about a third are derived from a geological contact, so neither answer is a safe default and the engineer must be told which models the drag carried.

.. CG-EXPLANATION-END id=interface:RestatedContactMoveResponse

``interface ModelFootprintResponse``
------------------------------------

.. CG-BLOCK id=interface:ModelFootprintResponse lines=1696-1710

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1696-1710
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ModelFootprintResponse

**What this does.** The reply from the model footprint endpoint: the closed ``polygon`` ring of ``[x, y]`` points in the project CRS (without a repeated last vertex), the build ``generation_id``, its ``built_at`` timestamp, and an ``unavailable_reason`` when the polygon is empty.

**Why it is here.** The docstring records the ring is re-derived server-side from the persisted build payload so the viewer draws the build's OWN boundary, not a client approximation. It is never an error state: a model never built, one that does not frame an area, or one whose payload cannot be read all answer 200 with an empty polygon and a plain-English reason.

.. CG-EXPLANATION-END id=interface:ModelFootprintResponse

``interface GeotechStatisticResponse``
--------------------------------------

.. CG-BLOCK id=interface:GeotechStatisticResponse lines=1711-1718

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/geology.types.ts
   :language: typescript
   :lines: 1711-1718
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechStatisticResponse

**What this does.** The statistic state of a geotech model after a change: the ``representative_statistic`` now stored, what the last full subdivide ``classified_with_statistic`` (null before any build), and a ``bands_stale`` flag.

**Why it is here.** The additive shape for rulings 7+8; ``bands_stale`` is true when the chosen statistic differs from the last build's stamp, telling the engineer a re-subdivide is due.

.. CG-EXPLANATION-END id=interface:GeotechStatisticResponse

