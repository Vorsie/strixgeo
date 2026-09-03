// Unit tests for the PG_VERSION content check (production-readiness audit M8).
//
// initialiseCluster used to treat a data directory with any PG_VERSION file as
// a finished cluster to reuse, without reading it. A bundle upgrade that raises
// the bundled PostgreSQL major (16 → 17) would then start the new server
// against the OLD major's data directory, which the server refuses in a way a
// non-technical tester cannot decode. The rule pinned here: a PG_VERSION whose
// major does not match the bundled major fails with a NAMED message.

import { describe, expect, it } from 'vitest'

import { EXPECTED_POSTGRES_MAJOR, clusterVersionMismatchMessage } from './postgresCluster'

describe('clusterVersionMismatchMessage', () => {
  it('returns null when the cluster major matches the bundled major', () => {
    // PG_VERSION for PG 10+ carries just the major, with a trailing newline.
    expect(clusterVersionMismatchMessage('16\n', '16')).toBeNull()
  })

  it('names both majors when the cluster was created by a different major', () => {
    const message = clusterVersionMismatchMessage('15\n', '16')
    expect(message).not.toBeNull()
    expect(message).toContain('15')
    expect(message).toContain('16')
  })

  it('tolerates an old-style two-part PG_VERSION (9.6) by comparing the major', () => {
    // Pre-10 PostgreSQL wrote "9.6"; the major for the compatibility check is 9.
    expect(clusterVersionMismatchMessage('9.6\n', '16')).not.toBeNull()
  })

  it('bundles a concrete expected major (matches the pinned PG build)', () => {
    // The build pins PostgreSQL 16.x (scripts/build-embedded-postgres.ps1).
    expect(EXPECTED_POSTGRES_MAJOR).toBe('16')
  })
})
