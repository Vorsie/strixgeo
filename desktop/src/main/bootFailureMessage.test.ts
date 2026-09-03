// M8 — a boot failure caused by a database written by a NEWER StrixGeo gets its
// own named message, instead of the generic "could not prepare the database"
// stage sentence. The user must be told their data is intact and that the cure
// is to install the current version — not that something is broken.
//
// The signal: alembic fails the ``run-migrations`` stage with "Can't locate
// revision identified by '<rev>'" when the cluster is stamped at a revision that
// this build's migration scripts do not contain — which is exactly the shape of
// an older build opening a newer database.

import { describe, expect, it } from 'vitest'

import { tailoredBootFailureCopy } from './bootFailureMessage'

describe('tailoredBootFailureCopy', () => {
  it('names the newer-database case and reassures the data is intact', () => {
    const copy = tailoredBootFailureCopy({
      stage: 'run-migrations',
      message: "the migrator exited with code 1: Can't locate revision identified by 'a4b5c6d7e8f9'",
    })
    expect(copy).not.toBeNull()
    expect(copy!.detail.toLowerCase()).toContain('newer')
    expect(copy!.detail.toLowerCase()).toContain('intact')
    // Points at the fix without a stack trace.
    expect(copy!.detail.toLowerCase()).toContain('current version')
  })

  it('matches the apostrophe and case variants of the alembic message', () => {
    expect(
      tailoredBootFailureCopy({
        stage: 'run-migrations',
        message: "CANT LOCATE REVISION identified by 'zzz'",
      }),
    ).not.toBeNull()
    expect(
      tailoredBootFailureCopy({
        stage: 'run-migrations',
        message: "can't locate revision 'zzz'",
      }),
    ).not.toBeNull()
  })

  it('returns null for a run-migrations failure that is NOT a newer database', () => {
    // A connection drop, a disk-full, a PostGIS-missing error at the same stage
    // must keep the generic stage message — not falsely blame a newer build.
    expect(
      tailoredBootFailureCopy({
        stage: 'run-migrations',
        message: 'could not connect to server: Connection refused',
      }),
    ).toBeNull()
  })

  it('returns null for any other stage', () => {
    expect(
      tailoredBootFailureCopy({
        stage: 'start-postgres',
        message: "Can't locate revision identified by 'zzz'",
      }),
    ).toBeNull()
  })
})
