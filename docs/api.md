# API Endpoints

Additive-only contract — see CLAUDE.md "Backwards Compatibility" for the deprecation cycle when fields must be removed or repurposed. The frontend always goes through the API — never directly to domain or DB.

```
POST   /cpt/import              Import a GEF file (multipart form; project_id form field)
POST   /cpt/import-dov          Import CPTs from DOV bbox (JSON body: west,south,east,north,project_id).
                                Synchronous — waits for the full import to complete. For large
                                bboxes use the streaming variant below.
POST   /cpt/import-dov/stream   Async SSE variant. Returns ``202 Accepted``
                                with ``{job_id}``. Connect to
                                ``GET /cpt/import-dov/stream/{job_id}``
                                to receive ``text/event-stream`` progress frames
                                (``data: <json>\n\n``). Each frame carries
                                phase, count, total, and status fields.
                                Same import semantics as the synchronous
                                endpoint but keeps the connection alive for
                                the DOV download + parse phase.
GET    /cpt/import-dov/stream/{job_id}
                                Drain a CPT import job's SSE event queue.
                                Closes when the job completes or errors.
GET    /cpt/                    List CPTs (optional ?project_id=UUID filters by project)
GET    /cpt/{id}                CPT metadata (location, elevation, cone props, summary).
                                Requires ``?project_id=UUID`` — the CPT must
                                belong to that project, else 404 (VULN-1
                                cross-project id enumeration guard).
GET    /cpt/{id}/plot           Depth-series arrays for plotting (depths, qc, fs, u2, rf, qt).
                                Requires ``?project_id=UUID`` (VULN-4).
DELETE /cpt/{id}                Delete CPT and its series (cascade). NOTE: the
                                desktop frontend no longer calls this — sidebar
                                "remove from project" is project-local
                                (localStorage), preserving the DB cache so a
                                re-import doesn't refetch.
                                Requires ``?project_id=UUID`` (VULN-3).
PATCH  /cpt/{id}/elevation      Phase 3a manual surface-elevation editor.
                                JSON body: ``{elevation_m: float | null,
                                z_epsg?: int | null}``. ``elevation_m: null``
                                clears a previously-entered value. When
                                ``z_epsg`` is omitted, the canonical vertical
                                datum for the row's horizontal CRS is used
                                (31370 → 5710 mTAW for BE; 28992 → 5709 NAP
                                for NL — see ``infrastructure/codelists/
                                vertical_crs.py``). Returns the full
                                ``CptResponse`` so the frontend can patch its
                                detail cache without a second GET. 404 when
                                the id is unknown or belongs to a different
                                project. Requires ``?project_id=UUID``
                                (VULN-2).

POST   /borehole/import-dov     Import boreholes + 8 interpretation streams + samples
                                + grain-size + Atterberg + CaCO3 + organic-C + water-content
                                + the ScalarLabTest catch-all from DOV bbox
                                (Phase C1+C2+C3+C4+C5). Synchronous. Response
                                carries per-test attached/failed counters; the
                                catch-all reports under
                                ``scalar_lab_tests_attached / _failed``.
POST   /borehole/import-dov/stream
                                Async SSE variant of ``/borehole/import-dov``.
                                Returns ``202 Accepted`` with ``{job_id}``.
                                Connect to
                                ``GET /borehole/import-dov/stream/{job_id}``
                                for ``text/event-stream`` progress frames.
                                Same semantics + same counters in the final
                                frame.
GET    /borehole/import-dov/stream/{job_id}
                                Drain a borehole import job's SSE event queue.
                                Closes when the job completes or errors.
GET    /borehole/{id}           Full borehole tree (header + drill segments + field log
                                + observations with layers + admixtures + samples with
                                grain-size + Atterberg + CaCO3 + organic + water-content
                                + the ``scalar_lab_tests`` catch-all list). 404 when
                                missing or belongs to a different project.
                                Requires ``?project_id=UUID`` (VULN-6 cross-project
                                id enumeration guard).
                                Optional ``?include=`` query parameter scopes the
                                per-sample lab-test families that get eager-loaded
                                (debt #2): comma-separated aliases from
                                {``grain_size``, ``atterberg``, ``caco3``,
                                ``organic``, ``water_content``, ``scalar``}.
                                Default (no ``?include=``) loads every family. Unrequested
                                families come back as empty lists, so the JSON shape is
                                unchanged — existing clients keep working.
PATCH  /borehole/{id}/elevation Mirror of ``PATCH /cpt/{id}/elevation`` — same
                                request body. Returns the lightweight
                                ``BoreholeListItem`` shape so the frontend can
                                refresh the sidebar badge without re-fetching
                                the heavy detail tree. Requires ``?project_id=UUID``
                                (VULN-7).

GET    /projects/               List active projects, most-recent first.
                                Optional ``?include_archived=true`` returns
                                both active and archived in one query.
GET    /projects/archived       List only archived projects (the
                                "Archived projects" view).
POST   /projects/               Create a new project. Body matches
                                ``ProjectCreateRequest`` — ``name`` is
                                required; everything else (project_number,
                                client, site_label, description, tags,
                                default CRSes, phase, status) optional.
                                Returns the full ``ProjectResponse``.
GET    /projects/{id}           Project detail (returns archived rows too).
PATCH  /projects/{id}           Partial update. Only fields present in the
                                JSON body are written; null clears optional
                                fields. ``name`` and ``status`` are NOT NULL
                                in the DB — sending null for either returns
                                400.
POST   /projects/{id}/archive   Soft-delete (stamps ``archived_at``).
                                Project + all its data preserved in the DB.
POST   /projects/{id}/unarchive Restore (clears ``archived_at``).
GET    /projects/{id}/bundle    Full project snapshot — metadata + every
                                CPT (with series) + every borehole (with
                                full child tree) + geological models with
                                contacts/litho_layers + correlation edges
                                + bodies + formation absences + boundary
                                shapes. Embedded verbatim in .gmproj v4
                                files on save. The frontend's
                                ``PROJECT_FILE_FORMAT_VERSION`` is 3
                                (outer file wrapper); the bundle payload
                                inside is the v4 shape. Backend supports
                                restore from v3 and v4 bundles.
POST   /projects/{id}/restore   Idempotently materialise a project + its
                                CPTs + boreholes + geology from a bundle
                                when the DB has lost the rows (wiped
                                local DB, fresh install). Body matches the
                                bundle shape (v3 or v4); id is in the
                                URL. Existing rows are returned / skipped
                                (no mutation); missing rows are inserted
                                with the supplied ids. After restore,
                                runs ResolveLithoInstances +
                                DetectLithoLenses per litho model to
                                reconcile any stale lens rows from older
                                bundles. Always 200.

POST   /projects/{pid}/geology/formations           Create a formation.
GET    /projects/{pid}/geology/formations           List project formations
                                                    (display order, then name).
PATCH  /projects/{pid}/geology/formations/{fid}     Partial update.
DELETE /projects/{pid}/geology/formations/{fid}     Cascade-removes every
                                                    contact pointing at it,
                                                    plus every geotechnical
                                                    unit hanging off it.

POST   /projects/{pid}/geology/formations/{fid}/units
                                                    Create a geotechnical unit
                                                    under a formation. Structure
                                                    only in v1 (name / code /
                                                    color / display_order /
                                                    description) — parameter
                                                    values are Phase 5.
GET    /projects/{pid}/geology/formations/{fid}/units
                                                    List units under the
                                                    formation (display order,
                                                    then name).
PATCH  /projects/{pid}/geology/formations/{fid}/units/{uid}
                                                    Partial update. Parent
                                                    formation_id NOT updatable —
                                                    delete + recreate to
                                                    re-parent.
DELETE /projects/{pid}/geology/formations/{fid}/units/{uid}
                                                    Delete a geotechnical unit.

POST   /projects/{pid}/geology/models               Create a model.
GET    /projects/{pid}/geology/models               List models (active first).
PATCH  /projects/{pid}/geology/models/{mid}         Partial update.
                                                    is_active NOT updatable
                                                    here — use /activate.
POST   /projects/{pid}/geology/models/{mid}/activate
                                                    Mark active; clear flag on
                                                    every sibling.
DELETE /projects/{pid}/geology/models/{mid}         Cascade-removes contacts.

POST   /projects/{pid}/geology/models/{mid}/contacts
                                                    Add a formation top at an
                                                    investigation. Exactly one
                                                    of borehole_id / cpt_id
                                                    must be set (XOR enforced
                                                    at API + DB layers).
GET    /projects/{pid}/geology/models/{mid}/contacts
                                                    List contacts. Optional
                                                    ?borehole_id and
                                                    ?formation_id filters.
                                                    Sorted shallowest-first.
PATCH  /projects/{pid}/geology/models/{mid}/contacts/{cid}
                                                    Update depth / formation /
                                                    notes / anchor. Anchor
                                                    (borehole_id + cpt_id) IS
                                                    updatable — the section
                                                    editor's drag-re-anchor
                                                    flow uses it. BOTH anchor
                                                    fields must be sent
                                                    together when either
                                                    changes (one of them
                                                    null); partial anchor
                                                    updates are 422 at the
                                                    schema layer.
DELETE /projects/{pid}/geology/models/{mid}/contacts/{cid}
POST   /projects/{pid}/geology/models/{mid}/contacts/auto-populate
                                                    Seed the model with
                                                    contacts derived from
                                                    each borehole's
                                                    stratigraphy observation
                                                    (FORMAL_STRATIGRAPHY
                                                    preferred, falls through
                                                    to INFORMAL_STRATIGRAPHY
                                                    only when no formal
                                                    exists). Body:
                                                    {borehole_ids:[uuid,...]}
                                                    (1..500). Auto-creates
                                                    formations whose name
                                                    matches the layer
                                                    description (case-
                                                    insensitive); skips
                                                    surface layers
                                                    (top_m == 0); skips
                                                    layers already used
                                                    (idempotent via
                                                    observation_layer_id).
                                                    Returns created counts
                                                    + ids + skip breakdown
                                                    (existing / unmatched /
                                                    no-stratigraphy).
PUT    /projects/{pid}/geology/models/{mid}/contacts/batch
                                                    All-or-nothing batch
                                                    update for N contacts.
                                                    Body: {updates: [{
                                                    contact_id, depth_top_m?,
                                                    borehole_id?, cpt_id?,
                                                    source?, confidence?,
                                                    notes?}]}. Same XOR rule
                                                    per entry as the single
                                                    PATCH. Used by the
                                                    section editor's multi-
                                                    drag + cross-column re-
                                                    anchor flows; one
                                                    transaction commits the
                                                    whole list. Min 1 / max
                                                    500 entries (422). Any
                                                    contact missing or out
                                                    of model scope → 404
                                                    with no mutations.

GET    /projects/{pid}/geology/models/{mid}/boreholes/{bid}/validate
                                                    No-gaps validator. Returns
                                                    a list of GapIssue. Empty
                                                    list = clean stratigraphy.
                                                    Issue kinds:
                                                    missing_surface_contact,
                                                    duplicate_depth,
                                                    contact_below_test,
                                                    no_contacts. Each issue
                                                    carries optional
                                                    ``contact_ids`` /
                                                    ``formation_ids`` arrays
                                                    so the editor can
                                                    highlight the offenders.

GET    /projects/{pid}/geology/models/{mid}/validate/crossings
                                                    Cross-formation validator.
                                                    Walks every cached TIN
                                                    pair (older, younger) and
                                                    flags any (x, y) where
                                                    the younger formation's
                                                    surface dips below the
                                                    older's — a violation of
                                                    the stratigraphic-order
                                                    superposition rule
                                                    (lower display_order =
                                                    older). Issue kind:
                                                    ``formation_crossing``;
                                                    ``formation_ids`` carries
                                                    ``[older_id, younger_id]``
                                                    and ``depth_m`` carries
                                                    the worst Δ-elevation in
                                                    metres. Empty list = all
                                                    surfaces stack consistently.
                                                    1 cm tolerance absorbs
                                                    interpolation + survey
                                                    noise.

GET    /projects/{pid}/geology/models/{mid}/surfaces
                                                    List the cached TIN
                                                    formation surfaces for
                                                    the model. One row per
                                                    formation that has at
                                                    least one anchor with a
                                                    known elevation. On-click
                                                    build: surfaces only land
                                                    after the user clicks
                                                    Build (POST /rebuild) —
                                                    contact mutations flip
                                                    ``is_stale=true`` instead
                                                    of recomputing. Each row
                                                    carries ``is_stale: bool``
                                                    so the section consumer
                                                    can render stale TINs at
                                                    a demoted style. Vertices
                                                    are [x, y, elevation] in
                                                    the project's horizontal
                                                    CRS; triangles are
                                                    integer triplets indexing
                                                    vertices. Empty list when
                                                    nothing has been picked
                                                    + built. Bundle round-
                                                    trips the cache + the
                                                    is_stale flag; restore
                                                    force-stales any surface
                                                    whose source_contact_count
                                                    drifted from the live
                                                    contacts.
POST   /projects/{pid}/geology/models/{mid}/surfaces/rebuild?method=tin
                                                    PRIMARY build path —
                                                    materialise every
                                                    formation's TIN from
                                                    its current contacts.
                                                    Empty body. The
                                                    InterpretationPane's
                                                    "Build model" button +
                                                    File → Save's auto-fire
                                                    both call this. Clears
                                                    ``is_stale`` on every
                                                    successful upsert; per-
                                                    contact mutations no
                                                    longer auto-recompute
                                                    (on-click build pivot).
                                                    Optional ``?method`` query
                                                    param scaffolds for
                                                    Phase 5+ kriging / RBF /
                                                    GemPy; v1 enforces
                                                    ``method=tin`` via
                                                    pattern. Unknown method
                                                    → 422. Idempotent — the
                                                    checksum short-circuit
                                                    skips the Delaunay run
                                                    when no contacts changed
                                                    since the last build but
                                                    still clears a lingering
                                                    is_stale flag (e.g. a
                                                    PATCH that round-tripped
                                                    to the same depth).
                                                    Response:
                                                    ``{formations_considered,
                                                    formations_rebuilt}`` —
                                                    the second is the subset
                                                    whose cache write actually
                                                    fired. On a clean model
                                                    both are 0. 404 when the
                                                    model isn't in this
                                                    project.
GET    /projects/{pid}/geology/models/{mid}/export/plaxis3d
                                                    Export the geological
                                                    model as a runnable
                                                    Plaxis 3D plxscripting
                                                    Python script (v1.0
                                                    MVP gate; Plaxis target
                                                    decided 2026-05-14).
                                                    Emits one soilmat
                                                    (Mohr-Coulomb placeholder)
                                                    per formation, one
                                                    global soillayer in
                                                    stratigraphic order
                                                    (display_order DESC =
                                                    youngest first = Plaxis
                                                    layer 0), one borehole
                                                    per investigation with
                                                    elevation, and a
                                                    setsoillayerlevel call
                                                    per (borehole, layer).
                                                    Investigations without
                                                    elevation_m are dropped
                                                    upstream of the script
                                                    with a logged warning.
                                                    ``text/x-python`` body
                                                    with a
                                                    ``Content-Disposition``
                                                    header naming the
                                                    project. 404 when the
                                                    model / project
                                                    resolution fails.

POST   /projects/{pid}/geology/models/{mid}/correlations
                                                    Create a litho-correlation
                                                    edge between two formations
                                                    in the same model. Body:
                                                    ``{formation_a_id,
                                                    formation_b_id, source}``.
                                                    Canonical ordering
                                                    (formation_a_id <
                                                    formation_b_id in UUID
                                                    lex) enforced at write;
                                                    duplicate edges return
                                                    the existing edge's id
                                                    (idempotent). 404 when
                                                    either formation is not
                                                    in the model. 422 when
                                                    formation_a_id ==
                                                    formation_b_id (self-loop).
                                                    Shipped in Slice 1.
GET    /projects/{pid}/geology/models/{mid}/correlations
                                                    List all litho-correlation
                                                    edges for the model,
                                                    ordered by created_at.
                                                    Each item: ``{id,
                                                    formation_a_id,
                                                    formation_b_id, source,
                                                    created_at}``. Empty
                                                    list when no edges exist.
                                                    Project-scope-guarded —
                                                    404 when model ∉ project.
                                                    No section_id parameter
                                                    (structural #57 guard).
                                                    Shipped in Slice 3.
DELETE /projects/{pid}/geology/models/{mid}/correlations/{cid}
                                                    Remove one edge. 404 when
                                                    edge missing or ∉ model.
                                                    Shipped in Slice 1.
POST   /projects/{pid}/geology/models/{mid}/correlations/resolve
                                                    Re-run the BFS instance-
                                                    ordinal resolver for the
                                                    model's litho formations.
                                                    Idempotent — running twice
                                                    on the same graph yields
                                                    the same ordinals. Assigns
                                                    a 1-based ordinal per
                                                    connected component
                                                    (body 1, body 2, …);
                                                    locked formations
                                                    (instance_ordinal_locked)
                                                    keep their current ordinal
                                                    unless they lose a conflict.
                                                    Response:
                                                    ``{updated: [{formation_id,
                                                    new_ordinal}]}`` — only
                                                    rows whose ordinal changed.
                                                    Stale surface flags on the
                                                    model are set when any
                                                    ordinal changes (ordinal
                                                    re-number = model changed).
                                                    Project-scope-guarded — 404
                                                    when model ∉ project. No
                                                    section_id parameter
                                                    (structural #57 guard).
                                                    Shipped in Slice 3.

GET    /projects/{pid}/geology/models/{mid}/layers
                                                    List litho_layer rows for
                                                    a lithostratigraphic model.
                                                    Optional filters:
                                                    ``borehole_id``,
                                                    ``cpt_id``,
                                                    ``formation_id``,
                                                    ``status`` (pending /
                                                    accepted / rejected).
                                                    Sorted shallowest-first.
POST   /projects/{pid}/geology/models/{mid}/layers
                                                    Bulk-create litho_layer rows
                                                    from a segmenter result (CPT
                                                    Robertson-SBT or borehole
                                                    ObservationLayer). Replaces
                                                    existing pending layers for
                                                    the same anchor.
PATCH  /projects/{pid}/geology/models/{mid}/layers/{lid}
                                                    Update a single layer
                                                    (depth_top_m, depth_base_m,
                                                    formation_id, status,
                                                    admixtures).
POST   /projects/{pid}/geology/models/{mid}/layers/{lid}/move-boundary
                                                    Move a shared boundary
                                                    between two adjacent layers
                                                    atomically.
PATCH  /projects/{pid}/geology/models/{mid}/layers/{lid}/status
                                                    Accept or reject a single
                                                    pending layer.
POST   /projects/{pid}/geology/models/{mid}/layers/batch-update
                                                    Batch status update (accept
                                                    or reject) for N layers.
DELETE /projects/{pid}/geology/models/{mid}/layers/{lid}
                                                    Delete one layer row.
PATCH  /projects/{pid}/geology/models/{mid}/layers/{lid}/geo-contact
                                                    Couple / uncouple a litho
                                                    layer to a geological
                                                    formation contact
                                                    (``parent_geo_contact_id``
                                                    FK; snap + propagation).

POST   /projects/{pid}/geology/models/{mid}/contacts/suggest-litho
                                                    Run the Robertson-SBT CPT
                                                    segmenter (or borehole
                                                    ObservationLayer reader)
                                                    for one anchor; returns
                                                    ephemeral ghost-layer
                                                    candidates.  Writes
                                                    ``pending`` litho_layer
                                                    rows as a side-effect.
POST   /projects/{pid}/geology/models/{mid}/contacts/accept-litho-suggestions
                                                    Accept a set of ghost
                                                    suggestion layers for one
                                                    anchor.  Creates
                                                    formation_contact rows
                                                    (find-or-create per
                                                    formation), runs straddle-
                                                    split if a contact spans
                                                    a geological boundary,
                                                    seeds the section, runs
                                                    inference. Returns
                                                    AcceptLithoSuggestionsResponse.
POST   /projects/{pid}/geology/models/{mid}/contacts/batch-accept-litho-suggestions
                                                    Batch variant — accepts
                                                    all anchors in one
                                                    transaction + single
                                                    inference recompute.
                                                    N+2 calls → 1 call / 3
                                                    commits.
DELETE /projects/{pid}/geology/models/{mid}/contacts/clear-litho
                                                    Delete all litho_layer rows
                                                    for the model and prune
                                                    the section's
                                                    seeded_formation_contact_ids
                                                    GC sweep.
POST   /projects/{pid}/geology/models/{mid}/contacts/seed-litho
                                                    Seed litho_layer rows from
                                                    the parent geological model's
                                                    formation contacts (initial
                                                    state for the litho axis).

POST   /projects/{pid}/geology/models/{mid}/contact-correlations
                                                    Create (or confirm) a
                                                    contact-level correlation
                                                    edge between two litho_layer
                                                    rows. Returns 201 when new,
                                                    200 when existing.
DELETE /projects/{pid}/geology/models/{mid}/contact-correlations/{cid}
                                                    Remove one edge.
GET    /projects/{pid}/geology/models/{mid}/contact-correlations
                                                    List all edges for the model.
POST   /projects/{pid}/geology/models/{mid}/contact-correlations/auto-correlate
                                                    Run the section-order
                                                    auto-correlate algorithm:
                                                    groups same-lithology
                                                    contacts by adjacency +
                                                    depth window along the
                                                    section, creates edges.
POST   /projects/{pid}/geology/models/{mid}/contact-correlations/accept
                                                    Promote pending edges to
                                                    approved.
POST   /projects/{pid}/geology/models/{mid}/contact-correlations/uncorrelate
                                                    Remove an edge by its two
                                                    endpoint contact ids.

POST   /projects/{pid}/geology/models/{mid}/lenses/detect
                                                    Explicit "Detect bodies"
                                                    verb — materialises BodyOrm
                                                    rows for bilateral-closure
                                                    topologies. Idempotent.

POST   /projects/{pid}/sections             Create a cross-section (line
                                            endpoints + projection buffer
                                            + view prefs). 422 when the
                                            endpoints coincide. 400 when
                                            ``epsg`` is not a supported
                                            projected metric CRS (debt
                                            #31 — degrees would yield
                                            garbage along-distance); the
                                            DXF + Plaxis 2D exports apply
                                            the same guard defensively.
GET    /projects/{pid}/sections             List sections, display_order
                                            then name.
GET    /projects/{pid}/sections/{sid}       Fetch one.
PATCH  /projects/{pid}/sections/{sid}       Partial update. Post-update
                                            distinct-endpoints invariant
                                            re-checked at the API layer.
DELETE /projects/{pid}/sections/{sid}       Delete a section.
GET    /projects/{pid}/sections/{sid}/export/dxf
                                            Stream the section's drawn
                                            geological model as a DXF file
                                            (v1.0 MVP gate #5). Query param
                                            ``model_id`` selects which
                                            geological model's contacts to
                                            include. Per-formation polylines
                                            + per-investigation columns +
                                            title block. ``application/dxf``
                                            body with a
                                            ``Content-Disposition`` header
                                            naming the section. 404 when the
                                            section / model / project
                                            resolution fails.
GET    /projects/{pid}/sections/{sid}/export/plaxis2d
                                            Stream the section's drawn
                                            geological model as a runnable
                                            Plaxis 2D ``plxscripting`` Python
                                            script (debt #29). Same
                                            ``model_id`` query param + 404
                                            contract as the DXF export. One
                                            ``g_i.borehole(x)`` per projected
                                            column at its along-section
                                            distance; columns without surface
                                            Z are dropped + counted.
                                            ``text/x-python`` body with a
                                            ``<section>_plaxis2d.py``
                                            ``Content-Disposition``.
GET    /projects/{pid}/sections/{sid}/export/pdf
                                            Export a section as a PDF report
                                            (``SectionPdfReportExporter``).
                                            Same ``model_id`` query param.
                                            ``application/pdf`` response with
                                            a ``Content-Disposition`` header.
                                            404 when section / model / project
                                            resolution fails.

GET    /dem/sample               Sample ``n_samples`` evenly-spaced DEM
                                 elevations along a line. Query params:
                                 ``start_x``, ``start_y``, ``end_x``,
                                 ``end_y``, ``epsg``, ``n_samples``
                                 (default 200, max 2000). Returns
                                 ``{source, samples: [{along_m,
                                 elevation_m}]}``. Source today:
                                 ``"dhmvii"`` (EPSG:31370 / Flanders).
                                 Any other EPSG → 400 "no DEM source
                                 mapped". Used by the section canvas to
                                 draw the ground-surface polyline.

GET    /projects/{pid}/reviews              List every per-(project,
                                            investigation) decision row
                                            (review status / notes /
                                            hidden flag). Empty when
                                            nothing has been reviewed
                                            yet — absence of a row =
                                            the default unreviewed /
                                            not-hidden state.
GET    /projects/{pid}/reviews/{kind}/{tid} Look up the decision row
                                            for one investigation.
                                            ``kind`` ∈ {cpt, borehole}.
                                            404 when no row exists.
PUT    /projects/{pid}/reviews/{kind}/{tid} Upsert by target. Body keys
                                            (all optional):
                                            review_status,
                                            review_notes, is_hidden.
                                            reviewed_at is managed
                                            server-side on transitions
                                            into / out of 'reviewed'.
                                            404 when the target row
                                            isn't in this project.
DELETE /projects/{pid}/reviews/{kind}/{tid} Drop the decision row.
                                            Idempotent — no 404 when
                                            already absent.

PATCH  /projects/{pid}/view-state           Shallow-merge a patch dict
                                            into ``project.view_state``
                                            (project-level toggles:
                                            DEM overlay, hidden-by-type
                                            sets, …). ``null`` for a
                                            key removes it. Returns
                                            the full ProjectResponse.

GET    /dov/virtuele-boring/lagenmodellen   List DOV's available
                                            Virtuele Boring layered
                                            models (12 today: g3dv3_F,
                                            g3dv3_L, hcovv2_H/S/B,
                                            OMAv1.1, …). Each entry:
                                            ``{code, beschrijving,
                                            resoluties}``. Live
                                            passthrough — desktop
                                            client caches per session.
GET    /projects/{pid}/virtuele-boring/predictions?models=A,B
                                            Per-investigation overlay
                                            payload: for each CPT +
                                            borehole in EPSG:31370,
                                            fetches one ``doorprik``
                                            call per requested model
                                            (max 12). Returns
                                            ``{models, predictions[],
                                            skipped_count}``. Each
                                            prediction carries
                                            ``predictions_by_model``
                                            keyed by the requested
                                            model codes (missing key
                                            = per-call failure for
                                            that pair, surfaced in
                                            server log). Informative-
                                            only — no rows persisted.
```

**Bodies (lateral extents)** — full catalogue (design doc: `docs/superpowers/specs/2026-05-31-body-with-extent-design.md`):

```
GET    /projects/{pid}/geology/models/{mid}/bodies
                                List all body metadata rows (oldest-first).
POST   /projects/{pid}/geology/models/{mid}/bodies/detect
                                Explicit "Detect bodies" verb (same as
                                /lenses/detect above — canonical path).
                                Runs DetectBodies: materialises BodyOrm rows
                                for bilateral-closure topologies + removes
                                stale rows. Idempotent. 422 when model is
                                not lithostratigraphic.
POST   /projects/{pid}/geology/models/{mid}/bodies/suggest-pinch-outs
                                Ephemeral only — returns PinchOutCandidateItem
                                list (no DB writes). Frontend renders as ghost
                                wedges; click-to-commit fires ClaimBodyExtent.
PATCH  /projects/{pid}/geology/models/{mid}/bodies/{bid}
                                Update a body's human-readable name
                                (NameBody use case).
DELETE /projects/{pid}/geology/models/{mid}/bodies
                                Bulk-delete the purely-detected bodies of the
                                model (DeleteDetectedBodies). Preserves
                                user-named + user-claimed ("accepted") bodies
                                (provenance rule §5.2). Returns
                                ClearDetectedBodiesResponse
                                {bodies_deleted, bodies_preserved}. Backs the
                                toolbar "Delete all detected lenses".
DELETE /projects/{pid}/geology/models/{mid}/bodies/{bid}
                                Hard-delete the BodyOrm metadata row.
                                Formation absence rows + synthetic contacts
                                are preserved.
DELETE /projects/{pid}/geology/models/{mid}/bodies/{bid}/extents/{side}
                                Clear one lateral extent back to NULL.
                                ``side`` ∈ {left, right}. Reaps the body
                                row when both extents are NULL and name is
                                empty.
GET    /projects/{pid}/geology/models/{mid}/bodies/{bid}/boundary
                                Return the user-authored boundary shape
                                (upper/lower control nodes + render_style).
                                Returns straight defaults when no shape
                                stored yet.
PUT    /projects/{pid}/geology/models/{mid}/bodies/{bid}/boundary
                                Full-replace the boundary shape + nodes.
                                Serialised with an advisory lock to prevent
                                concurrent drag-PUT races.
POST   /projects/{pid}/geology/models/{mid}/bodies/{bid}/perpendicular-companion
                                Auto-create a perpendicular companion
                                cross-section centred on the body's
                                formation-contact centroid. Idempotent —
                                200 when companion already exists,
                                201 when newly created.
GET    /projects/{pid}/geology/formations/{fid}/absences
                                List formation absence rows for one
                                formation (absent investigations + confidence
                                source: inferred / manual / observed).
POST   /projects/{pid}/geology/formations/{fid}/absences
                                Upsert a formation absence row (manual
                                override).
```

409 Conflict on duplicate import (same GEF project_id + test_id within the same app project) — response body includes `cpt_id` of the existing record so the client can auto-load it.
