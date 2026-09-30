// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { UndoButton } from '../src/client/UndoButton.tsx'

afterEach(() => {
  cleanup()
})

describe('UndoButton', () => {
  const t = vi.fn((key: string) => key)

  it('renders the undo button and opens confirmation dialog on click', () => {
    const inject = {
      revert: vi.fn().mockResolvedValue({ success: true, newSessionId: 'sess-new', revertedFiles: [] }),
      openSession: vi.fn(),
    }

    const view = render(
      <UndoButton
        seq={3}
        messageId="msg-1"
        text="Sample prompt text"
        t={t as any}
        inject={inject}
      />,
    )

    const btn = view.getByTestId('undo-action-btn')
    expect(btn).toBeTruthy()

    // Dialog should not be visible initially
    expect(view.queryByTestId('undo-dialog')).toBeNull()

    // Click undo button
    fireEvent.click(btn)

    // Dialog should now be visible
    expect(view.getByTestId('undo-dialog')).toBeTruthy()
    expect(view.getByText('dialog.title')).toBeTruthy()

    // Click confirm
    const confirmBtn = view.getByTestId('undo-confirm-btn')
    fireEvent.click(confirmBtn)

    expect(inject.revert).toHaveBeenCalledWith(3)
  })

  it('renders retry button and supports load and sendNow options', async () => {
    const inject = {
      revert: vi.fn().mockResolvedValue({ success: true, newSessionId: 'sess-forked', revertedFiles: [] }),
      resend: vi.fn().mockResolvedValue(undefined),
      fillDraft: vi.fn().mockResolvedValue(undefined),
      openSession: vi.fn(),
    }

    const view = render(
      <UndoButton
        seq={4}
        messageId="msg-2"
        text="Fix this bug please"
        t={t as any}
        inject={inject}
      />,
    )

    const retryBtn = view.getByTestId('retry-action-btn')
    expect(retryBtn).toBeTruthy()

    fireEvent.click(retryBtn)
    expect(view.getByTestId('retry-dialog')).toBeTruthy()
    expect(view.getByText('dialog.retryTitle')).toBeTruthy()

    // Click retry load
    const loadBtn = view.getByTestId('retry-load-btn')
    fireEvent.click(loadBtn)

    expect(inject.revert).toHaveBeenCalledWith(4)
  })

  it('supports retry sendNow option', async () => {
    const inject = {
      revert: vi.fn().mockResolvedValue({ success: true, newSessionId: 'sess-forked-2', revertedFiles: [] }),
      resend: vi.fn().mockResolvedValue(undefined),
      openSession: vi.fn(),
    }

    const view = render(
      <UndoButton
        seq={5}
        messageId="msg-3"
        text="Auto resend this prompt"
        t={t as any}
        inject={inject}
      />,
    )

    fireEvent.click(view.getByTestId('retry-action-btn'))
    const sendBtn = view.getByTestId('retry-send-btn')
    fireEvent.click(sendBtn)

    expect(inject.revert).toHaveBeenCalledWith(5)
  })

  it('closes dialog when cancel button is clicked', () => {
    const inject = {
      revert: vi.fn(),
    }

    const view = render(
      <UndoButton
        seq={5}
        t={t as any}
        inject={inject}
      />,
    )

    fireEvent.click(view.getByTestId('undo-action-btn'))
    expect(view.getByTestId('undo-dialog')).toBeTruthy()

    fireEvent.click(view.getByText('dialog.cancel'))
    expect(view.queryByTestId('undo-dialog')).toBeNull()
    expect(inject.revert).not.toHaveBeenCalled()
  })
})
