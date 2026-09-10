// Owner 2026-09-10: "Kon niet terugdraaien: dit bestand is niet de laatste
// bewaaractie van het project. De back-up is behouden. deze melding zie ik niet
// graag, users gaan hierop vloeken." Deleting a crash backup first reverts the
// database to the last save; when the file on disk is not that save the app
// used to refuse with a toast and keep the backup — a dead end. It must ASK
// instead: revert to that file anyway (the named danger button, Cancel focused),
// or keep the backup.
import { describe, expect, it, vi } from 'vitest'

import { revertBeforeDiscardBackup } from './discardBackupRevert'

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
