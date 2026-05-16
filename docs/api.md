# API Endpoints

Additive-only contract — see CLAUDE.md "Backwards Compatibility" for the deprecation cycle when fields must be removed or repurposed. The frontend always goes through the API — never directly to domain or DB.

```
POST   /cpt/import              Import a GEF file (multipart form; project_id form field)
POST   /cpt/import-dov          Import CPTs from DOV bbox (JSON body: west,south,east,north,project_id)
GET    /cpt/                    List CPTs (optional ?project_id=UUID filters by project)
GET    /cpt/{id}                CPT metadata (location, elevation, cone props, summary)
GET    /cpt/{id}/plot           Depth-series arrays for plotting (depths, qc, fs, u2, rf, qt)
DELETE /cpt/{id}                Delete CPT and its series (cascade). NOTE: the
                                desktop frontend no longer calls this — sidebar
                                "remove from project" is project-local
                                (localStorage), preserving the DB cache so a
                                re-import doesn't refetch.
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
                                the id is unknown.

POST   /borehole/import-dov     Import boreholes + 8 interpretation streams + samples
                                + grain-size + Atterberg + CaCO3 + organic-C + water-content
                                + the ScalarLabTest catch-all from DOV bbox
                                (Phase C1+C2+C3+C4+C5). Response carries per-test
                                attached/failed counters in addition to the borehole
                                counts; the catch-all reports under
                                ``scalar_lab_tests_attached / _failed``.
GET    /borehole/{id}           Full borehole tree (header + drill segments + field log
                                + observations with layers + admixtures + samples with
                                grain-size + Atterberg + CaCO3 + organic + water-content
                                + the ``scalar_lab_tests`` catch-all list). 404 when missing.
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
                                the heavy detail tree.

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
                                full child tree). Embedded verbatim in
                                .gmproj v2 files on save.
POST   /projects/{id}/restore   Idempotently materialise a project + its
                                CPTs + boreholes from a bundle when the
                                DB has lost the rows (wiped local DB,
                                fresh install). Body matches the bundle
                                shape; id is in the URL. Existing rows
                                are returned / skipped (no mutation);
                                missing rows are inserted with the
                                supplied ids. Always 200.

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

409 Conflict on duplicate import (same GEF project_id + test_id within the same app project) — response body includes `cpt_id` of the existing record so the client can auto-load it.
