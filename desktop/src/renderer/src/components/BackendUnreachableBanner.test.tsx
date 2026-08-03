// The banner is the half of the fix the engineer actually sees, so it is
// pinned against the real store rather than a mocked boolean prop — the
// question worth answering is "does a run of refused requests put words on
// screen, and do they go away by themselves", not "does an if-statement work".

import { cleanup, render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import BackendUnreachableBanner from './BackendUnreachableBanner'
import {
  CONSECUTIVE_NETWORK_FAILURES_BEFORE_UNREACHABLE as THRESHOLD,
  noteNetworkFailure,
  noteNetworkSuccess,
  resetNetworkHealth,
} from '../api/networkHealth'

beforeEach(() => resetNetworkHealth())
afterEach(() => {
  cleanup()
  resetNetworkHealth()
})

const TEST_ID = 'backend-unreachable-banner'

describe('BackendUnreachableBanner', () => {
  it('BU1 renders nothing while the backend is answering', () => {
    render(<BackendUnreachableBanner />)
    expect(screen.queryByTestId(TEST_ID)).toBeNull()
  })

  it('BU2 appears once the failure run crosses the threshold', () => {
    render(<BackendUnreachableBanner />)

    act(() => {
      for (let i = 0; i < THRESHOLD; i++) noteNetworkFailure()
    })

    expect(screen.getByTestId(TEST_ID)).toBeTruthy()
  })

  it('BU3 says what is unavailable and what to do, not just that something broke', () => {
    render(<BackendUnreachableBanner />)
    act(() => {
      for (let i = 0; i < THRESHOLD; i++) noteNetworkFailure()
    })

    const text = screen.getByTestId(TEST_ID).textContent ?? ''
    expect(text.toLowerCase()).toContain('unreachable')
    expect(text.toLowerCase()).toContain('restart')
  })

  it('BU4 is an assertive alert — it must not wait to be noticed', () => {
    render(<BackendUnreachableBanner />)
    act(() => {
      for (let i = 0; i < THRESHOLD; i++) noteNetworkFailure()
    })

    expect(screen.getByTestId(TEST_ID).getAttribute('role')).toBe('alert')
  })

  it('BU5 removes itself when the backend answers again', () => {
    render(<BackendUnreachableBanner />)
    act(() => {
      for (let i = 0; i < THRESHOLD; i++) noteNetworkFailure()
    })
    expect(screen.queryByTestId(TEST_ID)).not.toBeNull()

    act(() => noteNetworkSuccess())

    expect(screen.queryByTestId(TEST_ID)).toBeNull()
  })
})
