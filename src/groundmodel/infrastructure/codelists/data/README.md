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
