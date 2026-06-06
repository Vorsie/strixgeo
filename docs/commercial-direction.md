# Commercial Direction

> Extracted from `CLAUDE.md` 2026-06-06 to keep the always-loaded file lean. Load this on demand when the pointer in CLAUDE.md says so.

## Commercial Direction

This is a **commercial product**, not just an internal tool. Engineering
decisions in this repo are calibrated for a paid release to BE/NL
geotechnical consultancies — initially 5–50 person firms who already
feel the pain of legacy tools (gINT, D-Series, GeoStudio).

### Distribution model

* **Local-first desktop app.** Each user runs their own copy with
  their own local Postgres + PostGIS. **No central cloud service.**
  Reasoning: offline-capable on site, data-privacy-friendly (geotech
  projects are frequently NDA / defense-adjacent), zero ongoing infra
  cost, sub-ms query latency.
* **`.gmproj` v2 = the portable artefact.** Sharing a project means
  emailing the file. The bundle format already supports this — open
  on a wiped DB and the data rehydrates.
* **One DB per user.** Today: developer Docker Compose on
  ``localhost:5433``. v1.0 distribution likely bundles
  Postgres + PostGIS inside the installer so end users don't install
  anything themselves (Plaxis pattern). SQLite + SpatiaLite is a
  fall-back if the bundled-Postgres path proves too fragile, but it's
  a non-trivial refactor (PostgreSQL ``ARRAY`` columns, PostGIS-
  specific geometry features) so we don't pre-optimise for it.
* **SaaS is a Phase 5+ direction**, not a v1.0 concern. If/when it
  ships, the .gmproj file becomes the bridge format between the
  desktop client and any future cloud sync.

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

**Explicit-content invariant (owner directive 2026-05-17): nothing
appears on a section without the user clicking a button on that
section.** A freshly-drawn section shows investigations only — zero
formation contacts. Formation content appears only where the user
has explicitly seeded or drawn it; the ids of those contacts are
stored in ``cross_section.seeded_formation_contact_ids`` (PostgreSQL
UUID array, empty on create). ``SectionsCanvas`` filters
``axisContacts`` to ``seeded_formation_contact_ids`` at the prop
boundary before passing to ``SectionPanel`` — the Build/TIN path is
unaffected (it still consumes all model contacts for Delaunay). The
filtering is stale-id-tolerant: a contact deleted from the model
after being seeded is simply absent from ``axisContacts`` — filter
by id-membership skips it silently.

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
only genuinely-new ids), (c) contacts NOT in that set are invisible on
this section (the explicit-content invariant — see paragraph above),
(d) renders them as the dashed connect-the-dots fallback, never solid TIN
bands, (e) never creates formations and never triggers a Delaunay/TIN
build. Surface build remains a separate explicit action ("Build model" /
the Geology stage). This supersedes the earlier rule that listed
"Auto-populate from boreholes" on the section as a build-shaped intent
with retained auto-recompute. Dedupe's behaviour is unchanged.**

### v1.0 commercial MVP gate

The product is "sellable" the moment a geotech engineer can do this
end-to-end on a real project:

1. Import CPTs + boreholes (DOV bbox + GEF files — done).
2. Define a **geological model** (formations + surfaces) for the project (done).
3. Build a **lithostratigraphic model**: refine geological formations into
   lithology + admixture units via borehole ObservationLayer descriptions
   and the CPT Robertson-SBT segmenter. View and edit on cross-sections.
4. **Geotechnical subdivision**: assign NAD packing class (1–31) to each
   lithostratigraphic unit. Display Robertson Ic SBT zone, relative
   density Dr (sand), NAD packing class, and γ-estimate per unit in the
   inspector. Parameter VALUES (φ′/c′/cu/E50) stay blank — the engineer
   fills those in their downstream design tool.
5. **Export** the three-level model geometry to DXF and/or Plaxis, with
   unit identifiers so the downstream tool can map unit names to material
   definitions.

Design-ready parameter values (φ′, c′, cu, E50, OCR, Vs, G0, M), full
NAD-NEN xlsx table, per-layer statistics, and PDF reports are Phase 5
(post-v1.0). The geometry + packing-class interpretation is the
integration unit downstream design tools actually consume at handoff.
G3Dv3 import lands alongside or just after v1.0 — high-impact for the
Flanders launch demo but not a gate.

### Open commercial concerns (tracked as debt, not blocking the MVP)

* **License key / activation system** — none today; needed before any
  paid distribution. Likely shape: signed offline license tokens
  (machine-bound or floating per-user), no phone-home dependency for
  daily use. See debt section.
* **Code-signing the installer** — Windows SmartScreen will reject
  unsigned installers and signal "untrusted" to users. EV
  certificate required (~€200–400/year).
* **Hardening against tampering / reverse engineering** — modest
  posture, not paranoid. Geotech isn't a target-rich threat
  environment; goals are mostly to prevent casual license-key
  bypass and keep our user data import paths safe from malformed
  files. NOT trying to defeat dedicated reverse engineers — that's a
  losing arms race for a solo dev.
* **Auto-update channel** — Squirrel.Windows / electron-updater
  pattern. Needed because v1.0 saves write today's bundle format;
  future format upgrades depend on every user reaching at least the
  build that introduced the upgrade path.
* **Marketing site + demo video + market-facing name** — codename
  here stays "Strix" / "groundmodel" but the public name + domain +
  trademark search is a separate deliverable. The 90-second demo
  video showing DOV bbox → borelog → save/open round-trip is the
  primary marketing artefact; everything else is supporting copy.

These don't shape the v1.0 MVP feature gate, but every one has to
land before a paid public release. They're listed individually in
"Known Architectural Debt" so each gets a trigger condition.
