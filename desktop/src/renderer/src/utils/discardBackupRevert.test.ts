// Owner 2026-09-10: "Kon niet terugdraaien: dit bestand is niet de laatste
// bewaaractie van het project. De back-up is behouden. deze melding zie ik niet
// graag, users gaan hierop vloeken." Deleting a crash backup first reverts the
// database to the last save; when the file on disk is not that save the app
// used to refuse with a toast and keep the backup — a dead end. It must ASK
// instead: revert to that file anyway (the named danger button, Cancel focused),
// or keep the backup.
import { describe, expect, it, vi } from 'vitest'

import { reloadProjectAfterDiscard, revertBeforeDiscardBackup } from './discardBackupRevert'

describe('deleting a crash backup when the file is not the latest save', () => {
  it('asks, and on "revert anyway" forces the revert and lets the discard proceed', async () => {
    const revert = vi
      .fn()
      .mockResolvedValueOnce('refused-not-latest-save')
      .mockResolvedValueOnce('reverted')
    const askForceRevert = vi.fn().mockResolvedValue(true)
    const toast = vi.fn()
    const proceed = await revertBeforeDiscardBackup({ revert, askForceRevert, toast, message: (k) => k })
    expect(proceed).toBe(true)
    expect(revert).toHaveBeenNthCalledWith(2, true)
    expect(toast).not.toHaveBeenCalled()
  })

  it('asks, and on Cancel keeps the backup without an error toast', async () => {
    const revert = vi.fn().mockResolvedValue('refused-not-latest-save')
    const askForceRevert = vi.fn().mockResolvedValue(false)
    const toast = vi.fn()
    const proceed = await revertBeforeDiscardBackup({ revert, askForceRevert, toast, message: (k) => k })
    expect(proceed).toBe(false)
    expect(revert).toHaveBeenCalledTimes(1)
    expect(toast).not.toHaveBeenCalled()
  })

  it('a plain revert that succeeds never asks', async () => {
    const revert = vi.fn().mockResolvedValue('reverted')
    const askForceRevert = vi.fn()
    const proceed = await revertBeforeDiscardBackup({ revert, askForceRevert, toast: vi.fn(), message: (k) => k })
    expect(proceed).toBe(true)
    expect(askForceRevert).not.toHaveBeenCalled()
  })

  it('a revert that fails outright is a fault: error toast, backup kept', async () => {
    const revert = vi.fn().mockResolvedValue('failed')
    const toast = vi.fn()
    const proceed = await revertBeforeDiscardBackup({ revert, askForceRevert: vi.fn(), toast, message: (k) => k })
    expect(proceed).toBe(false)
    expect(toast).toHaveBeenCalledWith('error', 'project.revertFailed')
  })

  it('a forced revert that still fails is a fault too: error toast, backup kept', async () => {
    const revert = vi.fn().mockResolvedValueOnce('refused-not-latest-save').mockResolvedValueOnce('failed')
    const toast = vi.fn()
    const proceed = await revertBeforeDiscardBackup({
      revert,
      askForceRevert: vi.fn().mockResolvedValue(true),
      toast,
      message: (k) => k,
    })
    expect(proceed).toBe(false)
    expect(toast).toHaveBeenCalledWith('error', 'project.revertFailed')
  })
})

describe('reloading the project after a crash backup is deleted', () => {
  // Owner 2026-09-23: after "Delete backup" the section list stayed as it was
  // before the revert, and the next body recompute was refused ("the payload
  // must cover every section of the project exactly") — the toast "Body
  // identity could not be saved". Every project-keyed loader refetches on a
  // project-id CHANGE; reopening the same file keeps the id, so nothing
  // refetched. The reload must close the project first, so the reopen is a
  // real transition for every list.
  it('closes the project before reopening its file, with the path captured before the close', async () => {
    const calls: string[] = []
    const close = vi.fn(() => {
      calls.push('close')
    })
    const open = vi.fn(async (path: string) => {
      calls.push(`open:${path}`)
      return null
    })
    await reloadProjectAfterDiscard({ path: 'C:/p/test.strix', close, open })
    expect(calls).toEqual(['close', 'open:C:/p/test.strix'])
  })

  it('does nothing without a file path', async () => {
    const close = vi.fn()
    const open = vi.fn()
    await reloadProjectAfterDiscard({ path: null, close, open })
    expect(close).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })
})
