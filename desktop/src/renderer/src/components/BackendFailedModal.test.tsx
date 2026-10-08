// Owner finding 2026-10-08: an older StrixGeo opened a store a newer one wrote.
// The engine said so in plain words, the user saw only "the backend process
// exited before it was ready". With the reason ``newer-database`` the dialog must
// name the cause and offer the cure (check for updates); without a reason it
// stays the generic dialog it always was.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import BackendFailedModal from './BackendFailedModal'

const GENERIC_BODY =
  'The StrixGeo backend process exited before it was ready. This usually means a database connection problem or a startup crash.'
const NEWER_BODY =
  'This project was saved by a newer version of StrixGeo. Install the latest version to open it. Your data is intact.'

let checkForUpdates: ReturnType<typeof vi.fn>

beforeEach(() => {
  checkForUpdates = vi.fn().mockResolvedValue(undefined)
  ;(window as unknown as { electron: unknown }).electron = {
    checkForUpdates,
    notifyQuitDecision: vi.fn().mockResolvedValue(undefined),
  }
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { electron?: unknown }).electron
})

describe('BackendFailedModal', () => {
  it('BFM1 - without a reason: the generic body, Quit only, Quit focused', () => {
    render(<BackendFailedModal open logsPath="C:/logs" />)
    expect(screen.getByText(GENERIC_BODY)).toBeTruthy()
    expect(screen.queryByText(NEWER_BODY)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Quit StrixGeo' }))
    // The log path line stays.
    expect(screen.getByText(/C:\/logs\/backend\.log/)).toBeTruthy()
  })

  it('BFM2 - a newer-database store names the cause instead of the generic body', () => {
    render(<BackendFailedModal open logsPath="C:/logs" reason="newer-database" />)
    expect(screen.getByText(NEWER_BODY)).toBeTruthy()
    expect(screen.queryByText(GENERIC_BODY)).toBeNull()
    // The log path line stays here too.
    expect(screen.getByText(/C:\/logs\/backend\.log/)).toBeTruthy()
  })

  it('BFM3 - a newer-database store offers "Check for updates", focused, which runs the check', () => {
    render(<BackendFailedModal open logsPath={null} reason="newer-database" />)
    const check = screen.getByRole('button', { name: 'Check for updates' })
    // The cure is the safe default action; Quit stays available.
    expect(document.activeElement).toBe(check)
    expect(screen.getByRole('button', { name: 'Quit StrixGeo' })).toBeTruthy()
    fireEvent.click(check)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('BFM4 - closed renders nothing', () => {
    render(<BackendFailedModal open={false} logsPath={null} reason="newer-database" />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
