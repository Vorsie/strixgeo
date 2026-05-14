# DOV codetables — authoritative reference data

Files in this directory are the authoritative DOV (Databank Ondergrond
Vlaanderen) lookup tables that govern the Dutch tokens we receive in WFS
responses and DOV XML. They're checked in so the project has a stable,
version-controlled translation source even if DOV reorganises its
download pages.

**Source:** Flemish "Overleg richtlijn grondsoortbenaming" working-group
distribution received 2026-05.

## Files

| File                                | Rows | Used today                                                                            | Future use                                                                                                                                                                              |
| ----------------------------------- | ---: | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codetabel_hoofdnaam.csv`           |  108 | Lithology codes (FZ, KL, GL, …) — translated to English in `desktop/.../soilColors.ts` | Single source of truth when re-checking a code. Adding a new soil token to the lookup means updating ``soilColors.ts`` against this table.                                              |
| `codetabel_kleur.csv`               |  235 | _Not used_ — DOV's WFS already returns the Dutch label (e.g. `"beigegrijs"`)          | Authoritative list of color tokens for an English-translation pass on field-log colors when we want to expose them to non-Dutch readers.                                                |
| `codetabel_consistentie.csv`        |    7 | _Not used_ — DOV's WFS returns the Dutch label                                         | Translation table for field-log consistency tokens (`zeer slap`, `slap`, `plastisch`, `matig vast`, `vast`, `hard`, `versteend` → `very soft` / `soft` / … / `lithified`).                |
| `grondsoort GEO-BGGG.xlsx`          |    — | _Not used_                                                                             | Original consolidated reference document from the working group; contains additional context not present in the CSV exports (descriptions, methodology, examples). Open with Excel/LO. |
| `g3dv3_modeleenheden.xlsx`          |  113 | G3Dv3 model unit table — formation + member codes, abbreviations, Dutch names, H3D hydrogeology codes. Source for `g3dv3_units.json`. | Re-fetch when DOV publishes a new G3Dv3 revision. |
| `g3dv3_kleurcode_rgb.xlsx`          |  133 | G3Dv3 prescribed colors — RGB per formation/member. Source for `g3dv3_units.json`. | Same refresh trigger. |
| `g3dv3_units.json`                  |  117 | Joined catalog: code, abbreviation, rank, parent, Dutch name, **age_rank**, color hex, H3D codes. Consumed by `infrastructure/codelists/g3dv3_catalog.py`. | Single source of truth for stratigraphic ordering + canonical colors on Belgian projects. Used by auto-populate to set `display_order` (invert: lower display_order = older). |

## G3Dv3 catalog rebuild

Whenever DOV publishes a new G3Dv3 revision:

1. Download `ModeleenhedenG3Dv3_X.xlsx` and `G3Dv3kleurcodeRGB_YYYYMMDD.xlsx`
   from https://www.dov.vlaanderen.be/page/geologisch-3d-model-g3dv3.
2. Overwrite `g3dv3_modeleenheden.xlsx` and `g3dv3_kleurcode_rgb.xlsx`.
3. Run `uv run python scripts/build_g3dv3_catalog.py` to regenerate
   `g3dv3_units.json`.
4. Commit the three files together.

The catalog is built from the xlsx files at packaging time; runtime
code only reads the JSON. Network access is never required for
lookup — the catalog is fully self-contained.

## Translation strategy

Per project convention (memory: ``DOV codelists & translation strategy``),
translations live at the **presentation boundary**, not in domain or
import code. Domain entities store the raw DOV token; the React renderer
maps tokens to English labels via the lookup tables in
``desktop/src/renderer/src/utils/`` (currently ``soilColors.ts``).

When a new lookup is needed (e.g. consistency translation in the field-
log track), the recipe is:

1. Add the lookup table to ``desktop/src/renderer/src/utils/<name>.ts``,
   sourcing values from the CSV here.
2. Cite ``codetabel_<name>.csv`` in the ``.ts`` header so the next reader
   knows where the table came from.
3. **Don't** translate at ingest — the API still returns the raw DOV
   token so future consumers (export, third-party integrations) keep the
   source-of-truth value.

## Why store CSVs verbatim instead of generating a `.ts` file

The CSVs are the contract with DOV; the `.ts` files are the
presentation layer. Keeping them separate means we can re-import the
CSV at any time without re-deriving structure from generated code, and
diff-ing future DOV updates is a one-line CSV diff rather than a
hand-translated lookup-table diff.
