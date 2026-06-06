---
name: strix-migration-sync
description: Use when a change added or edited an Alembic migration (anything under infrastructure/db/migrations/versions) and you are about to dogfeed it in the desktop app. Triggers on a new migration file, a model/schema change, or an unexplained 500 / "CORS error" on a single endpoint right after a schema change.
disable-model-invocation: true
---

# Strix Migration Sync

## Overview

The integration wrapper only migrates the sibling `groundmodel_integration` DB. The
dev DB (`groundmodel`) lags behind, and a lagging dev DB shows up in the app as a
generic 500 that the frontend mislabels as a **CORS error** on one endpoint. The fix
is to migrate the dev DB.

`disable-model-invocation: true` — a migration is a state mutation; Claude should not
auto-run it. You invoke it deliberately.

## When to Use

- Right after a commit that adds/edits a migration, before dogfeeding.
- When exactly one endpoint 500s / "CORS"-errors immediately after a schema change.

## Run it (the verification step)

```
.\.claude\skills\strix-migration-sync\sync_dev_db.ps1
```

It prints the dev DB revision before and after `alembic upgrade head` (no
`DATABASE_URL` override → dev DB). The script is the whole action.

If a single endpoint still 500s after this, the cause is a real bug, not a lagging
schema — switch to `superpowers:systematic-debugging`.

## Self-check

If you keep hitting post-migration 500s the user has to report → the trigger is firing
too late. Invoke `superpowers:writing-skills` to tighten when this runs (e.g. fold it
into a post-commit step).
