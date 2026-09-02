# Bundled worked-example project

Drop the worked-example project here as `worked-example.strix`.

The owner builds this file (a finished ground model on a small real dataset).
The installer copies this whole directory to `resources/sample` via
`build.extraResources`, and "Load sample project" (onboarding) imports it.

Until the file exists, `sample:available` returns false and onboarding falls
back to starting an empty project — the mechanism ships now, the data later.
