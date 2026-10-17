# Product direction

> This note carries the product direction. Since 2026-10-17 StrixGeo is free and open source; the former commercial sections are gone (git history has them). Load it on demand when the pointer in CLAUDE.md says so.

## Direction in one paragraph

StrixGeo builds the ground model for BE/NL geotechnical work: the
unified subsurface dataset, its three-level interpretation and the
exports a design tool reads. Engineering decisions in this repo are
calibrated for engineers who use it on real projects.

### Open source

* **Licence.** GNU AGPL-3.0-or-later (`LICENSE`; the bundled third
  parties and their licences are in `NOTICE`). The copyleft also
  covers network use: anyone who ships or hosts a modified StrixGeo
  must publish its source under the same licence.
* **Repository.** One public repo, https://github.com/Vorsie/strixgeo.
  Releases and the auto-updater feed live in it.
* **Contributions.** Under the Developer Certificate of Origin: every
  commit carries `Signed-off-by` (`git commit -s`), and the CI `dco`
  job checks it. How to contribute: `CONTRIBUTING.md`.
* **Funding.** Voluntary, through GitHub Sponsors (`.github/FUNDING.yml`).
* **Free forever.** There is no paid tier, no licence key and no gated
  feature; every build is the full product. The guarantee is
  structural: the AGPL copyleft, no contributor licence agreement, and
  contributors keep their copyright, so the code can never be
  relicensed to closed terms.
* **Name.** The StrixGeo name and logo stay the owner's trademark; a
  modified distribution uses another name.
* **Roadmap.** Driven by GitHub issues and the tester loop: one issue
  per finding, one `fix/<slug>` or `feat/<slug>` branch per change. The
  v1.0 gate below is the scope boundary; [debt.md](debt.md) holds the
  backlog.
* **Local-first desktop app.** Each user runs their own copy with a
  bundled PostgreSQL + PostGIS; there is no central cloud service. A
  project travels as a `.strix` file: open it on a wiped database and
  the data rehydrates.

### Modelling hierarchy (load-bearing for the v1.0 design)

The data model has **three distinct levels** (revised 2026-05-17 —
owner directive; was two. The geological→geotechnical split is
unchanged, a lithostratigraphic level is inserted between them
because formation-only is too coarse for geotechnical deliverables).
Realised as **sibling `GeologicalModel` rows discriminated by a
`kind` column**, NOT a schema fork — the whole contact → on-click
build → TIN → section-slice → DXF/Plaxis-export → `.gmproj` pipeline
is reused at every level. See
`memory/project_litho_geotech_three_level_model.md`:

1. **Geological model** (`kind='geological'`) — formations are the
   substrate entities (Boom Klei, Diest Zand, Quaternary deposits,
   ...). Each carries a surface defined at known points
   (borehole/CPT contacts) and interpolated between them. Initially
   manual; in Flanders the public G3Dv3 model can seed the default
   formation set + baseline surfaces (post-v1.0 import, big
   differentiator at launch). The regional/chrono backbone.
2. **Lithostratigraphic model** (`kind='lithostratigraphic'`) —
   refines a geological model into lithology + admixture units
   (ZAND / KLEI / SILT / GRIND / VEEN, silt-/kleihoudend). Sourced
   from borehole `ObservationLayer` descriptions + an assisted-manual
   CPT Robertson-SBT segmenter (user-accepted ghost nodes, never
   auto-correlation). **The CPT segmenter offers two classifiers, chosen
   per project via Settings → Litho segmenter → "Normalise qc (Robertson
   2015)" (`view_state.litho_segmenter.use_normalised_qc`, default ON):**
   the stress-NORMALISED Robertson 2015 pipeline (Qtn / F / Ic — needs the
   CPT's elevation + water table to build a stress profile + iterate the
   stress exponent), or the NON-normalised Robertson 2010 `I_SBT` index
   (`qc/pa` + Rf, no stress profile) for shallow depth or unreliable
   groundwater. Non-normalised mode leaves Dr / NAD packing blank
   (relative density needs effective stress). `I_SBT` lives in its own
   `domain/services/robertson_sbt_non_normalised.py` so the faithful
   `robertson_2015.py` `.sce` port stays frozen.
   `parent_geological_model_id` is mandatory
   (enforced at creation — a litho model cannot exist without its
   geological parent; the column is DB-nullable only because
   geological models share it and have no parent). The
   geotechnically-actionable detail level.
3. **Geotechnical model** (`kind='geotechnical'`) — derived from the
   lithostratigraphic model. A lithology is subdivided by **packing
   density / consistency** into a Belgian **NAD** class (1–31:
   los/matig/dicht/zeer dicht for sand, weinig-vast→vast for fines),
   driven by CPT qc/Dr.
   *(Owner directive 2026-05-25, supersedes 2026-05-20):* The litho
   segmenter merges adjacent same-lithology segments by default.
   Settings → "Merge same-lithology layers" (default ON) toggles the
   behaviour. The packing-density signal that the merge would discard
   returns at the right architectural layer: the Geotech stage's
   "Suggest packing split" gesture (future work) will re-introduce
   Dr-driven subdivisions within a litho unit, with smoothing and
   horizontal-layer awareness so spurious lateral packing-lens noise
   doesn't survive across nearby tests. The merged segment's NAD class
   tooltip shows a range ("NAD 1–3") when sources differ, a singleton
   when they share. The 2026-05-20 over-split-by-design directive is
   retired — it was a placeholder bet that the geotech stage's split
   machinery would arrive sooner. **MVP scope (owner directive 2026-05-18):**
   subdivision structure + the following CPT-derived indicators per
   unit are v1.0: Robertson Ic SBT zone (committed summary), relative
   density Dr (sand units, `Dr = 100·(0.268·ln(qc/0.1 /
   (σ′v/100)^0.5) − 0.675)`), NAD packing class label, and γ-estimate
   from SBT-zone lookup. All are labelled "CPT-derived estimate" at
   the presentation boundary. **Design-ready parameter values**
   (φ′/c′/cu/E50/OCR/Vs/G0/M, the full NAD-NEN xlsx port) stay Phase
   5. Example: weathered crust of Boom Klei vs undisturbed clay below.

**Cross-sections are the editing surface, not the data primitive.**
Pick a slice through the project, see the investigations projected
on it, draw/edit formation tops between them — the edits commit to
the geological model, not to the section. The section is a view.

**Classification follows the test (owner directive 2026-06-08 —
supersedes the 2026-05-17 explicit-content directive FOR
CLASSIFICATION).** A test's classification — its geological
formation contacts and its accepted litho layers — is a property of
the borehole/CPT in the ground model, not of any cross-section.
Every section whose corridor contains a test shows that test's full
classification **automatically**, with no per-section seeding step.
So a test is classified **once** and that classification renders on
every section through it. ``SectionsCanvas`` filters ``axisContacts``
to the section's **in-corridor investigation set** (the CPTs +
boreholes the section projects within ``projection_buffer_m``, minus
its exclusion lists — ``inCorridorInvestigationIds`` in
``utils/sectionClassification.ts``) at the prop boundary; the backend
``build_section_snapshot`` applies the same in-corridor filter for
DXF/PDF export. The filter is stale-anchor-tolerant: a contact whose
anchor isn't projected (out of corridor, excluded, or deleted) is
skipped silently. The Build/TIN path is unaffected (it still consumes
all model contacts for Delaunay).

The reversal closes a data-integrity hole: a blank fresh section
tempted the user to re-classify, landing a second, slightly-different
boundary set on the same test. Auto-showing the existing
classification removes that temptation.

``cross_section.seeded_formation_contact_ids`` (PostgreSQL UUID array,
empty on create) is **kept** — it rides the ``.gmproj`` bundle for
backwards-compat and the accept/seed/draw flows still maintain it —
but it **no longer gates classification rendering**. The
explicit-content invariant now applies to **correlations** only:
correlations are relational and built per section, so they still
appear only where the user creates them (correlation creation and the
auto-correlate adjacency are unchanged). See
``docs/superpowers/specs/2026-06-08-classification-follows-the-test-design.md``.

**Stratigraphic order — `display_order` is the age axis.** Lower
`display_order` = older formation (deeper in the stratigraphic
column). Section views and any other layered **renderer** iterate
formations ASCENDING by `display_order` so older paints first and
younger formations render visually on top — the geological
superposition rule. **The GeologyInspector formation LIST is the
one exception: it presents formations YOUNGEST-first (descending
`display_order`), because an engineer reads it like a borehole log /
stratigraphic column — surface/youngest at the top, oldest at
depth. This is a presentation-only reversal; `display_order`
semantics and every renderer's ascending paint order are unchanged.
The drag-reorder runs in that displayed (reversed) space and maps
the displayed index back to `display_order = (N-1 - i)`.** Reorder
lives in GeologyInspector via drag-and-drop (the old InterpretationPane
was deleted in the G3 sidebar overhaul); the drag-end commit
renumbers every visible formation 0..N-1 (compact) and PATCHes only
the rows whose index actually changed. **The drag-end PATCH also sets
``pinned_order=True`` on every reordered formation (debt #35): Build's
``_reorder_by_age`` keeps pinned formations at their exact
``display_order`` and flows only the non-pinned ones into the free
slots by inferred age. This makes Build safe for unusual stratigraphy
(pinch-outs, unconformities, inversion) where the data-driven
inference is wrong — a manual reorder is no longer silently reverted.
Undo restores the pre-drag pin state per formation; "Fill from
boreholes" / seeded formations stay unpinned so they still benefit
from the inference.** The crossing validator
(``GET /geology/models/{mid}/validate/crossings``) consumes this
ordering: it samples each pair of cached TIN surfaces and flags any
(x, y) where the younger formation dips below the older. Results
surface as an amber "N surface crossings detected" banner; refetched
on every contact mutation.

**On-click build — the user controls when surfaces compute.** Per-
contact mutations (Create / Update / Delete / Batch update) DO NOT
auto-run Delaunay; they flip ``formation_surface.is_stale = True``
on the affected (model, formation) row. Only ``POST /geology/models/
{mid}/surfaces/rebuild`` (the "Build 3D model" toolbar button)
clears the flag by re-running the recompute. File → Save does NOT
auto-fire a rebuild. The section view renders stale TINs at opacity
0.35 + dashed ``6 3`` so the engineer sees "this is your last build,
refresh to update." Distinct from the connect-the-dots fallback
(dashed ``4 3``, opacity 0.55) and from fresh TIN (solid 0.7).
Dedupe's auto-recompute is retained (it is a build-shaped intent,
not an iterative edit). The ``method`` query param scaffolds for
kriging / RBF / GemPy in Phase 5; v1 enforces ``method=tin`` via
regex.

**Geology stage owns model definition. Formations are created/curated/
deleted and seeded from borehole stratigraphy ("Fill from boreholes")
in the Geology stage — the substrate-definition step. The cross-section's
"Seed from stratigraphy" is NOT a model-definition action: it is a
downstream, gated operation that (a) is disabled until the active
geological model has formations, (b) places formation CONTACTS only —
for the formations the user has kept — at each in-corridor investigation,
AND records each created contact id into ``cross_section.
seeded_formation_contact_ids`` (union pattern — idempotent re-runs add
only genuinely-new ids; kept for bundle compat, no longer the render
gate), (c) those contacts are placed at in-corridor investigations, so
they render automatically under "classification follows the test" (see
paragraph above) — the seed step now just creates the contacts; it is
no longer what makes them visible, (d) renders them as the dashed
connect-the-dots fallback, never solid TIN bands, (e) never creates
formations and never triggers a Delaunay/TIN build. Surface build remains a separate explicit action ("Build model" /
the Geology stage). This supersedes the earlier rule that listed
"Auto-populate from boreholes" on the section as a build-shaped intent
with retained auto-recompute. Dedupe's behaviour is unchanged.**

### v1.0 gate

v1.0 is complete the moment a geotech engineer can do this end to end
on a real project. All five steps shipped in the v0.1.0 beta
(2026-09-16):

1. Import CPTs + boreholes (DOV bbox + GEF files). *Shipped.*
2. Define a **geological model** (formations + surfaces) for the
   project. *Shipped.*
3. Build a **lithostratigraphic model**: refine geological formations into
   lithology + admixture units via borehole ObservationLayer descriptions
   and the CPT Robertson-SBT segmenter. View and edit on cross-sections.
   *Shipped.*
4. **Geotechnical subdivision**: assign NAD packing class (1-31) to each
   lithostratigraphic unit. Display Robertson Ic SBT zone, relative
   density Dr (sand), NAD packing class, and γ-estimate per unit in the
   inspector. Parameter VALUES (φ′/c′/cu/E50) stay blank: the engineer
   fills those in their downstream design tool. *Shipped.*
5. **Export** the three-level model geometry to DXF and/or Plaxis, with
   unit identifiers so the downstream tool can map unit names to material
   definitions. *Shipped (#104).*

**The ruled v1.0 scope (owner ballot, 2026-08-26; it supersedes narrower
readings of the gate, and each line was ruled individually).** An item
marked *shipped* is in the released build; an unmarked item is open or
not yet verified, and its debt entry carries the state.

*Exports & deliverables:* export unit identifiers (NAD class + soil) in
DXF/Plaxis (#104, *shipped*); a Plaxis material-mapping sidecar; PDF
report slices B/C/D, with D at the CHARACTERISATION level (NAD class +
per unit statistics, never design values) (#52, open); D-Stability
(.stix) and D-Sheet exports (*shipped*) and a GeoStudio export (open: no
exporter exists); an export completeness guard (unclassified/stale
content refuses or flags); a report data-thinning step that merges
lenses with identical NAD parameters for readability (#104b, *shipped*).

*Model trust:* #266 litho-drift staleness stamp (*shipped*); #225
save-guard (*shipped*); the per-build gapless report UI; the CS3 nospan
residual; crossing ties marked in the CS; the machine-tie frame warning.

*Interpretation (narrow):* per-unit statistics plots (raincloud/box of
qc, fs, Rf over a selected unit) and the right-click layer → isolate in
3-D → jump-to-parameters link. All other interpretation automation
stays out.

*3-D & visuals:* smooth non-blocky 3-D (#220, open), footprint ring
(*shipped*), DEM ground-surface reference (G7, *shipped*), 3-D split
viewport (#64, *shipped*), fence diagram export (*shipped*).

*UX:* onboarding / first-use tutorial (#93: the in-app tutorial
*shipped*, per-stage hinting open) and NL UI translation (*shipped*).

*Distribution:* bundled Postgres (#2) and the Windows installer
(*shipped* since v0.1.0); telemetry / crash reporting (#16: local
capture *shipped*, transmission stays off until consent is given and an
endpoint is configured).

*Explicitly NOT v1.0 (owner-ruled):* IFC export; monitoring / DMT /
pressuremeter / mechanical lab / AGS data sources; G3Dv3 import;
parameter suggestions and the full Robertson/Mayne + NAD-NEN port; auto
soil profiling; interfingering shapes; #163f; multilingual stratigraphy
catalog; share-pack / borelog sheets / model snapshots / completeness
panel.

Design-ready parameter VALUES (φ′, c′, cu, E50, OCR, Vs, G0, M) and
the full NAD-NEN xlsx table remain Phase 5: the per-unit statistics
plots above are characterisation outputs, not design inputs.

### Open concerns (tracked as debt, not blocking)

* **Code-signing the installer** (#6). The installer ships unsigned, so
  Windows SmartScreen warns on first run. A nice-to-have now: it removes
  the warning, it gates nothing.
* **Project-by-id endpoints** (#4) rely on "the only caller is the local
  user"; a guard is needed before any multi-user or hosted use.
* **Malformed input.** Every import path (GEF, DOV XML, PDF, `.strix`)
  reads files from outside; a parser or restore change gets a
  security-reviewer pass so a malformed file fails cleanly.
* **Auto-update channel.** Shipped (electron-updater, github provider,
  fed from the public repo's releases). Format upgrades still depend on
  every user reaching the build that introduced the upgrade path, so
  the backwards-compat rules in [backwards-compat.md](backwards-compat.md)
  stay load-bearing.
* **Hosted Windows build** (#288). The installer is built on the owner's
  machine; a GitHub Actions build is a debt item for the first
  contributor who needs one.
* **Site and demo video** (#7). strixgeo.com carries the download and
  the open-source line; the short demo (DOV bbox → borelog → save/open
  round-trip) is the main showcase for new users.
