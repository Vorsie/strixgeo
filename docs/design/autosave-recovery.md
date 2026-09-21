# Autosave + crash recovery

**Status 2026-08-02:** design APPROVED. SHIPPED: the three lumping columns
(`c5b81d7a4e39`), the staged/promote API with the monotonic 409 revision guard, the
Electron recovery-file store + IPC (capped, atomic, case-canonical ids), the renderer's
revision increments (`utils/stratigraphyLumping` + `useProject`), the CAPTURE half —
`utils/recoverySnapshot` (the payload codec) plus `hooks/useRecoveryAutosave` (the
debounce + cap scheduler, and the delete on every decided exit) — and the RESTORE
surface: `RecoveryPromptDialog` (three choices, per Q3), `hooks/useRecoveryOffer` (the
single detection point, keyed on the open project's id), `hooks/useRecoveryRestore`
(applies the six items; `utils/recoveryReconcile` implements §3's table) and the
`WelcomeScreen` "Recovered work" list.
**DECIDED (owner, 2026-08-03):** a declined copy survives, Word-style. "Open without
restoring" moves the file to a second **declined slot** the autosave scheduler never
writes, so the next launch offers the same unsaved work again; the prompt's **Discard**
is the only thing that destroys it. See §4's clearing table for the two deletes that
implements. Discard first replays the last save over the database; when the file on
disk is NOT this project's latest save that replay is refused and the app **asks**
("Revert to file and delete backup?", Cancel focused — `utils/discardBackupRevert.ts`)
instead of toasting a refusal and keeping the backup (owner 2026-09-10: the toast
was a dead end).
Load before touching autosave, the recovery file, or the stratigraphy lumping map.

---

## 1. The finding that shapes everything: a crash loses no interpretation

The owner asked for "auto save and a recover function in case of a sudden crash", picturing
Word's `.asd`. Word's model assumes the document lives in memory and the file is the only
durable copy. **In Strix that is backwards**, and building the Word feature here would be
building the wrong thing well.

Every interpretation gesture — contact drag, correlation create/delete, litho accept,
subdivide, import — is an **awaited HTTP call at gesture time**, landing in one transaction per
request, in a PostgreSQL container whose lifecycle is independent of Electron's. Electron dying
takes the spawned uvicorn with it; it does not take committed rows with it.

`.strix` is not a serialisation of an in-memory document either. It is a **re-export of the
database**: `useProject.saveProject` fetches `GET /bundle`, trims four arrays against the
session manifest, and writes. On the real dev project the file is a row-for-row mirror of
Postgres for every interpretation array.

So there is no unsaved document to shadow-copy. What a crash destroys is a small, oddly-shaped
**session delta** — typically well under 1 MB against a 7.9 MB `.strix`.

**Consequence for the copy:** the recovery prompt must never say "recover your project". It says
*"restore your unsaved work"*, because the project is fine. Everything else in the wording
follows from that sentence.

### Two framings that were tried and are wrong

* *"The DB is the source of truth, so little is at risk."* Half true, and misleading. The DB is
  a **working copy** the app is willing to destroy: `revertToLastSaved` (the "Don't Save"
  branch) replace-restores the DB **from the file** so the project's children match it exactly.
* *"A changelog in the DB is the recovery mechanism."* It is not. The state actually at risk
  never reaches the API, so nothing would ever be logged. A decision log keeps its value for
  debt #70 (ML training) and for making build-generation pruning safe — not for recovery.

---

## 2. What is actually at risk

Six items. Each survived an adversarial pass whose job was to refute it.

| # | State | Why it is lost |
|---|---|---|
| 1 | **Stratigraphy lumping map** (`currentLumping` / `savedLumping`) | Had **no database home at all** — a schema-wide query for `%lump%` / `%stratigraphy%` returned zero columns. Being fixed; see §3. |
| 2 | **Litho ghost workspace** (`ghostsByAnchor`) | Self-documented "Ephemeral — not persisted". 14 mutating gestures, **zero API traffic** until Accept. The suggestions are re-derivable; the edits, rejections, splits and manual ghosts are irreproducible human triage. Since 2026-09-11 (`useLithoGhostWorkspace`) every structural gesture is an undo command on the renderer undo stack (a boundary drag = one step), and a litho-model switch sets the outgoing model's columns aside in a ref and restores them on return. That set-aside stash is NOT in the recovery payload: only the live map is serialised, so columns parked on another model die with the process (accepted; a `setAside` section is the follow-up if it ever matters). |
| 3 | **Project metadata draft** (10 scalars) | `applyMetadataDraft` is a bare `setProject`; the only PATCH is inside `saveProject`. Only the uncommitted delta is at risk — ~200 bytes to carry. |
| 4 | **The four manifest sets** | *Unreconstructed*, not lost. The localStorage mirror is **lossy**: DOV dedupe-hit ids and Fill-matched pre-existing formations enter the manifest without entering the session set. |
| 5 | **The five session-import sets** | Survive in localStorage, but must stay consistent with the manifest snapshot taken at the same instant. |
| 6 | **`hasUnsavedMutations`** | One boolean — see the second-order path below. |

### The nastiest item is the boolean

Lose the dirty flag in a crash and the project reopens looking **clean**. A later, unrelated
**Discard** then runs `revertToLastSaved`, which wipes the DB back to the file "EXACTLY" —
silently destroying pre-crash work the crash itself never touched. One bit closes it.

### Deliberately not captured

* **Undo/redo stacks.** `UndoCommand` holds live closures (`revert`/`reapply`) over captured api
  calls and ids. Structurally unserialisable; recovering them means rewriting every mutation
  handler into a parameterised command form. The underlying rows are all durable — what is lost
  is only the ability to *reverse* them. Out of scope permanently.
* **Any interpretation data.** Already in Postgres. Copying it in would create a second source
  of truth and a merge problem that does not otherwise exist.

---

## 3. The lumping map gets a real home (owner decision 2026-08-02)

Autosave alone would have shadow-copied item 1 every two seconds while leaving it one crash away
from loss in any path that does not go through autosave. The owner chose **both**: a durable
home *and* a recovery copy.

Columns on `project`, mirroring the `view_state` JSONB precedent:

| column | written when |
|---|---|
| `stratigraphy_lumping_staged` | on Apply, immediately |
| `stratigraphy_lumping_saved` | on File → Save |
| `stratigraphy_lumping_revision` | monotonic, incremented on every stage |

**This does not violate two-stage save, and the distinction matters** because an earlier attempt
was removed for getting it wrong. The old `writeLumpingSnapshot` wrote the **`.gmproj` file**
immediately on Apply — that is what broke the model. Writing a **staging column** is what
`view_state` already does. `staged != saved` is exactly the dirty signal the renderer computes
in memory today.

### Reconciliation: revision wins, never the clock

Two writers means one reconciliation rule. Wall-clock comparison was rejected on three counts:
`project.updated_at` moves for unrelated reasons so it cannot date the map; the recovery file
*legitimately* lags by up to 15 s so "older" does not mean "stale"; and a clock shift (DST, NTP,
a resumed VM) would silently invert the comparison.

The renderer increments `revision` on every `stageLumping` and writes it to both places:

| case | resolution |
|---|---|
| revisions equal | **no discrepancy — skip the prompt entirely** (the common case) |
| file revision higher | the PATCH never landed; **the file wins** — this is what "both" is for |
| DB revision higher | the crash beat the debounce; **the DB wins** |
| equal revision, different content | **a bug, not a conflict.** Log loudly, prefer the DB (what the rest of the app reads) |

Lumping is the **only** double-written item. Items 2–6 have no DB home, so the file is their
only copy and there is nothing to reconcile.

---

## 4. Mechanism

### Location and format

```
<userData>/recovery/<projectId>.recovery.json           (primary)
<userData>/recovery/<projectId>.recovery.declined.json  (declined)
<userData>/recovery/<projectId>.recovery.corrupt.json   (quarantine, never read)
```

Two slots, one offer. The scheduler writes and clears the **primary** slot only; the
**declined** slot holds a copy the user chose to keep but not restore. Readers prefer
the primary (a primary present alongside a declined one is strictly newer work), and
the start screen lists one entry per project, not per file.

**Presence wins only for a READABLE primary.** An unparseable, foreign, stale or
over-cap primary is garbage, not state — and left in place it hid a valid declined
copy at every launch, forever, because nothing ever deleted it. So `resolveSlot`
quarantines it (`renameSync` onto the third name, overwriting an older quarantine,
plus a WARN naming the reason) and falls through to the declined slot in the same
resolve. Nothing reads the quarantine; it survives for support questions and goes
with the rest on Discard.

No sibling `.bak`: the write goes through `writeFileAtomic` (temp file, then rename), so a
reader already sees either the old file or the new one and never a blend — a second copy would
buy nothing and cost cap, list and skip handling.

One file **per project id**, not per session: recovery is offered per project, the id is the
natural key, and "which project is this?" becomes unanswerable by mistake. `kind` +
`format_version` (starting at `1`, deliberately **not** coupled to `PROJECT_FILE_FORMAT_VERSION`)
are the compatibility gate.

### Write trigger: debounce **and** a cap

`RECOVERY_DEBOUNCE_MS = 2_000`, `RECOVERY_MAX_LATENCY_MS = 15_000`.

A pure timer was rejected — it rewrites an unchanged file forever and blunts the existence
signal. A pure debounce was rejected — sustained ghost triage starves it. The cap bounds
worst-case loss at 15 s of continuous work.

### Crash detection: the file's own existence

No sentinel, no heartbeat. Today a clean quit and a hard crash leave byte-identical state on
disk. This design *creates* the discriminator by making the **clean paths delete the file**, so
a file present at launch means the previous session reached no clean exit.

Three consequences worth stating:

* `process.exit(1)` on `uncaughtException` bypasses `before-quit`; the file survives. Correct —
  that is a crash.
* The backend-failed forced quit leaves the file. Also correct.
* **Deletion must NOT hang off `app.on('before-quit')`.** Electron fires it *before* the window
  close handler shows the unsaved-changes prompt, so hooking deletion there would destroy the
  recovery file for a quit the user then cancels. Deletion is renderer-driven, downstream of the
  user's decision.

### Clearing

Three deletes, because three different intents were being spelled with one call:

| path | clears | why |
|---|---|---|
| the prompt's **Discard unsaved work** | **both slots** (+ the quarantine) | the user asked for the work to be gone; leaving a declined copy would re-offer it every launch and make the button look broken |
| the prompt's **Restore**, after the promoting write | **declined only** | the restore promotes the offered snapshot into the primary slot, so the decline is over. Without this the declined file sits behind the new primary, every clean exit clears only the primary, and the same work is offered at every launch forever — a user who restores could never make the prompt stop |
| every other decided exit — save, discard-and-close, close, quit — and the scheduler's dirty→clean transition | **primary only** | these mean "*this session's* delta has a durable home now". They say nothing about a copy declined in an earlier session, and taking it would restore the exact silent loss the declined slot removes |

**Restore writes before it deletes, never the reverse.** The app can die between the
two calls; deleting first would leave an instant in which the only copy of the
restored, at-risk work is the one in memory. The write is idempotent when the
snapshot already came from the primary slot, and is the durable replacement when it
did not — so a failed write means the declined copy stays exactly where it is.

### The scheduler is suspended while the prompt is unanswered

`useRecoveryAutosave` takes a `suspended` flag; App passes
`suspended={recoveryOffer !== null}`. For that window the files on disk are the
*crashed* session's, not this one's, and two races follow from letting the scheduler
run into it: a debounced write landing between an answer handler's two IPC calls
replaces the crashed copy with this session's much thinner delta (the decline then
preserves *that*, keeping the promise in name only), and a decided exit taken while
the prompt is still up runs `clearRecoveryNow` and deletes a crash copy the user
never answered for. Suspended, nothing is scheduled and every clear is a no-op with
an INFO line; quitting mid-question keeps the copy and is re-offered next launch.
The three answer handlers finish their IPC work **before** clearing the offer, so the
whole answer sequence runs under the suspension.

The post-save clear is **gated on the file write, not the return value** — `lastSaveWroteFile()`,
never `saveProject()`'s boolean. The two agree today (a failed `writeProjectFile` now makes
`saveProject` return `false`, since close-without-save replays the FILE over the database, so a
silently stale file is a data-loss path, not a DB-is-authoritative nicety), but they answer
different questions and must stay separate: the boolean says "did this save succeed", the
file-write signal says "does the delta have a durable home". `recoveryClearAllowed()` keeps the
third state distinct — a session that has never saved has no failed write to distrust.

**"Open without restoring" writes before it moves.** A crash-reopened project is at risk from
the moment it mounts (the session-import sets survive in localStorage), so the scheduler can
overwrite the primary slot with this session's much thinner delta while the prompt is still up.
Moving *that* would keep the promise in name only, so the offered snapshot — the one the prompt
itemised — is written back first and then moved. The cost is the write timestamp: the next
launch dates the copy from the decline rather than from the crash. Payload fidelity beats age
fidelity; the age line informs a judgement, the payload is the work.

**Ordering trap:** cancel every pending debounce/cap timer *inside* the clear path. A late timer
firing after a clean save resurrects the file and produces a false recovery offer next launch.

---

## 5. Security posture for the new IPC

The existing `authorisePath` / `pathIsAuthorised` set is populated only by OS dialogs. It is a
**single flat set with no per-channel scoping** — the same predicate gates `fs:read-file`,
`project:read-file`, `project:write-file` and `export:write-file`.

**Do not authorise the recovery directory.** Doing so would simultaneously make it readable
through the generic read channels, widening the renderer's filesystem surface for no benefit.

**The renderer never supplies a path.** It supplies a `projectId`; main validates it against a
strict UUID regex and resolves the path itself under `userData`. No traversal input reaches
`join()`. This is strictly tighter than the existing `.strix` channel.

---

## 6. Open owner questions

* ~~**Q3** — three choices in the prompt (Restore / Open without restoring / Discard) or
  two?~~ **ANSWERED (owner, 2026-08-02): three**, plus a Word-style "Recovered work"
  entry on the start screen. Shipped.
* ~~**Q4** — add `requestSingleInstanceLock()`?~~ **ANSWERED (owner, 2026-08-03): yes.**
  Shipped: the loser quits, the winner restores and focuses its window. The lock is
  requested unless `STRIX_DISABLE_SINGLE_INSTANCE` is set *and* the build is
  unpackaged — the Playwright harness sets it, because ~166 launches share one
  userData dir and a single lingering process would make every subsequent launch a
  lock loser that exits before creating a window. The winner's `second-instance`
  handler logs the argv it drops (opening a handed-over `.strix` is a future
  deep-link feature, debt #200).
* ~~**Q6** — gate `View → Reload` and DevTools on `!app.isPackaged` now (debt #200)?~~
  **ANSWERED (owner, 2026-08-03): yes.** Shipped: packaged builds register neither role
  (so neither do their accelerators) and `webPreferences.devTools` is off. Consequence
  paid for in the same pass: the renderer's close-flow INFO lines became invisible in
  packaged builds, so each one is now mirrored to the main process through a single
  `app:close-flow-note` channel (`utils/closeFlowNote`) and prints as
  `[renderer] …` beside main's own close lines. Close flow only — deliberately not a
  general log bridge. (`--remote-debugging-port` / `--inspect` remain open; that is a
  tamper surface, tracked under debt #5.)
* **Q7** — confirm the undo stack is out of scope *permanently*, so it stops being an open
  question.
* **Q8** — SHIPPED 2026-08-05: `writeFileAtomic` fsyncs the temp file before the
  rename, so every caller (recovery snapshots, `.strix` saves, binary exports) is
  durable against power loss, not just process death. Directory-entry fsync is not
  reachable from Node on Windows — file-data flush is where the hardening stops.

---

## 7. Recovery points before a destructive write (production-readiness audit H2)

§1 covers a *crash*: Postgres outlives Electron, so nothing interpreted is lost. Two other
events can destroy good data even without a crash — a **mistaken save** over a `.strix`, and a
**destructive schema migration** on launch. Both now leave a recovery point.

### `.strix` save generations (H2a)

`File → Save` keeps the previous **three** generations beside the file, rotated:
`<name>.strix.1` (the most recent previous save) … `<name>.strix.3` (the oldest kept). A
mistaken save can be undone by hand by renaming a generation back.

The mechanism is `writeFileAtomicKeepingGenerations(path, bytes, keep=3)` in
`desktop/src/main/atomicWrite.ts`: it writes + fsyncs the new content to a temp file first,
then rotates the existing file to `.1` (unlink the oldest `.keep`, shift `.i → .i+1`, then
`<name> → .1`), then renames the temp into place. **Rotation is best-effort — a rotation
failure never fails the save**; it is logged and the save proceeds (at worst one recovery copy
is missing, never the save itself). Only the `.strix` project-save IPC uses it; the recents
list, exports and the recovery snapshot keep the plain `writeFileAtomic`.

### Pre-write empty-bundle guard (H2a2, debt #225)

Generations recover a save the user *meant* differently. A different failure needs stopping
BEFORE it reaches disk: a `File → Save` fetches `GET /bundle` and the export comes back
**empty for a collection the model actually holds** — a transient bad state (observed
2026-06-25: a bundle returned `litho_contact_correlation_edges: []` while the database held
481). Writing that would overwrite the `.strix` with hollow data; the generations would still
hold the last good copy, but the user's live file would silently go empty.

`useProject` keeps a per-collection count of the last opened / saved file
(`lastKnownBundleCountsRef`), seeded on every open / restore / new / Save-As adopt and
refreshed after each successful save — "what the app knows it holds". Before `writeProjectFile`,
both `saveProject` and `saveAsProject` run `guardEmptyBundle`: it counts the freshly fetched
bundle (`utils/saveBundleGuard.ts` `countBundleCollections`) and calls `assessEmptyBundleGuard`.
A collection that came back `0` while the app expects rows does NOT abort the save.
The rule is **retry once, then ask** (owner ruling, 2026-09-21): `guardEmptyBundle`
re-fetches the bundle once, because the observed cause is a transient bad export
state, and writes the healed bundle when the retry comes back populated (WARNING
log, no toast, the save simply succeeds). Only when the re-fetch STILL reads `0`
does it ask, through a `ConfirmDialog` with Cancel default-focused and a danger
button reading "Save anyway" / "Toch opslaan", listing each collection as
"{label}: last save {expected}, now {now}". Confirm writes the still-empty bundle;
Cancel writes nothing, so `saveProject` returns `false`, the project stays dirty,
`fileWriteSucceeded` stays `false` (the recovery file is kept) and Save-As rolls
its freshly-minted duplicate row back. The imported collections' expected counts
are the live session manifest; the interpretation collections'
(`litho_contact_correlation_edges`, per-model `litho_layers` / `contacts`,
`bodies`) the last file. A collection with an unknown expected count (null ref
before the first open) is unguarded, so a save is never blocked on a count the app
cannot trust. **Why a question and not a refusal:** a first version hard-blocked
the write, which broke the ordinary case of deliberately clearing a model and
saving; asking keeps the data-loss protection without ever trapping the engineer.

### Pre-migration `pg_dump` checkpoint (H2b)

The packaged app runs `alembic upgrade head` on every launch (`DatabaseMigrator`,
`src/groundmodel/infrastructure/db/database_migrator.py`). When the database is stamped
*behind* head (pending migrations exist), a `pg_dump -Fc` of the whole database is written to
`<userData>/backups/pre-<from_rev>-<to_rev>-<timestamp>.dump` **before** the upgrade runs. The
five newest dumps are kept (older pruned). A dump failure **aborts the upgrade** with a named
error (`stage = "backup"`, migrate exit code 5) — the app never migrates a store with pending
data-rewriting migrations without a checkpoint first.

* The `pg_dump` binary path and the backup directory reach the migrator as the env vars
  `STRIX_PG_DUMP_PATH` and `STRIX_BACKUP_DIR`, set by the packaged launcher the same way the
  DSN is. **In dev neither is set and the dump is skipped** with an INFO line (a dev DB is not
  the user's only copy).
* A migration module may declare `DATA_REWRITE = True`; the migrator names which pending
  migrations rewrite user rows in the log, so the checkpoint is visibly warranted. Declared
  today on the geo-label twin merge (`a4b5c6d7e8f9`), the correlation-edge / formation-contact
  / body-boundary-shape deletes, the GEF-CRS rewrite, and the `sample.geotech_body_id` FK
  migration.

### Newer-database guard (H2c / M8)

An older build opened over a store a **newer** StrixGeo already migrated is stamped at a
revision this build's migration graph does not contain. That now raises `NewerDatabaseError`
(migrate exit code 6) — "install the current version of StrixGeo; your data is intact" —
BEFORE any upgrade, so the launcher shows that specific copy instead of bricking with a
generic "migration failed". Two adjacent hardenings: `initialiseCluster`
(`embedded/postgresCluster.ts`) reads `PG_VERSION` and refuses a data directory whose
PostgreSQL major differs from the bundled major (`EXPECTED_POSTGRES_MAJOR`), and the migration
timeout scales with the data-directory size (`migrationTimeoutMs`, base 180 s + 60 s/GB) and is
named in the failure copy, so a legitimately slow migration on a large store is not killed and
retried every launch.
