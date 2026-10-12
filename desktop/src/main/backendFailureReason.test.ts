// Owner finding 2026-10-08: he reinstalled 0.1.4 over 0.1.5. The 0.1.4 engine
// refused the store with NewerDatabaseError ("This project's database was
// written by a newer version of StrixGeo..."), but the user saw only the generic
// "the backend process exited before it was ready" dialog. The failure signal
// must NAME the cause when the engine's output says the store is from a newer
// version, so the dialog can send the user to the update that cures it.

import { describe, expect, it } from 'vitest'

import {
  backendFailedPayload,
  backendFailureReasonFromOutput,
  createBackendFailureReasonTracker,
} from './backendFailureReason'

/** The tail of a real lifespan traceback for the newer-store refusal. */
const NEWER_DB_TRACEBACK =
  'Traceback (most recent call last):\n' +
  '  File "groundmodel/api/boot_migration.py", line 131, in run_boot_migration\n' +
  'groundmodel.infrastructure.db.database_migrator.NewerDatabaseError: ' +
  "This project's database was written by a newer version of StrixGeo. " +
  'Install the current version of StrixGeo to open it — your data is intact.'

describe('backendFailureReasonFromOutput — the engine output names the cause', () => {
  it('BFR1 - the NewerDatabaseError traceback reads as a newer-database failure', () => {
    expect(backendFailureReasonFromOutput(NEWER_DB_TRACEBACK)).toBe('newer-database')
  })

  it('BFR2 - the migrator message alone (no class name) is enough', () => {
    expect(
      backendFailureReasonFromOutput(
        "ERROR This project's database was written by a newer version of StrixGeo.",
      ),
    ).toBe('newer-database')
  })

  it("BFR3 - alembic's own unknown-revision text is the same cause", () => {
    expect(
      backendFailureReasonFromOutput("Can't locate revision identified by 'c8d9e0f1a2b4'"),
    ).toBe('newer-database')
  })

  it('BFR4 - any other startup crash names no cause (the generic dialog stays)', () => {
    expect(backendFailureReasonFromOutput('asyncpg.exceptions.InvalidPasswordError: password')).toBeNull()
    expect(backendFailureReasonFromOutput('')).toBeNull()
  })
})

describe('createBackendFailureReasonTracker — one tracker per backend spawn', () => {
  it('BFR5 - a marker split across two output chunks is still recognised', () => {
    const tracker = createBackendFailureReasonTracker()
    tracker.observe('groundmodel.infrastructure.db.database_migrator.NewerDa')
    tracker.observe('tabaseError: this project ...')
    expect(tracker.reason()).toBe('newer-database')
  })

  it('BFR6 - the reason latches: later unrelated output does not clear it', () => {
    const tracker = createBackendFailureReasonTracker()
    tracker.observe(NEWER_DB_TRACEBACK)
    tracker.observe('INFO:     Waiting for application shutdown.')
    tracker.observe('x'.repeat(10_000))
    expect(tracker.reason()).toBe('newer-database')
  })

  it('BFR7 - a clean boot log names no cause', () => {
    const tracker = createBackendFailureReasonTracker()
    tracker.observe('INFO:     Started server process [1234]')
    tracker.observe('INFO:     Application startup complete.')
    expect(tracker.reason()).toBeNull()
  })
})

describe('backendFailedPayload — the additive app:backend-failed payload', () => {
  it('BFR8 - carries the reason, or null when the cause is unknown', () => {
    expect(backendFailedPayload('newer-database')).toEqual({ reason: 'newer-database' })
    expect(backendFailedPayload(null)).toEqual({ reason: null })
  })
})

// Tester finding 2026-10-12: another program owned the engine port; uvicorn
// printed "[Errno 10048] error while attempting to bind on address
// ('127.0.0.1', 8765)" and the user saw the generic dialog. The engine's
// bind-failure output must read as the cause ``port-busy`` so the dialog can say
// which port is taken and what to do.
const BIND_FAILURE =
  "ERROR:    [Errno 10048] error while attempting to bind on address ('127.0.0.1', 8765): " +
  'only one usage of each socket address (protocol/network address/port) is normally permitted'

describe('backendFailureReasonFromOutput - a port another program holds', () => {
  it('BFR9 - the uvicorn bind failure reads as port-busy', () => {
    expect(backendFailureReasonFromOutput(BIND_FAILURE)).toBe('port-busy')
  })

  it('BFR10 - the tracker latches port-busy across chunks', () => {
    const tracker = createBackendFailureReasonTracker()
    tracker.observe('INFO:     engine READY\nERROR:    [Errno 10048] error while attempting to bi')
    tracker.observe("nd on address ('127.0.0.1', 8765): only one usage")
    tracker.observe('INFO:     Waiting for application shutdown.')
    expect(tracker.reason()).toBe('port-busy')
  })
})

describe('backendFailedPayload - names the engine port', () => {
  it('BFR11 - carries the port the engine was told to bind', () => {
    expect(backendFailedPayload('port-busy', 8767)).toEqual({ reason: 'port-busy', port: 8767 })
  })
})
