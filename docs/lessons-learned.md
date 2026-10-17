# Engineering Lessons — Strix

Transferable, hard-won lessons. Each is a *rule* + the concrete instance that taught it + how to apply. Add to this when a bug or process gap teaches something a future session (or a future Claude) would otherwise repeat. Keep it to genuinely non-obvious lessons — not things the code or CLAUDE.md already say.

---

## 2026-07-26 — The geotech save/reopen data-loss bug (codex safety audit)

### 15. A new model *kind* that reuses a table with kind-gated triggers can silently lose data on restore — audit the whole round-trip, not the create path.
Geotech subdivision reuses the `litho_layer` table and the "Shape A" idea (layers are truth, contacts are a derived mirror). The create path worked. But **reopening** a saved subdivided project dropped every geotech layer: the bundle serialized geotech's FC-mirror *contacts* (unlike litho, which emits `contacts=[]`), so restore's de-dupe **skipped** the explicit geotech-layer insert and deferred to the FC→LL trigger — which is **gated to `lithostratigraphic` only** (`mirror_litho_contact_to_layer`, migration `p0j1k2l3m4n5:73`). No layer → dangling correlation edges → FK 500 / silent loss. Two asymmetries (serialization + trigger kind-gate) lined up to lose data only on the round-trip. Fix: serialize geotech as Shape-A (`NON_STRATIGRAPHIC_KINDS`) so layers restore explicitly, and the *un-gated* LL→FC trigger rebuilds the mirror; plus reconcile `body_id` for geotech too.
**Apply:** when a new `kind` reuses a table that has kind-gated triggers or kind-branched serialization, write the **save → close → reopen** regression test before calling it shipped. Grep every `IF ... kind` in the triggers and every `if model.kind ==` in the bundle serializer/restorer and confirm the new kind is handled on *both* the write and the read side. Create-path green says nothing about round-trip survival.

### 16. A disproven hypothesis + a symptom that won't quit = keep pulling the thread; the harness "artifact" may be the real bug.
The audit flagged a suspected restore *ordering* P0. It **didn't reproduce** (SQLAlchemy batches inserts — proven with child-before-parent tests). But writing the geotech round-trip test kept hitting obstacles — a `MissingGreenlet`, an HTTP 500, then a DB FK violation — each of which *looked* like a test-harness problem. Chasing "why does the harness fight me" (rather than papering over it with `expunge_all`/session tweaks) led straight to the real, worse defect above. The FK violation **was** the bug, not an artifact.
**Apply:** when a suspected bug is disproven but a related symptom persists, don't close the ticket — the real defect is usually adjacent. And when the test harness repeatedly resists (greenlet errors, 500s, FK violations that survive the obvious session fixes), treat the resistance as a signal about the *system*, not just the test. Verify a reproduction is real vs. artifact by reading the code path the error names, not by assuming.

---

## 2026-06-30 — Geotech body model + the whole-codebase observability/testing audit

### 1. An all-or-nothing match rule almost never matches on real data — match *partially* along the lines you already have.
The geotech auto-correlate connected two columns' packing sub-bands **only when their full NAD-class sequences were identical**. On the real CS1 section the sequences differed on every pair (`S7 [6,6,7,8]` vs `S11 [6,8,5]`), so it emitted **zero** edges and the sands rendered as 13 disconnected bodies — even though the litho unit was one connected sand. The fix: walk the **existing litho correlation edges** and connect each same-class band in the **longest-common-subsequence** of the two stacks (`aligned_same_class_pairs`). Sand edges went 0→8, bodies 13→9 on real data.
**Apply:** when a feature "derives from" an existing connectivity (litho→geotech, geo→litho), *inherit and refine* that connectivity per-element; never gate the whole inheritance on a strict full-shape equality. Strict equality is for fixtures, not field data.

### 2. Never reason about identity from a truncated UUID.
"All the sands share body `019f1922`" was wrong — uuid7 is time-ordered, so 13 *different* bodies created in the same second shared the 8-char prefix. The "one body" conclusion sent the diagnosis in the wrong direction for a step.
**Apply:** in any diagnostic query/log that compares identity, print the **full** uuid. (Encoded in the `debugging-scientist` agent.)

### 3. Integration tests must have an automated trigger, or a RED one will ship.
A stale `BH1-2` integration assertion (expecting `body_id=None` after Task B intentionally changed it to assign one) shipped RED and went unnoticed — because the pre-commit hook runs `tests/unit` + desktop Vitest only, and CI explicitly skips integration. Every watertight invariant, importer round-trip, and bundle-restore guard lives in `tests/integration`, run only by the manual wrapper.
**Apply:** the `.githooks/pre-push` hook now runs the integration suite when `src/groundmodel/**` or `tests/integration/**` change. A path-gated PR-only CI job is the durable upgrade. Don't let a whole correctness layer depend on a human remembering to run a script.

### 4. The real-data gate must assert the invariant the feature protects — not just adjacent ones.
The CS1 gate checked litho≠class / null-class / sample-assignment, but **not connectivity** — the exact property that then broke silently on real data (connected litho → disconnected geotech). Synthetic LCS unit tests passed while the real section was wrong. This is the recurring "synthetic is necessary-not-sufficient" trap (it has now bitten on the strat builder, the deep-substrate fill, and here).
**Apply:** when a change enforces an invariant, add that invariant to the **real-data gate**, and prefer a checked-in frozen real-section fixture over an env-gated dev-DB extract that self-skips on a clean checkout.

### 5. Run the logging + testing reviewer pass *after* implementation — implementers mis-judge observability and tests.
Within one applied batch: the implementer **over-promoted** high-frequency per-drag logs to INFO (hundreds per editing session) and added a `log` call **inside a module declared pure**; and wrote a "regression test" (`PF-2`) whose docstring claimed a partial-survivor scenario but which returned `[]` — a **vacuous duplicate** that left the load-bearing counting path untested. The `logging-reviewer` and `testing-reviewer` agents caught all of it.
**Apply:** the Combined Workflow (implement → logging-review → testing-review → revise) is not ceremony — the reviewers catch the implementer's blind spots every time. Use the dedicated agents, not a general one.

### 6. A regression test is only real if it goes RED on the old code — verify that, don't assume it.
`PF-2` would have passed on the buggy code (it tested the wrong branch). A bug-fix test that was never seen to fail on the pre-fix code is not a regression test; it's decoration that can silently rot (see also the CLAUDE.md "the test WAS the regression" tale).
**Apply:** state how you confirmed the test fails on the old behaviour. If you can't make it fail, the test is testing the wrong thing.

### 7. Load-bearing breadcrumbs at DEBUG are invisible exactly where you dogfeed.
The renderer's `log.ts` suppresses `debug` on packaged builds, and Chrome hides `console.debug` under "Default levels" even in dev. So the drag-commit/branch-decision logs the owner needs during a dogfeed session were silent on the build they actually run.
**Apply:** a breadcrumb that frames a user-reported "it did the wrong thing" (stage/axis, gesture branch, mutation outcome) is **INFO**, not DEBUG. DEBUG is for per-row/per-frame verbosity that would flood INFO.

### 8. A subagent's "done" is a claim, not proof — and a premature/partial return is common.
Two subagents returned mid-work (one left orphaned background `pytest` processes; one returned without a status). One reported "done" while leaving a RED integration test the pre-commit hook couldn't see. The controller verifying the actual git state + running the real gate caught all three. A later instance was worse: a subagent committed 669 lines of regression *tests* for four fixes while applying only ~1 of them — leaving RED tests for missing code, one source file modified-but-uncommitted, and the primary target file entirely untouched. Its final message was truncated and off-topic (a tell). `git log --stat` + `git diff --stat <base> -- <expected-file>` exposed the gap in two commands.
**Apply:** after a subagent reports done, check the git state, run the load-bearing gate yourself, and read the diff — especially for premature returns and tests that didn't run in the hook. A truncated/off-topic final message means assume nothing shipped; verify per-file. When a security/multi-file fix flakes, finishing it directly (you have the reviewer's exact fixes + full context) is usually faster and safer than re-dispatching into another flake.

### 9. Fix ONE instance of a vulnerability *class*, then sweep every sibling before closing it.
The geotech-unit restore IDOR fix was correct — but a `security-reviewer` pass over the *rest* of the restore path found the identical pattern (a cross-project FK the DB accepts because the referenced row exists under another project) on four more entities: `FormationContactOrm.borehole_id`/`cpt_id` (HIGH, untested), `FormationAbsenceOrm.investigation_id` (polymorphic UUID, no DB FK at all), the `LithoBodySolidOrm` geometry (no size cap → OOM vector), and an unwhitelisted review `target_kind`. All flowed through the same shared restore helpers. Fixing only the reported instance would have left the class open.
**Apply:** the moment you fix a security bug, ask "what is the *class*, and where else does it live?" Grep every caller of the shared helper / every entity with the same column shape (`*_id` FKs, polymorphic UUIDs, unbounded JSONB blobs, enum-dispatched strings). Run the dedicated `security-reviewer` on the surrounding surface, not just the one line. A single-instance security fix is a false sense of closure — the reviewer's whole value here was proving the class wasn't closed. The frozen counterpart: also add the missing regression test for the *class* (a valid-formation-but-foreign-investigation contact had zero coverage and passed every existing test).

---

## 2026-07-01 — Backlogged-hook test coverage (the audit tail)

### 10. Writing tests for un-tested code is how you find the shipped bugs — but only if you PROVE the failure, not "fix" it.
Adding a first test suite to `useInvestigationData` (872 LOC, previously zero tests) surfaced a live, shipped bug: `unhideCpts`/`unhideBoreholes` built their `touched` id-list as a **side-effect inside the `setRemovedCptIds` functional updater**, then read `touched.length` **synchronously on the next line**. Under React 18 automatic batching the updater is *deferred to the render phase*, so `touched` was always empty at the synchronous guard → the `is_hidden=false` upsert never fired → a 409-re-imported CPT came back **hidden on the next project load** (the exact failure the code comment says the logic exists to prevent). The local removed-set clear masked it within the session, which is why it shipped. The `testing-reviewer` proposed the test that went RED; the `debugging-scientist` then **proved** (instrumented logs across event-handler, promise-continuation, and effect contexts) that it was a real production bug and not a test-timing artifact — killing the tempting "it's just the test harness" escape hatch. The working sibling `handleRestoreAllCpts` already did it right (compute the list from the closure's current state *before* `setState`); the fix mirrored that.
**Apply:** (a) the highest-value place to add tests is the large hook/module with *none* — that's where the un-caught bugs are. (b) A React functional `setState(prev => …)` updater runs later; never read a variable it mutates on the following synchronous line. Compute the derived list from current state *before* calling `setState`, and add that state to the dep array. (c) When a new test fails in a way that *could* be "just the harness," don't rationalise — instrument the real code in the real call contexts and prove which it is. A guessed "test artifact" verdict would have buried a real data-loss-shaped bug.

---

## 2026-06-11 — a wasted day (the floor-clip / geo-coupled fill thread, reverted `git reset --hard f66ac920`)

### 11. Establish WHERE before HOW — name the render surface / owning layer FIRST.
A feature was built in the 2D section render when it belonged in the 3D litho builder. The target was knowable from three ignored signals: the branch name, the memory file, and a same-day approved spec that literally said "no section-lofting, no frontend plumbing."
**Apply:** before brainstorming any feature, the first paraphrase-back question is *"which surface does this render in / which layer owns it?"* — a hard gate alongside core-problem / who / success / not-do.

### 12. Check done-ness against memory + `git log`, not a spec's status line.
A spec saying "ready to implement" with unchecked boxes can describe ALREADY-SHIPPED work.
**Apply:** before acting on any spec/plan, grep the memory and `git log --oneline` for whether it already shipped.

### 13. When the user gives the same correction twice, STOP iterating the implementation and re-locate the target.
"We've been going in circles all day" / "not even close" are signals the *frame* is wrong, not the *code*.
**Apply:** re-derive what surface / layer / data the feature lives in before the next edit.

### 14. Don't stack new work on an un-dogfed, unmerged branch foundation without flagging it.
It compounds the mess and makes the eventual revert bigger.
**Apply:** flag the shaky foundation before building on it; prefer a clean base.

---

## 2026-07-27 — the voxel model-fidelity investigation

### 15. Prove an offline diagnostic reproduces the production output BEFORE trusting a single conclusion it draws.
Diagnosing the built 3-D litho model needed the frontend's 2-D partition payload, which is not stored anywhere — so the harness had to be rebuilt offline from a captured payload. Two ways to get that wrong bit immediately. (a) The **first** diagnostic recovered the voxel lattice from the persisted mesh vertices and measured a 1 m step for a 2 m grid — the greedy mesher's pinch-splitting inserts coincident edge MIDPOINTS, which are not lattice nodes. Every grid cell it reported was therefore wrong, and it named the wrong pair of boreholes as colliding. (b) The committed oracle fixture was captured from the v1 partition engine, while the build under investigation used v2 — diagnosing against it would have been a diagnosis of a model the owner never saw.
**Apply:** an offline reproduction of a production pipeline is a *hypothesis about the inputs* until it reproduces the production *output*. Make that the harness's first assertion: here, the A/B's control arm had to return the persisted build's exact fidelity numbers (49 covered / 9 uncovered / 41 exact / 8 wrong) before either arm meant anything. Never infer a pipeline's parameters from its output artifacts when the parameters are recorded somewhere authoritative (the project view-state held `voxel_horizontal_spacing_m = 2` all along).

### 16. When two subsystems consume "the position of X", check they mean the SAME position.
The voxel builder framed its model footprint from the section columns' **projected feet** (where an investigation meets the section line) but honored each investigation's drilled log at its **true map position** — two different points, 0.5–64.9 m apart on real data, inside one use case. Nine of 58 interpreted investigations consequently sat outside the footprint that gates labelling, and the model had no material at all where the ground was drilled. Both behaviours were separately documented and separately correct; the contradiction only existed between them.
**Apply:** when an entity has more than one legitimate position (true vs projected, raw vs snapped, screen vs world), treat "which one does this consumer mean?" as a review question at every consumer, and say which one in the parameter name. A footprint that gates *honored* data must be built from the *honored* positions.

### 17. A resolution limit is not a bug — but silently picking a winner is.
Two investigations closer than one voxel cannot both be represented on a regular grid; the builder honored whichever had the lexicographically smaller UUID, which on time-ordered UUIDv7 means "whichever was imported first". The loser's drilled log was replaced by its neighbour's *at the loser's own map position* — the model asserting borehole A's stratigraphy where borehole B was drilled — with nothing in the log to say so. Worse, which pairs collide depends on where the grid origin falls, so the defect set moved when an unrelated fix changed the footprint.
**Apply:** where a discretisation forces a choice between two pieces of real data, the choice is a domain rule the owner has to make — but the *reporting* of it never is. Log every contended pair by name at WARNING before asking the question, and record the arbitrary rule as debt rather than letting it read as intent.

## Verify freshness by CONTENT, not by a timestamp column (2026-07-29)

A `litho_body_solid` upsert wrote correct, current meshes while leaving
`updated_at` at the value from the build that first created the row. The ORM
column declares `onupdate=func.now()`, but that only fires on an ORM-level
UPDATE — a Core `pg_insert(...).on_conflict_do_update(set_=...)` bypasses it
entirely.

The failure this caused was not the stale column itself. It was that a
diagnosis read the timestamp, saw yesterday's date, and concluded twice — to the
owner — that a successful 61-second build had never persisted. The owner rebuilt,
saw no error, and was told again that nothing had been written. Only the backend
log settled it, and the decisive check took one query: the row content carried
**790,910 triangles, exactly the number that build's log reported**.

Two rules out of it:

* **A metadata column is a claim; the payload is the evidence.** When asking "is
  this data fresh?", compare something the process actually computes — a count, a
  checksum, a total — against what the process said it produced. `updated_at` is
  a convenience, and a convenience that can silently be wrong.
* **A row count that matches the new run while the timestamp matches the old one
  is a contradiction, not a curiosity.** 81 rows against a log saying `built=81`
  should have been read as "the write happened" long before it was.

Any `on_conflict_do_update` that omits `updated_at` from its `set_` has this
bug; the ORM declaration will not save it.


## A test guards only what a WRONG implementation would fail (2026-08-09)

Two pure functions shipped with tests that read as thorough and were partly
blind. `packingSnapCandidates` sorted its input, and every fixture happened to
arrive already sorted — delete the sort, suite stays green. `clampToNextBoundary`
documented that it does not depend on candidate order, and its fixture was
sorted too, so "first crossed" and "nearest to the origin" coincided; a wrong
implementation that returned the first in range passed the test written to pin
the nearest.

Both were found the same way, and not by re-reading the assertions: by asking
*what wrong implementation would still pass this?* and then writing that wrong
implementation and running it. A careful read had already judged both adequate.

* **Reading a test tells you what it says. Mutating the code tells you what it
  catches.** Comment out the line the test exists to protect. If it stays green,
  the test is describing behaviour rather than defending it.
* **The most suspicious test is the one whose fixture satisfies the property by
  accident.** Sorted inputs, contiguous depths, values that happen to be
  distinct — anywhere the data makes two different rules agree, only one of them
  is actually pinned.
* **Cost is trivial.** Three edits and three runs covered both functions here,
  and it surfaced a surviving mutant that a deliberate review pass had missed
  once already.

Related, from the same session: a test asserting an ABSENCE (no grip on a
non-draggable boundary) can never go red before the feature exists. It is worth
keeping as a regression guard, but it is not TDD evidence and must not be
counted toward a RED-first claim.

## The pre-commit hook serialises concurrent agents (2026-08-09)

`.githooks/pre-commit` runs a project-wide `tsc --noEmit`, so it type-checks the
whole WORKING TREE, not the files being committed. Two consequences, both hit in
one session:

* **RED-first commits are impossible without a bypass.** Committing a failing
  test on its own cannot pass a hook that runs the suite. The sequence that
  satisfies both: write the test, run it, *record the RED*, commit nothing, write
  the implementation, confirm green, then commit test and implementation as
  separate commits — the hook passes on both because the tree is green by then.
  The RED evidence lives in the transcript, which costs nothing real.
* **Two agents sharing a worktree block each other even on disjoint files.** One
  agent's half-written import fails everyone's `tsc`, so all commits stop. Either
  serialise implementers or give each a worktree. Standing down and waiting is
  the correct response — never `--no-verify`, never a retry loop.

## Hiding a window to let its work finish is what stops the work (2026-08-10)

The close flow hides the main window as soon as the engineer answers
save-or-discard, then finishes the restore in the background so the desktop comes
back immediately. Chromium backgrounds a hidden window and throttles its timers,
so the hide starved the very work it existed to permit: the app never reached its
own quit handshake and the process lingered with no window to show for it.
`webPreferences.backgroundThrottling: false` is the fix.

Three things worth carrying:

* **Any renderer work that must outlive the window's visibility needs the flag.**
  Hiding is not backgrounding-in-the-colloquial-sense; to Chromium it is a signal
  that nothing on the page matters any more.
* **The symptom was nowhere near the cause.** It surfaced as an e2e worker
  teardown timeout on `flow_litho_facies` — a spec about lithology groups, which
  passed alone in 14 s and hung for the full 180 s test timeout in any group run.
  The failure screenshot showed the build complete and no dialog, i.e. the test
  had finished its assertions; the hang was in `closeApp`. Spec-scoped debugging
  would never have reached the window options.
* **Bisect by disabling the suspect, not by reasoning about it.** Two theories
  (a slow restore, a large payload fetch) were both plausible and both wrong; a
  measurement killed the first (a replace-restore took 0.3 s). Making the hide a
  no-op and re-running the failing pair answered it in four minutes: 16.4 s,
  green. Then restore the suspect and fix it properly, so the fix is verified
  against the real failure rather than against its absence.

## A smoke script that re-implements the steps tests the script (2026-08-27)

The bundled-Postgres bring-up (debt #2) was verified with a PowerShell script
that ran `initdb`, started the server, then invoked the migrator. It passed on
the first try. The packaged app then failed on its very first boot, on the
first step the script had "proved", with a 100 %-reproducible error: `initdb`
refuses any target directory that is not empty, and the real code wrote its
`--pwfile` **inside** the data directory before calling it. The script had
written that file to the parent, because that is where a human naturally puts
a temp file. It never executed a line of the code it was vouching for.

* **A harness that reproduces the steps proves the steps are possible, not
  that your code performs them.** The only thing that tests the code is
  calling the code. The fix was an opt-in vitest spec that imports
  `startEmbeddedStack` itself and runs it against the real staged binaries in
  a `mkdtemp` profile on an ephemeral port — no Electron, no window, safe to
  run while the app is in use. It would have failed on day one.
* **Injected seams hide integration bugs by construction — assert the
  contract inside the fake.** The same slice shipped an `alembic upgrade` that
  could never work (`migrations/env.py` calls `asyncio.run`, and the caller was
  already inside a loop) because the upgrade runner is constructor-injected and
  every unit test passed a fake. The durable fix was not just the one-line
  `asyncio.to_thread` but an assertion *inside the fake* that it is never
  invoked from a thread that owns a running loop — so the seam now enforces
  what the real implementation needs.
* **Corollary for anything that writes into a data directory a tool owns:**
  put transient files (password files, markers, locks) OUTSIDE it. Tools that
  demand an empty directory are common, and the failure is total, not partial.

## Never point a test run at the app's real user profile (2026-08-27)

Verifying the packaged build meant launching `dist/win-unpacked/StrixGeo.exe`.
It booted against `app.getPath('userData')` — which resolves from
`package.json`'s `name`, **not** electron-builder's `build.productName`, and so
is the *same* `%APPDATA%/ground-model-desktop` the dev app uses. The run
created a `pgdata`, a credentials file and a log inside the owner's live
profile, then popped a native error dialog on his desktop mid-session.

* **`productName` in the `build` block does not move `userData`.** If a
  packaged app should have its own profile, that has to be arranged
  deliberately — and changing it later orphans whatever the old path holds.
* **Isolate every launch:** `--user-data-dir=<throwaway>`, and never bind the
  dev backend's port (`memory/feedback_e2e_port_8765_conflicts_dev_app`).
  Prefer a headless test that drives the same code (previous lesson) over
  launching the app at all.
* **An error dialog is the wrong failure mode for an unattended process.** Log
  and exit; show a dialog only when a human actually asked for the launch.

## A gate that cannot see failure reports success (2026-08-28)

The pre-push hook ran the integration wrapper, captured its output, and
checked the exit code:

```sh
output="$(powershell.exe -File scripts/run-integration-tests.ps1 2>&1 || true)"
ps_exit=$?          # ALWAYS 0
```

`|| true` sits **inside** the command substitution, so the assignment's status
is the status of `true`. `ps_exit` was never anything but 0 and the "primary
gate" beneath it had been dead code since the day it was written. Proof is two
lines: `out="$(bash -c 'exit 7')"` → `$?` is 7; add `|| true` inside → 0. The
`|| true` was there because `set -e` would otherwise abort the hook — a real
problem solved in the one place that destroyed the signal. Use `set +e` around
the call instead.

* **A gate needs a positive assertion that it RAN, not only a check for
  failure.** The surviving grep for `N failed` looked adequate, but every path
  that exits *before* pytest starts — the wrapper's lock ABORT, an alembic
  failure, a collection error, a crash — prints no summary at all, matches no
  failure pattern, and was reported as **"Integration tests passed"**. Assert
  the summary line exists; treat its absence as a block.
* **Anything that shifts trust onto a gate is a reason to re-read the gate.**
  This surfaced the day a batch mode started skipping per-commit test layers on
  the argument that push-time and CI re-prove them. The weakening was fine; not
  checking the gate it leaned on was not.
* **Do not filter a gate's output when you capture it.** The same evening, a
  landing script piped `git push` through `Select-String 'develop|error|
  Integration'`, which dropped pytest's summary line while keeping test paths
  (they match "integration" case-insensitively) — making a green run look like
  a suite that never ran. Log the whole thing or log the summary deliberately.

## A time-ordered id has no unique prefix (2026-08-28)

The fence DXF exporter disambiguated colliding layer names with the first 8
characters of the formation id: `Fence-SAND (019fe4ac-3)`. Those ids are
**uuid7 — the leading bits are a millisecond timestamp**, so every row created
in the same few seconds shares them. Measured on the live project: **111
formations, 14 distinct 8-char prefixes, one prefix shared by 34 rows**
spanning KLEI 21/22/23 and SILT 13/14/15/16. The trailing `-N` was a bare
collision counter, so the "traceable" suffix identified nothing and a CAD user
faced 13 indistinguishable SAND layers.

* **Never truncate a uuid7 (or ULID, or any k-sortable id) for identity.** The
  entropy is at the END. Truncating a uuid4 is merely risky; truncating a
  time-ordered id is guaranteed to collide for rows created together — which
  is exactly how a pipeline creates them.
* **When a name needs to identify a thing, use the domain identifier.** The
  repo already had one (`unit_identifier` → `NAD-06_ZAND`) used by the section
  DXF and the Plaxis mapping table. The fence had grown its own scheme instead
  of reusing it, and no test compared the two.
* **A disambiguation suffix nobody can interpret is worse than a collision** —
  it looks resolved. A visible collision gets reported; an opaque suffix gets
  trusted.

## Measure the property that matters, not the one that is easy (2026-08-28)

Asked whether small patches in an exported fence were engine debris, the first
pass measured AREA and reported "223 slivers under 50 m², probably debris".
The owner asked the right question — *does every patch have a physical
thickness on the column?* — and the answer inverted the conclusion: **319 of
320 had real thickness (median 1.06 m, minimum 6 cm)**. A thin band that
pinches out over a short distance has small area and is perfectly real
geology. The single apparent exception was also a measurement artefact: the
script rounded plan positions to 10 cm cells and read the zero-thickness end
of a wedge that is 9.9 cm thick at its other end.

* **Area, count and size are proxies. Name the physical property first**, then
  find the measure for it. Here the question was "is there material here?",
  whose measure is thickness at the logged column — not area on a wall.
* **A proxy that supports a tidy conclusion deserves more suspicion, not
  less.** "223 pieces of debris" was a satisfying finding and completely wrong.
* **Rounding is part of the measurement.** A 10 cm plan tolerance silently
  converted a real wedge into a "point contact"; the tolerance, not the data,
  produced the anomaly.
* The proposed remedy would have made things worse: dropping sub-threshold
  patches deletes logged ground and punches holes in a model whose stated
  invariant is that it is gapless.

## 2026-09-02 — three from an autonomous landing day

* **A distribution build stages the working tree at the moment it starts.** `npm run dist`
  copies the backend, compiles it, then runs the behavioural native gate against the
  staged copy. Landing commits while it runs (even backend-only ones) gives the gate a
  half-landed tree — here a new test file with no compiled module behind it — and the
  build fails at the gate with a message that looks like a Nuitka deviation. Rule: no
  landings between `npm run dist` start and its gate; if in doubt, rebuild.
* **An e2e sweep red is a regression only if it fails solo.** On a 130-spec single-worker
  sweep, three specs timed out under load and passed alone, and one of those (a
  link-then-unlink round trip) left a stray contact that made a LATER spec's "zero
  crossings" assertion fail. Diagnose the earliest red first; rerun every red solo
  before reading code. A deterministic solo red was a stale spec encoding a rule the
  owner changed that morning — the spec's own comment named the old rule, which is the
  tell.
* **The security-guidance hook drops a whole Write on a text pattern match**, including
  a markdown plan that merely quotes `RegExp.prototype.exec` or React's raw-HTML prop.
  Reword the snippet (`str.match`, tag-stripped text); never route around the hook.

## 2026-09-02 — a later request-validation guard can silently disarm a concurrency test

* **A schema validator added after a race test can turn it into a false-green — if the
  test tolerates the resulting 4xx, it stays green while no longer racing.** BP-1
  (`test_body_partition_concurrency`) pins that a correlate ‖ bodies/recompute cannot
  500; its `_check` deliberately flags only `>= 500`, tolerating 409/422. Three days
  after it landed, the P1-3 recompute coverage guard added a validator requiring
  `section_ids` parallel to `sections`. BP-1's recompute payload never carried
  `section_ids`, so from then on its recompute arm 422'd at request validation — BEFORE
  the endpoint takes the body-partition lock — every round. The test kept passing (a 422
  is not a 500) but only the correlate side ever reached `_run_resolver`, so it would
  have stayed green even with the lock removed from recompute. Rule: when you add a
  request-schema guard, grep the tests that POST that endpoint and confirm their payloads
  still pass it — a concurrency test that tolerates 4xx will not tell you it stopped
  racing. Make a race test assert a 200 (or log both status codes), so a silenced arm
  fails loudly instead of passing on the 4xx.

## 2026-09-02 — a foreign-key ON DELETE action is a hidden write on the child row

* **A parent write that reaches a child through a foreign-key action counts as "touching
  the child" — so the child's lock must precede it.** A litho `bodies/recompute` and a
  geotech `bodies/recompute` fire independently and take DIFFERENT per-model advisory
  locks, so they run concurrently. The litho resolver deleted litho `body` rows, then — at
  the very end (step 6) — took the sibling geotech lock to re-stamp `parent_litho_body_id`.
  But deleting a litho body fires the `ON DELETE SET NULL` of the geotech rows'
  `parent_litho_body_id` FK, row-locking the geotech `body` rows before the geotech
  advisory lock was ever requested; a concurrent geotech recompute holding that advisory
  lock and deleting those same rows gave a textbook ABBA deadlock (8 victims in one e2e
  sweep, `DeadlockDetectedError` on `DELETE FROM body`, pinned red-first by BP-3
  `test_body_partition_litho_geotech_lock_order`). The documented order (litho parent
  first, geotech child second) was right; the flaw was taking the child lock AFTER a write
  that had already reached the child. Rule: when choosing where to acquire a child's lock,
  trace every `ON DELETE`/`ON UPDATE` FK action on the rows you're about to write — a `SET
  NULL`/`CASCADE` on a parent you delete IS a write on the child, so the child's lock has
  to come before that delete. Fix here: take the sibling geotech locks up front, right
  after the litho lock and before the first delete; belt and braces, run the lock helper's
  own SELECTs under `no_autoflush` so acquiring a lock never flushes a pending write first.
  Same class still unfixed in `clear_litho_model` / `delete_body` (they delete litho bodies
  without the geotech child lock — lower-probability, user-initiated).

## 2026-09-03 — a foreign-key KEY SHARE lock from a child insert is a hidden lock on the parent row

* **Every writer of a child row must take the same serialising lock as the code that
  rewrites the parent — inserting or updating a child row FOR-KEY-SHARE-locks the parent
  row it references, and that lock is invisible in the child writer's own SQL.** A
  `bodies/recompute` deletes/re-stamps `body` rows under a per-model advisory lock, while
  five use cases that write `litho_layer` rows (accept / batch-accept / move-boundary /
  update / bulk-create) took NO lock — yet each accepted `litho_layer` FK-references a
  `body`, so their INSERT/UPDATE holds a KEY-SHARE lock on the very `body` rows recompute
  is trying to delete. Recompute holds the advisory lock and waits on those rows; the
  writer holds the rows and (unlike recompute) never queued on the advisory lock — an ABBA
  deadlock the app hit every time accept + the debounced recompute overlapped
  (`flow_bulk_accept`), and when the victim rolled back mid-column the litho contiguity
  trigger then rejected the next accept. Rule: when one code path rewrites a parent table
  under a lock, grep for every path that writes a CHILD of that table and make it take the
  SAME lock before its first write — the FK KEY-SHARE is a real lock even though the child
  writer never names the parent. Fix here: each writer takes the model's partition lock
  (own litho, then sibling geotech) before its first write, once at the outermost use case
  (batch-accept takes it; the inner accept skips it in batch mode — advisory xact locks are
  re-entrant, so take it once to keep the contention log clean). Pinned red-first by
  `tests/unit/application/test_litho_write_lock_order.py` and by BP-4 in
  `test_body_partition_litho_write_recompute_race.py`.

## 2026-09-03 — readiness is confirmed against the PORT, so an exit after readiness is not always a crash

**What happened.** A full e2e sweep lost 40 of 42 UI specs to one fatal
"backend exited before it was ready" modal, on a tree whose previous sweep was
green. The app marks the backend ready by probing `:8765`, not by watching its
own child. In e2e (and in a dev session with an external uvicorn) the harness
already owns the port, so the app's child loses the bind and exits — and after
a reboot the cold child exited LATER than the renderer's first probe, so the
exit landed in the "died after readiness" branch. That branch respawned once
(a second loser), then the crash-loop guard gave up with the modal while every
request still succeeded. The warm-cache morning ordered the same two events
the other way round, which is why the morning sweep was green.

**Lesson.** When readiness comes from a port probe, an exit after readiness
must probe the port again before it is treated as a death:
`decideExitAfterReady` returns `'ignore'` while `:8765` still answers. More
generally: any "was ready, now died" rule needs to name WHICH process died —
ours, or the one that answered the probe.

**Two forensic traps on the way.** (1) Playwright's `line` reporter writes the
failed count behind cursor-control sequences (`ESC[1A ESC[2K`), so a grep for
`^\s*\d+ failed` on the raw log finds nothing and a sweep reads as "86 passed"
— strip `\[[0-9;?]*[A-Za-z]` before counting. (2) The screenshot settled it
in one look (the modal, in Dutch); forty identical "navigation not visible"
timeouts are a boot-level blocker, not forty bugs.

## 2026-09-03 — a system-language default silently changes every copy assertion in the suite

**What happened.** The app started defaulting to the system language (English
fallback) for the packaged beta. On the owner's Dutch machine every e2e launch
then rendered in Dutch, and the one spec that asserts copy ("Chapter 1") failed
while the testid-based specs still passed — a partial, confusing red.

**Lesson.** A locale default is an input to the test harness. Pin it at the
launch boundary (`--lang=en-US` in the e2e launch args; Chromium derives
`navigator.language` from it) rather than in the specs, and do it in the same
commit as the default change.

## 2026-09-03 — removing an exemption exposes the path the exemption was hiding

**What happened.** The licence gate had a "beta builds run on their stamp"
exemption, so every packaged build so far passed straight through. The owner
ruled the beta must require a key. The gate change itself was test-first and
green — and the first install showed "Kon de StrixGeo API niet starten" over
the key page: the boot hook asked the main process for API readiness on mount,
the main process answered "not running" because the engine was deliberately
deferred until activation, and the App rendered the fatal boot error before
its licence-screen branch. The audit had already called the gate "decorative";
nothing had ever run the blocked path on real hardware.

**Lesson.** When a ruling removes an exemption, the code BEHIND the exemption
is untested by definition, however green the gate's own tests are. Before
shipping, walk the newly reachable path end to end (here: blocked verdict →
key page → activation → deferred engine start → workspace) and pin the
ordering with a unit test in the rule's words ("the API wait does not start
while the gate is closed"). A pure decision function passing is not evidence
that the callers sequence correctly.

## 2026-09-04 — a file the app wrote must restore into a fresh backend; only a real file proves it

**What happened.** Looking for something else (a lens rule on the owner's own
data), the harness tried to open his `test3.strix`, saved by the packaged
app that morning, into a fresh backend: `POST /restore` answered 500.
`sample.geotech_body_id`, the stamp Divide boreholes writes, is a foreign key
to `body`; samples restore in Phase 2 with their boreholes, bodies only in
Phase 8, so the first query-invoked autoflush raised
`ForeignKeyViolationError`. A stale stamp (a body id re-minted after the last
Divide) fails the same way. Every bundle test was green: none carried a
stamped sample.

**Lesson.** Restore order is a contract with every FK in the bundle. When a
column that points at a later-phase table is added (the stamp landed with the
#278 work), the restore needs the same deferred-link treatment the
cross-section companion FK already has — strip on insert, re-attach after
the target phase, drop and COUNT what no longer resolves. And the gate that
catches it is a real file from the shipped app, not a fixture: keep one
recent owner-saved `.strix` in the dogfeed loop and open it in the harness
after any schema-bearing slice.

## A landing during a running push rides that push ungated (2026-09-04)

`git push` runs the pre-push integration gate against the head it saw when the
push started, then sends the head as it is when the gate finishes. Two slices
were fast-forwarded onto develop during a 25-minute gate; both reached origin
without their gate, and the "second push" afterwards reported "No
Python/integration files changed — gate skipped". Rule: never land on develop
while a push is in flight; if it happened, run the integration wrapper by hand
before the next installer. A Python-touching push that finishes in seconds is
this, every time.


## Five corruption artefacts in two hours all look like code bugs first (2026-09-05)

On a machine with a flaky DIMM the artefacts arrive as ordinary-looking
failures: `ValueError: bad marshal data` while collecting tests (a corrupt
`.pyc`), an `IndentationError` inside a site-packages module that nobody
edited (a flipped byte in `jinja2`), a two-byte swap inside an identifier in
the working copy that `git status` calls clean (the stat cache still matches),
a corrupt loose git object that `git fsck` names, and a Docker engine that
answers 500 under load. None of them is a logic bug and none of them is fixed
by reading the code. Rule: when a failure names a file that the last commit
did not touch, check the machine class first. The recipe: clear every
`__pycache__` (including the one inside `.venv`) for marshal errors;
`uv cache clean <pkg>` plus `uv sync --reinstall-package <pkg>` for a broken
dependency; `rm` plus `git checkout -- <file>` for a working-copy flip;
move a corrupt loose object aside and `git fetch --refetch origin`; then
`git fsck`. `uv sync --group dev --group docs` is the full main-tree sync
since the compile group was removed.


## A write that can CREATE a row must refetch the list the renderer keys on (2026-09-10)

"Edit composition" repoints an accepted litho layer through a find-or-create on
(soil, admixtures); when nothing matched it created a new formation row. The
save refetched the litho layers (which now pointed at the new id) but not the
formations, and every renderer map that derives from the formation list
(`lithoSoilByFormationId`, the colour map, the litho unit filter) resolved the
layer to nothing until the next project open. On the geotech axis that read
as a black outline around one sand wedge: `lithoOutlineEdges` dissolves an
edge only when the soil on both sides is known and equal, so an unknown
formation strokes its whole ring. The owner saw "seams we already fixed";
nothing in the outline pass had regressed. Rule: when a mutation's backend
path contains a find-or-CREATE, the renderer handler refetches the created
kind's list before the rows that reference it, in that order. The accept
flow already did (`refetchFormations` after accept); the newer verb did not.
The test is a SectionsCanvas mount that saves the composition and asserts the
formation refetch, not a test of the outline pass.


## A deliberate exclusion in a derived check turns into a silent gap when a new verb lands (2026-09-10)

The band-fit staleness rule skipped borehole columns on purpose ("Subdivide
CPTs cannot re-derive a borehole, so naming one sends the engineer to a verb
that cannot help") and filed a band whose litho parent had no row left on the
column as "unresolvable, not stale" (a data-integrity problem, re-deriving
cannot fix it). Both were sound when written. Then Edit composition shipped:
the owner turned a borehole's sand piece into gravel, the geotech band over it
kept reading sand, and nothing said the column was out of date, because the
provenance stamps that were supposed to cover "re-classified" did not exist on
his legacy model. What he saw was "the seam bug is back" — it was a correct
contact around a unit he had made, on a column nobody had told him to re-divide.
Rule: when a new mutation verb lands, re-read every derived check's exclusion
list and ask which exclusion the verb has just turned from "cannot happen" into
"happens silently". A derived check may exclude a case only while no verb can
produce it.


## A dialog must not hand its initial focus to a control that changes a value on a keypress (2026-09-10)

The composition editor let the modal's default focus land on its first control,
the main-soil dropdown. On a focused native select one ArrowUp moves to the
option above; Gravel sits directly above Sand. A key meant for the section
canvas turned a sand piece on a borehole into GRIND, Save wrote it, the toast
said only "updated.", and two days later the owner met "the seam bug is back":
a correct gravel|sand contact around a unit he never made. Rule: a dialog's
initial focus goes to a button (Cancel), never to a select, radio group or
number field; and a toast that reports a save names the value it saved. The
regression test asserts document.activeElement on open, because jsdom cannot
reproduce the key on the select — the focus is the whole mechanism.


## A row that inherits a discriminating field is not the thing it inherits from (2026-09-11)

The litho find-or-create lookup keyed every project formation by (soil code,
admixtures) because "litho rows are the ones with a soil code". Geotech rows
inherit that soil code from the litho unit they subdivide, so the key collided
and the last row won: an Edit composition to sand repointed the litho layer to
"ZAND (geotech)", the litho axis painted the interval in that row's colour and
the verb could no longer find the layer's unit. The renderer had the right
rule all along (``isLithoUnit``: soil code present AND no
``source_litho_formation_id``); the backend copied only half of it. Rule: when
a derived row inherits a field, that field stops discriminating the parent
kind — key on what the derivative carries and the parent never does, and keep
the two implementations of the rule next to each other in the docs.

## A rule with two implementations needs an arbiter neither side owns (2026-09-16, debt #284)

When the same rule lives once in Python and once in TypeScript, a parity test
that compares one side against itself is structurally incapable of going red;
the fix is a committed fixture BOTH suites load. Cross-language twin arbiters
live in `tests/fixtures/contracts/` (`section_corridor_membership.json`,
`packing_class_key.json`, `admixture_canonical_key.json`, and the older
`robertson_sbt_bands.json`); each is read by a Python `test_twin_*.py` and a TS
`*.twin.test.ts`, so a fix that drifts on one side reddens the other. Change the
rule by changing the fixture first.

## A pytest target under %TEMP% makes an unrelated process able to fail your build (2026-09-20)

The behavioural native gate failed a release with "a compiled .pyd deviates
from its source behaviour". Nothing had deviated: pytest never got past
COLLECTION. It died on `FileNotFoundError` for a directory in `%TEMP%` that no
longer existed, and the directory it named was DIFFERENT on each run
(`codex-review-empty-<guid>` once, `python-gvOFvp` the next).

Mechanism: pytest walks the ancestor directories of every target path it is
given, and on Windows, when a sibling node's path does not string-match the
requested one, it falls back to `samefile_nofollow()` (short-path handling,
pytest #11895), which `lstat()`s both sides. The gate's marker test lived at
`%TEMP%\strix-native-gate\work\`, so collection enumerated `%TEMP%`'s
children. `%TEMP%` is shared with every other tool on the machine, so any
unrelated process deleting one of its temp dirs inside that window aborts the
run. A Codex session churning temp dirs was enough.

Proved rather than guessed, under deliberately forced temp churn: the marker in
`%TEMP%` exited 2, the same marker in a repo-local directory exited 0. The fix
is one line, `$GateWork` now resolves under the repo (`.native-gate-work/`,
gitignored); `gate-pytest` and the numba cache stay in `%TEMP%` because they are
PYTHONPATH and cache only, never collection targets.

Two rules. **Never hand pytest a target path inside a directory other processes
write to** — the collector reads that directory's siblings, so you inherit
their lifetime. And **a gate must not translate an exit code into a claim it
cannot support**: only pytest exit 1 means a test ran and failed; 2 to 5 mean
the harness never ran and say nothing about the thing under test. Reporting
those as a `.pyd` deviation sent a debug session hunting a compiled-code bug
that did not exist.


## A test that pins a setting where you SET it proves nothing about where the library READS it (2026-09-22)

The 3-D stratigraphic view showed a deeper, wider formation composited over
the younger one on top ("a green sheen on top, while that should be all
red"). The fix was obvious: make the translucent formation sheets write
depth. PR #36 passed `renderState: { depthMask: true }` to Cesium's
`PerInstanceColorAppearance`, its test asserted
`appearance.renderState.depthMask === true`, the suite went green, and the
owner still saw the wrong sheet on top. Two more rounds of "did you reload"
followed before the owner said "find it yourself".

The setting was written where nothing reads it. Cesium's `Primitive` builds
its GPU render state from `appearance.getRenderState()`, and
`Appearance.prototype.getRenderState` forces `depthMask = false` on every
translucent appearance — the constructor option is honoured for every field
EXCEPT the one the fix needed. The property said true; the GPU said false.
A standalone probe (three stacked sheets under Playwright + swiftshader,
reading the centre pixel and the primitive's `_frontFaceRS.depthMask`)
showed it in one run: `false` on the GPU and the wrong colour for every
variant of the option, the right colour the moment the call itself was
answered on the instance (`geology3DPrimitives.withDepthWrites`).

Three rules. **Assert at the consumer's boundary** — the value the library
actually reads (`getRenderState()`), not the property you wrote; a test on
the property is a test of your own assignment. **A fix the product cannot
show is reproduced outside the product before the code is touched again**
— a pixel read from a twenty-line page answers in minutes what a dogfeed
round-trip answers in hours. **Read the library's path from your setting to
the GPU** — here three functions in one file — before reasoning about depth
semantics; the answer was a line of source, not a theory.

## One producer of a no-null array contract breaks every reader, and nothing types it (2026-09-25, issue #55)

A tester's CPTE GEF declared `#COLUMNVOID` on the cone-resistance column.
The parser masked the marker to null and kept the row, so the stored
`cpt_series.qc_mpa` array carried `None` elements. The ORM said
`Mapped[list[float]]`, the plot schema said `list[float]`, the renderer said
`number[]`, and every reader — the Ic chart, the litho segmenter, the SBT
profile, the geotech subdivision — did arithmetic on it. The first reader
hit was the chart: `GET /cpt/{id}/plot` answered 500 from
`robertson_2015.unit_weight` ("'<=' not supported between NoneType and
float"). A comment in `CptChart.tsx` from May had already spelled the
contract out ("changing qc_mpa to allow null elements is invasive — ORM,
persist, API schema, all typed list[float]") and noted that the DOV parser
skips such rows. The GEF parser was the one producer nobody checked, and
a PostgreSQL array happily stores a NULL element behind a `list[float]`
annotation: neither mypy nor the schema nor a test stood between the file
and the crash, for four months.

Three rules. **A "no null" contract on a stored array is only as good as
its producers** — list every writer of the column (each parser, each
importer, restore) and pin the invariant at each, or at the one choke
point they share. **When a comment says "X never happens because Y
guards it", grep for the other paths that would also have to guard it**;
the comment named DOV and was silent on GEF. **A stored violation needs a
read-side repair, not only a producer fix** — the tester's project already
held the rows; the ORM `load` hook compacts them so the fix reaches data
written by earlier builds without a re-import.
