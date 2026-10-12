// Walker finding 2026-10-12 (seed 2586200527, step 258): a redo of
// "Copy 0 and move 1 contacts" was refused because the contact already
// existed, and the engine logged it at ERROR + showed an error toast.
//
// The ruling, in the brief's words:
//   UC1  "a redo refused by a duplicate is an expected conflict after the state
//        moved on": skip it with a WARNING toast and log.warn, never log.error;
//        "keep the history-clearing".
//   UC2  "A genuine failure (any other error) keeps the error level and the
//        existing toast."

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/log', () => ({
  log: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

import { log } from '../utils/log'
import { setLanguage } from '../i18n/languageSelect'
import { UndoConflictError } from './undoConflictError'
import { useUndoStack, type UndoCommand } from './useUndoStack'

function command(reapply: () => Promise<void>): UndoCommand {
  return {
    descriptionKey: 'undo.copyMoveContacts',
    descriptionParams: { copied: 0, moved: 1 },
    revert: vi.fn().mockResolvedValue(undefined),
    reapply,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  setLanguage('en')
})

async function undoThenRedo(cmd: UndoCommand, onError: () => void, onWarning: () => void) {
  const hook = renderHook(() => useUndoStack({ onError, onWarning }))
  act(() => hook.result.current.push(cmd))
  await act(async () => {
    await hook.result.current.undo()
  })
  await act(async () => {
    await hook.result.current.redo()
  })
  return hook
}

describe('useUndoStack: a redo refused as a duplicate is a warning, not an error', () => {
  it('UC1: duplicate refusal -> warning toast + log.warn, no log.error, history cleared', async () => {
    const onError = vi.fn()
    const onWarning = vi.fn()
    const cmd = command(() => Promise.reject(new UndoConflictError('undo.redoContactExists')))
    const { result } = await undoThenRedo(cmd, onError, onWarning)

    expect(onError).not.toHaveBeenCalled()
    expect(onWarning).toHaveBeenCalledWith(
      'Cannot redo: the contact already exists. History cleared.',
    )
    expect(log.error).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalled()
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('UC1 (NL): the warning reads in Dutch', async () => {
    setLanguage('nl')
    const onWarning = vi.fn()
    const cmd = command(() => Promise.reject(new UndoConflictError('undo.redoContactExists')))
    await undoThenRedo(cmd, vi.fn(), onWarning)
    expect(onWarning).toHaveBeenCalledWith(
      'Opnieuw uitvoeren niet mogelijk: het contact bestaat al. De geschiedenis is gewist.',
    )
  })

  it('UC2: any other failure keeps the error level and the existing toast', async () => {
    const onError = vi.fn()
    const onWarning = vi.fn()
    const cmd = command(() => Promise.reject(new Error('network down')))
    const { result } = await undoThenRedo(cmd, onError, onWarning)

    expect(onWarning).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(
      'Redo failed: Copy 0 and move 1 contacts. History cleared to keep state safe.',
    )
    expect(log.error).toHaveBeenCalled()
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })
})
