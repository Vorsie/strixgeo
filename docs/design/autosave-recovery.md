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
implements.
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
| 2 | **Litho ghost workspace** (`ghostsByAnchor`) | Self-documented "Ephemeral — not persisted". 14 mutating gestures, **zero API traffic** until Accept. The suggestions are re-derivable; the edits, rejections, splits and manual ghosts are irreproducible human triage. |
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

The post-save clear is **gated on the file write, not the return value** — `saveProject`
swallows a `writeProjectFile` failure and returns `true` anyway; that is defensible for the DB
but wrong as a recovery signal, since a failed file write means the delta still has no durable
home.

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
* **Q8** — `writeFileAtomic` has no `fsync` anywhere: atomic against a process kill, not durable
  against power loss. Scoped here to the recovery write only; the `.strix` is the more valuable
  file. Separate change?
