// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'

afterEach(() => {
  cleanup()
})

describe('ui-undo plugin', () => {
  it('registers dictionary and user-actions slot', async () => {
    const ctx = new Context()
    const localeRegistered: any[] = []
    const slotsRegistered: any[] = []

    ctx.provide('locale', {
      register: (ns: string, dicts: any) => {
        localeRegistered.push({ ns, dicts })
      },
    } as any)

    ctx.provide('slots', {
      inject: (_slotName: string, cb: () => void) => {
        cb()
      },
      register: (opts: any, component: any) => {
        slotsRegistered.push({ opts, component })
      },
    } as any)

    await ctx.plugin({ apply })

    expect(localeRegistered).toHaveLength(1)
    expect(localeRegistered[0].ns).toBe('undo')

    expect(slotsRegistered).toHaveLength(1)
    expect(slotsRegistered[0].opts.name).toBe('conversation.chat.user-actions')
    expect(slotsRegistered[0].opts.id).toBe('undo')

    // Test inject function
    const injected = slotsRegistered[0].opts.inject('sess-test')
    expect(injected).toBeDefined()
    expect(typeof injected.revert).toBe('function')
  })
})
