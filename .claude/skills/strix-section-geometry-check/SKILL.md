---
name: strix-section-geometry-check
description: Use when you added or edited any section-view overlay that draws at an along-section position (bands, wedges, ghosts, contacts, lens/body caps, DEM line, grid) — before committing. Triggers on touching files under desktop/src/renderer/src/components/sections, or any "renders in the wrong place / floats off its column / only wrong when spacing changed" symptom.
---

# Strix Section Geometry Check

## Overview

Section overlays must map along-section metres through `warpedXToScreen` (the
post-column-nudge transform), never raw `xToScreen` / `proj.along`. At 100% spacing
both agree, so a raw call looks correct until the user nudges column spacing — then it
floats metres off its column. This bug class has recurred repeatedly.

## When to Use

Any diff that touches a `sections/` overlay and computes a screen X from an along
position. Run it before you claim the overlay renders correctly.

## Run it (the verification step)

```
python .claude/skills/strix-section-geometry-check/check_section_geometry.py <changed files>
```

Exit 0 = clean. Exit 1 = it found raw `xToScreen` calls and printed file:line. The
**script is the whole check** — don't reason about spacing by hand.

## Judgment (the only AI part)

For each flagged line, decide whether that coordinate is genuinely spacing-independent
(rare — e.g. a fixed gutter) or should be `warpedXToScreen`. Everything else is the
script's call.

## Self-check

If you ran this, committed, and the user still reports a "renders in the wrong place"
bug on a section overlay → the grep missed a path (e.g. an inverse transform or a
non-`xToScreen` mapper). Invoke `superpowers:writing-skills` and widen the pattern.
