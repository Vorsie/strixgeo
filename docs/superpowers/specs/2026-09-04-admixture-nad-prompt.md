# Admixture → NAD-family prompt at geotech subdivide

**Owner ruling (2026-09-04 01:30, verbatim):** *"we can keep the admixture mix,
but then we need to prompt user in geotech stage on subdivide. Hey we see you
have an admixture here, which NAD classes do you want, pure sand or sand with
admixture."*

DOV's admixture detail stays exactly as imported. At **subdivide** time, for
every litho unit whose admixture the NAD table can express *either* as the pure
class *or* as the with-admixture variant, the engineer is asked once which NAD
family that unit is classified into. The answer is persisted with the litho
unit (its `geological_formation` row) so a re-divide does not re-ask, a
change-my-answer path exists, and the classifier honours it.

---

## (a) Detection rule — which units are ambiguous

Derived entirely from the EXISTING NAD table
(`domain/services/nad_classification_constants.py::NAD_QC_BANDS` +
`_SECONDARY_ADMIXTURE_CODES`). **No new thresholds are invented.**

A litho unit is *admixture-ambiguous* when BOTH hold:

1. It carries at least one admixture whose `soil_code` is in the soil's
   secondary set (`_SECONDARY_ADMIXTURE_CODES[soil]`) — i.e.
   `nad_classifier._variant_for(soil, admixtures) == "secondary"`; AND
2. the soil's `"clean"` and `"secondary"` NAD columns actually **differ**
   (`NAD_QC_BANDS[(soil,"clean")] != NAD_QC_BANDS[(soil,"secondary")]`).

Condition (2) is what excludes VEEN, whose secondary column mirrors clean.

### The pairs found in the mapping (this is what the owner rules on)

| Soil | Pure classes | With-admixture classes | Trigger admixture (secondary set) |
|------|--------------|------------------------|-----------------------------------|
| GRIND (Gravel) | 1, 2 | 3, 4 | silt-/kleihoudend — codes `SI KL LE SL` |
| ZAND (Sand)    | 5, 6, 7, 8 | 9, 10, 11, 12 | silt-/kleihoudend — codes `SI KL LE SL` |
| SILT (Silt)    | 13, 14, 15, 16 | 17, 18, 19, 20 | zandhoudend — codes `XZ ZN Z FZ MZ GZ` |
| KLEI (Clay)    | 21, 22, 23, 24 | 25, 26, 27, 28 | zandhoudend — codes `XZ ZN Z FZ MZ GZ` |
| VEEN (Peat)    | 29, 30, 31 | (secondary == clean) | **no distinct variant → never prompted** |

Coarse soils (GRIND/ZAND) fork only on a **silt/clay** admixture; fine soils
(SILT/KLEI) fork only on a **sand** admixture — the norm table defines a
with-admixture column only for those combinations. Consequences (units NOT
prompted, because the table has no with-admixture class to offer):

- a **sandy** sand or **sandy** gravel — no "sandy sand"/"sandy gravel" NAD
  column → classified clean, not prompted;
- a **silty/clayey** silt or clay — no such NAD column → classified clean, not
  prompted;
- **any** VEEN (peat) unit — secondary mirrors clean → never prompted.

The `_SAND_ADMIXTURE_CODES` / `_SILT_CLAY_ADMIXTURE_CODES` sets are ported
verbatim to the renderer (`utils/admixtureNadChoice.ts`) with a source-of-truth
comment; a vitest pins the ported pairs against this table.

## (b) Where the answer lives

New nullable column `nad_admixture_choice` on `geological_formation`
(`TEXT`, values `'pure' | 'with_admixture' | NULL`; NULL = not yet answered =
today's auto-from-admixtures behaviour). Additive Alembic revision (backwards
compat SUSPENDED pre-ship — a plain additive column is fine). The bundle carries
it for free: formations serialise via `_column_to_json` and restore via
`_apply_json_to_kwargs`, both column-driven — a round-trip test pins it.

## (c) API

- **Write:** extend `GeologicalFormationUpdateRequest` with
  `nad_admixture_choice: Literal['pure','with_admixture'] | None`; the existing
  `PATCH /geology/formations/{fid}` already threads `model_dump(exclude_unset)`
  → `repo.update_formation(setattr)`, so no router change beyond the field.
- **Read:** `GeologicalFormationResponse` gains `nad_admixture_choice`. The
  "units needing an answer" list is **derived on the client** from
  `geoModel.formations` (soil + admixtures + choice) joined with the litho
  layers in the model — no new endpoint; the detection rule is a small TS port
  pinned by vitest against the same pairs.

## (d) UI — the pre-flight gains an admixture page

A sibling dialog `GeotechAdmixtureChoiceDialog` in the geotech-stage Build
pre-flight (`useGeotechBuildPreflight`). On the Build press, BEFORE the existing
unbanded-tests flow, the hook computes the *unanswered* ambiguous litho units.
If any exist it shows the page: one row per unit, unit name + soil, two radios
— **"Zuiver {soil}" / "{soil} met bijmenging"** (EN **"Pure {soil}" /
"{soil} with admixture"**). Default: **no** radio selected (the owner: *"which
NAD classes do you want"* — the user must answer). The primary button
(**Divide** / continue) is **disabled until every listed unit has an answer**.
On confirm the choices `PATCH` to their formations, then the press continues to
the unbanded-tests flow and the build. Cancel closes without building.

**Change-my-answer path:** re-opening the dialog (any later Build press) shows
the stored choice pre-selected and lets the engineer switch it; a subsequent
subdivide-with-rebuild re-classifies with the new value. (The stored choice is
authoritative on every subdivide path, so a section-scoped re-divide also
honours it.)

## (e) Classifier reads the choice

The choice resolves to a NAD variant at the application layer and is threaded
into the domain classifier as an explicit override:

- `'pure'` → force `"clean"` variant;
- `'with_admixture'` → force `"secondary"` variant;
- `NULL`/absent → today's `_variant_for(soil, admixtures)`.

Domain surface (`nad_classifier.py`): a `variant_override: Variant | None`
keyword on `classify_nad`, `loosest_class_for`, and (threaded through)
`geotech_subdivision.suggest_geotech_subdivision` +
`_sustained_threshold_cuts` + `_class_over`. A resolver
`resolve_admixture_variant(soil, admixtures, choice)` maps the stored choice
string to a `Variant | None`. Application call sites (`subdivide_all_bodies.py`
per body group, `divide_boreholes.py` per group floor) load the formation's
`nad_admixture_choice` and pass the resolved override.

## Scope / non-goals for this slice

- The prompt is wired into the **geotech-stage Build pre-flight** (the surface
  the brief names). The Sections-stage direct subdivide / section right-click
  divide do NOT themselves pop the prompt in this slice — they still honour the
  stored choice. Whether to add the same gate there is an owner follow-up.
- `hand_settable_classes_for` (the by-hand class menu) is unchanged: a hand
  class already offers BOTH variants by design.
