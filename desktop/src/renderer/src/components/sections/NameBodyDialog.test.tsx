// Unit tests for NameBodyDialog (dogfeed 2026-06-01 — window.prompt dead-end fix).
//
//   NBD1  pre-fills the input with the body's current name (rename).
//   NBD2  Save submits the trimmed name via onSubmit.
//   NBD3  empty / whitespace name disables Save.
//   NBD4  Cancel fires onCancel, not onSubmit.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import NameBodyDialog from './NameBodyDialog'

afterEach(() => cleanup())

describe('NameBodyDialog', () => {
  it('NBD1 — pre-fills the input with the current name', () => {
    render(
      <NameBodyDialog open initialName="Sand lens" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    )
    const input = screen.getByTestId('name-body-input') as HTMLInputElement
    expect(input.value).toBe('Sand lens')
  })

  it('NBD2 — Save submits the trimmed name', () => {
    const onSubmit = vi.fn()
    render(<NameBodyDialog open initialName="" onSubmit={onSubmit} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByTestId('name-body-input'), {
      target: { value: '  Peat wedge  ' },
    })
    fireEvent.click(screen.getByTestId('name-body-submit'))
    expect(onSubmit).toHaveBeenCalledWith('Peat wedge')
  })

  it('NBD3 — empty / whitespace name disables Save', () => {
    render(<NameBodyDialog open initialName="" onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByTestId('name-body-submit')).toBeDisabled()
    fireEvent.change(screen.getByTestId('name-body-input'), { target: { value: '   ' } })
    expect(screen.getByTestId('name-body-submit')).toBeDisabled()
  })

  it('NBD4 — Cancel fires onCancel, not onSubmit', () => {
    const onCancel = vi.fn()
    const onSubmit = vi.fn()
    render(
      <NameBodyDialog open initialName="x" onSubmit={onSubmit} onCancel={onCancel} />,
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
