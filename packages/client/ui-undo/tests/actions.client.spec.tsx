// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { UndoButton, type UndoInjected } from '../src/client/UndoButton.tsx'

afterEach(cleanup)
const t = (key: string) => key
const result = { success: true, newSessionId: 'new-session' }
function mount(inject: UndoInjected, text = 'Try again') {
  return render(<UndoButton seq={12} text={text} t={t as any} inject={inject} />)
}

describe('undo action settlements', () => {
  it('confirm opens the fork and closes only on success', async () => {
    const openSession = vi.fn()
    const revert = vi.fn().mockResolvedValue(result)
    const view = mount({ revert, openSession })
    fireEvent.click(view.getByTestId('undo-action-btn'))
    fireEvent.click(view.getByTestId('undo-confirm-btn'))
    await waitFor(() => expect(view.queryByTestId('undo-dialog')).toBeNull())
    expect(revert).toHaveBeenCalledWith(12)
    expect(openSession).toHaveBeenCalledWith('new-session')
  })

  it('navigates to the fork and fills its composer with original prompt', async () => {
    const order: string[] = []
    const fillDraft = vi.fn().mockImplementation(async () => { order.push('fill') })
    const openSession = vi.fn(() => { order.push('open') })
    const view = mount({ revert: vi.fn().mockResolvedValue(result), fillDraft, openSession })
    fireEvent.click(view.getByTestId('retry-action-btn'))
    fireEvent.click(view.getByTestId('retry-load-btn'))
    await waitFor(() => expect(view.queryByTestId('retry-dialog')).toBeNull())
    expect(fillDraft).toHaveBeenCalledWith('new-session', 'Try again')
    expect(order).toEqual(['open', 'fill'])
  })

  it('resends original prompt to fork and closes only after completion', async () => {
    let settle!: () => void
    const resend = vi.fn().mockReturnValue(new Promise<void>((resolve) => { settle = resolve }))
    const openSession = vi.fn()
    const view = mount({ revert: vi.fn().mockResolvedValue(result), resend, openSession })
    fireEvent.click(view.getByTestId('retry-action-btn'))
    fireEvent.click(view.getByTestId('retry-send-btn'))
    await waitFor(() => expect(resend).toHaveBeenCalledWith('new-session', 'Try again'))
    expect(view.getByTestId('retry-dialog')).toBeTruthy()
    settle()
    await waitFor(() => expect(view.queryByTestId('retry-dialog')).toBeNull())
    expect(openSession).toHaveBeenCalledWith('new-session')
  })

  it('shows remote and partial rollback errors without dismissing dialog', async () => {
    const view = mount({ revert: vi.fn().mockResolvedValue({ success: true, message: 'Files reverted, but session fork failed' }), openSession: vi.fn() })
    fireEvent.click(view.getByTestId('undo-action-btn'))
    fireEvent.click(view.getByTestId('undo-confirm-btn'))
    await waitFor(() => expect(view.getByRole('alert').textContent).toMatch(/session fork failed/))
    expect(view.getByTestId('undo-dialog')).toBeTruthy()
  })
})
