# Backwards Compatibility

> Extracted from `CLAUDE.md` 2026-06-06 to keep the always-loaded file lean. Load this on demand when the pointer in CLAUDE.md says so.

## Backwards Compatibility — non-negotiable from now on

> **RE-ARMED 2026-09-05 (owner: "back compatibility on").** The trigger below
> fired: installer #17 is the first build handed to people outside the dev
> machine to save real projects with (the closed beta). The suspension of
> 2026-05-16 ("schema / API / `.gmproj` shapes may change cleanly, no shims,
> no upgrade chain") is over. **Floor = what #17 emits:** backend bundle
> `format_version = 4` (`SUPPORTED_BUNDLE_VERSIONS = {3, 4}` in
> `shared/bundle_format.py`), `.strix` `PROJECT_FILE_FORMAT_VERSION = 3`
> (`desktop/src/renderer/src/utils/projectFile.ts`), activation store
> `ACTIVATION_FORMAT_VERSION = 1`, Alembic head as of `develop` at #17.
>
> From this floor forward every rule below is non-negotiable: a `.strix`
> written by any beta build opens in every later build; schema and API
> changes are additive (new columns nullable or defaulted, new fields
> optional); removing or repurposing anything needs a deprecation cycle;
> a version bump needs an upgrade step and a restore test for the old
> shape. Beta testers save real projects with this build, so the cost of
> a broken restore is now a person's work, not a re-import.

The rules below are the contract. They were retained verbatim during the
suspension so re-arming was a revert, not a redesign.

User-owned artefacts have to keep working across upgrades. "Forever"
isn't rhetorical — the user paid the cost of saving the file once and
should never lose access to that data because we changed our minds.

### Floor: format_version = 4

v1 (metadata-only) and v2 (CPTs + boreholes + geology + sections) were
dev-only and have been removed pre-shipping (one-time amnesty). v3
carried every per-project decision in the boundary-centric shape
(``contacts`` array on each geological model). **v4 (current, A4 of
the unified litho boundary model) makes the litho axis Shape A
native: each geological model carries a nested ``litho_layers``
array; on litho models the ``contacts`` array is emitted empty —
``litho_layer`` rows are the source of truth.** Both v3 and v4 stay
parseable on this build (``SUPPORTED_BUNDLE_VERSIONS == {3, 4}``);
v3 restores via the LL→FC trigger materialising layers from contacts.
Bumping the version requires the upgrade-chain steps below.

**v4 + bodies (2026-05-31, pre-ship amnesty):** the body-with-extent
refactor landed without a version bump (pre-ship amnesty, no external
users). v4 format now also carries a top-level ``bodies`` array per
model alongside ``litho_layers[]`` and ``contacts[]``. When the
backwards-compat trigger fires (first external/paid distribution), v4
with bodies becomes the floor: ``format_version`` stays at 4 but
``bodies`` is a required-or-normalised-to-[]  field that any v4
reader must tolerate. Old v4 bundles without ``bodies`` restore
cleanly (normalised to ``[]`` on parse — see ``parseProjectFile``).
The next version bump will be v5 and applies only if the shape breaks
in a way that requires an explicit upgrade path.

### Scope

The rule applies to anything the user persists or relies on outside
the running app:

| Artefact | Rule |
|---|---|
| ``.gmproj`` file format | v3+ must always parse. Bump ``format_version`` for breaking changes and add an explicit upgrade path; never silently drop fields. The upgrade-chain rules below are the template. |
| Bundle wire format (``ProjectBundleRequest`` / ``Response``) | Same as .gmproj — the file embeds this verbatim. Adding fields is fine; removing or repurposing a field name requires a version bump + parse-path branching. |
| REST API contracts | Additive changes only. New fields default to optional / null. Removing or repurposing existing fields needs a deprecation cycle (ship the new one alongside, migrate clients, drop the old after one or two releases). |
| Recent-projects list (``userData/recent-projects.json``) | Tolerate unknown fields on read, version it if the shape changes. |
| URL / query / config conventions documented in CLAUDE.md | Don't yank without a deprecation note. |

### Doesn't apply to

* Internal Python / TypeScript types — they're internal, refactor freely.
* DB schema (we own Alembic; ``alembic upgrade head`` is the contract,
  not the column list).
* Test fixtures, fixtures-on-disk, dev seeds.
* DOV cache file layout (we control it end-to-end; cache wipe is fine).

### How to bump a versioned format

1. Bump the integer ``format_version`` field.
2. Keep the old version's reader / parser intact; never delete it.
3. Add an explicit ``upgrade_vN_to_vN+1`` function that mirrors the
   shape. The parser tries the newest version first, falls back to
   older versions, and runs the upgrade chain to materialise into the
   current in-memory shape.
4. Write a test that opens a fixture from the previous version and
   asserts it still reaches today's runtime shape.
5. New saves always emit the latest version.

If you find yourself wanting to "just break it, no one's using the old
format yet" — that's the moment the rule matters most. Today's "no
one" is tomorrow's "every user who downloaded the v0.3 build."
