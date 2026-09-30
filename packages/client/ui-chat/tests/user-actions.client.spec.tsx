// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { UserMessageNodeView } from '../src/client/chat/MessageItem.tsx'

afterEach(() => {
  cleanup()
})

describe('conversation.chat.user-actions', () => {
  it('invokes renderSlot with seq, messageId, and time for user message', () => {
    const renderSlot = vi.fn((_slotName: string, props: { seq: number; messageId: string; time: number }) => {
      return <button data-testid="user-action-btn">{props.seq}:{props.messageId}:{props.time}</button>
    })
    const node = {
      key: 'u1',
      kind: 'user' as const,
      anchorSeq: 1,
      location: { kind: 'turn' as const, turn: 0 },
      data: {
        kind: 'user' as const,
        seq: 1,
        time: 1234567890,
        content: [{ type: 'text', text: 'hello user 1' }],
        source: {},
        id: 'msg-123',
      },
    }
    const view = render(
      <UserMessageNodeView
        node={node as any}
        renderMessageImages={vi.fn(() => null)}
        openFile={vi.fn()}
        openSkill={vi.fn()}
        renderSlot={renderSlot as any}
        t={((key: string) => key) as any}
      />,
    )
    expect(renderSlot).toHaveBeenCalledWith(
      'conversation.chat.user-actions',
      expect.objectContaining({ seq: 1, messageId: 'msg-123', time: 1234567890, text: 'hello user 1' }),
    )
    expect(view.getByTestId('user-action-btn').textContent).toBe('1:msg-123:1234567890')
  })

  it('renders gracefully when renderSlot is absent', () => {
    const node = {
      key: 'u2',
      kind: 'user' as const,
      anchorSeq: 2,
      location: { kind: 'turn' as const, turn: 0 },
      data: {
        kind: 'user' as const,
        seq: 2,
        time: 1234567890,
        content: [{ type: 'text', text: 'hello user 2' }],
        source: {},
      },
    }
    const view = render(
      <UserMessageNodeView
        node={node as any}
        renderMessageImages={vi.fn(() => null)}
        openFile={vi.fn()}
        openSkill={vi.fn()}
        t={((key: string) => key) as any}
      />,
    )
    expect(view.getByText('hello user 2')).toBeTruthy()
  })
})
