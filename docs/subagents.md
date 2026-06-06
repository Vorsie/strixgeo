# Subagents

> Extracted from `CLAUDE.md` 2026-06-06 to keep the always-loaded file lean. Load this on demand when the pointer in CLAUDE.md says so.

## Subagents

Six project-scoped subagents live in `.claude/agents/`. They are
Strix-tuned: each one reads CLAUDE.md (and CLAUDE.local.md, and the
memory directory) before opining, so its advice respects the layer
model, the .gmproj v3 contract, the data-integrity rules, and the
documented debt list rather than reaching for generic best practices.

| Agent | When the orchestrator reaches for it |
|---|---|
| `senior-code-reviewer` | Before commits / PRs that touch non-trivial code — a new feature, a refactor, a parser change, a migration. Returns blockers / should-fix / consider, with citations to the project rule. Skip for one-line fixes and doc-only commits. |
| `system-architect` | Before designing a new subsystem, evaluating a schema change, weighing competing implementation approaches, or considering whether to bend an architectural rule. NOT for stylistic tweaks. |
| `staff-engineer` | For non-trivial implementation work — designing + writing a feature inside the existing conventions, modernising a legacy module, mid-stream performance fixes. Less review-focused than `senior-code-reviewer`; this is who builds the thing. |
| `security-reviewer` | Before merging code that touches a security-sensitive surface — file parsers (DOV XML, GEF, .strix), DB query construction outside the ORM, Electron IPC handlers, file-system access from the renderer, endpoints that take user-supplied IDs, future license/auth flows. Critical / High / Medium / Low findings with concrete attack scenarios. NOT a substitute for `senior-code-reviewer` — pair them on diffs that touch trust boundaries. |
| `product-strategy-advisor` | Build/kill/defer/enhance decisions, competitive positioning vs gINT / D-Series / GeoStudio, pricing tier shape, validation cadence, v1.0 MVP gate scope. NOT for implementation questions. |
| `ux-reviewer` | Before committing a diff that touches the desktop UI — a new panel/modal/inspector, a changed interaction (selection / drag / keyboard / zoom), an empty/loading/error state, a colour/contrast/dark-mode change, or any engineer-facing flow. Judges against the layered UX stack in `docs/ux.md` AND against what the market leaders (gINT / LeapFrog / Plaxis / D-Series / GeoStudio) have trained the user's customers to expect. NOT for backend/parser/schema work. |

**What "automatic" means in practice.** The agent descriptions are
how Claude Code's orchestrator decides when to delegate — there is
no hard rule that says "every commit MUST run senior-code-reviewer".
When the situation matches the description (a real review on a real
diff, a real architecture question on a real subsystem), the
orchestrator will reach for the matching agent. When it doesn't,
ask explicitly: *"hand this to senior-code-reviewer first"* is
always a valid override.

**Cost discipline.** Each agent call spends a separate context
window. Use them where the signal-per-token is high: review before
push, architecture before a multi-day build, strategy before a
naming / pricing / launch call. Don't fan out four agents in
parallel for a one-line config change.

**Adding more.** Drop a new `.claude/agents/<name>.md` with the
standard frontmatter (`name`, `description`, `model`, optional
`color`, optional `tools`) and a body that's the agent's system
prompt. Keep the description tight and trigger-shaped (when to
delegate, not the agent's whole philosophy) — that's what drives
auto-selection.
