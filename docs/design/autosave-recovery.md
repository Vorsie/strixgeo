# Autosave + crash recovery

**Status 2026-08-02:** design APPROVED, backend + main-process halves SHIPPED: the three
lumping columns (`c5b81d7a4e39`), the staged/promote API with the monotonic 409 revision
guard, and the Electron recovery-file store + IPC (capped, atomic, case-canonical ids).
NOT STARTED: the renderer wiring (debounce/cap scheduler, ghost serialisation, revision
increments) and the start-screen prompt. Load before touching autosave, the recovery file,
or the stratigraphy lumping map.

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
<userData>/recovery/<projectId>.recovery.json
```

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

After a save **gated on the file write, not the return value** — `saveProject` swallows a
`writeProjectFile` failure and returns `true` anyway; that is defensible for the DB but wrong as
a recovery signal, since a failed file write means the delta still has no durable home. Also
after Discard, after close-with-decision, on explicit "Discard unsaved work", and when all six
watched values return to clean mid-session.

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

* **Q3** — three choices in the prompt (Restore / Open without restoring / Discard) or two?
  Three recommended; Word uses three.
* **Q4** — add `requestSingleInstanceLock()`? Two instances are already broken by the `:8765`
  bind. Cheap; recommended.
* **Q6** — gate `View → Reload` and DevTools on `!app.isPackaged` now (debt #200)? It is the
  single most likely accidental trigger of the loss this feature mitigates.
* **Q7** — confirm the undo stack is out of scope *permanently*, so it stops being an open
  question.
* **Q8** — `writeFileAtomic` has no `fsync` anywhere: atomic against a process kill, not durable
  against power loss. Scoped here to the recovery write only; the `.strix` is the more valuable
  file. Separate change?
