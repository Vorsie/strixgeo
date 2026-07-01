# Engineering Lessons — Strix

Transferable, hard-won lessons. Each is a *rule* + the concrete instance that taught it + how to apply. Add to this when a bug or process gap teaches something a future session (or a future Claude) would otherwise repeat. Keep it to genuinely non-obvious lessons — not things the code or CLAUDE.md already say.

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
