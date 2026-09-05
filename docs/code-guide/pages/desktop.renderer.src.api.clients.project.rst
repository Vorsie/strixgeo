desktop.renderer.src.api.clients.project
========================================

.. CG-PAGE source=desktop/src/renderer/src/api/clients/project.ts complete=true

*Source file:* ``desktop/src/renderer/src/api/clients/project.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/project.ts
   :language: typescript
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and imports for the project client — the typed calls for the ``/projects/*`` endpoints and the per-investigation review sub-resource (create, edit, archive, duplicate, bundle get and restore, view-state edit, review upsert). It imports the shared HTTP helpers and, type-only, the shape of the stratigraphy-lumping snapshot.

**Why it is here.** The comment explains the lumping shape is imported as a type only, never as runnable code, so this module keeps no run-time dependency on the utils layer. Every call goes through the shared ``request`` helper introduced on the ``desktop.renderer.src.api.clients.shared`` page.

.. CG-EXPLANATION-END id=module-header

``type ProjectPhase``
---------------------

.. CG-BLOCK id=type:ProjectPhase lines=23-25

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/project.ts
   :language: typescript
   :lines: 23-25
   :lineno-match:

.. CG-EXPLANATION-START id=type:ProjectPhase

**What this does.** Names the four allowed project phases: feasibility, design, construction, monitoring.

**Why it is here.** Fixing the set catches a stray phase value before the app runs.

.. CG-EXPLANATION-END id=type:ProjectPhase

``type ProjectStatus``
----------------------

.. CG-BLOCK id=type:ProjectStatus lines=26-28

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/project.ts
   :language: typescript
   :lines: 26-28
   :lineno-match:

.. CG-EXPLANATION-START id=type:ProjectStatus

**What this does.** Names the three allowed project statuses: active, on hold, completed.

**Why it is here.** Fixing the set catches a stray status value before the app runs.

.. CG-EXPLANATION-END id=type:ProjectStatus

``interface ProjectResponse``
-----------------------------

.. CG-BLOCK id=interface:ProjectResponse lines=29-78

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/project.ts
   :language: typescript
   :lines: 29-78
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ProjectResponse

**What this does.** Describes the full project metadata answer: identity and labels, tags, the default coordinate systems, phase and status, archive and timestamp fields, the view-state preferences bag, and the three stratigraphy-lumping fields.

**Why it is here.** The comments carry several rules: phase and status are kept as loose strings for forward-compatibility; the view-state bag is schema-less on the server so each consumer narrows the keys it cares about; the lumping ``staged`` and ``saved`` slots are the durable home of the two-stage save model, where ``staged`` differing from ``saved`` is the same dirty signal the renderer derives in memory (``docs/design/autosave-recovery.md``); and the revision is a renderer-owned counter that crash-recovery compares instead of wall-clocks. The lumping fields are optional, mirroring the additive-only stance — a response serialised before the columns existed carries none of them, so every read site handles the null case.

.. CG-EXPLANATION-END id=interface:ProjectResponse

``interface ProjectBundleResponse``
-----------------------------------

.. CG-BLOCK id=interface:ProjectBundleResponse lines=79-125

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/project.ts
   :language: typescript
   :lines: 79-125
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ProjectBundleResponse

**What this does.** Describes the whole project bundle: a format version, the project row, every CPT with its series, every borehole with its child tree, and the geological, litho, section, review, correlation, body, absence, tombstone, separation and union rows.

**Why it is here.** The docstring says the renderer never inspects the row shapes — the data dictionaries are opaque and round-trip unchanged — which is why they are typed loosely. The comments mark the newer collections as absent in older bundles (additive-only) and stress that several are evidence, not cache: dropping the deleted-tie tombstones, separations or unions would resurrect every tie, split or join the engineer had deliberately made on the next derivation.

.. CG-EXPLANATION-END id=interface:ProjectBundleResponse

``interface ProjectCreatePayload``
----------------------------------

.. CG-BLOCK id=interface:ProjectCreatePayload lines=126-139

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/project.ts
   :language: typescript
   :lines: 126-139
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ProjectCreatePayload

**What this does.** Describes the body for creating a project: a required name and the optional labels, tags, coordinate systems, phase and status.

**Why it is here.** Only the name is required; the optional fields mirror the additive-only backend schema.

.. CG-EXPLANATION-END id=interface:ProjectCreatePayload

``interface ProjectUpdatePayload``
----------------------------------

.. CG-BLOCK id=interface:ProjectUpdatePayload lines=140-157

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/project.ts
   :language: typescript
   :lines: 140-157
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ProjectUpdatePayload

**What this does.** Describes the body for editing a project: every field optional, so a caller sends only what it is changing.

**Why it is here.** All-optional matches a partial edit — an absent field means leave it unchanged.

.. CG-EXPLANATION-END id=interface:ProjectUpdatePayload

``type ReviewTargetKind``
-------------------------

.. CG-BLOCK id=type:ReviewTargetKind lines=158-160

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/project.ts
   :language: typescript
   :lines: 158-160
   :lineno-match:

.. CG-EXPLANATION-START id=type:ReviewTargetKind

**What this does.** Names what an investigation review can point at: a CPT or a borehole.

**Why it is here.** Fixing the two kinds lets the review sub-resource address either investigation type by the same shape.

.. CG-EXPLANATION-END id=type:ReviewTargetKind

``type ReviewStatus``
---------------------

.. CG-BLOCK id=type:ReviewStatus lines=161-169

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/project.ts
   :language: typescript
   :lines: 161-169
   :lineno-match:

.. CG-EXPLANATION-START id=type:ReviewStatus

**What this does.** Names the three review states: unreviewed, in progress, reviewed.

**Why it is here.** Fixing the set catches a stray status before the app runs.

.. CG-EXPLANATION-END id=type:ReviewStatus

``interface InvestigationReviewResponse``
-----------------------------------------

.. CG-BLOCK id=interface:InvestigationReviewResponse lines=170-183

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/project.ts
   :language: typescript
   :lines: 170-183
   :lineno-match:

.. CG-EXPLANATION-START id=interface:InvestigationReviewResponse

**What this does.** Describes one per-investigation review row: its ids, the target kind and id, the review status and notes, the reviewed timestamp, whether it is hidden, and its timestamps.

**Why it is here.** The docstring says it drives the sidebar's project-local hide (``is_hidden``) and, later, the reviewed-state filter, and that it rides in the project bundle on save and is restored on open — an engineering decision persisted in the bundle, not local screen chrome.

.. CG-EXPLANATION-END id=interface:InvestigationReviewResponse

``interface InvestigationReviewUpsertPayload``
----------------------------------------------

.. CG-BLOCK id=interface:InvestigationReviewUpsertPayload lines=184-195

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/project.ts
   :language: typescript
   :lines: 184-195
   :lineno-match:

.. CG-EXPLANATION-START id=interface:InvestigationReviewUpsertPayload

**What this does.** Describes the body for setting a review: an optional status, notes, and hidden flag.

**Why it is here.** All-optional so a caller can set just one of the three without disturbing the others.

.. CG-EXPLANATION-END id=interface:InvestigationReviewUpsertPayload

``interface ProjectRestoreResponse``
------------------------------------

.. CG-BLOCK id=interface:ProjectRestoreResponse lines=196-205

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/project.ts
   :language: typescript
   :lines: 196-205
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ProjectRestoreResponse

**What this does.** Describes the restore answer: a full project response plus two counts of rows the restore's size caps had to drop.

**Why it is here.** The docstring notes both counts are zero when nothing was dropped, and a non-zero count is worth a toast telling the engineer some over-large depth-series or child rows were capped on open.

.. CG-EXPLANATION-END id=interface:ProjectRestoreResponse

``const projectClient``
-----------------------

.. CG-BLOCK id=const:projectClient lines=206-284

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/project.ts
   :language: typescript
   :lines: 206-284
   :lineno-match:

.. CG-EXPLANATION-START id=const:projectClient

**What this does.** The object of typed calls for the ``/projects/*`` endpoints: fetch, create, edit, archive or duplicate a project; get the full bundle; restore from a bundle; edit the view-state; and the two stratigraphy-lumping calls (stage and promote).

**Why it is here.** Every call goes through the shared ``request`` helper introduced on the ``desktop.renderer.src.api.clients.shared`` page. The comments carry the design: the bundle drops the cached 3-D meshes by default because the project file never stores them and pulling megabytes of vertices slowed saving; restore is idempotent and can replace a project's children exactly for a revert-to-last-save; view-state is shallow-merged; and the two lumping calls are the halves of the two-stage save — staging writes the ``staged`` slot and rejects a lower revision with 409 so a stale writer cannot roll the map back, while promote copies ``staged`` onto ``saved`` on File → Save, which is what makes the two match and read clean right after a save.

.. CG-EXPLANATION-END id=const:projectClient

``const reviewClient``
----------------------

.. CG-BLOCK id=const:reviewClient lines=285-297

.. literalinclude:: ../../../desktop/src/renderer/src/api/clients/project.ts
   :language: typescript
   :lines: 285-297
   :lineno-match:

.. CG-EXPLANATION-START id=const:reviewClient

**What this does.** The object of typed calls for the review sub-resource: list a project's reviews, or create-or-update the review for one investigation.

**Why it is here.** Both go through the shared ``request`` helper introduced on the ``desktop.renderer.src.api.clients.shared`` page, wired under ``api.review``.

.. CG-EXPLANATION-END id=const:reviewClient

